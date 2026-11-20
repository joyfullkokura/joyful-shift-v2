import 'server-only'
import { cache } from 'react'
import type { LoginMember, SessionStaff } from '@/lib/auth-types'
import { readSession } from '@/lib/server/session'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { parseWeeklyAvailability } from '@/lib/weekly-availability'
import { compareStaffOrder } from '@/lib/staff-order'

export class AuthorizationError extends Error {
  constructor(readonly reason: 'unauthenticated' | 'forbidden') {
    super(reason)
    this.name = 'AuthorizationError'
  }
}

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const toRows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(isRow) : [])
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const integer = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null)

export const isValidStoreId = (storeId: unknown): storeId is string =>
  typeof storeId === 'string' && storeId.length > 0 && storeId.length <= 100

/**
 * Resolves the session for one store. Role and existence are read from the DB
 * on every request, so the cookie never decides authority on its own.
 */
export const getSessionStaff = cache(async (storeId: string): Promise<SessionStaff | null> => {
  if (!isValidStoreId(storeId)) return null
  const claims = await readSession(storeId)
  if (!claims) return null

  const { data, error } = await getAdminClient()
    .from('staff')
    .select('id, name, is_employee, session_version, pin_hash')
    .eq('id', claims.staffId)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw error
  const row: unknown = data
  if (!isRow(row)) return null
  if (integer(row.session_version) !== claims.sessionVersion || !text(row.pin_hash)) return null

  return { id: String(row.id), name: text(row.name) ?? '', is_employee: row.is_employee === true }
})

export const requireSession = async (storeId: string): Promise<SessionStaff> => {
  const staff = await getSessionStaff(storeId)
  if (!staff) throw new AuthorizationError('unauthenticated')
  return staff
}

export const requireAdmin = async (storeId: string): Promise<SessionStaff> => {
  const staff = await requireSession(storeId)
  if (!staff.is_employee) throw new AuthorizationError('forbidden')
  return staff
}

export const getStoreName = async (storeId: string): Promise<string | null> => {
  const { data, error } = await getAdminClient().from('stores').select('name').eq('store_id', storeId).maybeSingle()
  if (error) throw error
  const row: unknown = data
  return isRow(row) ? text(row.name) : null
}

export const getPendingNewStaffIds = async (storeId: string): Promise<Set<string>> => {
  const { data, error } = await getAdminClient()
    .from('staff_requests')
    .select('staff_id')
    .eq('store_id', storeId)
    .eq('type', 'new_staff')
    .eq('status', 'pending')
  if (error) throw error
  return new Set(toRows(data).map(row => String(row.staff_id)))
}

/** Pre-login name picker. Returns no hashes and no role flags. */
export const listLoginMembers = async (storeId: string): Promise<LoginMember[]> => {
  const [{ data, error }, pendingIds] = await Promise.all([
    getAdminClient()
      .from('staff')
      .select('id, name, is_employee, pin_hash, weekly_target_days, main_job, work_start_1, work_end_1, work_start_2, work_end_2, memo, weekly_availability, category, display_order')
      .eq('store_id', storeId),
    getPendingNewStaffIds(storeId),
  ])
  if (error) throw error

  return toRows(data)
    .filter(row => !pendingIds.has(String(row.id)))
    // Paper-form order: category, display order, name.
    .sort((left, right) => compareStaffOrder(
      { id: String(left.id), name: text(left.name) ?? '', category: left.category, display_order: left.display_order },
      { id: String(right.id), name: text(right.name) ?? '', category: right.category, display_order: right.display_order },
    ))
    .map(row => {
      const hasPin = Boolean(text(row.pin_hash))
      return {
        id: String(row.id),
        name: text(row.name) ?? '',
        hasPin,
        setupDefaults: hasPin ? null : {
          weekly_target_days: integer(row.weekly_target_days),
          main_job: text(row.main_job),
          work_start_1: text(row.work_start_1),
          work_end_1: text(row.work_end_1),
          work_start_2: text(row.work_start_2),
          work_end_2: text(row.work_end_2),
          memo: text(row.memo),
          weekly_availability: parseWeeklyAvailability(row.weekly_availability),
        },
      }
    })
}

export type StaffAuthRow = {
  id: string
  name: string
  is_employee: boolean
  pin_hash: string | null
  session_version: number
}

export const getStaffAuthRow = async (storeId: string, staffId: string): Promise<StaffAuthRow | null> => {
  const { data, error } = await getAdminClient()
    .from('staff')
    .select('id, name, is_employee, pin_hash, session_version')
    .eq('id', staffId)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw error
  const row: unknown = data
  if (!isRow(row)) return null
  return {
    id: String(row.id),
    name: text(row.name) ?? '',
    is_employee: row.is_employee === true,
    pin_hash: text(row.pin_hash),
    session_version: integer(row.session_version) ?? 0,
  }
}
