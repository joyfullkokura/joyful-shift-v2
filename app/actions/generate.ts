'use server'

import type { ActionResult, DataRow } from '@/lib/action-result'
import { type DayRequest, type DayRequestKind, businessHoursOf, convertLegacyRequest, toDayRequest } from '@/lib/day-request'
import { STAFF_SECRET_COLUMNS, STORE_SECRET_COLUMNS, check, omit, runAction, toRow, toRows } from '@/lib/server/action'
import { requireAdmin } from '@/lib/server/dal'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { assert, isId, isJsonWithin, isMonthStart, isRecord, isShortText, nextMonthStart } from '@/lib/server/validation'

// All actions in this file are admin-only (シフト自動生成).

const MAX_SCHEDULE_BYTES = 900_000
const MAX_SETTINGS_BYTES = 200_000

/** An old memo-only request the rules could not read: the manager decides on the generate screen. */
export type RequestReview = { id: string; staff_id: string; staff_name: string; date: string; memo: string }

export type GenerationInputs = { staff: DataRow[]; requests: DataRow[]; reviews: RequestReview[] }

const CONVERSION_CONCURRENCY = 5

/**
 * Reads the month's requests and converts rows saved before requests were
 * structured (rules on the memo, see convertLegacyRequest). Converted rows are
 * written back once; rows nobody can read stay null and are listed for review.
 */
const loadMonthRequests = async (storeId: string, monthStart: string): Promise<{ requests: DataRow[]; pending: DataRow[] }> => {
  const db = getAdminClient()
  const [requestResult, storeResult] = await Promise.all([
    db.from('shift_requests').select('*').eq('store_id', storeId).gte('date', monthStart).lt('date', nextMonthStart(monthStart)),
    db.from('stores').select('open_time, close_time').eq('store_id', storeId).maybeSingle(),
  ])
  check(requestResult.error)
  check(storeResult.error)
  const store = toRow(storeResult.data)
  const hours = businessHoursOf(store?.open_time, store?.close_time)
  const requests = toRows(requestResult.data)

  const conversions = requests
    .filter(row => row.request_kind == null)
    .map(row => ({ row, request: convertLegacyRequest(row, hours) }))
  const converted = conversions.filter((item): item is { row: DataRow; request: DayRequest } => item.request !== null)
  for (let index = 0; index < converted.length; index += CONVERSION_CONCURRENCY) {
    await Promise.all(converted.slice(index, index + CONVERSION_CONCURRENCY).map(async ({ row, request }) => {
      const fields = { request_kind: request.kind, start_time: request.start, end_time: request.end, is_off: request.kind === 'off' }
      // Only rows still unconverted: a staff member may have saved the day meanwhile.
      const { error } = await db.from('shift_requests').update(fields)
        .eq('id', row.id).eq('store_id', storeId).is('request_kind', null)
      check(error)
      Object.assign(row, fields)
    }))
  }
  if (converted.length > 0) {
    console.info(JSON.stringify({ event: 'legacy_requests_converted', count: converted.length, pending: conversions.length - converted.length }))
  }
  return { requests, pending: conversions.filter(item => item.request === null).map(item => item.row) }
}

const toReviews = (pending: DataRow[], staff: DataRow[]): RequestReview[] => {
  const names = new Map(staff.map(row => [String(row.id), typeof row.name === 'string' ? row.name : '']))
  return pending
    .map(row => ({
      id: String(row.id),
      staff_id: String(row.staff_id),
      staff_name: names.get(String(row.staff_id)) || 'スタッフ',
      date: String(row.date),
      memo: typeof row.memo === 'string' ? row.memo : '',
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.staff_name.localeCompare(right.staff_name, 'ja'))
}

export type GenerateContext = {
  store: DataRow | null
  draft: DataRow | null
  settings: DataRow[]
  /** Latest weekday / weekend settings from earlier months, used when this month has none. */
  pastSettings: DataRow[]
  /** 要確認の要望 of the month (old memos the rules could not read). */
  reviews: RequestReview[]
}

export async function getGenerateContext(storeId: string, monthStart: string): Promise<ActionResult<GenerateContext>> {
  return runAction('getGenerateContext', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart))
    const db = getAdminClient()
    const [storeResult, draftResult, settingsResult, pastResult, staffResult, { pending }] = await Promise.all([
      db.from('stores').select('*').eq('store_id', storeId).maybeSingle(),
      db.from('monthly_shifts').select('*').eq('store_id', storeId).eq('target_month', monthStart).maybeSingle(),
      db.from('generation_settings').select('*').eq('store_id', storeId).eq('target_month', monthStart),
      db.from('generation_settings').select('*').eq('store_id', storeId)
        .in('config_type', ['wd', 'we']).order('target_month', { ascending: false }).limit(10),
      db.from('staff').select('id, name').eq('store_id', storeId),
      loadMonthRequests(storeId, monthStart),
    ])
    check(staffResult.error)
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
      reviews: toReviews(pending, toRows(staffResult.data)),
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

export async function getGenerationInputs(storeId: string, monthStart: string): Promise<ActionResult<GenerationInputs>> {
  return runAction('getGenerationInputs', async () => {
    await requireAdmin(storeId)
    assert(isMonthStart(monthStart))
    const db = getAdminClient()
    const [staffResult, { requests, pending }] = await Promise.all([
      db.from('staff').select('*').eq('store_id', storeId).order('name', { ascending: true }),
      loadMonthRequests(storeId, monthStart),
    ])
    check(staffResult.error)
    const staff = toRows(staffResult.data)
    return {
      staff: staff.map(row => omit(row, STAFF_SECRET_COLUMNS)),
      requests,
      reviews: toReviews(pending, staff),
    }
  })
}

/** The manager decides what an unreadable old memo means. The memo itself is kept. */
export async function resolveShiftRequest(
  storeId: string,
  requestId: string,
  kind: DayRequestKind,
  start: string | null,
  end: string | null,
): Promise<ActionResult<DayRequest>> {
  return runAction('resolveShiftRequest', async () => {
    await requireAdmin(storeId)
    assert(isId(requestId))
    const request = toDayRequest(kind, start, end)
    assert(request, '時間を選び直してください。')
    const { data, error } = await getAdminClient().from('shift_requests')
      .update({ request_kind: request.kind, start_time: request.start, end_time: request.end, is_off: request.kind === 'off' })
      .eq('id', requestId).eq('store_id', storeId)
      .select('id')
    check(error)
    assert(toRows(data).length === 1, 'この要望は見つかりませんでした。画面を開き直してください。')
    return request
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
