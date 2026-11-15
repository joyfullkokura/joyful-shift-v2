import type { ReactNode } from 'react'
import { AdminProvider } from '@/context/AdminContext'
import StoreShell from '@/components/StoreShell'
import { FlashProvider } from '@/components/FlashMessage'
import type { LoginMember, SessionStaff } from '@/lib/auth-types'
import { getSessionStaff, getStoreName, listLoginMembers } from '@/lib/server/dal'

export default async function StoreLayout({ children, params }: { children: ReactNode; params: Promise<{ store_id: string }> }) {
  const { store_id: storeId } = await params

  let session: SessionStaff | null = null
  let storeName = ''
  let members: LoginMember[] = []
  let loadError = ''
  try {
    const [resolvedSession, resolvedStoreName] = await Promise.all([getSessionStaff(storeId), getStoreName(storeId)])
    session = resolvedSession
    storeName = resolvedStoreName ?? ''
    // The name picker is only needed (and only sent) before login.
    if (!session) members = await listLoginMembers(storeId)
  } catch (error) {
    console.error('店舗情報の読み込みに失敗しました。', error)
    loadError = 'スタッフ一覧を読み込めませんでした。時間をおいて再度お試しください。'
  }

  return (
    // Remount when the server-side session changes (login, logout, PIN change).
    <AdminProvider key={session?.id ?? 'guest'} storeId={storeId} initialStaff={session}>
      <FlashProvider storeId={storeId}>
        <StoreShell storeId={storeId} storeName={storeName} members={members} loadError={loadError}>
          {children}
        </StoreShell>
      </FlashProvider>
    </AdminProvider>
  )
}
