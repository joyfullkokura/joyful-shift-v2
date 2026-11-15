'use server'

import type { ActionResult, DataRow } from '@/lib/action-result'
import { UserFacingError, check, runAction, toRows } from '@/lib/server/action'
import { requireSession } from '@/lib/server/dal'
import { CLEARED_ANALYSIS, type ExistingDayRequest, type IncomingDayRequest, planMonthRequestSave } from '@/lib/server/request-save-plan'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { assert, isDateKey, isMonthStart, isRecord, isShortText, nextMonthStart, nextMonthStartInJapan } from '@/lib/server/validation'

const MAX_REQUEST_MEMO_LENGTH = 500

export type RequestsMonthData = {
  staff: DataRow[]
  /** Every staff member's requests in the month (store overview table). */
  requests: DataRow[]
}

/** 休み希望 screen: store-wide overview for the month. Any logged-in staff of the store. */
export async function getRequestsMonth(storeId: string, monthStart: string): Promise<ActionResult<RequestsMonthData>> {
  return runAction('getRequestsMonth', async () => {
    await requireSession(storeId)
    assert(isMonthStart(monthStart))
    const db = getAdminClient()
    const [staffResult, requestResult] = await Promise.all([
      db.from('staff').select('id, name, is_employee').eq('store_id', storeId).order('name'),
      db.from('shift_requests').select('staff_id, date, is_off, memo')
        .eq('store_id', storeId).gte('date', monthStart).lt('date', nextMonthStart(monthStart)),
    ])
    check(staffResult.error)
    check(requestResult.error)
    return { staff: toRows(staffResult.data), requests: toRows(requestResult.data) }
  })
}

export type DayRequestInput = { date: string; is_off: boolean; memo: string }

/**
 * Replaces the logged-in staff member's own requests for one month. Days whose
 * memo did not change keep their cached AI analysis (parsed_request).
 * Months before next month (JST) are read-only, matching the screen.
 */
export async function saveMyMonthRequests(storeId: string, monthStart: string, entries: DayRequestInput[]): Promise<ActionResult<null>> {
  return runAction('saveMyMonthRequests', async () => {
    const session = await requireSession(storeId)
    assert(isMonthStart(monthStart) && Array.isArray(entries) && entries.length <= 31)
    if (monthStart < nextMonthStartInJapan()) throw new UserFacingError('この月の休み希望は締め切られています。')
    const monthEnd = nextMonthStart(monthStart)

    const rows = entries.map(entry => {
      assert(isRecord(entry) && isDateKey(entry.date) && entry.date >= monthStart && entry.date < monthEnd)
      assert(typeof entry.is_off === 'boolean' && isShortText(entry.memo, MAX_REQUEST_MEMO_LENGTH), 'メモは500文字以内で入力してください。')
      return { date: entry.date, is_off: entry.is_off, memo: entry.memo }
    })
    assert(new Set(rows.map(row => row.date)).size === rows.length)

    const db = getAdminClient()
    const { data: stored, error: readError } = await db.from('shift_requests').select('date, memo')
      .eq('store_id', storeId).eq('staff_id', session.id).gte('date', monthStart).lt('date', monthEnd)
    check(readError)
    const plan = planMonthRequestSave((stored ?? []) as ExistingDayRequest[], rows)
    const owned = (row: IncomingDayRequest) => ({ ...row, staff_id: session.id, store_id: storeId })

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

/** The logged-in staff member's own requests for one month (calendar editor). */
export async function getMyMonthRequests(storeId: string, monthStart: string): Promise<ActionResult<DataRow[]>> {
  return runAction('getMyMonthRequests', async () => {
    const session = await requireSession(storeId)
    assert(isMonthStart(monthStart))
    const { data, error } = await getAdminClient().from('shift_requests').select('date, is_off, memo')
      .eq('store_id', storeId).eq('staff_id', session.id).gte('date', monthStart).lt('date', nextMonthStart(monthStart))
    check(error)
    return toRows(data)
  })
}
