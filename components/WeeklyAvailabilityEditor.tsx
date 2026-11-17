'use client'

import { useState } from 'react'
import DayRequestSheet from '@/components/DayRequestSheet'
import { type BusinessHours, type DayRequest, formatDayRequest } from '@/lib/day-request'
import { changedWeekdays } from '@/lib/usual-availability'
import { WEEKDAY_KEYS, WEEKDAY_LABELS, type WeekdayKey, type WeeklyAvailabilityDraft } from '@/lib/weekly-availability'

const WEEKDAYS: WeekdayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
const WEEKEND: WeekdayKey[] = ['saturday', 'sunday']

/**
 * Usual availability per weekday: one row per weekday, tapping a row (or
 * several with 「複数の曜日を選ぶ」) opens the same sheet as the request screen.
 */
export default function WeeklyAvailabilityEditor({ value, onChange, hours, disabled = false, baseline }: {
  value: WeeklyAvailabilityDraft
  onChange: (next: WeeklyAvailabilityDraft) => void
  hours: BusinessHours
  disabled?: boolean
  /** When given (a change request), weekdays that differ from it are bold and marked 変更. */
  baseline?: WeeklyAvailabilityDraft
}) {
  const changed = new Set(baseline ? changedWeekdays(baseline, value) : [])
  const [isMultiSelect, setIsMultiSelect] = useState(false)
  const [selected, setSelected] = useState<WeekdayKey[]>([])
  const [sheetDays, setSheetDays] = useState<WeekdayKey[] | null>(null)

  const toggleMulti = () => {
    setIsMultiSelect(current => !current)
    setSelected([])
  }

  const tapDay = (day: WeekdayKey) => {
    if (disabled) return
    if (isMultiSelect) {
      setSelected(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day])
      return
    }
    setSheetDays([day])
  }

  const apply = (request: DayRequest | null) => {
    if (!sheetDays || !request) return
    const next = { ...value }
    sheetDays.forEach(day => { next[day] = request })
    onChange(next)
    setSheetDays(null)
    setSelected([])
    setIsMultiSelect(false)
  }

  const orderedSelection = WEEKDAY_KEYS.filter(day => selected.includes(day))

  return (
    <div className="space-y-2">
      <div className="flex min-h-9 justify-end">
        <button type="button" onClick={toggleMulti} disabled={disabled} className="px-1 py-2 text-[15px] font-bold text-slate-600 underline underline-offset-4 disabled:opacity-50">
          {isMultiSelect ? '複数選択をやめる' : '複数の曜日を選ぶ'}
        </button>
      </div>
      {isMultiSelect && (
        <div className="flex flex-wrap gap-1.5">
          {[{ label: '平日', days: WEEKDAYS }, { label: '土日', days: WEEKEND }, { label: '全部', days: WEEKDAY_KEYS as readonly WeekdayKey[] }].map(option => (
            <button key={option.label} type="button" onClick={() => setSelected([...option.days])}
              className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-[15px] font-bold text-slate-700 hover:bg-slate-50">
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-slate-300">
        {WEEKDAY_KEYS.map(day => {
          const request = value[day]
          const isSelected = selected.includes(day)
          const dayColor = day === 'sunday' ? 'text-red-600' : day === 'saturday' ? 'text-sky-700' : 'text-slate-900'
          return (
            <button key={day} type="button" onClick={() => tapDay(day)} disabled={disabled} aria-pressed={isMultiSelect ? isSelected : undefined}
              aria-label={`${WEEKDAY_LABELS[day]}曜日 ${request ? formatDayRequest(request, 'long', '出られない') : '未設定'}`}
              className={`grid min-h-[60px] w-full grid-cols-[48px_1fr] items-center gap-2.5 border-t border-slate-200 px-4 text-left first:border-t-0 disabled:cursor-default ${
                isSelected ? 'bg-slate-50 shadow-[inset_4px_0_0_#1e293b]' : 'bg-white hover:bg-slate-50'
              }`}>
              <span className={`text-lg font-bold ${dayColor}`}>{WEEKDAY_LABELS[day]}</span>
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className={`text-[17px] tabular-nums ${!request ? 'font-medium text-slate-500'
                  : baseline && !changed.has(day) ? `font-medium ${request.kind === 'off' ? 'text-red-700/70' : 'text-slate-500'}`
                    : request.kind === 'off' ? 'font-bold text-red-700' : 'font-bold text-slate-900'}`}>
                  {request ? formatDayRequest(request, 'long', '出られない') : '未設定'}
                </span>
                {changed.has(day) && <span className="shrink-0 rounded border border-slate-300 px-1.5 text-xs font-bold text-slate-700">変更</span>}
              </span>
            </button>
          )
        })}
      </div>
      {isMultiSelect && (
        <div className="flex items-center gap-2 pt-1">
          <span className="flex-1 text-[15px] font-bold text-slate-900">{selected.length > 0 ? `${selected.length}曜日を選択中` : '曜日を選んでください'}</span>
          <button type="button" disabled={selected.length === 0} onClick={() => setSheetDays(orderedSelection)}
            className="min-h-12 rounded-md bg-[var(--primary)] px-4 text-base font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300 disabled:text-slate-500">
            内容を入れる
          </button>
        </div>
      )}
      {sheetDays && (
        <DayRequestSheet
          key={sheetDays.join(',')}
          title={sheetDays.length === 1 ? `${WEEKDAY_LABELS[sheetDays[0]]}曜日` : `${sheetDays.length}つの曜日をまとめて入力`}
          subtitle={sheetDays.length > 1 ? sheetDays.map(day => WEEKDAY_LABELS[day]).join('・') : undefined}
          initial={sheetDays.length === 1 ? value[sheetDays[0]] ?? null : null}
          hours={hours}
          offLabel="出られない"
          onApply={apply}
          onClose={() => setSheetDays(null)}
        />
      )}
    </div>
  )
}
