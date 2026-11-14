import { requireAdmin } from '@/lib/server/dal'
import { errorResponse, omitColumns } from '@/lib/server/http'
import { getAdminClient } from '@/lib/server/supabase-admin'

export const runtime = 'nodejs'

const SERVER_ONLY_STAFF_COLUMNS = ['pin_hash', 'session_version'] as const

/**
 * Admin-only full staff roster (every column except server-only ones).
 * Replaces client-side select('*'), which stops working once pin_hash is no
 * longer granted to the anon role.
 */
export async function GET(request: Request, { params }: { params: Promise<{ store_id: string }> }) {
  try {
    const { store_id: storeId } = await params
    await requireAdmin(storeId)
    const orderBy = new URL(request.url).searchParams.get('order') === 'created_at' ? 'created_at' : 'name'

    const { data, error } = await getAdminClient()
      .from('staff')
      .select('*')
      .eq('store_id', storeId)
      .order(orderBy, { ascending: true })
    if (error) throw error

    const rows: unknown[] = data ?? []
    return Response.json({ staff: rows.map(row => omitColumns(row, SERVER_ONLY_STAFF_COLUMNS)).filter(row => row !== null) })
  } catch (error) {
    return errorResponse('GET staff', error)
  }
}
