'use server'

import type { ActionResult, DataRow } from '@/lib/action-result'
import { check, runAction, toRows } from '@/lib/server/action'
import { requireAdmin } from '@/lib/server/dal'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { assert, isDateKey, isRecord, isShortText } from '@/lib/server/validation'

// 清掃記録 is an admin-only screen.

const AREA_KEYS = ['1', '2', '3', '4', '5', '6', '7']

export async function getCleaningLogs(storeId: string, dates: string[]): Promise<ActionResult<DataRow[]>> {
  return runAction('getCleaningLogs', async () => {
    await requireAdmin(storeId)
    assert(Array.isArray(dates) && dates.length <= 6 && dates.every(isDateKey))
    if (dates.length === 0) return []
    const { data, error } = await getAdminClient().from('cleaning_logs')
      .select('id, store_id, date, areas, worker_name, memo, is_confirmed, confirmed_at, created_at, updated_at')
      .eq('store_id', storeId).in('date', dates)
    check(error)
    return toRows(data)
  })
}

export type CleaningLogInput = {
  date: string
  areas: Record<string, boolean>
  worker_name: string
  memo: string
  is_confirmed: boolean
  confirmed_at: string | null
}

export async function saveCleaningLogs(storeId: string, records: CleaningLogInput[]): Promise<ActionResult<number>> {
  return runAction('saveCleaningLogs', async () => {
    await requireAdmin(storeId)
    assert(Array.isArray(records) && records.length > 0 && records.length <= 6)
    const payloads = records.map(record => {
      assert(isRecord(record) && isDateKey(record.date))
      assert(isRecord(record.areas) && Object.entries(record.areas).every(([key, value]) => AREA_KEYS.includes(key) && typeof value === 'boolean'))
      assert(isShortText(record.worker_name, 100) && isShortText(record.memo, 1_000) && typeof record.is_confirmed === 'boolean')
      assert(record.confirmed_at === null || (typeof record.confirmed_at === 'string' && !Number.isNaN(Date.parse(record.confirmed_at))))
      return {
        store_id: storeId,
        date: record.date,
        areas: record.areas,
        worker_name: record.worker_name.trim(),
        memo: record.memo.trim(),
        is_confirmed: record.is_confirmed,
        confirmed_at: record.is_confirmed ? record.confirmed_at ?? new Date().toISOString() : null,
      }
    })
    const { error } = await getAdminClient().from('cleaning_logs').upsert(payloads, { onConflict: 'store_id,date' })
    check(error)
    return payloads.length
  })
}
