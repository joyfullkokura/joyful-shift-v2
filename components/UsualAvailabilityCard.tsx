'use client'

import { useState } from 'react'
import WeeklyAvailabilityEditor from '@/components/WeeklyAvailabilityEditor'
import type { BusinessHours } from '@/lib/day-request'
import { changedWeekdays, usualAsWeeklyDraft, usualAvailabilityOf, type UsualAvailabilityInput } from '@/lib/usual-availability'
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  completeWeeklyAvailability,
  type WeekdayKey,
  type WeeklyAvailability,
  type WeeklyAvailabilityDraft,
} from '@/lib/weekly-availability'
import { formatDayRequest } from '@/lib/day-request'

const dayColor = (day: WeekdayKey) => day === 'sunday' ? 'text-red-600' : day === 'saturday' ? 'text-sky-700' : 'text-slate-700'

/**
 * Staff home: the usual availability per weekday and a change request for it.
 * Nothing changes until the manager approves; one request may be pending at a time.
 */
export default function UsualAvailabilityCard({ profile, hasPendingRequest, pendingWeekly, hours, onSubmit }: {
  profile: UsualAvailabilityInput
  /** Any condition change of this person is waiting for the manager. */
  hasPendingRequest: boolean
  /** The weekday times in that pending request, if it contains them. */
  pendingWeekly: WeeklyAvailability | null
  hours: BusinessHours
  /** Sends the request; resolves to an error message, or null when sent. */
  onSubmit: (weekly: WeeklyAvailability) => Promise<string | null>
}) {
  const usual = usualAvailabilityOf(profile)
  const baseline = usualAsWeeklyDraft(usual)
  const [draft, setDraft] = useState<WeeklyAvailabilityDraft | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')

  const changes = draft ? changedWeekdays(baseline, draft) : []
  const complete = draft ? completeWeeklyAvailability(draft) : null
  const pendingChanges = new Set(pendingWeekly ? changedWeekdays(baseline, pendingWeekly) : [])

  const send = async () => {
    if (!complete || changes.length === 0) return
    setIsSending(true)
    setError('')
    const message = await onSubmit(complete)
    setIsSending(false)
    if (message) setError(message)
    else setDraft(null)
  }

  return (
    <section aria-labelledby="usual-availability-title" className="mb-5 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="usual-availability-title" className="text-sm font-semibold text-slate-800">いつもの出勤できる時間</h2>
          {usual.source === 'bands' && <p className="mt-0.5 text-xs text-slate-500">（以前の時間帯）</p>}
        </div>
        {hasPendingRequest
          ? <span role="status" className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">申請中（店長の確認待ち）</span>
          : (
            <button type="button" onClick={() => { setDraft(baseline); setError('') }}
              className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
              変更を申請
            </button>
          )}
      </div>

      {usual.source === 'none'
        ? <p className="mt-3 text-sm text-slate-500">まだ登録されていません。「変更を申請」から曜日ごとに選んでください。</p>
        : (
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {WEEKDAY_KEYS.map(day => {
              const usualDay = usual.days[day]
              return (
                <div key={day} className="flex items-baseline gap-3 text-sm">
                  <dt className={`w-5 shrink-0 font-bold ${dayColor(day)}`}>{WEEKDAY_LABELS[day]}</dt>
                  <dd className={`font-medium tabular-nums ${usualDay.request?.kind === 'off' ? 'text-red-700' : 'text-slate-800'}`}>{usualDay.long || '未設定'}</dd>
                </div>
              )
            })}
          </dl>
        )}

      {pendingWeekly && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-700">申請中の内容</p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {WEEKDAY_KEYS.map(day => (
              <div key={day} className="flex items-baseline gap-3 text-sm">
                <dt className={`w-5 shrink-0 font-bold ${dayColor(day)}`}>{WEEKDAY_LABELS[day]}</dt>
                <dd className={`tabular-nums ${pendingChanges.has(day) ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
                  {formatDayRequest(pendingWeekly[day], 'long', '出られない')}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget && !isSending) setDraft(null) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="usual-availability-dialog-title"
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-md border border-slate-200 bg-white shadow-2xl">
            <div className="shrink-0 border-b border-slate-200 px-5 py-4">
              <h2 id="usual-availability-dialog-title" className="text-base font-bold text-slate-900">いつもの出勤できる時間の変更を申請</h2>
              <p className="mt-1 text-xs text-slate-500">変える曜日だけ選び直してください。店長が承認すると反映されます。</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <WeeklyAvailabilityEditor value={draft} onChange={setDraft} hours={hours} disabled={isSending} baseline={baseline} />
              {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <span className="mr-auto text-xs font-medium text-slate-500">{changes.length > 0 ? `${changes.length}曜日を変更` : '変更はまだありません'}</span>
              <button type="button" onClick={() => setDraft(null)} disabled={isSending}
                className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">キャンセル</button>
              <button type="button" onClick={() => void send()} disabled={isSending || !complete || changes.length === 0}
                className="min-h-11 rounded-md bg-[var(--primary)] px-4 text-sm font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300 disabled:text-slate-500">
                {isSending ? '送信中...' : '申請する'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
