import 'server-only'
import { createHmac } from 'node:crypto'
import { headers } from 'next/headers'
import { getPinPepper } from '@/lib/server/env'
import { getAdminClient } from '@/lib/server/supabase-admin'

export type ThrottlePolicy = {
  maxFailures: number
  windowSeconds: number
  lockStepsSeconds: number[]
}

const MINUTE = 60
const HOUR = 60 * MINUTE

/**
 * The keypad auto-submits from the 4th digit, so a correct 8-digit PIN can
 * produce up to 4 mismatches on its own. 15 per 15 minutes leaves room for a
 * couple of typos while keeping online guessing of a 4-digit PIN impractical.
 */
export const STAFF_PIN_POLICY: ThrottlePolicy = {
  maxFailures: 15,
  windowSeconds: 15 * MINUTE,
  lockStepsSeconds: [15 * MINUTE, HOUR, 24 * HOUR],
}

// Shared store tablets sit behind one IP, so this is looser than the per-staff limit.
export const IP_PIN_POLICY: ThrottlePolicy = {
  maxFailures: 60,
  windowSeconds: 15 * MINUTE,
  lockStepsSeconds: [15 * MINUTE, HOUR],
}

// Unauthenticated writes (new staff registration, initial setup, reset requests):
// every call counts, not only failures.
export const IP_PUBLIC_WRITE_POLICY: ThrottlePolicy = {
  maxFailures: 20,
  windowSeconds: HOUR,
  lockStepsSeconds: [HOUR],
}

export const staffThrottleKey = (staffId: string) => `staff:${staffId}`

export const getClientIpKey = async (): Promise<string> => {
  const headerList = await headers()
  // On Vercel x-real-ip / x-forwarded-for are set by the platform edge.
  const ip = headerList.get('x-real-ip') || headerList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  return `ip:${createHmac('sha256', getPinPepper()).update(ip).digest('hex').slice(0, 32)}`
}

const isLockRow = (value: unknown): value is { locked_until: string | null } =>
  typeof value === 'object' && value !== null && 'locked_until' in value &&
  (typeof value.locked_until === 'string' || value.locked_until === null)

/** Returns the latest active lock expiry among the given keys, or null. */
export const getActiveLock = async (keys: string[]): Promise<Date | null> => {
  const { data, error } = await getAdminClient().from('auth_throttle').select('locked_until').in('key', keys)
  if (error) throw error
  const now = Date.now()
  const rows: unknown[] = data ?? []
  const expiries = rows
    .filter(isLockRow)
    .map(row => (row.locked_until ? Date.parse(row.locked_until) : 0))
    .filter(time => time > now)
  return expiries.length > 0 ? new Date(Math.max(...expiries)) : null
}

/** Records one failure and returns the lock expiry if this failure caused (or is under) a lock. */
export const registerFailure = async (key: string, policy: ThrottlePolicy): Promise<Date | null> => {
  const { data, error } = await getAdminClient().rpc('auth_register_failure', {
    p_key: key,
    p_max_failures: policy.maxFailures,
    p_window_seconds: policy.windowSeconds,
    p_lock_steps_seconds: policy.lockStepsSeconds,
  })
  if (error) throw error
  const value: unknown = data
  return typeof value === 'string' ? new Date(value) : null
}

export const clearFailures = async (key: string): Promise<void> => {
  const { error } = await getAdminClient().from('auth_throttle').delete().eq('key', key)
  if (error) throw error
}

export const minutesUntil = (date: Date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60_000))
