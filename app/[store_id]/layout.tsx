import type { ReactNode } from 'react'
import { AdminProvider } from '@/context/AdminContext'
import StoreShell from '@/components/StoreShell'
import { FlashProvider } from '@/components/FlashMessage'
import VersionWatcher from '@/components/VersionWatcher'
import { currentDeploymentId } from '@/lib/deployment'
import type { LoginMember, SessionStaff } from '@/lib/auth-types'
import { type BusinessHours, DEFAULT_BUSINESS_HOURS } from '@/lib/day-request'
import { getStoreBusinessHours } from '@/lib/server/business-hours'
import { getSessionStaff, getStoreName, listLoginMembers } from '@/lib/server/dal'
import { getUnreadNotificationCount } from '@/app/actions/dashboard'

// Session, staff list and the unread dot differ per person: rendered for every request, never cached.
export const dynamic = 'force-dynamic'

export default async function StoreLayout({ children, params }: { children: ReactNode; params: Promise<{ store_id: string }> }) {
  const { store_id: storeId } = await params

  let session: SessionStaff | null = null
  let storeName = ''
  let members: LoginMember[] = []
  let hours: BusinessHours = DEFAULT_BUSINESS_HOURS
  let hasUnreadNotifications = false
  let loadError = ''
  try {
    const [resolvedSession, resolvedStoreName] = await Promise.all([getSessionStaff(storeId), getStoreName(storeId)])
    session = resolvedSession
    storeName = resolvedStoreName ?? ''
    // The name picker is only needed (and only sent) before login.
    // Business hours bound the time buttons of first-time setup / registration.
    if (!session) [members, hours] = await Promise.all([listLoginMembers(storeId), getStoreBusinessHours(storeId)])
    // Rendered with the page, so screens no longer queue a separate Server Action for the dot.
    // The action re-checks the session; the result depends on the person, and nothing is cached.
    else {
      const unread = await getUnreadNotificationCount(storeId)
      hasUnreadNotifications = unread.ok && unread.data > 0
    }
  } catch (error) {
    console.error('店舗情報の読み込みに失敗しました。', error)
    loadError = 'スタッフ一覧を読み込めませんでした。時間をおいて再度お試しください。'
  }

  return (
    // Remount when the server-side session changes (login, logout, PIN change).
    <AdminProvider key={session?.id ?? 'guest'} storeId={storeId} initialStaff={session}>
      <FlashProvider storeId={storeId}>
        <VersionWatcher deploymentId={currentDeploymentId()} />
        <StoreShell storeId={storeId} storeName={storeName} members={members} hours={hours} initialHasUnread={hasUnreadNotifications} loadError={loadError}>
          {children}
        </StoreShell>
      </FlashProvider>
    </AdminProvider>
  )
}
