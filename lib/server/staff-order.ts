import 'server-only'
import { type StaffRank, staffRankOf } from '@/lib/staff-order'
import { getAdminClient } from '@/lib/server/supabase-admin'

/**
 * id → position of every staff member of the store in the paper-form order.
 * Only the order is returned (no names or other columns), for sorting saved
 * schedules whose rows already carry ids and names.
 */
export const loadStaffRank = async (storeId: string): Promise<StaffRank> => {
  const { data, error } = await getAdminClient().from('staff').select('id, name, category, display_order').eq('store_id', storeId)
  if (error) throw error
  const rows: unknown[] = Array.isArray(data) ? data : []
  return staffRankOf(rows.flatMap(row => {
    if (typeof row !== 'object' || row === null) return []
    const record = row as Record<string, unknown>
    return [{ id: String(record.id), name: typeof record.name === 'string' ? record.name : '', category: record.category, display_order: record.display_order }]
  }))
}
