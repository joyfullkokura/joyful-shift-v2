'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MINUTE_CHOICES = ['00', '15', '30', '45'] as const

type MinuteChoice = (typeof MINUTE_CHOICES)[number]
type TimePart = 'startHour' | 'startMinute' | 'endHour' | 'endMinute'
type EditorMode = 'quick' | 'detail'

type ParsedShift = {
  startHour: number
  startMinute: string
  endHour: number
  endMinute: string
}

export type ShiftTimeEditorProps = {
  value: string
  minTime: number
  maxTime: number
  presets: string[]
  isActive: boolean
  mode: EditorMode
  onActivate: (mode: EditorMode) => void
  onDeactivate: () => void
  onChange: (value: string) => void
}

const pad2 = (value: number) => String(value).padStart(2, '0')

export const hoursInStoreRange = (minTime: number, maxTime: number): number[] => {
  const start = Number.isFinite(minTime) ? Math.max(0, Math.floor(minTime)) : 0
  const end = Number.isFinite(maxTime) ? Math.min(24, Math.max(start, Math.floor(maxTime))) : 24
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export const parseShiftLabel = (value: string): ParsedShift | null => {
  const match = value.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return {
    startHour: Number(match[1]),
    startMinute: match[2],
    endHour: Number(match[3]),
    endMinute: match[4],
  }
}

const formatShiftLabel = (shift: ParsedShift) =>
  `${pad2(shift.startHour)}:${shift.startMinute}-${pad2(shift.endHour)}:${shift.endMinute}`

const minuteChoicesFor = (current: string): string[] => (
  MINUTE_CHOICES.includes(current as MinuteChoice) ? [...MINUTE_CHOICES] : [...MINUTE_CHOICES, current]
)

const displayLabel = (value: string) => {
  if (!value || value === '休み') return '休み'
  if (value === '×') return '×'
  return value
}

export default function ShiftTimeEditor({
  value,
  minTime,
  maxTime,
  presets,
  isActive,
  mode,
  onActivate,
  onDeactivate,
  onChange,
}: ShiftTimeEditorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const hoverCloseTimer = useRef<number | null>(null)
  const hoverOpenTimer = useRef<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 300 })
  const [openPart, setOpenPart] = useState<TimePart | null>(null)

  const hours = useMemo(() => hoursInStoreRange(minTime, maxTime), [minTime, maxTime])
  const parsed = parseShiftLabel(value)
  const firstHour = hours[0] ?? 10
  const lastHour = hours[hours.length - 1] ?? 18
  const draft: ParsedShift = parsed ?? {
    startHour: firstHour,
    startMinute: '00',
    endHour: lastHour,
    endMinute: '00',
  }

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => () => {
    if (hoverCloseTimer.current !== null) window.clearTimeout(hoverCloseTimer.current)
    if (hoverOpenTimer.current !== null) window.clearTimeout(hoverOpenTimer.current)
  }, [])

  useEffect(() => {
    if (!isActive) setOpenPart(null)
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(320, window.innerWidth - 16)
      const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))
      const estimatedHeight = mode === 'detail' ? 320 : 168
      const openBelow = rect.bottom + 8 + estimatedHeight < window.innerHeight - 8
      const top = openBelow ? rect.bottom + 8 : Math.max(8, rect.top - estimatedHeight - 8)
      setPanelPos({ top, left, width })
    }
    updatePosition()
    const closeOnScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return
      onDeactivate()
    }
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [isActive, mode, onDeactivate, openPart])

  useEffect(() => {
    if (!isActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDeactivate()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isActive, onDeactivate])

  const clearHoverClose = () => {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current)
      hoverCloseTimer.current = null
    }
  }

  const clearHoverOpen = () => {
    if (hoverOpenTimer.current !== null) {
      window.clearTimeout(hoverOpenTimer.current)
      hoverOpenTimer.current = null
    }
  }

  const scheduleHoverClose = () => {
    clearHoverClose()
    hoverCloseTimer.current = window.setTimeout(() => {
      if (mode === 'quick') onDeactivate()
    }, 180)
  }

  const applyShift = (next: ParsedShift) => {
    onChange(formatShiftLabel(next))
  }

  const updatePart = (part: TimePart, nextValue: number | string) => {
    const next = { ...draft, [part]: nextValue }
    applyShift(next)
    if (part === 'startMinute' || part === 'endMinute') setOpenPart(null)
  }

  const isOff = !value || value === '休み'
  const isUnavailable = value === '×'

  return (
    <div data-shift-editor className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isActive}
        aria-haspopup="dialog"
        onClick={() => {
          clearHoverOpen()
          onActivate('detail')
        }}
        onFocus={() => onActivate('detail')}
        onPointerEnter={event => {
          if (event.pointerType !== 'mouse') return
          clearHoverClose()
          clearHoverOpen()
          hoverOpenTimer.current = window.setTimeout(() => {
            onActivate(isActive && mode === 'detail' ? 'detail' : 'quick')
          }, 220)
        }}
        onPointerLeave={event => {
          if (event.pointerType !== 'mouse') return
          clearHoverOpen()
          scheduleHoverClose()
        }}
        className={`flex min-h-10 w-full min-w-0 items-center justify-center rounded-md border px-1 text-center text-[11px] font-medium tabular-nums tracking-tight transition ${
          isActive
            ? 'border-slate-500 bg-white text-slate-900 ring-2 ring-slate-200'
            : 'border-transparent bg-transparent hover:border-slate-300 hover:bg-slate-50'
        } ${isUnavailable ? 'text-rose-600' : isOff ? 'text-slate-400' : 'text-slate-800'}`}
      >
        <span className="block w-full truncate whitespace-nowrap">{displayLabel(value)}</span>
      </button>

      {mounted && isActive && createPortal(
        <div
          ref={panelRef}
          data-shift-editor
          role="dialog"
          aria-label="勤務時間を編集"
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          onPointerEnter={clearHoverClose}
          onPointerLeave={event => {
            if (event.pointerType !== 'mouse') return
            scheduleHoverClose()
          }}
          className="fixed z-[80] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl"
        >
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">基本枠</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[...presets, ''].map(preset => (
              <button
                key={preset || 'off'}
                type="button"
                onClick={() => {
                  onChange(preset)
                  onDeactivate()
                }}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums ${
                  value === preset || (preset === '' && isOff)
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {preset || '休み'}
              </button>
            ))}
          </div>

          {(mode === 'detail' || openPart) && (
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">時・分をクリックして指定</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <TimeSegment
                  label="開始"
                  hour={draft.startHour}
                  minute={draft.startMinute}
                  hourOpen={openPart === 'startHour'}
                  minuteOpen={openPart === 'startMinute'}
                  onHourClick={() => setOpenPart(current => current === 'startHour' ? null : 'startHour')}
                  onMinuteClick={() => setOpenPart(current => current === 'startMinute' ? null : 'startMinute')}
                />
                <span className="pb-2 text-xs text-slate-400">–</span>
                <TimeSegment
                  label="終了"
                  hour={draft.endHour}
                  minute={draft.endMinute}
                  hourOpen={openPart === 'endHour'}
                  minuteOpen={openPart === 'endMinute'}
                  onHourClick={() => setOpenPart(current => current === 'endHour' ? null : 'endHour')}
                  onMinuteClick={() => setOpenPart(current => current === 'endMinute' ? null : 'endMinute')}
                />
              </div>

              {openPart === 'startHour' || openPart === 'endHour' ? (
                <div className="mt-2 grid grid-cols-6 gap-1">
                  {hours.map(hour => {
                    const selected = openPart === 'startHour' ? draft.startHour === hour : draft.endHour === hour
                    return (
                      <button
                        key={`${openPart}-${hour}`}
                        type="button"
                        onClick={() => updatePart(openPart, hour)}
                        className={`h-8 rounded-md border text-xs font-medium tabular-nums ${
                          selected ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {pad2(hour)}
                      </button>
                    )
                  })}
                </div>
              ) : openPart === 'startMinute' || openPart === 'endMinute' ? (
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {minuteChoicesFor(openPart === 'startMinute' ? draft.startMinute : draft.endMinute).map(minute => {
                    const selected = openPart === 'startMinute' ? draft.startMinute === minute : draft.endMinute === minute
                    return (
                      <button
                        key={`${openPart}-${minute}`}
                        type="button"
                        onClick={() => updatePart(openPart, minute)}
                        className={`h-8 rounded-md border text-xs font-medium tabular-nums ${
                          selected ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {minute}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-2 text-[10px] text-slate-400">時または分の数字を押すと候補が出ます。</p>
              )}
            </div>
          )}

          {mode === 'quick' && !openPart && (
            <button
              type="button"
              onClick={() => onActivate('detail')}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            >
              時・分を個別に指定
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

function TimeSegment({
  label,
  hour,
  minute,
  hourOpen,
  minuteOpen,
  onHourClick,
  onMinuteClick,
}: {
  label: string
  hour: number
  minute: string
  hourOpen: boolean
  minuteOpen: boolean
  onHourClick: () => void
  onMinuteClick: () => void
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium text-slate-500">{label}</p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`${label}の時`}
          onClick={onHourClick}
          className={`h-9 min-w-0 flex-1 rounded-md border text-sm font-semibold tabular-nums ${
            hourOpen ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
          }`}
        >
          {pad2(hour)}
        </button>
        <span className="text-sm font-semibold text-slate-400">:</span>
        <button
          type="button"
          aria-label={`${label}の分`}
          onClick={onMinuteClick}
          className={`h-9 min-w-0 flex-1 rounded-md border text-sm font-semibold tabular-nums ${
            minuteOpen ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
          }`}
        >
          {minute}
        </button>
      </div>
    </div>
  )
}
