'use server'

import { after } from 'next/server'
import type { ActionResult, DataRow } from '@/lib/action-result'
import { MAX_MEMO_LENGTH, MAX_NAME_LENGTH } from '@/lib/staff-profile-options'
import { STAFF_SECRET_COLUMNS, UserFacingError, check, omit, runAction, toRow, toRows } from '@/lib/server/action'
import { analyzeAndStoreStaffConditions } from '@/lib/server/condition-analysis'
import { requireAdmin } from '@/lib/server/dal'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { INVALID_INPUT, assert, isId, isRecord, isShortText, isTimeText } from '@/lib/server/validation'

// All actions in this file are admin-only (従業員名簿).

/** Columns an admin may edit from the roster screen, with their validators. */
const EDITABLE_FIELDS: Record<string, (value: unknown) => unknown> = {
  name: value => (typeof value === 'string' && value.trim() && value.length <= MAX_NAME_LENGTH ? value.trim() : undefined),
  rank: value => (value === null || isShortText(value, 20) ? value : undefined),
  main_job: value => (value === null || isShortText(value, 50) ? value : undefined),
  memo: value => (value === null || isShortText(value, MAX_MEMO_LENGTH) ? value : undefined),
  skills: value => (value === null || isShortText(value, 1_000) ? value : undefined),
  is_employee: value => (typeof value === 'boolean' ? value : undefined),
  weekly_target_days: value => {
    const days = typeof value === 'string' && value.trim() ? Number(value) : value
    return days === null || (typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 7) ? days : undefined
  },
  work_start_1: value => (value === null || value === '' ? null : isTimeText(value) ? value : undefined),
  work_end_1: value => (value === null || value === '' ? null : isTimeText(value) ? value : undefined),
  work_start_2: value => (value === null || value === '' ? null : isTimeText(value) ? value : undefined),
  work_end_2: value => (value === null || value === '' ? null : isTimeText(value) ? value : undefined),
}

/** Picks and validates editable fields; unknown keys (id, store_id, pin_hash, ...) are ignored. */
const toStaffUpdate = (input: Record<string, unknown>): DataRow => {
  const update: DataRow = {}
  for (const [field, validate] of Object.entries(EDITABLE_FIELDS)) {
    if (!(field in input)) continue
    const value = validate(input[field])
    if (value === undefined) throw new UserFacingError(`${INVALID_INPUT}（${field}）`)
    update[field] = value
  }
  return update
}

const loadRoster = async (storeId: string): Promise<DataRow[]> => {
  const { data, error } = await getAdminClient().from('staff').select('*')
    .eq('store_id', storeId).order('created_at', { ascending: true })
  check(error)
  return toRows(data).map(row => omit(row, STAFF_SECRET_COLUMNS))
}

const scheduleConditionAnalysis = (storeId: string, row: DataRow) => {
  const time = (value: unknown) => (typeof value === 'string' && value ? value : null)
  const staffId = String(row.id)
  after(() => analyzeAndStoreStaffConditions(storeId, staffId, {
    work_start_1: time(row.work_start_1),
    work_end_1: time(row.work_end_1),
    work_start_2: time(row.work_start_2),
    work_end_2: time(row.work_end_2),
    memo: typeof row.memo === 'string' ? row.memo : '',
  }))
}

export type StaffPageData = { staff: DataRow[]; skillOptions: unknown }

export async function getStaffPageData(storeId: string): Promise<ActionResult<StaffPageData>> {
  return runAction('getStaffPageData', async () => {
    await requireAdmin(storeId)
    const [staff, storeResult] = await Promise.all([
      loadRoster(storeId),
      getAdminClient().from('stores').select('skill_options').eq('store_id', storeId).maybeSingle(),
    ])
    check(storeResult.error)
    return { staff, skillOptions: toRow(storeResult.data)?.skill_options ?? null }
  })
}

export async function addStaff(storeId: string, name: string): Promise<ActionResult<{ id: string; staff: DataRow[] }>> {
  return runAction('addStaff', async () => {
    await requireAdmin(storeId)
    assert(typeof name === 'string' && name.trim() && name.length <= MAX_NAME_LENGTH, 'お名前を入力してください。')
    const { data, error } = await getAdminClient().from('staff')
      .insert({
        name: name.trim(),
        store_id: storeId,
        main_job: 'ホール',
        rank: 'B',
        weekly_target_days: 3,
        work_start_2: null,
        work_end_2: null,
      })
      .select('id')
      .single()
    check(error)
    const created = toRow(data)
    if (!created) throw new Error('Insert returned no row.')
    return { id: String(created.id), staff: await loadRoster(storeId) }
  })
}

/** Bulk save of the roster. Only updates existing staff of this store. */
export async function saveStaffRoster(storeId: string, rows: unknown): Promise<ActionResult<null>> {
  return runAction('saveStaffRoster', async () => {
    await requireAdmin(storeId)
    assert(Array.isArray(rows) && rows.length <= 500)
    const updates = rows.map(row => {
      assert(isRecord(row) && isId(row.id))
      return { id: row.id, update: toStaffUpdate(row) }
    })
    const db = getAdminClient()
    for (const { id, update } of updates) {
      if (Object.keys(update).length === 0) continue
      const { error } = await db.from('staff').update(update).eq('id', id).eq('store_id', storeId)
      check(error)
    }
    return null
  })
}

/** Saves one staff member (new-staff detail form) and re-runs condition analysis. */
export async function saveStaffMember(storeId: string, row: unknown): Promise<ActionResult<null>> {
  return runAction('saveStaffMember', async () => {
    await requireAdmin(storeId)
    assert(isRecord(row) && isId(row.id))
    const { data, error } = await getAdminClient().from('staff').update(toStaffUpdate(row))
      .eq('id', row.id).eq('store_id', storeId)
      .select('id, work_start_1, work_end_1, work_start_2, work_end_2, memo')
      .maybeSingle()
    check(error)
    const saved = toRow(data)
    if (!saved) throw new UserFacingError('対象のスタッフが見つかりません。')
    scheduleConditionAnalysis(storeId, saved)
    return null
  })
}

export async function deleteStaff(storeId: string, staffId: string): Promise<ActionResult<null>> {
  return runAction('deleteStaff', async () => {
    const session = await requireAdmin(storeId)
    assert(isId(staffId))
    if (staffId === session.id) throw new UserFacingError('ログイン中の自分自身は削除できません。')
    const { error } = await getAdminClient().from('staff').delete().eq('id', staffId).eq('store_id', storeId)
    check(error)
    return null
  })
}
