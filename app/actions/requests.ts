'use server'

import type { ActionResult } from '@/lib/action-result'
import {
  type BusinessHours,
  type DayRequest,
  convertLegacyRequest,
  dayRequestOfRow,
  isDayRequestKind,
  requestSpan,
  toDayRequest,
} from '@/lib/day-request'
import { UserFacingError, check, runAction, toRow, toRows } from '@/lib/server/action'
import { type UsualAvailability, usualAvailabilityOf } from '@/lib/usual-availability'
import { type StaffCategory, isStaffCategory, sortStaff } from '@/lib/staff-order'
import { getStoreBusinessHours } from '@/lib/server/business-hours'
import { requireAdmin, requireSession } from '@/lib/server/dal'
import { deadlineDayOf, isDeadlineDay, requestDeadlineDate } from '@/lib/request-deadline'
import { CLEARED_ANALYSIS, type ExistingDayRequest, planMonthRequestSave } from '@/lib/server/request-save-plan'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { assert, isDateKey, isMonthStart, isRecord, isShortText, nextMonthStart, nextMonthStartInJapan } from '@/lib/server/validation'

const MAX_REQUEST_MEMO_LENGTH = 500

const REQUEST_COLUMNS = 'staff_id, date, is_off, memo, request_kind, start_time, end_time, parsed_request'

/**
 * One day's request as the request screen shows it. request is null only for a
 * legacy memo the rules could not read (shown as a memo until someone decides).
 */
export type DayRequestView = { date: string; memo: string; request: DayRequest | null }
export type StoreDayRequestView = DayRequestView & { staff_id: string }

export type RequestStaff = { id: string; name: string; is_employee: boolean; category: StaffCategory | null; display_order: number | null }

const getBusinessHours = getStoreBusinessHours

const toView = (row: Record<string, unknown>, hours: BusinessHours): DayRequestView => ({
  date: String(row.date),
  memo: typeof row.memo === 'string' ? row.memo : '',
  // Rows saved before requests were structured are shown converted; saving the month stores the conversion.
  request: row.request_kind != null ? dayRequestOfRow(row) : convertLegacyRequest(row, hours),
})

/** Everything the 休み希望 screen shows for one month, in one call. */
export type RequestsPageData = {
  month: string
  staff: RequestStaff[]
  /** Every staff member's requests in the month (store overview table; every staff member of the store may see it). */
  requests: StoreDayRequestView[]
  /** The logged-in staff member's own requests (calendar editor). */
  mine: DayRequestView[]
  /** The logged-in staff member's usual availability, shown faintly on days without a request. */
  usual: UsualAvailability
  hours: BusinessHours
  /** 提出期限 (YYYY-MM-DD, display only) and the store's 前月〇日 setting (22 when unset). */
  deadline: string
  deadlineDay: number
  /** イベント row: date → note. */
  events: Record<string, string>
}

/**
 * 休み希望 screen data for one month: the store-wide table and the logged-in
 * staff member's own days come from the same query. Called by the server page
 * for the first render and by the screen when the month changes.
 */
export async function getRequestsPageMonth(storeId: string, monthStart: string): Promise<ActionResult<RequestsPageData>> {
  return runAction('getRequestsPageMonth', async () => {
    const session = await requireSession(storeId)
    assert(isMonthStart(monthStart))
    const db = getAdminClient()
    const [staffResult, requestResult, hours, meResult, storeResult, eventResult] = await Promise.all([
      db.from('staff').select('id, name, is_employee, category, display_order').eq('store_id', storeId),
      db.from('shift_requests').select(REQUEST_COLUMNS)
        .eq('store_id', storeId).gte('date', monthStart).lt('date', nextMonthStart(monthStart)),
      getBusinessHours(storeId),
      db.from('staff').select('weekly_availability, work_start_1, work_end_1, work_start_2, work_end_2')
        .eq('id', session.id).eq('store_id', storeId).maybeSingle(),
      db.from('stores').select('request_deadline_day').eq('store_id', storeId).maybeSingle(),
      db.from('store_day_events').select('date, note')
        .eq('store_id', storeId).gte('date', monthStart).lt('date', nextMonthStart(monthStart)),
    ])
    check(staffResult.error)
    check(requestResult.error)
    check(meResult.error)
    check(storeResult.error)
    check(eventResult.error)
    const deadlineDay = deadlineDayOf(toRow(storeResult.data)?.request_deadline_day)
    const requests = toRows(requestResult.data).map(row => ({ ...toView(row, hours), staff_id: String(row.staff_id) }))
    return {
      month: monthStart,
      staff: sortStaff(toRows(staffResult.data).map(row => ({
        id: String(row.id),
        name: typeof row.name === 'string' ? row.name : '',
        is_employee: row.is_employee === true,
        category: isStaffCategory(row.category) ? row.category : null,
        display_order: typeof row.display_order === 'number' ? row.display_order : null,
      }))),
      requests,
      mine: requests.filter(request => request.staff_id === session.id)
        .map(request => ({ date: request.date, memo: request.memo, request: request.request })),
      usual: usualAvailabilityOf(toRow(meResult.data)),
      hours,
      deadline: requestDeadlineDate(monthStart, deadlineDay),
      deadlineDay,
      events: Object.fromEntries(toRows(eventResult.data).flatMap(row =>
        typeof row.note === 'string' && row.note ? [[String(row.date), row.note]] : [])),
    }
  })
}

const MAX_EVENT_LENGTH = 100

/** 提出期限 setting: requests are due on this day of the previous month (display only). Admin only. */
export async function saveRequestDeadlineDay(storeId: string, day: number): Promise<ActionResult<number>> {
  return runAction('saveRequestDeadlineDay', async () => {
    await requireAdmin(storeId)
    assert(isDeadlineDay(day), '1〜31日の中から選んでください。')
    const { error } = await getAdminClient().from('stores').update({ request_deadline_day: day }).eq('store_id', storeId)
    check(error)
    return day
  })
}

/** イベント row: sets (or, with an empty note, deletes) the store's note for one date. Admin only. */
export async function saveDayEvent(storeId: string, date: string, note: string): Promise<ActionResult<string>> {
  return runAction('saveDayEvent', async () => {
    await requireAdmin(storeId)
    const tooLong = `イベントは${MAX_EVENT_LENGTH}文字以内で入力してください。`
    assert(isDateKey(date) && isShortText(note, MAX_EVENT_LENGTH * 2), tooLong)
    const trimmed = note.trim()
    assert(trimmed.length <= MAX_EVENT_LENGTH, tooLong)
    const db = getAdminClient()
    if (!trimmed) {
      const { error } = await db.from('store_day_events').delete().eq('store_id', storeId).eq('date', date)
      check(error)
      return ''
    }
    const { error } = await db.from('store_day_events')
      .upsert({ store_id: storeId, date, note: trimmed, updated_at: new Date().toISOString() }, { onConflict: 'store_id,date' })
    check(error)
    return trimmed
  })
}

/**
 * kind null keeps a legacy memo-only day as it is (nobody has chosen yet);
 * it is accepted only together with a memo.
 */
export type DayRequestInput = { date: string; kind: DayRequest['kind'] | null; start: string | null; end: string | null; memo: string }

/**
 * Replaces the logged-in staff member's own requests for one month.
 * Months before next month (JST) are read-only, matching the screen.
 */
export async function saveMyMonthRequests(storeId: string, monthStart: string, entries: DayRequestInput[]): Promise<ActionResult<null>> {
  return runAction('saveMyMonthRequests', async () => {
    const session = await requireSession(storeId)
    assert(isMonthStart(monthStart) && Array.isArray(entries) && entries.length <= 31)
    if (monthStart < nextMonthStartInJapan()) throw new UserFacingError('この月の休み希望は締め切られています。')
    const monthEnd = nextMonthStart(monthStart)
    const hours = await getBusinessHours(storeId)

    const rows = entries.map(entry => {
      assert(isRecord(entry) && isDateKey(entry.date) && entry.date >= monthStart && entry.date < monthEnd)
      assert(isShortText(entry.memo, MAX_REQUEST_MEMO_LENGTH), 'メモは500文字以内で入力してください。')
      const memo = entry.memo.trim()
      if (entry.kind === null) {
        assert(memo.length > 0)
        return { date: entry.date, memo, is_off: false, request_kind: null, start_time: null, end_time: null }
      }
      assert(isDayRequestKind(entry.kind))
      const request = toDayRequest(entry.kind, entry.start, entry.end)
      assert(request, '時間を選び直してください。')
      if (request.kind === 'from' || request.kind === 'until' || request.kind === 'range') {
        assert(requestSpan(request, hours), '営業時間内の時間を選んでください。')
      }
      return { date: entry.date, memo, is_off: request.kind === 'off', request_kind: request.kind, start_time: request.start, end_time: request.end }
    })
    assert(new Set(rows.map(row => row.date)).size === rows.length)

    const db = getAdminClient()
    const { data: stored, error: readError } = await db.from('shift_requests').select('date, memo')
      .eq('store_id', storeId).eq('staff_id', session.id).gte('date', monthStart).lt('date', monthEnd)
    check(readError)
    const plan = planMonthRequestSave((stored ?? []) as ExistingDayRequest[], rows)
    const owned = <T extends object>(row: T) => ({ ...row, staff_id: session.id, store_id: storeId })

    // Upsert first and delete last: a failure part-way never loses a day that is still requested.
    // Each upsert sends one column set, so no row gets another row's missing columns defaulted to null.
    if (plan.keepAnalysis.length > 0) {
      const { error } = await db.from('shift_requests')
        .upsert(plan.keepAnalysis.map(owned), { onConflict: 'store_id,staff_id,date' })
      check(error)
    }
    if (plan.resetAnalysis.length > 0) {
      const { error } = await db.from('shift_requests')
        .upsert(plan.resetAnalysis.map(row => ({ ...owned(row), ...CLEARED_ANALYSIS })), { onConflict: 'store_id,staff_id,date' })
      check(error)
    }
    if (plan.deleteDates.length > 0) {
      const { error } = await db.from('shift_requests').delete()
        .eq('store_id', storeId).eq('staff_id', session.id).in('date', plan.deleteDates)
      check(error)
    }
    return null
  })
}
