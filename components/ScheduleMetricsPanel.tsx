'use client'

import type { CapacityCheck } from '@/lib/shift-generator/capacity'
import { type ScheduleEvaluation, VIOLATION_LABELS, type ViolationKind } from '@/lib/shift-generator/metrics'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const yen = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('ja-JP')}円`)
const hours = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}h`)
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

function Verdict({ value, target }: { value: number | null; target: number }) {
  if (value === null) return <span className="text-slate-400">—</span>
  const win = value >= target
  return <span className={`font-bold ${win ? 'text-slate-900' : 'text-red-700'}`}>{yen(value)}<span className="ml-1 text-xs">{win ? '勝' : '負'}</span></span>
}

const balanceClass = (balance: number | undefined) => {
  if (balance === undefined) return 'bg-white'
  if (balance <= -1) return 'bg-red-200'
  if (balance < -0.25) return 'bg-red-100'
  if (balance >= 2) return 'bg-amber-300'
  if (balance >= 1) return 'bg-amber-200'
  if (balance > 0.25) return 'bg-amber-100'
  return 'bg-slate-50'
}

/**
 * Numbers of a generated (or hand-edited) schedule: labor hours and expected
 * 人時売上 per day and month, staffing against the required staff, and the
 * labor-rule checks. Evaluation only; it does not change the schedule.
 */
export default function ScheduleMetricsPanel({ evaluation, capacity, target, staffNames }: {
  evaluation: ScheduleEvaluation
  capacity: CapacityCheck | null
  target: number
  staffNames: Record<string, string>
}) {
  const byKind = new Map<ViolationKind, ScheduleEvaluation['violations']>()
  for (const violation of evaluation.violations) byKind.set(violation.kind, [...(byKind.get(violation.kind) ?? []), violation])
  const hasHeatmap = evaluation.days.some(day => day.balanceByHour)
  const heatHours = [...new Set(evaluation.days.flatMap(day => Object.keys(day.balanceByHour ?? {}).map(Number)))].sort((left, right) => left - right)
  const { month, coverage } = evaluation
  const coverageItems = [
    { label: '責任者がいない時間', total: hours(coverage.noLeadHours), dates: coverage.days.filter(day => day.noLeadHours > 0).map(day => day.date) },
    { label: '開店の担当がいない日', total: `${coverage.noOpenDays}日`, dates: coverage.days.filter(day => day.noOpen).map(day => day.date) },
    { label: '締めの担当がいない日', total: `${coverage.noCloseDays}日`, dates: coverage.days.filter(day => day.noClose).map(day => day.date) },
    { label: '新人だけの時間', total: hours(coverage.noviceOnlyHours), dates: coverage.days.filter(day => day.noviceOnlyHours > 0).map(day => day.date) },
  ].filter(item => item.dates.length > 0)

  return (
    <section aria-labelledby="metrics-title" className="space-y-4 rounded-md border border-slate-200 bg-white p-4">
      <h2 id="metrics-title" className="text-lg font-bold text-slate-900">人時と人時売上</h2>

      {capacity && capacity.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {capacity.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-slate-200 p-3">
          <dt className="text-xs font-bold text-slate-500">月の人時（休憩を除く）</dt>
          <dd className="mt-1 text-xl font-bold tabular-nums text-slate-900">{hours(month.laborHours)}</dd>
          <dd className="text-xs text-slate-500">目標で使える人時 {hours(month.budgetHours)}{month.budgetHours !== null ? `（${(month.budgetHours - month.laborHours) >= 0 ? 'あと' : '超過'} ${Math.abs(month.budgetHours - month.laborHours).toFixed(1)}h）` : ''}</dd>
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <dt className="text-xs font-bold text-slate-500">予想人時売上（月）</dt>
          <dd className="mt-1 text-xl tabular-nums"><Verdict value={month.salesPerLaborHour} target={target} /></dd>
          <dd className="text-xs text-slate-500">目標 {yen(target)}・予想売上 {yen(month.expectedSales)}</dd>
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <dt className="text-xs font-bold text-slate-500">平日 / 土日祝</dt>
          <dd className="mt-1 tabular-nums"><Verdict value={evaluation.weekday.salesPerLaborHour} target={target} /></dd>
          <dd className="tabular-nums"><Verdict value={evaluation.weekendHoliday.salesPerLaborHour} target={target} /></dd>
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <dt className="text-xs font-bold text-slate-500">22時以降 / 上限超え</dt>
          <dd className="mt-1 tabular-nums text-slate-900">22時以降 {hours(evaluation.lateNightHours)}</dd>
          <dd className="tabular-nums text-slate-900">1日の上限超え {hours(evaluation.overtimeHours)}（社員 {evaluation.employeeDaysOverDaily}日）</dd>
          <dd className="tabular-nums text-slate-900">週20時間超えのアルバイト {evaluation.partTimersOver20h}人</dd>
        </div>
      </dl>

      <div>
        <h3 className="text-sm font-bold text-slate-800">ルールの確認</h3>
        {evaluation.violations.length === 0
          ? <p className="mt-1 text-sm text-slate-600">労働時間のルールに反するシフトはありません。</p>
          : (
            <ul className="mt-1 space-y-1 text-sm">
              {[...byKind.entries()].map(([kind, items]) => (
                <li key={kind}>
                  <span className="font-bold text-red-700">{VIOLATION_LABELS[kind]} {items.length}件</span>
                  <span className="ml-2 text-slate-600">
                    {items.slice(0, 4).map(item => `${staffNames[item.staffId] ?? item.staffId} ${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}（${item.detail}）`).join('、')}
                    {items.length > 4 ? ` ほか${items.length - 4}件` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        <p className="mt-1 text-xs text-slate-500">自動作成はこれらのルールを超えないように作ります。手で直したシフトはここで確認できます。</p>
      </div>

      <div>
        <h3 className="text-sm font-bold text-slate-800">責任者・開店・締め・新人だけの時間</h3>
        {coverageItems.length === 0
          ? <p className="mt-1 text-sm text-slate-600">足りない時間・日はありません。</p>
          : (
            <ul className="mt-1 space-y-1 text-sm">
              {coverageItems.map(item => (
                <li key={item.label}>
                  <span className="font-bold text-red-700">{item.label} {item.total}</span>
                  <span className="ml-2 text-slate-600">{item.dates.slice(0, 6).map(shortDate).join('、')}{item.dates.length > 6 ? ` ほか${item.dates.length - 6}日` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        <p className="mt-1 text-xs text-slate-500">責任者・開店・締めは、店舗のルール設定でオンにしたときだけ確かめます。</p>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-bold text-slate-800">日別の人時と予想人時売上</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-max border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                {['日付', '区分', '人数', '人時', '予想売上', '予想人時売上', '目標まで', '必要より多い', '必要より少ない'].map(label => (
                  <th key={label} className="border border-slate-200 px-2 py-1 text-left font-bold text-slate-700">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evaluation.days.map(day => {
                const date = new Date(`${day.date}T00:00:00`)
                return (
                  <tr key={day.date}>
                    <td className="border border-slate-200 px-2 py-1 tabular-nums">{date.getMonth() + 1}/{date.getDate()}（{WEEKDAYS[date.getDay()]}）</td>
                    <td className="border border-slate-200 px-2 py-1">{day.configType === 'wd' ? '平日' : day.configType === 'we' ? '土日祝' : '特別日'}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{day.people}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{hours(day.laborHours)}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{yen(day.expectedSales)}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums"><Verdict value={day.salesPerLaborHour} target={target} /></td>
                    <td className={`border border-slate-200 px-2 py-1 text-right tabular-nums ${day.hoursToTarget !== null && day.hoursToTarget < 0 ? 'font-bold text-red-700' : ''}`}>{day.hoursToTarget === null ? '—' : `${day.hoursToTarget > 0 ? '+' : ''}${day.hoursToTarget.toFixed(1)}h`}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{hours(day.overstaffedHours)}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{hours(day.understaffedHours)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>

      {hasHeatmap && (
        <details>
          <summary className="cursor-pointer text-sm font-bold text-slate-800">時間帯ごとの過不足（必要人数との差）</summary>
          <p className="mt-1 text-xs text-slate-500">黄色は必要人数より多い、赤は少ない時間です（締め準備の時間も差として表示）。</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-max border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="border border-slate-200 bg-slate-50 px-2 py-1">日付</th>
                  {heatHours.map(hour => <th key={hour} className="border border-slate-200 bg-slate-50 px-1 py-1 tabular-nums">{hour}</th>)}
                </tr>
              </thead>
              <tbody>
                {evaluation.days.filter(day => day.balanceByHour).map(day => {
                  const date = new Date(`${day.date}T00:00:00`)
                  return (
                    <tr key={day.date}>
                      <th className="border border-slate-200 bg-white px-2 py-1 text-left tabular-nums">{date.getMonth() + 1}/{date.getDate()}（{WEEKDAYS[date.getDay()]}）</th>
                      {heatHours.map(hour => {
                        const balance = day.balanceByHour?.[hour]
                        return (
                          <td key={hour} title={balance === undefined ? undefined : `${hour}時 ${balance > 0 ? '+' : ''}${balance}人`}
                            className={`h-6 w-8 border border-slate-200 text-center tabular-nums text-slate-800 ${balanceClass(balance)}`}>
                            {balance === undefined || Math.abs(balance) < 0.25 ? '' : `${balance > 0 ? '+' : ''}${balance}`}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}
