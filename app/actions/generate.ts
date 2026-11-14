'use server'

import type { ActionResult, DataRow } from '@/lib/action-result'
import { parseParsedShiftRequest } from '@/lib/parsed-conditions'
import { STAFF_SECRET_COLUMNS, STORE_SECRET_COLUMNS, check, omit, runAction, toRow, toRows } from '@/lib/server/action'
import { requireAdmin } from '@/lib/server/dal'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { assert, isId, isJsonWithin, isMonthStart, isRecord, isShortText, nextMonthStart } from '@/lib/server/validation'

// All actions in this file are admin-only (シフト自動生成).

const MAX_SCHEDULE_BYTES = 900_000
const MAX_SETTINGS_BYTES = 200_000

export type GenerateContext = {
  store: DataRow | null
  draft: DataRow | null
  settings: DataRow[]
  /** Latest weekday / weekend settings from earlier months, used when this month has none. */
  pastSettings: DataRow[]
}

export async function getGenerateContext(storeId: string, monthStart: string): Promise<ActionResult<GenerateContext>> {
  return runAction('getGenerateContext', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart))
    const db = getAdminClient()
    const [storeResult, draftResult, settingsResult, pastResult] = await Promise.all([
      db.from('stores').select('*').eq('store_id', storeId).maybeSingle(),
      db.from('monthly_shifts').select('*').eq('store_id', storeId).eq('target_month', monthStart).maybeSingle(),
      db.from('generation_settings').select('*').eq('store_id', storeId).eq('target_month', monthStart),
      db.from('generation_settings').select('*').eq('store_id', storeId)
        .in('config_type', ['wd', 'we']).order('target_month', { ascending: false }).limit(10),
    ])
    check(storeResult.error)
    check(draftResult.error)
    check(settingsResult.error)
    check(pastResult.error)
    const store = toRow(storeResult.data)
    return {
      store: store ? omit(store, STORE_SECRET_COLUMNS) : null,
      draft: toRow(draftResult.data),
      settings: toRows(settingsResult.data),
      pastSettings: toRows(pastResult.data),
    }
  })
}

export type GenerationSettingInput = { config_type: string; counts: unknown; slots: unknown }

/** Saves this month's settings and removes special-day settings that were deselected. */
export async function saveGenerationSettings(storeId: string, monthStart: string, entries: GenerationSettingInput[]): Promise<ActionResult<null>> {
  return runAction('saveGenerationSettings', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart) && Array.isArray(entries) && entries.length <= 40)
    assert(isJsonWithin(entries, MAX_SETTINGS_BYTES))
    const payload = entries.map(entry => {
      assert(isRecord(entry) && isShortText(entry.config_type, 40) && entry.config_type.length > 0)
      assert(isRecord(entry.counts) && isRecord(entry.slots))
      return { store_id: storeId, target_month: monthStart, config_type: entry.config_type, counts: entry.counts, slots: entry.slots }
    })
    const keep = new Set(payload.map(row => row.config_type))
    const db = getAdminClient()

    const { data: existing, error: fetchError } = await db.from('generation_settings').select('config_type')
      .eq('store_id', storeId).eq('target_month', monthStart)
    check(fetchError)
    const removeTypes = toRows(existing)
      .map(row => String(row.config_type))
      .filter(type => type !== 'wd' && type !== 'we' && !keep.has(type))
    if (removeTypes.length > 0) {
      const { error } = await db.from('generation_settings').delete()
        .eq('store_id', storeId).eq('target_month', monthStart).in('config_type', removeTypes)
      check(error)
    }
    const { error } = await db.from('generation_settings').upsert(payload, { onConflict: 'store_id, target_month, config_type' })
    check(error)
    return null
  })
}

export type GenerationInputs = { staff: DataRow[]; requests: DataRow[] }

export async function getGenerationInputs(storeId: string, monthStart: string): Promise<ActionResult<GenerationInputs>> {
  return runAction('getGenerationInputs', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart))
    const db = getAdminClient()
    const [staffResult, requestResult] = await Promise.all([
      db.from('staff').select('*').eq('store_id', storeId).order('name', { ascending: true }),
      db.from('shift_requests').select('*').eq('store_id', storeId).gte('date', monthStart).lt('date', nextMonthStart(monthStart)),
    ])
    check(staffResult.error)
    check(requestResult.error)
    return {
      staff: toRows(staffResult.data).map(row => omit(row, STAFF_SECRET_COLUMNS)),
      requests: toRows(requestResult.data),
    }
  })
}

/** Caches the AI interpretation of one day's request memo. */
export async function saveParsedShiftRequest(storeId: string, requestId: string, parsed: unknown): Promise<ActionResult<null>> {
  return runAction('saveParsedShiftRequest', async () => {
    await requireAdmin(storeId)
    assert(isId(requestId))
    const parsedRequest = parseParsedShiftRequest(parsed)
    assert(parsedRequest)
    const { error } = await getAdminClient().from('shift_requests').update({ parsed_request: parsedRequest })
      .eq('id', requestId).eq('store_id', storeId)
    check(error)
    return null
  })
}

/** Saves the month's schedule as a draft or publishes it (confirmed). */
export async function saveMonthlyShift(
  storeId: string,
  monthStart: string,
  status: 'draft' | 'confirmed',
  scheduleData: unknown,
): Promise<ActionResult<null>> {
  return runAction('saveMonthlyShift', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart) && (status === 'draft' || status === 'confirmed'))
    assert(isRecord(scheduleData) && Array.isArray(scheduleData.staff))
    assert(isJsonWithin(scheduleData, MAX_SCHEDULE_BYTES), 'シフトのデータが大きすぎます。')
    const { error } = await getAdminClient().from('monthly_shifts').upsert({
      store_id: storeId,
      target_month: monthStart,
      status,
      schedule_data: scheduleData,
    }, { onConflict: 'store_id,target_month' })
    check(error)
    return null
  })
}

export async function deleteMonthlyShift(storeId: string, monthStart: string): Promise<ActionResult<null>> {
  return runAction('deleteMonthlyShift', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart))
    const { error } = await getAdminClient().from('monthly_shifts').delete()
      .eq('store_id', storeId).eq('target_month', monthStart)
    check(error)
    return null
  })
}
