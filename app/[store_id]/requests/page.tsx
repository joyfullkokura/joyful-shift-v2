import { getRequestsPageMonth, type RequestsPageData } from '@/app/actions/requests'
import { getSessionStaff, isValidStoreId } from '@/lib/server/dal'
import { timedPageData } from '@/lib/server/timing'
import { nextMonthStartInJapan } from '@/lib/server/validation'
import RequestsClient from './RequestsClient'

// Per-person data: rendered for every request, never cached.
export const dynamic = 'force-dynamic'

/**
 * 休み希望: the month being entered (next month, JST) is loaded here so the
 * first screen needs no Server Action. getRequestsPageMonth checks the session
 * exactly as when the screen calls it.
 */
export default async function RequestsPage({ params }: { params: Promise<{ store_id: string }> }) {
  const { store_id: storeId } = await params
  const month = nextMonthStartInJapan()
  let initial: RequestsPageData | null = null

  // Without a session the shell shows the login screen; nothing to load.
  if (isValidStoreId(storeId) && await getSessionStaff(storeId)) {
    const result = await timedPageData('requests', () => getRequestsPageMonth(storeId, month))
    if (result.ok) initial = result.data
  }

  return <RequestsClient initialMonth={month} initial={initial} />
}
