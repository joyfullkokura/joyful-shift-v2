import { getDashboard, getMyDayOff } from '@/app/actions/dashboard'
import { getSessionStaff, isValidStoreId } from '@/lib/server/dal'
import { timedPageData } from '@/lib/server/timing'
import { todayInJapan } from '@/lib/server/validation'
import HomeClient, { type HomeInitialData } from './HomeClient'

// Per-person data: rendered for every request, never cached.
export const dynamic = 'force-dynamic'

/**
 * Home: today's month (Japan time) is loaded here so the first screen needs no
 * Server Action. getDashboard / getMyDayOff check the session exactly as when
 * the screen calls them, so each person still receives only what they may see.
 */
export default async function HomePage({ params }: { params: Promise<{ store_id: string }> }) {
  const { store_id: storeId } = await params
  let initial: HomeInitialData | null = null

  // Without a session the shell shows the login screen; nothing to load.
  if (isValidStoreId(storeId) && await getSessionStaff(storeId)) {
    const dateKey = todayInJapan()
    const month = `${dateKey.slice(0, 7)}-01`
    const result = await timedPageData('home', async () => {
      const [dashboard, dayOff] = await Promise.all([getDashboard(storeId, month), getMyDayOff(storeId, dateKey)])
      return dashboard.ok && dayOff.ok
        ? { ok: true as const, data: { dateKey, month, dashboard: dashboard.data, dayOff: dayOff.data } }
        : { ok: false as const }
    })
    if (result.ok) initial = result.data
  }

  return <HomeClient initial={initial} />
}
