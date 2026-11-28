'use client'

import { useState } from 'react'
import { Clock, Lock } from 'lucide-react'
import { type RequestDeadlineView, clearMonthRequestDeadline, saveRequestDeadline } from '@/app/actions/requests'
import {
  DEADLINE_TIME_CHOICES,
  DEFAULT_REQUEST_DEADLINE_TIME,
  type DeadlineSetting,
  type RequestDeadline,
  deadlineStatus,
  formatDeadlineAt,
  japanParts,
} from '@/lib/request-deadline'

type Scope = 'monthly' | 'month'

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1)

/**
 * 「12月分の提出期限　11月20日（金）21:00まで　あと3日」 at the top of the 休み希望
 * screen. 社員・店長 (canEdit) can change it here: the monthly setting, or this month only.
 */
export default function RequestDeadlineBar({ storeId, monthStart, deadline, monthly, now, canEdit, onSaved, onError }: {
  storeId: string
  monthStart: string
  deadline: RequestDeadline | null
  monthly: DeadlineSetting | null
  /** Current time (ms), ticking in the parent. */
  now: number
  canEdit: boolean
  onSaved: (view: RequestDeadlineView, message: string) => void
  onError: (message: string) => void
}) {
  const month = Number(monthStart.slice(5, 7))
  const [editor, setEditor] = useState<{ scope: Scope; day: number; time: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const status = deadline ? deadlineStatus(deadline.at, now) : null

  const openEditor = () => {
    const current = deadline ? japanParts(deadline.at) : null
    setEditor({
      scope: 'month',
      day: current ? Number(current.date.slice(8, 10)) : monthly?.day ?? 20,
      time: current && DEADLINE_TIME_CHOICES.includes(current.time) ? current.time : monthly?.time ?? DEFAULT_REQUEST_DEADLINE_TIME,
    })
  }

  const save = async () => {
    if (!editor) return
    setIsSaving(true)
    const result = await saveRequestDeadline(storeId, monthStart, { scope: editor.scope, day: editor.day, time: editor.time })
    setIsSaving(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    setEditor(null)
    onSaved(result.data, editor.scope === 'monthly'
      ? `毎月の提出期限を「前月${editor.day}日 ${editor.time}」にしました。`
      : `${month}月分の提出期限だけを変更しました。`)
  }

  const clearOverride = async () => {
    setIsSaving(true)
    const result = await clearMonthRequestDeadline(storeId, monthStart)
    setIsSaving(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    setEditor(null)
    onSaved(result.data, `${month}月分の提出期限を毎月の設定に戻しました。`)
  }

  const closed = status?.kind === 'closed'
  const urgent = status?.urgent === true

  return (
    <div className={`mt-2 rounded-md border px-3 py-2 text-sm ${urgent ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {closed ? <Lock size={16} className="shrink-0 text-slate-500" aria-hidden="true" /> : <Clock size={16} className="shrink-0 text-slate-500" aria-hidden="true" />}
        {deadline && status ? (
          <>
            <span className="text-slate-600">{month}月分の提出期限</span>
            <span className="font-bold tabular-nums text-slate-900">{formatDeadlineAt(deadline.at)}まで</span>
            <span className={`font-bold ${urgent ? 'text-amber-700' : closed ? 'text-slate-700' : 'text-slate-600'}`}>
              {closed && canEdit ? '締め切りました（社員・店長は入力できます）' : status.label}
            </span>
          </>
        ) : (
          <span className="text-slate-600">{month}月分の提出期限は決まっていません</span>
        )}
        {canEdit && !editor && (
          <button type="button" onClick={openEditor}
            className="ml-auto min-h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">期限を変更</button>
        )}
      </div>
      {canEdit && deadline?.source === 'override' && !editor && (
        <p className="mt-1 text-xs text-slate-500">この月だけの期限です{monthly ? `（毎月の期限は前月${monthly.day}日 ${monthly.time}）` : ''}。</p>
      )}

      {canEdit && editor && (
        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
          <fieldset className="space-y-1.5" disabled={isSaving}>
            <legend className="sr-only">変更する範囲</legend>
            {([['monthly', '毎月の期限を変更（来月以降も同じ）'], ['month', `この月だけ変更（${month}月分）`]] as const).map(([scope, label]) => (
              <label key={scope} className="flex min-h-9 items-center gap-2 text-slate-800">
                <input type="radio" name="deadline-scope" checked={editor.scope === scope}
                  onChange={() => setEditor(current => current ? { ...current, scope } : current)} className="h-4 w-4 accent-slate-700" />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2 text-slate-700">
            <label className="flex items-center gap-1">前月
              <select value={editor.day} disabled={isSaving} aria-label="提出期限の日（前月）"
                onChange={event => setEditor(current => current ? { ...current, day: Number(event.target.value) } : current)}
                className="min-h-9 rounded-md border border-slate-300 bg-white px-1.5 text-sm">
                {DAYS.map(day => <option key={day} value={day}>{day}</option>)}
              </select>日
            </label>
            <select value={editor.time} disabled={isSaving} aria-label="提出期限の時刻"
              onChange={event => setEditor(current => current ? { ...current, time: event.target.value } : current)}
              className="min-h-9 rounded-md border border-slate-300 bg-white px-1.5 text-sm tabular-nums">
              {DEADLINE_TIME_CHOICES.map(time => <option key={time} value={time}>{time}</option>)}
            </select>
            <span>まで</span>
          </div>
          <p className="text-xs text-slate-500">月の日数より大きい日は、その月の末日になります。時刻は日本時間です。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={isSaving}
              className="min-h-9 rounded-md bg-[var(--primary)] px-4 text-xs font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300">保存</button>
            <button type="button" onClick={() => setEditor(null)} disabled={isSaving}
              className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">やめる</button>
            {deadline?.source === 'override' && (
              <button type="button" onClick={() => void clearOverride()} disabled={isSaving}
                className="ml-auto min-h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">毎月の期限に戻す</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
