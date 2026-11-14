'use server'

import { after } from 'next/server'
import type {
  LoginResult,
  NewStaffRegistrationInput,
  PinCheckResult,
  SessionStaff,
  SetupProfileInput,
  SetupResult,
  SimpleResult,
} from '@/lib/auth-types'
import {
  EMPLOYMENT_TYPE_OPTIONS,
  JOB_OPTIONS,
  MAX_MEMO_LENGTH,
  MAX_NAME_LENGTH,
  TIME_OPTIONS,
  WEEKLY_DAY_OPTIONS,
} from '@/lib/staff-profile-options'
import {
  AuthorizationError,
  getPendingNewStaffIds,
  getStaffAuthRow,
  getStoreName,
  isValidStoreId,
  requireAdmin,
  requireSession,
  type StaffAuthRow,
} from '@/lib/server/dal'
import { analyzeAndStoreStaffConditions } from '@/lib/server/condition-analysis'
import { hashPin, isValidPin, verifyPin } from '@/lib/server/pin'
import { createSession, deleteSession } from '@/lib/server/session'
import { getAdminClient } from '@/lib/server/supabase-admin'
import {
  IP_PIN_POLICY,
  IP_PUBLIC_WRITE_POLICY,
  STAFF_PIN_POLICY,
  clearFailures,
  getActiveLock,
  getClientIpKey,
  minutesUntil,
  registerFailure,
  staffThrottleKey,
} from '@/lib/server/throttle'

// Server Actions are reachable by direct POST, so every input is re-validated here.

const GENERIC_ERROR = '処理に失敗しました。時間をおいて再度お試しください。'

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64
const isTime = (value: unknown): value is string => typeof value === 'string' && TIME_OPTIONS.includes(value)
const isOptionalTime = (value: unknown): value is string | null => value === null || isTime(value)
const isMemo = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_MEMO_LENGTH
const isWeeklyDays = (value: unknown): value is number => typeof value === 'number' && WEEKLY_DAY_OPTIONS.includes(value)
const isJob = (value: unknown): value is string => typeof value === 'string' && JOB_OPTIONS.includes(value)

const hasValidRanges = (start1: string | null, end1: string | null, start2: string | null, end2: string | null) =>
  Boolean(start1) === Boolean(end1) && Boolean(start2) === Boolean(end2) &&
  (!start1 || !end1 || start1 < end1) && (!start2 || !end2 || start2 < end2)

const toSessionStaff = (row: StaffAuthRow): SessionStaff => ({ id: row.id, name: row.name, is_employee: row.is_employee })

const lockedResult = (until: Date) => ({ status: 'locked' as const, retryAfterMinutes: minutesUntil(until) })

const logUnexpected = (label: string, error: unknown) => {
  if (!(error instanceof AuthorizationError)) console.error(label, error)
}

/** Counts one unauthenticated write per IP; returns the lock if the limit is exceeded. */
const consumePublicWriteQuota = async (): Promise<Date | null> => {
  const ipKey = await getClientIpKey()
  const existing = await getActiveLock([ipKey])
  if (existing) return existing
  return registerFailure(ipKey, IP_PUBLIC_WRITE_POLICY)
}

/**
 * Shared PIN check with lockout. Migrates legacy SHA-256 hashes on success.
 * Every mismatch counts, including the keypad's intermediate auto-submits.
 */
const checkPin = async (row: StaffAuthRow, pin: string): Promise<PinCheckResult> => {
  const staffKey = staffThrottleKey(row.id)
  const ipKey = await getClientIpKey()
  const activeLock = await getActiveLock([staffKey, ipKey])
  if (activeLock) return lockedResult(activeLock)
  if (!row.pin_hash) return { status: 'unavailable' }

  const { ok, needsRehash } = await verifyPin(pin, row.pin_hash)
  if (!ok) {
    const [staffLock, ipLock] = await Promise.all([
      registerFailure(staffKey, STAFF_PIN_POLICY),
      registerFailure(ipKey, IP_PIN_POLICY),
    ])
    const lock = staffLock ?? ipLock
    return lock ? lockedResult(lock) : { status: 'mismatch' }
  }

  await clearFailures(staffKey)
  if (needsRehash) {
    // Compare-and-swap so a concurrent PIN change is never overwritten.
    const { error } = await getAdminClient()
      .from('staff')
      .update({ pin_hash: await hashPin(pin) })
      .eq('id', row.id)
      .eq('pin_hash', row.pin_hash)
    if (error) console.error('PINハッシュの移行に失敗しました。', error)
  }
  return { status: 'ok' }
}

export async function loginWithPin(storeId: string, staffId: string, pin: string): Promise<LoginResult> {
  try {
    if (!isValidStoreId(storeId) || !isId(staffId) || !isValidPin(pin)) return { status: 'mismatch' }
    const [row, pendingIds] = await Promise.all([getStaffAuthRow(storeId, staffId), getPendingNewStaffIds(storeId)])
    if (!row || pendingIds.has(row.id)) {
      const ipKey = await getClientIpKey()
      await registerFailure(ipKey, IP_PIN_POLICY)
      return { status: 'unavailable' }
    }

    const result = await checkPin(row, pin)
    if (result.status !== 'ok') return result
    await createSession({ staffId: row.id, storeId, sessionVersion: row.session_version })
    return { status: 'ok', staff: toSessionStaff(row) }
  } catch (error) {
    logUnexpected('loginWithPin', error)
    return { status: 'error', message: GENERIC_ERROR }
  }
}

/** PIN change, step 1: confirms the current PIN before the new-PIN keypad is shown. */
export async function verifyCurrentPin(storeId: string, pin: string): Promise<PinCheckResult> {
  try {
    const session = await requireSession(storeId)
    if (!isValidPin(pin)) return { status: 'mismatch' }
    const row = await getStaffAuthRow(storeId, session.id)
    if (!row) return { status: 'unavailable' }
    return await checkPin(row, pin)
  } catch (error) {
    logUnexpected('verifyCurrentPin', error)
    return { status: 'error', message: GENERIC_ERROR }
  }
}

/** PIN change, step 2: re-verifies the current PIN, stores the new one and rotates the session. */
export async function changePin(storeId: string, currentPin: string, newPin: string): Promise<LoginResult> {
  try {
    const session = await requireSession(storeId)
    if (!isValidPin(currentPin) || !isValidPin(newPin)) return { status: 'mismatch' }
    const row = await getStaffAuthRow(storeId, session.id)
    if (!row) return { status: 'unavailable' }
    const check = await checkPin(row, currentPin)
    if (check.status !== 'ok') return check

    const nextVersion = row.session_version + 1
    const { error } = await getAdminClient()
      .from('staff')
      .update({ pin_hash: await hashPin(newPin), session_version: nextVersion })
      .eq('id', row.id)
      .eq('store_id', storeId)
    if (error) throw error
    await createSession({ staffId: row.id, storeId, sessionVersion: nextVersion })
    return { status: 'ok', staff: toSessionStaff(row) }
  } catch (error) {
    logUnexpected('changePin', error)
    return { status: 'error', message: GENERIC_ERROR }
  }
}

/**
 * First-time setup for a staff member without a PIN. Never grants employee
 * (admin) rights: choosing 社員 only reports that approval is needed.
 */
export async function completeInitialSetup(
  storeId: string,
  staffId: string,
  pin: string,
  profile: SetupProfileInput,
): Promise<SetupResult> {
  try {
    if (!isValidStoreId(storeId) || !isId(staffId)) return { status: 'unavailable' }
    if (!isValidPin(pin)) return { status: 'error', message: '暗証番号は4〜8桁の数字で入力してください。' }
    if (!isWeeklyDays(profile.weekly_target_days) || !isJob(profile.main_job) || typeof profile.wants_employee !== 'boolean' ||
      !isTime(profile.work_start_1) || !isTime(profile.work_end_1) ||
      !isOptionalTime(profile.work_start_2) || !isOptionalTime(profile.work_end_2) || !isMemo(profile.memo) ||
      !hasValidRanges(profile.work_start_1, profile.work_end_1, profile.work_start_2, profile.work_end_2)) {
      return { status: 'error', message: '入力内容を確認してください。' }
    }

    const lock = await consumePublicWriteQuota()
    if (lock) return lockedResult(lock)

    const [row, pendingIds] = await Promise.all([getStaffAuthRow(storeId, staffId), getPendingNewStaffIds(storeId)])
    if (!row || row.pin_hash || pendingIds.has(row.id)) return { status: 'unavailable' }

    const memo = profile.memo.trim()
    const { data, error } = await getAdminClient()
      .from('staff')
      .update({
        pin_hash: await hashPin(pin),
        weekly_target_days: profile.weekly_target_days,
        main_job: profile.main_job,
        work_start_1: profile.work_start_1,
        work_end_1: profile.work_end_1,
        work_start_2: profile.work_start_2,
        work_end_2: profile.work_end_2,
        memo,
      })
      .eq('id', row.id)
      .eq('store_id', storeId)
      .is('pin_hash', null)
      .select('id')
    if (error) throw error
    if (!Array.isArray(data) || data.length === 0) return { status: 'unavailable' }

    after(() => analyzeAndStoreStaffConditions(storeId, row.id, {
      work_start_1: profile.work_start_1,
      work_end_1: profile.work_end_1,
      work_start_2: profile.work_start_2,
      work_end_2: profile.work_end_2,
      memo,
    }))

    await createSession({ staffId: row.id, storeId, sessionVersion: row.session_version })
    return {
      status: 'ok',
      staff: toSessionStaff(row),
      employeeRequestPending: profile.wants_employee && !row.is_employee,
    }
  } catch (error) {
    logUnexpected('completeInitialSetup', error)
    return { status: 'error', message: GENERIC_ERROR }
  }
}

export async function requestPinReset(storeId: string, staffId: string): Promise<SimpleResult> {
  try {
    if (!isValidStoreId(storeId) || !isId(staffId)) return { status: 'error', message: GENERIC_ERROR }
    const lock = await consumePublicWriteQuota()
    if (lock) return lockedResult(lock)
    const { error } = await getAdminClient()
      .from('staff')
      .update({ pin_reset_requested: true })
      .eq('id', staffId)
      .eq('store_id', storeId)
    if (error) throw error
    return { status: 'ok' }
  } catch (error) {
    logUnexpected('requestPinReset', error)
    return { status: 'error', message: GENERIC_ERROR }
  }
}

/** Admin: approve (clear PIN + revoke sessions) or reject a PIN reset request. */
export async function resolvePinReset(storeId: string, staffId: string, approved: boolean): Promise<SimpleResult> {
  try {
    await requireAdmin(storeId)
    if (!isId(staffId) || typeof approved !== 'boolean') return { status: 'error', message: GENERIC_ERROR }
    const row = await getStaffAuthRow(storeId, staffId)
    if (!row) return { status: 'error', message: '対象のスタッフが見つかりません。' }
    const update = approved
      ? { pin_hash: null, pin_reset_requested: false, session_version: row.session_version + 1 }
      : { pin_reset_requested: false }
    const { error } = await getAdminClient().from('staff').update(update).eq('id', row.id).eq('store_id', storeId)
    if (error) throw error
    if (approved) await clearFailures(staffThrottleKey(row.id))
    return { status: 'ok' }
  } catch (error) {
    logUnexpected('resolvePinReset', error)
    return { status: 'error', message: error instanceof AuthorizationError ? '権限がありません。' : GENERIC_ERROR }
  }
}

/** Unauthenticated self-registration. The staff row stays pending until an admin approves it. */
export async function registerNewStaff(storeId: string, input: NewStaffRegistrationInput): Promise<SimpleResult> {
  try {
    if (!isValidStoreId(storeId)) return { status: 'error', message: GENERIC_ERROR }
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > MAX_NAME_LENGTH) return { status: 'error', message: 'お名前を入力してください。' }
    if (!isValidPin(input.pin)) return { status: 'error', message: '暗証番号は4〜8桁の数字で入力してください。' }
    if (typeof input.employment_type !== 'string' || !EMPLOYMENT_TYPE_OPTIONS.includes(input.employment_type) ||
      !isJob(input.main_job) || !isWeeklyDays(input.weekly_target_days) ||
      !isOptionalTime(input.work_start_1) || !isOptionalTime(input.work_end_1) ||
      !isOptionalTime(input.work_start_2) || !isOptionalTime(input.work_end_2) || !isMemo(input.memo) ||
      !hasValidRanges(input.work_start_1, input.work_end_1, input.work_start_2, input.work_end_2)) {
      return { status: 'error', message: '入力内容を確認してください。' }
    }

    const lock = await consumePublicWriteQuota()
    if (lock) return lockedResult(lock)
    if (await getStoreName(storeId) === null) return { status: 'error', message: '店舗が見つかりません。' }

    const memo = input.memo.trim()
    const admin = getAdminClient()
    const { data: staff, error: staffError } = await admin
      .from('staff')
      .insert({
        store_id: storeId,
        name,
        pin_hash: await hashPin(input.pin),
        is_employee: false,
        main_job: input.main_job,
        weekly_target_days: input.weekly_target_days,
        work_start_1: input.work_start_1,
        work_end_1: input.work_end_1,
        work_start_2: input.work_start_2,
        work_end_2: input.work_end_2,
        memo,
      })
      .select('id')
      .single()
    if (staffError) throw staffError
    const createdRow: unknown = staff
    if (!createdRow || typeof createdRow !== 'object' || !('id' in createdRow)) throw new Error('Staff insert returned no id.')
    const staffId = String(createdRow.id)

    const { error: requestError } = await admin.from('staff_requests').insert({
      store_id: storeId,
      staff_id: staffId,
      type: 'new_staff',
      details: {
        name,
        employment_type: input.employment_type,
        main_job: input.main_job,
        weekly_target_days: input.weekly_target_days,
        work_start_1: input.work_start_1,
        work_end_1: input.work_end_1,
        work_start_2: input.work_start_2,
        work_end_2: input.work_end_2,
        memo,
      },
      status: 'pending',
    })
    if (requestError) {
      await admin.from('staff').delete().eq('id', staffId).eq('store_id', storeId)
      throw requestError
    }

    after(() => analyzeAndStoreStaffConditions(storeId, staffId, {
      work_start_1: input.work_start_1,
      work_end_1: input.work_end_1,
      work_start_2: input.work_start_2,
      work_end_2: input.work_end_2,
      memo,
    }))
    return { status: 'ok' }
  } catch (error) {
    logUnexpected('registerNewStaff', error)
    return { status: 'error', message: '登録申請を送信できませんでした。' }
  }
}

export async function logout(storeId: string): Promise<void> {
  if (isValidStoreId(storeId)) await deleteSession(storeId)
}
