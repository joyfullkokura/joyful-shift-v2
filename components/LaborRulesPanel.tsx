'use client'

import { useState } from 'react'
import { saveStoreRules } from '@/app/actions/labor'
import { useUnsavedChanges } from '@/lib/client/app-version'
import { formatClock } from '@/lib/day-request'
import { type LaborRules, monthlyLegalHours } from '@/lib/labor-rules'

const WEEKDAYS = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜']
const hoursOptions = (from: number, to: number, step = 0.5) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, index) => from + index * step)
const timeOptions = Array.from({ length: 48 }, (_, index) => index * 30)

const selectClass = 'min-h-10 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-slate-500'

function Row({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-slate-200 py-3 first:border-t-0 sm:grid-cols-[220px_1fr] sm:items-center">
      <div>
        <p className="text-sm font-bold text-slate-800">{label}</p>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="inline-flex min-h-10 items-center gap-2">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-5 w-5 rounded border-slate-300" />
      {label}
    </label>
  )
}

/**
 * ルール設定: the store's labor-time and on-site rules. The generator starts
 * using them in later steps; until then they are only stored and shown.
 */
/** Fewer marked people than this cannot cover every day (days off, holidays). */
const MIN_MARKED = 2

export default function LaborRulesPanel({ storeId, initial, daysInMonth, flagCounts, onSaved }: {
  storeId: string
  initial: LaborRules
  daysInMonth: number
  /** Staff marked 責任者 / 開店 / 締め on the roster. */
  flagCounts: { lead: number; open: number; close: number } | null
  onSaved: (rules: LaborRules) => void
}) {
  const [rules, setRules] = useState(initial)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const isDirty = JSON.stringify(rules) !== JSON.stringify(initial)
  useUnsavedChanges('labor-rules', isDirty)
  const set = <K extends keyof LaborRules>(key: K, value: LaborRules[K]) => setRules(current => ({ ...current, [key]: value }))

  const save = async () => {
    setIsSaving(true)
    setMessage('')
    const result = await saveStoreRules(storeId, rules)
    setIsSaving(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    setRules(result.data)
    onSaved(result.data)
    setMessage('保存しました。')
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <Row label="労働時間の上限の方式" note="就業規則に合わせて選びます">
        <label className="inline-flex min-h-10 items-center gap-2">
          <input type="radio" name="labor-time-mode" checked={rules.laborTimeMode === 'weekly_40'} onChange={() => set('laborTimeMode', 'weekly_40')} className="h-5 w-5" />
          1日・1週の上限（週40時間）
        </label>
        <label className="inline-flex min-h-10 items-center gap-2">
          <input type="radio" name="labor-time-mode" checked={rules.laborTimeMode === 'monthly_variable'} onChange={() => set('laborTimeMode', 'monthly_variable')} className="h-5 w-5" />
          1か月単位の変形労働時間制（この月は {monthlyLegalHours(daysInMonth)} 時間まで）
        </label>
      </Row>
      <Row label="1日の上限" note="休憩を除いた実働">
        <select aria-label="1日の上限" value={rules.dailyMaxHours} onChange={event => set('dailyMaxHours', Number(event.target.value))} className={selectClass}>
          {hoursOptions(4, 12).map(hours => <option key={hours} value={hours}>{hours}時間</option>)}
        </select>
      </Row>
      {rules.laborTimeMode === 'weekly_40' && (
        <Row label="1週の上限" note="休憩を除いた実働">
          <select aria-label="1週の上限" value={rules.weeklyMaxHours} onChange={event => set('weeklyMaxHours', Number(event.target.value))} className={selectClass}>
            {hoursOptions(20, 60, 1).map(hours => <option key={hours} value={hours}>{hours}時間</option>)}
          </select>
          <span className="text-xs text-slate-500">週の始まり</span>
          <select aria-label="週の始まり" value={rules.weekStartDay} onChange={event => set('weekStartDay', Number(event.target.value))} className={selectClass}>
            {WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}
          </select>
        </Row>
      )}
      <Row label="最低勤務時間" note="これより短いシフトは作らない">
        <select aria-label="最低勤務時間" value={rules.minShiftHours} onChange={event => set('minShiftHours', Number(event.target.value))} className={selectClass}>
          {hoursOptions(0, 6).map(hours => <option key={hours} value={hours}>{hours}時間</option>)}
        </select>
      </Row>
      <Row label="勤務間インターバル" note="終業から次の始業まで">
        <select aria-label="勤務間インターバル" value={rules.restIntervalHours} onChange={event => set('restIntervalHours', Number(event.target.value))} className={selectClass}>
          {hoursOptions(0, 16).map(hours => <option key={hours} value={hours}>{hours}時間</option>)}
        </select>
      </Row>
      <Row label="深夜の時間帯" note="18歳未満は入れない">
        <select aria-label="深夜の開始" value={rules.lateNightStart} onChange={event => set('lateNightStart', Number(event.target.value))} className={selectClass}>
          {timeOptions.map(minutes => <option key={minutes} value={minutes}>{formatClock(minutes)}</option>)}
        </select>
        〜
        <select aria-label="深夜の終了" value={rules.lateNightEnd} onChange={event => set('lateNightEnd', Number(event.target.value))} className={selectClass}>
          {timeOptions.map(minutes => <option key={minutes} value={minutes}>{formatClock(minutes)}</option>)}
        </select>
      </Row>
      <Row label="責任者・開店・締め" note="名簿の「責任者」「開店」「締め」を使う">
        <Toggle checked={rules.checkLead} onChange={value => set('checkLead', value)} label="責任者がいない時間を作らない" />
        <Toggle checked={rules.checkOpenClose} onChange={value => set('checkOpenClose', value)} label="開店・締めの担当を必ず置く" />
        {flagCounts && (
          <ul className="w-full space-y-0.5 text-xs">
            {rules.checkLead && flagCounts.lead < MIN_MARKED && (
              <li className="font-bold text-red-700">{flagCounts.lead === 0 ? '責任者ができる人が名簿にいません。' : `責任者ができる人が${flagCounts.lead}人しかいません。`}名簿で「責任者」に印を付けてください。</li>
            )}
            {rules.checkOpenClose && flagCounts.open < MIN_MARKED && (
              <li className="font-bold text-red-700">{flagCounts.open === 0 ? '開店ができる人が名簿にいません。' : `開店ができる人が${flagCounts.open}人しかいません。`}名簿で「開店」に印を付けてください。</li>
            )}
            {rules.checkOpenClose && flagCounts.close < MIN_MARKED && (
              <li className="font-bold text-red-700">{flagCounts.close === 0 ? '締めができる人が名簿にいません。' : `締めができる人が${flagCounts.close}人しかいません。`}名簿で「締め」に印を付けてください。</li>
            )}
            <li className="text-slate-500">名簿の印：責任者 {flagCounts.lead}人・開店 {flagCounts.open}人・締め {flagCounts.close}人</li>
          </ul>
        )}
      </Row>
      <Row label="新人だけの時間帯" note="このランク以上が1人もいない時間">
        <select aria-label="ランクの下限" value={rules.noviceRankFloor} onChange={event => set('noviceRankFloor', event.target.value === 'A' ? 'A' : event.target.value === 'C' ? 'C' : 'B')} className={selectClass}>
          <option value="A">A以上</option>
          <option value="B">B以上</option>
          <option value="C">C以上</option>
        </select>
        <select aria-label="新人だけの時間帯の扱い" value={rules.noviceRule} onChange={event => set('noviceRule', event.target.value === 'hard' ? 'hard' : 'soft')} className={selectClass}>
          <option value="soft">なるべく避ける（減点）</option>
          <option value="hard">作らない（その枠は空ける）</option>
        </select>
      </Row>
      <Row label="アルバイトの週20時間" note="社会保険の加入ライン">
        <Toggle checked={rules.applyWeekly20hLine} onChange={value => set('applyWeekly20hLine', value)} label="超えないようにする（減点）" />
      </Row>
      <Row label="人時売上の目標" note="月報の勝敗の基準">
        <input type="number" inputMode="numeric" min={1} step={100} value={rules.targetSalesPerLaborHour} aria-label="人時売上の目標"
          onChange={event => set('targetSalesPerLaborHour', Math.max(1, Math.round(Number(event.target.value) || 0)))}
          className="min-h-10 w-32 rounded-md border border-slate-300 px-2 text-right text-sm tabular-nums" />円
      </Row>
      <Row label="売上の時刻のずれ" note="売上は会計時刻。来店はこの時間だけ前">
        <select aria-label="売上の時刻のずれ" value={rules.salesOffsetHours} onChange={event => set('salesOffsetHours', Number(event.target.value))} className={selectClass}>
          {hoursOptions(0, 3).map(hours => <option key={hours} value={hours}>{hours}時間</option>)}
        </select>
      </Row>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {message && <p role="status" className={`text-sm font-bold ${message === '保存しました。' ? 'text-slate-600' : 'text-red-700'}`}>{message}</p>}
        <button type="button" onClick={() => void save()} disabled={isSaving || !isDirty}
          className="min-h-11 rounded-md bg-[var(--primary)] px-5 text-sm font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300 disabled:text-slate-500">
          {isSaving ? '保存中...' : 'ルールを保存'}
        </button>
      </div>
    </div>
  )
}
