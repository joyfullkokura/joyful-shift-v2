'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  type BusinessHours,
  type DayRequest,
  type DayRequestKind,
  formatClock,
  formatDayRequest,
  minutesToTime,
  timeChoices,
  timeToMinutes,
} from '@/lib/day-request'

type Step = 'choose' | 'from' | 'until' | 'rangeStart' | 'rangeEnd'
type Draft = { kind: DayRequestKind | null; start: number | null; end: number | null }

type DayRequestSheetProps = {
  title: string
  subtitle?: string
  initial: DayRequest | null
  hours: BusinessHours
  /** Label of the unavailable choice: 休み (a date) or 出られない (a weekday). */
  offLabel?: string
  /** Shows 「希望なしに戻す」. */
  allowClear?: boolean
  /** Memo for the manager; undefined hides the memo box. */
  memo?: string
  /** request null = 希望なし. */
  onApply: (request: DayRequest | null, memo: string | undefined) => void
  /** Closing keeps the chosen request; an edited memo is handed back. */
  onClose: (memo: string | undefined) => void
}

const MIN_LENGTH = 60

const toDraft = (request: DayRequest | null): Draft => ({
  kind: request?.kind ?? null,
  start: timeToMinutes(request?.start),
  end: timeToMinutes(request?.end),
})

const toRequest = (draft: Draft): DayRequest | null => {
  if (!draft.kind) return null
  return {
    kind: draft.kind,
    start: (draft.kind === 'from' || draft.kind === 'range') && draft.start !== null ? minutesToTime(draft.start) : null,
    end: (draft.kind === 'until' || draft.kind === 'range') && draft.end !== null ? minutesToTime(draft.end) : null,
  }
}

const isComplete = (draft: Draft) =>
  draft.kind === 'from' ? draft.start !== null
    : draft.kind === 'until' ? draft.end !== null
      : draft.kind === 'range' ? draft.start !== null && draft.end !== null && draft.end > draft.start
        : draft.kind !== null

/**
 * Bottom sheet for choosing one day's (or one weekday's) availability with
 * large buttons only: 休み / 終日OK / 〇時から / 〇時まで / 時間を指定, times in
 * 30-minute steps within the business hours. No keyboard entry for times.
 */
export default function DayRequestSheet({
  title, subtitle, initial, hours, offLabel = '休み', allowClear = false, memo, onApply, onClose,
}: DayRequestSheetProps) {
  const [step, setStep] = useState<Step>('choose')
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [memoText, setMemoText] = useState(memo ?? '')
  // Fixed after the first render so that React never fights the user opening / closing it.
  const [memoInitiallyOpen] = useState(() => (memo ?? '').trim().length > 0)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const currentMemo = memo === undefined ? undefined : memoText

  useEffect(() => { closeButtonRef.current?.focus() }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose(currentMemo)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentMemo, onClose])

  const choose = (kind: DayRequestKind) => {
    if (kind === 'off' || kind === 'any' || kind === 'none') {
      onApply({ kind, start: null, end: null }, currentMemo)
      return
    }
    setDraft(previous => previous.kind === kind ? previous : { kind, start: null, end: null })
    setStep(kind === 'range' ? 'rangeStart' : kind)
  }

  const pickTime = (minutes: number) => {
    if (step === 'from') setDraft(previous => ({ ...previous, start: minutes }))
    if (step === 'until') setDraft(previous => ({ ...previous, end: minutes }))
    if (step === 'rangeStart') {
      setDraft(previous => ({ ...previous, start: minutes, end: previous.end !== null && previous.end > minutes + MIN_LENGTH - 1 ? previous.end : null }))
      setStep('rangeEnd')
    }
    if (step === 'rangeEnd') setDraft(previous => ({ ...previous, end: minutes }))
  }

  const confirm = () => {
    if (isComplete(draft)) onApply(toRequest(draft), currentMemo)
  }

  const timeStep = (() => {
    switch (step) {
      case 'from': return { heading: '何時から出られますか', from: hours.open, to: hours.close - MIN_LENGTH, picked: draft.start, minimum: null }
      case 'until': return { heading: '何時まで出られますか', from: hours.open + MIN_LENGTH, to: hours.close, picked: draft.end, minimum: null }
      case 'rangeStart': return { heading: '始まりの時間', from: hours.open, to: hours.close - MIN_LENGTH, picked: draft.start, minimum: null }
      case 'rangeEnd': return {
        heading: `終わりの時間（${draft.start === null ? '' : formatClock(draft.start)} から）`,
        from: hours.open + MIN_LENGTH, to: hours.close, picked: draft.end, minimum: (draft.start ?? hours.open) + MIN_LENGTH,
      }
      default: return null
    }
  })()

  const currentLabel = formatDayRequest(toRequest(draft), 'long', offLabel)
  const choices: { kind: DayRequestKind; label: string }[] = [
    { kind: 'off', label: offLabel },
    { kind: 'any', label: '終日OK' },
    { kind: 'from', label: '〇時から' },
    { kind: 'until', label: '〇時まで' },
    { kind: 'range', label: '時間を指定' },
  ]

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/40" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(currentMemo) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="day-request-sheet-title"
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-lg border border-slate-200 bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl">
        <div className="mx-auto mb-3 mt-1 h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="day-request-sheet-title" className="text-xl font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
          </div>
          <button ref={closeButtonRef} type="button" onClick={() => onClose(currentMemo)} aria-label="閉じる"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <X size={22} />
          </button>
        </div>

        {step === 'choose' && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-md border border-slate-300">
              {choices.map(choice => {
                const isCurrent = draft.kind === choice.kind
                return (
                  <button key={choice.kind} type="button" onClick={() => choose(choice.kind)} aria-pressed={isCurrent}
                    className={`flex min-h-16 w-full items-center justify-between gap-2 border-t border-slate-200 px-4 text-left text-lg font-bold first:border-t-0 hover:bg-slate-50 ${
                      isCurrent ? 'bg-slate-50 shadow-[inset_4px_0_0_#1e293b]' : 'bg-white'
                    } ${choice.kind === 'off' ? 'text-red-700' : 'text-slate-900'}`}>
                    <span>{choice.label}</span>
                    {isCurrent && (choice.kind === 'from' || choice.kind === 'until' || choice.kind === 'range') && (
                      <span className="text-sm font-medium text-slate-500">{currentLabel}</span>
                    )}
                  </button>
                )
              })}
            </div>
            {allowClear && (
              <div className="flex justify-center">
                <button type="button" onClick={() => onApply(null, currentMemo)} className="px-2 py-2 text-[15px] font-bold text-slate-600 underline underline-offset-4">
                  希望なしに戻す
                </button>
              </div>
            )}
            {memo !== undefined && (
              <details open={memoInitiallyOpen}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center text-[15px] font-bold text-slate-600">店長へのメモ（任意）</summary>
                <textarea value={memoText} onChange={event => setMemoText(event.target.value)} maxLength={500} rows={3}
                  aria-label="店長へのメモ"
                  className="w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-base text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
                <p className="mt-1 text-[13px] text-slate-500">メモはシフトの自動作成には使われません。</p>
              </details>
            )}
          </div>
        )}

        {timeStep && (
          <div className="space-y-3">
            <p className="text-base font-bold text-slate-900">{timeStep.heading}</p>
            <TimeGrid from={timeStep.from} to={timeStep.to} picked={timeStep.picked} minimum={timeStep.minimum} onPick={pickTime} />
            <div className="grid grid-cols-[1fr_2fr] gap-2 pt-1">
              <button type="button" onClick={() => setStep(step === 'rangeEnd' ? 'rangeStart' : 'choose')}
                className="min-h-12 rounded-md border border-slate-300 bg-white px-3 text-[15px] font-bold text-slate-700 hover:bg-slate-50">戻る</button>
              <button type="button" onClick={confirm} disabled={!isComplete(draft)}
                className="min-h-14 rounded-md bg-[var(--primary)] px-3 text-[17px] font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300 disabled:text-slate-500">
                {isComplete(draft) ? `${currentLabel} で決定` : '時間を選んでください'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

const TIME_GROUPS: { label: string; from: number; to: number }[] = [
  { label: '午前', from: 0, to: 12 * 60 - 1 },
  { label: '午後', from: 12 * 60, to: 17 * 60 - 1 },
  { label: '夕方・夜', from: 17 * 60, to: 48 * 60 },
]

function TimeGrid({ from, to, picked, minimum, onPick }: {
  from: number; to: number; picked: number | null; minimum: number | null; onPick: (minutes: number) => void
}) {
  const options = timeChoices(from, to)
  return (
    <div className="space-y-2">
      {TIME_GROUPS.map(group => {
        const inGroup = options.filter(minutes => minutes >= group.from && minutes <= group.to)
        if (inGroup.length === 0) return null
        return (
          <div key={group.label}>
            <p className="mb-1 text-[13px] font-bold text-slate-500">{group.label}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {inGroup.map(minutes => {
                const isPicked = picked === minutes
                return (
                  <button key={minutes} type="button" onClick={() => onPick(minutes)} aria-pressed={isPicked}
                    disabled={minimum !== null && minutes < minimum}
                    className={`min-h-[52px] rounded-md border text-[17px] tabular-nums disabled:cursor-not-allowed disabled:opacity-35 ${
                      isPicked ? 'border-slate-800 bg-slate-800 font-bold text-white' : `border-slate-300 bg-white text-slate-900 hover:bg-slate-50 ${minutes % 60 ? 'font-medium text-slate-600' : 'font-bold'}`
                    }`}>
                    {formatClock(minutes)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
