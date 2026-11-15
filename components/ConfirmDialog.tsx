'use client'

import { useEffect, useRef } from 'react'
import { AlertTriangle, CircleHelp } from 'lucide-react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  /** danger: destructive action (rose confirm button). */
  tone?: 'default' | 'danger'
  isProcessing?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-page replacement for window.confirm, which in-app browsers (LINE, the
 * Claude app, ...) may not show at all, making the button look dead.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'キャンセル',
  tone = 'default',
  isProcessing = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus the safe choice when the dialog opens, as the native dialog does.
    if (open) cancelButtonRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isProcessing) {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isProcessing, onCancel, open])

  if (!open) return null
  const Icon = tone === 'danger' ? AlertTriangle : CircleHelp

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !isProcessing) onCancel() }}
    >
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" className="w-full max-w-sm rounded-md border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 p-5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
            <Icon size={18} />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-dialog-title" className="text-sm font-semibold text-slate-900">{title}</h2>
            <p id="confirm-dialog-message" className="mt-1 text-sm leading-relaxed text-slate-600">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} disabled={isProcessing} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={isProcessing} className={`rounded-md px-3 py-2 text-xs font-medium text-white transition disabled:opacity-50 ${tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-800 hover:bg-slate-700'}`}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
