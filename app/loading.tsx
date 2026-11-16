import { Store } from 'lucide-react'

/**
 * Start-up screen: shown only while a store's layout (session, staff list) is
 * loaded, i.e. before the login screen or the first screen appears. Moving
 * between screens inside a store uses each screen's skeleton instead.
 * Fades in within one second; no animation with prefers-reduced-motion.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] px-4">
      <div className="startup-logo flex items-center gap-3 rounded-md border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-900 text-white"><Store size={20} aria-hidden="true" /></div>
        <div>
          <p className="text-xl font-bold leading-none text-slate-900">Joyful Shift</p>
          <p className="mt-1.5 text-[11px] font-medium text-slate-500">読み込んでいます…</p>
        </div>
      </div>
    </div>
  )
}
