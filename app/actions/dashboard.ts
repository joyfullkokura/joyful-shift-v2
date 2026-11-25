'use server'

import type { ActionResult, DataRow } from '@/lib/action-result'
import { getConditionChangeDetails, getNewStaffRegistrationDetails } from '@/lib/staff-request-details'
import { JOB_OPTIONS, MAX_MEMO_LENGTH, WEEKLY_DAY_OPTIONS } from '@/lib/staff-profile-options'
import { UserFacingError, check, runAction, toRow, toRows } from '@/lib/server/action'
import { getStoreBusinessHours, weeklyAvailabilityColumns } from '@/lib/server/business-hours'
import { applyWeeklyAvailabilityChange } from '@/lib/weekly-availability'
import { type BusinessHours, businessHoursOf } from '@/lib/day-request'
import { requireAdmin, requireSession } from '@/lib/server/dal'
import { loadStaffRank } from '@/lib/server/staff-order'
import { type StaffCategory, type StaffRank, isStaffCategory, suggestCategory } from '@/lib/staff-order'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { clearFailures, staffThrottleKey } from '@/lib/server/throttle'
import { assert, isDateKey, isId, isMonthStart, isShortText } from '@/lib/server/validation'

const PROFILE_COLUMNS = 'id, name, weekly_target_days, main_job, memo, skills, work_start_1, work_end_1, work_start_2, work_end_2, is_employee, parsed_conditions, weekly_availability'
const REQUEST_COLUMNS = 'id, staff_id, type, details, status, is_read_by_staff, created_at, resolved_at'

export type LockedStaff = { id: string; name: string; lockedUntil: string }

export type DashboardData = {
  store: { name: string | null; notice: string | null; skill_options: unknown; hours: BusinessHours } | null
  schedule: unknown
  pinResetRequests: DataRow[]
  staffProfiles: DataRow[]
  conditionRequests: DataRow[]
  newStaffRequests: DataRow[]
  lockedStaff: LockedStaff[]
  /** Current paper-form order (id → position) for the shift list. */
  staffRank: StaffRank
}

/**
 * Home screen data in one round trip. Staff members only receive their own
 * profile and requests; admins receive the whole store.
 */
export async function getDashboard(storeId: string, targetMonth: string): Promise<ActionResult<DashboardData>> {
  return runAction('getDashboard', async () => {
    const session = await requireSession(storeId)
    assert(isMonthStart(targetMonth))
    const db = getAdminClient()
    const isAdmin = session.is_employee

    const profilesQuery = db.from('staff').select(PROFILE_COLUMNS).eq('store_id', storeId).order('name')
    const conditionQuery = db.from('staff_requests').select(REQUEST_COLUMNS)
      .eq('store_id', storeId).eq('type', 'condition_change').order('created_at', { ascending: false })

    const [storeResult, shiftResult, profilesResult, conditionResult, staffRank] = await Promise.all([
      db.from('stores').select('name, notice, skill_options, open_time, close_time').eq('store_id', storeId).maybeSingle(),
      db.from('monthly_shifts').select('schedule_data')
        .eq('store_id', storeId).eq('target_month', targetMonth).eq('status', 'confirmed')
        .order('created_at', { ascending: false }).limit(1),
      isAdmin ? profilesQuery : profilesQuery.eq('id', session.id),
      isAdmin ? conditionQuery : conditionQuery.eq('staff_id', session.id),
      loadStaffRank(storeId),
    ])
    check(storeResult.error)
    check(shiftResult.error)
    check(profilesResult.error)
    check(conditionResult.error)

    const store = toRow(storeResult.data)
    const staffProfiles = toRows(profilesResult.data)
    const latestShift = toRows(shiftResult.data)[0]

    let pinResetRequests: DataRow[] = []
    let newStaffRequests: DataRow[] = []
    let lockedStaff: LockedStaff[] = []
    if (isAdmin) {
      const [resetResult, newStaffResult, lockResult] = await Promise.all([
        db.from('staff').select('id, name').eq('store_id', storeId).eq('pin_reset_requested', true).order('name'),
        db.from('staff_requests').select(REQUEST_COLUMNS)
          .eq('store_id', storeId).eq('type', 'new_staff').eq('status', 'pending')
          .order('created_at', { ascending: false }),
        staffProfiles.length > 0
          ? db.from('auth_throttle').select('key, locked_until')
            .in('key', staffProfiles.map(profile => staffThrottleKey(String(profile.id))))
            .gt('locked_until', new Date().toISOString())
          : Promise.resolve({ data: [], error: null }),
      ])
      check(resetResult.error)
      check(newStaffResult.error)
      check(lockResult.error)
      pinResetRequests = toRows(resetResult.data)
      newStaffRequests = toRows(newStaffResult.data)
      const names = new Map(staffProfiles.map(profile => [staffThrottleKey(String(profile.id)), String(profile.name ?? '')]))
      lockedStaff = toRows(lockResult.data).flatMap(row => {
        const key = String(row.key)
        return typeof row.locked_until === 'string' && names.has(key)
          ? [{ id: key.slice('staff:'.length), name: names.get(key) ?? '', lockedUntil: row.locked_until }]
          : []
      })
    }

    return {
      store: store ? {
        name: typeof store.name === 'string' ? store.name : null,
        notice: typeof store.notice === 'string' ? store.notice : null,
        skill_options: store.skill_options,
        hours: businessHoursOf(store.open_time, store.close_time),
      } : null,
      schedule: latestShift?.schedule_data ?? null,
      pinResetRequests,
      staffProfiles,
      conditionRequests: toRows(conditionResult.data),
      newStaffRequests,
      lockedStaff,
      staffRank,
    }
  })
}

/** Whether the logged-in staff member has requested the given day off. */
export async function getMyDayOff(storeId: string, date: string): Promise<ActionResult<boolean>> {
  return runAction('getMyDayOff', async () => {
    const session = await requireSession(storeId)
    assert(isDateKey(date))
    const { data, error } = await getAdminClient().from('shift_requests').select('is_off')
      .eq('store_id', storeId).eq('staff_id', session.id).eq('date', date).maybeSingle()
    check(error)
    return toRow(data)?.is_off === true
  })
}

/** Count used for the notification dot. */
export async function getUnreadNotificationCount(storeId: string): Promise<ActionResult<number>> {
  return runAction('getUnreadNotificationCount', async () => {
    const session = await requireSession(storeId)
    const query = getAdminClient().from('staff_requests').select('id', { count: 'exact', head: true }).eq('store_id', storeId)
    const { count, error } = session.is_employee
      ? await query.eq('status', 'pending')
      : await query.eq('staff_id', session.id).eq('is_read_by_staff', false).neq('status', 'pending')
    check(error)
    return count ?? 0
  })
}

export async function saveStoreNotice(storeId: string, notice: string): Promise<ActionResult<string>> {
  return runAction('saveStoreNotice', async () => {
    await requireAdmin(storeId)
    assert(isShortText(notice, MAX_MEMO_LENGTH), 'お知らせは2000文字以内で入力してください。')
    const trimmed = notice.trim()
    const { error } = await getAdminClient().from('stores').update({ notice: trimmed }).eq('store_id', storeId)
    check(error)
    return trimmed
  })
}

const PENDING_CONDITION_CHANGE = '申請中の変更があります。店長の確認をお待ちください。'

/**
 * A staff member asks the manager to change their own working conditions.
 * Only one request may be pending per person (also enforced by a unique index).
 */
export async function submitConditionChange(storeId: string, details: unknown): Promise<ActionResult<DataRow>> {
  return runAction('submitConditionChange', async () => {
    const session = await requireSession(storeId)
    const parsed = getConditionChangeDetails(details)
    assert(parsed)
    // New requests never carry the old single time band.
    assert(parsed.available_hours === undefined)
    assert(parsed.weekly_target_days === undefined || WEEKLY_DAY_OPTIONS.includes(parsed.weekly_target_days))
    assert(parsed.main_job === undefined || JOB_OPTIONS.includes(parsed.main_job))
    assert(parsed.memo === undefined || parsed.memo.length <= MAX_MEMO_LENGTH)
    assert(!parsed.skills || (parsed.skills.length <= 30 && parsed.skills.every(skill => skill.length <= 50)))

    const db = getAdminClient()
    const { count, error: pendingError } = await db.from('staff_requests').select('id', { count: 'exact', head: true })
      .eq('store_id', storeId).eq('staff_id', session.id).eq('type', 'condition_change').eq('status', 'pending')
    check(pendingError)
    if ((count ?? 0) > 0) throw new UserFacingError(PENDING_CONDITION_CHANGE)

    const { data, error } = await db.from('staff_requests')
      .insert({
        store_id: storeId,
        staff_id: session.id,
        type: 'condition_change',
        details: parsed.memo === undefined ? parsed : { ...parsed, memo: parsed.memo.trim() },
        status: 'pending',
      })
      .select(REQUEST_COLUMNS)
      .single()
    // 23505: a request sent at the same moment won the unique index (migration F).
    if (error?.code === '23505') throw new UserFacingError(PENDING_CONDITION_CHANGE)
    check(error)
    const row = toRow(data)
    if (!row) throw new Error('Insert returned no row.')
    return row
  })
}

const loadPendingRequest = async (storeId: string, requestId: string, type: 'condition_change' | 'new_staff'): Promise<DataRow> => {
  const { data, error } = await getAdminClient().from('staff_requests').select(REQUEST_COLUMNS)
    .eq('id', requestId).eq('store_id', storeId).eq('type', type).maybeSingle()
  check(error)
  const row = toRow(data)
  if (!row) throw new UserFacingError('申請が見つかりません。')
  if (row.status !== 'pending') throw new UserFacingError('この申請はすでに処理されています。')
  return row
}

export type ResolvedConditionRequest = { resolvedAt: string; staffUpdate: DataRow | null }

/**
 * Admin approval of a condition change. The stored request details are
 * applied (never values sent by the client).
 */
export async function resolveConditionRequest(storeId: string, requestId: string, approved: boolean): Promise<ActionResult<ResolvedConditionRequest>> {
  return runAction('resolveConditionRequest', async () => {
    await requireAdmin(storeId)
    assert(isId(requestId) && typeof approved === 'boolean')
    const request = await loadPendingRequest(storeId, requestId, 'condition_change')
    const staffId = String(request.staff_id)
    const db = getAdminClient()

    let staffUpdate: DataRow | null = null
    if (approved) {
      const details = getConditionChangeDetails(request.details)
      if (!details) throw new UserFacingError('申請内容を読み込めませんでした。')
      // Weekday times: the requested days over the person's choices as they are now,
      // so changes the manager made in the roster after the request was sent are kept.
      let weeklyColumns = {}
      if (details.weekly_availability) {
        const { data: current, error: currentError } = await db.from('staff')
          .select('weekly_availability, work_start_1, work_end_1, work_start_2, work_end_2')
          .eq('id', staffId).eq('store_id', storeId).maybeSingle()
        check(currentError)
        const merged = applyWeeklyAvailabilityChange(toRow(current), details.weekly_availability)
        if (!merged) throw new UserFacingError('曜日ごとの時間がそろわないため承認できません。名簿で曜日ごとの時間を設定してから承認してください。')
        weeklyColumns = weeklyAvailabilityColumns(merged, await getStoreBusinessHours(storeId))
      }
      // Only the fields the request contains are changed.
      staffUpdate = {
        ...(details.weekly_target_days !== undefined ? { weekly_target_days: details.weekly_target_days } : {}),
        ...(details.main_job !== undefined ? { main_job: details.main_job } : {}),
        ...(details.memo !== undefined ? { memo: details.memo } : {}),
        ...(details.skills ? { skills: details.skills.join(',') } : {}),
        ...(details.available_hours !== undefined ? {
          work_start_1: details.available_hours?.start || null,
          work_end_1: details.available_hours?.end || null,
        } : {}),
        ...weeklyColumns,
      }
      const { error } = await db.from('staff').update(staffUpdate).eq('id', staffId).eq('store_id', storeId)
      check(error)
    }

    const resolvedAt = new Date().toISOString()
    const { error } = await db.from('staff_requests')
      .update({ status: approved ? 'approved' : 'rejected', resolved_at: resolvedAt })
      .eq('id', requestId).eq('store_id', storeId)
    check(error)
    return { resolvedAt, staffUpdate }
  })
}

/**
 * Admin approval / rejection of a self-registered staff member. On approval the
 * person goes to the end of the chosen category (the paper-form order).
 */
export async function resolveNewStaffRequest(
  storeId: string,
  requestId: string,
  approved: boolean,
  category: StaffCategory | null = null,
): Promise<ActionResult<{ name: string }>> {
  return runAction('resolveNewStaffRequest', async () => {
    await requireAdmin(storeId)
    assert(isId(requestId) && typeof approved === 'boolean')
    assert(category === null || isStaffCategory(category))
    const request = await loadPendingRequest(storeId, requestId, 'new_staff')
    const details = getNewStaffRegistrationDetails(request.details)
    if (!details) throw new UserFacingError('新規登録申請の内容を読み込めませんでした。')
    const staffId = String(request.staff_id)
    const db = getAdminClient()
    const resolvedAt = new Date().toISOString()

    if (approved) {
      const chosenCategory = category ?? suggestCategory({
        isEmployee: details.employment_type === '社員',
        main_job: details.main_job,
        weekly_availability: details.weekly_availability,
        work_start_1: details.work_start_1,
      })
      const { data: last, error: lastError } = await db.from('staff').select('display_order')
        .eq('store_id', storeId).eq('category', chosenCategory).not('display_order', 'is', null)
        .order('display_order', { ascending: false }).limit(1)
      check(lastError)
      const lastOrder = toRows(last)[0]?.display_order
      const { error } = await db.from('staff').update({
        category: chosenCategory,
        display_order: (typeof lastOrder === 'number' ? lastOrder : 0) + 1,
        is_employee: details.employment_type === '社員',
        main_job: details.main_job,
        weekly_target_days: details.weekly_target_days,
        ...(details.weekly_availability
          ? weeklyAvailabilityColumns(details.weekly_availability, await getStoreBusinessHours(storeId))
          : {
              work_start_1: details.work_start_1,
              work_end_1: details.work_end_1,
              work_start_2: details.work_start_2,
              work_end_2: details.work_end_2,
            }),
        memo: details.memo,
      }).eq('id', staffId).eq('store_id', storeId)
      check(error)
      const { error: requestError } = await db.from('staff_requests')
        .update({ status: 'approved', resolved_at: resolvedAt }).eq('id', requestId).eq('store_id', storeId)
      check(requestError)
    } else {
      const { error: requestError } = await db.from('staff_requests')
        .update({ status: 'rejected', resolved_at: resolvedAt }).eq('id', requestId).eq('store_id', storeId)
      check(requestError)
      const { error } = await db.from('staff').delete().eq('id', staffId).eq('store_id', storeId)
      check(error)
    }
    return { name: details.name }
  })
}

export async function markConditionRequestRead(storeId: string, requestId: string): Promise<ActionResult<null>> {
  return runAction('markConditionRequestRead', async () => {
    const session = await requireSession(storeId)
    assert(isId(requestId))
    const { error } = await getAdminClient().from('staff_requests').update({ is_read_by_staff: true })
      .eq('id', requestId).eq('store_id', storeId).eq('staff_id', session.id)
    check(error)
    return null
  })
}

/** Admin: lift a PIN lockout (e.g. after a staff member's own typos). */
export async function unlockStaffPin(storeId: string, staffId: string): Promise<ActionResult<null>> {
  return runAction('unlockStaffPin', async () => {
    await requireAdmin(storeId)
    assert(isId(staffId))
    const { data, error } = await getAdminClient().from('staff').select('id').eq('id', staffId).eq('store_id', storeId).maybeSingle()
    check(error)
    if (!toRow(data)) throw new UserFacingError('対象のスタッフが見つかりません。')
    await clearFailures(staffThrottleKey(staffId))
    return null
  })
}
