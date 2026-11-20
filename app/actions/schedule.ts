'use server'

import type { ActionResult, DataRow } from '@/lib/action-result'
import { check, runAction, toRow } from '@/lib/server/action'
import { requireSession } from '@/lib/server/dal'
import { loadStaffRank } from '@/lib/server/staff-order'
import type { StaffRank } from '@/lib/staff-order'
import { getAdminClient } from '@/lib/server/supabase-admin'
import { assert, isMonthStart } from '@/lib/server/validation'

export type ConfirmedScheduleData = {
  storeName: string | null
  shift: DataRow | null
  /** Current paper-form order (id → position) for sorting the saved rows. */
  staffRank: StaffRank
}

/** 確定シフト: the published schedule of one month. Any logged-in staff of the store. */
export async function getConfirmedSchedule(storeId: string, monthStart: string): Promise<ActionResult<ConfirmedScheduleData>> {
  return runAction('getConfirmedSchedule', async () => {
    await requireSession(storeId)
    assert(isMonthStart(monthStart))
    const db = getAdminClient()
    const [storeResult, shiftResult, staffRank] = await Promise.all([
      db.from('stores').select('name').eq('store_id', storeId).maybeSingle(),
      // select('*'): legacy rows may keep the schedule in `schedule` or `shifts`
      // and those columns are not guaranteed to exist, so they cannot be named.
      db.from('monthly_shifts').select('*')
        .eq('store_id', storeId).eq('target_month', monthStart).eq('status', 'confirmed').maybeSingle(),
      loadStaffRank(storeId),
    ])
    check(storeResult.error)
    check(shiftResult.error)
    const store = toRow(storeResult.data)
    const row = toRow(shiftResult.data)
    return {
      storeName: typeof store?.name === 'string' ? store.name : null,
      shift: row ? { schedule_data: row.schedule_data, schedule: row.schedule, shifts: row.shifts } : null,
      staffRank,
    }
  })
}
