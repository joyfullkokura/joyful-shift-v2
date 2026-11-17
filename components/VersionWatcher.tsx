'use client'

import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { hasUnsavedChanges, onUnsavedChangesChange, onVersionCheckRequest } from '@/lib/client/app-version'

const CHECK_INTERVAL_MS = 10 * 60 * 1000
const MIN_GAP_MS = 30 * 1000

/**
 * Tells a screen that was left open across a deployment to reload.
 * Checks /api/version when the tab becomes visible again, every 10 minutes,
 * and right after a failure (requestVersionCheck). Never reloads by itself:
 * the person decides, and is warned when the screen has unsaved edits.
 */
export default function VersionWatcher({ deploymentId }: {
  /**
   * The deployment that rendered this page, passed by the server layout.
   * (Next.js puts it on <html data-dpl-id> in the HTML, but hydration removes
   * that attribute, so the DOM cannot be relied on.) Undefined locally: no checks.
   */
  deploymentId?: string
}) {
  const [isOutdated, setIsOutdated] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    const loaded = deploymentId
    if (!loaded) return // local development: no deployment id, nothing to compare
    let lastCheck = 0
    let stopped = false

    const check = async (force = false) => {
      const now = Date.now()
      if (stopped || (!force && now - lastCheck < MIN_GAP_MS)) return
      lastCheck = now
      try {
        const response = await fetch('/api/version', { cache: 'no-store' })
        if (!response.ok) return
        const body: unknown = await response.json()
        const latest = typeof body === 'object' && body !== null && 'deploymentId' in body ? body.deploymentId : null
        if (!stopped && typeof latest === 'string' && latest !== loaded) {
          setIsOutdated(true)
          stopped = true
        }
      } catch {
        // Offline or a network hiccup: try again at the next occasion.
      }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => { void check() }, CHECK_INTERVAL_MS)
    const stopListening = onVersionCheckRequest(() => { void check(true) })
    const onRejection = () => { void check(true) }
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
      stopListening()
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [deploymentId])

  useEffect(() => onUnsavedChangesChange(() => setIsDirty(hasUnsavedChanges())), [])

  if (!isOutdated) return null

  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[95] border-b border-slate-300 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-md md:left-[268px]">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">新しいバージョンがあります。画面を再読み込みしてください。</p>
          <p className={`mt-0.5 text-xs ${isDirty ? 'font-bold text-red-700' : 'text-slate-600'}`}>
            {isDirty
              ? 'この画面に保存していない変更があります。先に保存してから再読み込みしてください。'
              : '入力中の内容がある場合は、保存してから再読み込みしてください。'}
          </p>
        </div>
        <button type="button" onClick={() => window.location.reload()}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-bold text-white hover:bg-[var(--primary-strong)]">
          <RotateCw size={16} aria-hidden="true" />再読み込み
        </button>
      </div>
    </div>
  )
}
