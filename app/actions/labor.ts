'use server'

import type { ActionResult } from '@/lib/action-result'
import { isHoliday } from '@/lib/holidays'
import { type LaborRules, laborRuleColumns, laborRulesOf, parseLaborRulesInput } from '@/lib/labor-rules'
import { type DayType, type PastSchedule, type RequiredCurve, pastStaffingCurve } from '@/lib/required-curve'
import { check, runAction, toRow, toRows } from '@/lib/server/action'
import { requireAdmin } from '@/lib/server/dal'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { assert, isMonthStart, isRecord, isShortText } from '@/lib/server/validation'

// All actions in this file are admin-only (シフト生成のルール・人時売上の設定).

/** ルール設定: saves the store's labor and on-site rules. */
export async function saveStoreRules(storeId: string, input: unknown): Promise<ActionResult<LaborRules>> {
  return runAction('saveStoreRules', async () => {
    await requireAdmin(storeId)
    const rules = parseLaborRulesInput(input)
    assert(rules, 'ルール設定の値を確認してください。')
    const { data, error } = await getAdminClient().from('stores').update(laborRuleColumns(rules)).eq('store_id', storeId)
      .select('*').maybeSingle()
    check(error)
    return laborRulesOf(toRow(data))
  })
}

const WINDOW_DAYS = 77 // the last 11 weeks

const dateKeyOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const isWeekendOrHoliday = (date: string) => {
  const weekday = new Date(`${date}T00:00:00`).getDay()
  return weekday === 0 || weekday === 6 || isHoliday(date)
}

export type PastStaffingCurveResult = {
  from: string
  to: string
  wd: { curve: RequiredCurve; days: number }
  we: { curve: RequiredCurve; days: number }
}

/**
 * 「過去の実績から作る」: average people per job and hour in the confirmed
 * schedules of the 11 weeks before the month (平日 / 土日祝 separately).
 */
export async function getPastStaffingCurve(storeId: string, monthStart: string): Promise<ActionResult<PastStaffingCurveResult>> {
  return runAction('getPastStaffingCurve', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart))
    const end = new Date(`${monthStart}T00:00:00`)
    end.setDate(0)
    const start = new Date(end)
    start.setDate(end.getDate() - (WINDOW_DAYS - 1))
    const from = dateKeyOf(start)
    const to = dateKeyOf(end)
    const { data, error } = await getAdminClient().from('monthly_shifts').select('schedule_data')
      .eq('store_id', storeId).eq('status', 'confirmed')
      .gte('target_month', `${from.slice(0, 7)}-01`).lt('target_month', monthStart)
    check(error)
    const schedules: PastSchedule[] = toRows(data).flatMap(row => {
      const schedule = toRow(row.schedule_data)
      return schedule && Array.isArray(schedule.staff) ? [schedule as unknown as PastSchedule] : []
    })
    return { from, to, ...pastStaffingCurve(schedules, from, to, isWeekendOrHoliday) }
  })
}

export type HourlySalesRow = { hour: number; sales: number; customers: number | null }
export type HourlySalesSet = { rows: HourlySalesRow[]; source: 'manual' | 'pos' | null; periodLabel: string | null; updatedAt: string | null }

/** Average sales per hour for 平日 (wd) and 土日祝 (we). */
export async function getHourlySales(storeId: string): Promise<ActionResult<Record<DayType, HourlySalesSet>>> {
  return runAction('getHourlySales', async () => {
    await requireAdmin(storeId)
    const { data, error } = await getAdminClient().from('store_hourly_sales')
      .select('day_type, hour, sales, customers, source, period_label, updated_at').eq('store_id', storeId).order('hour')
    check(error)
    const empty = (): HourlySalesSet => ({ rows: [], source: null, periodLabel: null, updatedAt: null })
    const result: Record<DayType, HourlySalesSet> = { wd: empty(), we: empty() }
    for (const row of toRows(data)) {
      const type: DayType = row.day_type === 'we' ? 'we' : 'wd'
      const customers = typeof row.customers === 'number' ? row.customers : row.customers == null ? null : Number(row.customers)
      result[type].rows.push({ hour: Number(row.hour), sales: Number(row.sales), customers: Number.isFinite(customers) ? customers : null })
      result[type].source = row.source === 'pos' ? 'pos' : 'manual'
      result[type].periodLabel = typeof row.period_label === 'string' ? row.period_label : null
      result[type].updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null
    }
    return result
  })
}

/** Replaces the hourly averages of one day type (hand entry or the POS report). */
export async function saveHourlySales(
  storeId: string,
  dayType: DayType,
  rows: HourlySalesRow[],
  source: 'manual' | 'pos',
  periodLabel: string | null,
): Promise<ActionResult<null>> {
  return runAction('saveHourlySales', async () => {
    await requireAdmin(storeId)
    assert((dayType === 'wd' || dayType === 'we') && (source === 'manual' || source === 'pos'))
    assert(periodLabel === null || isShortText(periodLabel, 100))
    assert(Array.isArray(rows) && rows.length <= 24)
    const cleaned = rows.map(row => {
      assert(isRecord(row) && typeof row.hour === 'number' && Number.isInteger(row.hour) && row.hour >= 0 && row.hour <= 23)
      assert(typeof row.sales === 'number' && Number.isInteger(row.sales) && row.sales >= 0 && row.sales <= 100_000_000, '売上は0以上の整数で入力してください。')
      assert(row.customers === null || (typeof row.customers === 'number' && row.customers >= 0 && row.customers <= 100_000))
      return { store_id: storeId, day_type: dayType, hour: row.hour, sales: row.sales, customers: row.customers === null ? null : Math.round(row.customers * 10) / 10, source, period_label: periodLabel, updated_at: new Date().toISOString() }
    })
    assert(new Set(cleaned.map(row => row.hour)).size === cleaned.length)
    const db = getAdminClient()
    const { error: deleteError } = await db.from('store_hourly_sales').delete().eq('store_id', storeId).eq('day_type', dayType)
    check(deleteError)
    if (cleaned.length > 0) {
      const { error } = await db.from('store_hourly_sales').insert(cleaned)
      check(error)
    }
    return null
  })
}
