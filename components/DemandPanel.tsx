'use client'

import { CURVE_JOBS, type CurveJob, MAX_CURVE_PEOPLE, type RequiredCurve, emptyCurve } from '@/lib/required-curve'

export type HourJobValues = Record<CurveJob, Record<number, number>>

const formatYen = (value: number) => `${Math.round(value).toLocaleString('ja-JP')}円`
const formatPeople = (value: number | undefined) => (value === undefined || value === 0 ? '' : String(Math.round(value * 10) / 10))

/**
 * Per day type (the active tab): expected sales of one day, and the required
 * staff per job and hour next to what the slots provide, the past average and
 * what the hourly sales would justify. Hours marked 締め準備 are not excess.
 */
export default function DemandPanel({
  label, hours, expectedSales, onExpectedSales, curve, onCurve, slotPeople, pastPeople, pastDays, salesPeople,
  slotLaborHours, target, onLoadPast, isLoadingPast,
}: {
  label: string
  hours: number[]
  expectedSales: number | null
  onExpectedSales: (value: number | null) => void
  curve: RequiredCurve | null
  onCurve: (curve: RequiredCurve) => void
  /** People the current slots provide per job and hour. */
  slotPeople: HourJobValues
  /** Past average (「過去の実績から作る」), if loaded. */
  pastPeople: HourJobValues | null
  pastDays: number | null
  /** Total people the hourly sales justify per hour, if hourly sales exist. */
  salesPeople: Record<number, number> | null
  /** Labor hours of the slots (paid, after breaks). */
  slotLaborHours: number
  target: number
  onLoadPast: () => void
  isLoadingPast: boolean
}) {
  const value = curve ?? emptyCurve()
  const setPeople = (job: CurveJob, hour: number, people: number) => {
    const next: RequiredCurve = { ...value, [job]: { ...value[job] } }
    if (people > 0) next[job][String(hour)] = Math.min(MAX_CURVE_PEOPLE, Math.round(people * 10) / 10)
    else delete next[job][String(hour)]
    onCurve(next)
  }
  const togglePrep = (hour: number) => {
    const key = String(hour)
    onCurve({ ...value, closing_prep: value.closing_prep.includes(key) ? value.closing_prep.filter(item => item !== key) : [...value.closing_prep, key] })
  }
  const applyPast = () => {
    if (!pastPeople) return
    const next = emptyCurve()
    for (const job of CURVE_JOBS) for (const [hour, people] of Object.entries(pastPeople[job])) if (people > 0) next[job][hour] = Math.round(people * 10) / 10
    next.closing_prep = value.closing_prep
    onCurve(next)
  }

  const budget = expectedSales !== null && target > 0 ? expectedSales / target : null
  const productivity = expectedSales !== null && slotLaborHours > 0 ? expectedSales / slotLaborHours : null

  return (
    <section aria-labelledby="demand-title" className="rounded-md border border-slate-200 bg-white p-4">
      <h3 id="demand-title" className="text-base font-bold text-slate-900">{label}の売上と必要人数</h3>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="text-sm font-bold text-slate-700">
          1日の予想売上
          <span className="mt-1 flex items-center gap-1">
            <input type="number" inputMode="numeric" min={0} step={1000} value={expectedSales ?? ''} aria-label={`${label}の1日の予想売上`}
              onChange={event => onExpectedSales(event.target.value === '' ? null : Math.max(0, Math.round(Number(event.target.value) || 0)))}
              className="min-h-10 w-36 rounded-md border border-slate-300 px-2 text-right tabular-nums" />円
          </span>
        </label>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm">
          <dt className="text-slate-500">枠の人時</dt><dd className="font-bold tabular-nums text-slate-900">{slotLaborHours.toFixed(1)}h</dd>
          <dt className="text-slate-500">目標で使える人時</dt><dd className="font-bold tabular-nums text-slate-900">{budget === null ? '—' : `${budget.toFixed(1)}h`}</dd>
          <dt className="text-slate-500">予想人時売上</dt>
          <dd className={`font-bold tabular-nums ${productivity !== null && productivity < target ? 'text-red-700' : 'text-slate-900'}`}>
            {productivity === null ? '—' : `${formatYen(productivity)}（目標 ${formatYen(target)}・${productivity >= target ? '勝' : '負'}）`}
          </dd>
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">必要人数（1時間ごと）。灰色は参考の値です。</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onLoadPast} disabled={isLoadingPast}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {isLoadingPast ? '集計中...' : '過去の実績を表示'}
          </button>
          {pastPeople && (
            <button type="button" onClick={applyPast} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
              過去の実績から作る
            </button>
          )}
        </div>
      </div>
      {pastPeople && <p className="mt-1 text-xs text-slate-500">過去の実績：直近11週の確定シフト{pastDays ? `（${pastDays}日分）` : ''}の平均。休憩は含みません。今の余りも含むので、そのまま使わず下げてください。</p>}

      <div className="mt-2 overflow-x-auto">
        <table className="w-max border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-2 py-1 text-left">時間</th>
              {hours.map(hour => <th key={hour} className="border border-slate-200 bg-slate-50 px-1 py-1 tabular-nums">{hour}時</th>)}
            </tr>
          </thead>
          <tbody>
            {CURVE_JOBS.map(job => (
              <FragmentRows key={job} job={job} hours={hours} value={value} setPeople={setPeople} slotPeople={slotPeople} pastPeople={pastPeople} />
            ))}
            {salesPeople && (
              <tr>
                <th className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left font-medium text-slate-500">売上から（合計）</th>
                {hours.map(hour => <td key={hour} className="border border-slate-200 px-1 py-1 text-center tabular-nums text-slate-500">{formatPeople(salesPeople[hour])}</td>)}
              </tr>
            )}
            <tr>
              <th className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left font-medium text-slate-700">締め準備</th>
              {hours.map(hour => (
                <td key={hour} className="border border-slate-200 px-1 py-1 text-center">
                  <input type="checkbox" checked={value.closing_prep.includes(String(hour))} onChange={() => togglePrep(hour)} aria-label={`${hour}時は締め準備`} className="h-4 w-4" />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FragmentRows({ job, hours, value, setPeople, slotPeople, pastPeople }: {
  job: CurveJob
  hours: number[]
  value: RequiredCurve
  setPeople: (job: CurveJob, hour: number, people: number) => void
  slotPeople: HourJobValues
  pastPeople: HourJobValues | null
}) {
  return (
    <>
      <tr>
        <th className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left font-bold text-slate-900">{job} 必要</th>
        {hours.map(hour => {
          const required = value[job][String(hour)] ?? 0
          const slots = slotPeople[job][hour] ?? 0
          const over = slots - required
          return (
            <td key={hour} className={`border border-slate-200 p-0 ${required > 0 && over >= 1 ? 'bg-amber-50' : required > 0 && over <= -1 ? 'bg-red-50' : ''}`}>
              <input type="number" inputMode="decimal" min={0} max={MAX_CURVE_PEOPLE} step={0.5} value={required || ''} aria-label={`${job} ${hour}時の必要人数`}
                onChange={event => setPeople(job, hour, Number(event.target.value) || 0)}
                className="h-8 w-12 bg-transparent px-1 text-center text-sm font-bold tabular-nums outline-none focus:bg-white" />
            </td>
          )
        })}
      </tr>
      <tr>
        <th className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left font-medium text-slate-500">{job} 枠の人数</th>
        {hours.map(hour => <td key={hour} className="border border-slate-200 px-1 py-1 text-center tabular-nums text-slate-500">{formatPeople(slotPeople[job][hour])}</td>)}
      </tr>
      {pastPeople && (
        <tr>
          <th className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left font-medium text-slate-500">{job} 過去の実績</th>
          {hours.map(hour => <td key={hour} className="border border-slate-200 px-1 py-1 text-center tabular-nums text-slate-500">{formatPeople(pastPeople[job][hour])}</td>)}
        </tr>
      )}
    </>
  )
}
