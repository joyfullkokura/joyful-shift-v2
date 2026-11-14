import { requireAdmin } from '@/lib/server/dal'
import { errorResponse, omitColumns } from '@/lib/server/http'
import { getAdminClient } from '@/lib/server/supabase-admin'

export const runtime = 'nodejs'

// admin_pw is a legacy plaintext column, unused by the app and dropped in migration B.
const SERVER_ONLY_STORE_COLUMNS = ['admin_pw'] as const

/** Admin-only store settings row (used by shift generation). */
export async function GET(_request: Request, { params }: { params: Promise<{ store_id: string }> }) {
  try {
    const { store_id: storeId } = await params
    await requireAdmin(storeId)

    const { data, error } = await getAdminClient().from('stores').select('*').eq('store_id', storeId).maybeSingle()
    if (error) throw error
    return Response.json({ store: omitColumns(data, SERVER_ONLY_STORE_COLUMNS) })
  } catch (error) {
    return errorResponse('GET store settings', error)
  }
}
