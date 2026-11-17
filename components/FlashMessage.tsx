'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, startTransition, type ReactNode } from 'react'
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import { requestVersionCheck } from '@/lib/client/app-version'

export type FlashTone = 'success' | 'error' | 'info'
type Flash = { id: number; message: string; tone: FlashTone }

type FlashContextValue = {
  /** Shows a message at the top of the screen (replacement for window.alert). */
  notify: (message: string, tone?: FlashTone) => void
  dismiss: () => void
}

const FlashContext = createContext<FlashContextValue | null>(null)
const SUCCESS_TIMEOUT_MS = 6_000
const PENDING_KEY_PREFIX = 'joyful_pending_flash_'

/**
 * Leaves a message for the next mount of this store's screens. Used when the
 * current tree is about to be replaced (e.g. right after login), where in-memory
 * state would be lost. Best effort: storage may be unavailable.
 */
export const queueFlashForNextScreen = (storeId: string, message: string, tone: FlashTone = 'info') => {
  try {
    sessionStorage.setItem(`${PENDING_KEY_PREFIX}${storeId}`, JSON.stringify({ message, tone }))
  } catch {
    // The message is informational only.
  }
}

const takePendingFlash = (storeId: string): { message: string; tone: FlashTone } | null => {
  try {
    const key = `${PENDING_KEY_PREFIX}${storeId}`
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    sessionStorage.removeItem(key)
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('message' in parsed) || typeof parsed.message !== 'string') return null
    const tone = 'tone' in parsed && (parsed.tone === 'success' || parsed.tone === 'error' || parsed.tone === 'info') ? parsed.tone : 'info'
    return { message: parsed.message, tone }
  } catch {
    return null
  }
}

const TONE_STYLES: Record<FlashTone, { box: string; icon: typeof CheckCircle2 }> = {
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: CheckCircle2 },
  error: { box: 'border-rose-200 bg-rose-50 text-rose-800', icon: CircleAlert },
  info: { box: 'border-slate-200 bg-white text-slate-700', icon: Info },
}

export function FlashProvider({ storeId, children }: { storeId: string; children: ReactNode }) {
  const [flash, setFlash] = useState<Flash | null>(null)

  const notify = useCallback((message: string, tone: FlashTone = 'success') => {
    setFlash({ id: Date.now(), message, tone })
    // A failure may come from a screen older than the deployment (its Server Actions are gone).
    if (tone === 'error') requestVersionCheck()
  }, [])
  const dismiss = useCallback(() => setFlash(null), [])

  useEffect(() => {
    const pending = takePendingFlash(storeId)
    if (pending) startTransition(() => setFlash({ id: Date.now(), ...pending }))
  }, [storeId])

  useEffect(() => {
    // Errors stay until dismissed; other messages fade out.
    if (!flash || flash.tone === 'error') return
    const timer = window.setTimeout(() => setFlash(current => (current?.id === flash.id ? null : current)), SUCCESS_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  const value = useMemo(() => ({ notify, dismiss }), [dismiss, notify])
  const style = flash ? TONE_STYLES[flash.tone] : null
  const Icon = style?.icon

  return (
    <FlashContext.Provider value={value}>
      {flash && style && Icon && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[130] flex justify-center px-4">
          <div
            role={flash.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg ${style.box}`}
          >
            <Icon size={17} className="mt-0.5 shrink-0" />
            <p className="min-w-0 flex-1 leading-relaxed">{flash.message}</p>
            <button type="button" onClick={dismiss} className="shrink-0 rounded-md p-0.5 opacity-70 transition hover:opacity-100" aria-label="閉じる">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      {children}
    </FlashContext.Provider>
  )
}

export function useFlash() {
  const context = useContext(FlashContext)
  if (!context) throw new Error('useFlash must be used within a FlashProvider')
  return context
}
