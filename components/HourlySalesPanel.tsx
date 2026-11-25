'use client'

import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { type HourlySalesRow, type HourlySalesSet, getHourlySales, saveHourlySales } from '@/app/actions/labor'
import { useUnsavedChanges } from '@/lib/client/app-version'
import { isHoliday } from '@/lib/holidays'
import { averageHourlySales, parsePosHourlyReport } from '@/lib/hourly-sales'

type DayType = 'wd' | 'we'
const DAY_TYPE_LABELS: Record<DayType, string> = { wd: '平日', we: '土日祝' }

type Draft = Record<DayType, { sales: Record<number, string>; customers: Record<number, string>; source: 'manual' | 'pos'; periodLabel: string | null }>

const toDraft = (sets: Record<DayType, HourlySalesSet>): Draft => {
  const one = (set: HourlySalesSet) => ({
    sales: Object.fromEntries(set.rows.map(row => [row.hour, String(row.sales)])),
    customers: Object.fromEntries(set.rows.flatMap(row => row.customers === null ? [] : [[row.hour, String(row.customers)]])),
    source: set.source ?? 'manual' as const,
    periodLabel: set.periodLabel,
  })
  return { wd: one(sets.wd), we: one(sets.we) }
}

const isWeekendOrHoliday = (date: string) => {
  const weekday = new Date(`${date}T00:00:00`).getDay()
  return weekday === 0 || weekday === 6 || isHoliday(date)
}

const cellValue = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'result' in value) return (value as { result: unknown }).result
  if (value && typeof value === 'object' && 'richText' in value) {
    return (value as { richText: { text: string }[] }).richText.map(part => part.text).join('')
  }
  return value
}

/**
 * 時間別売上: average sales per hour for 平日 / 土日祝, typed in or read from the
 * POS 「時間別売上実績表」 (xlsx). Used for 「売上から計算」 next to the required staff.
 */
export default function HourlySalesPanel({ storeId, openHour, closeHour, year, onChange }: {
  storeId: string
  openHour: number
  closeHour: number
  /** Year for report dates written without one (e.g. 11/1(土)). */
  year: number
  onChange: (sets: Record<DayType, HourlySalesRow[]>) => void
}) {
  const [loadedSets, setLoadedSets] = useState<Record<DayType, HourlySalesSet> | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dayType, setDayType] = useState<DayType>('wd')
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const hours = Array.from({ length: Math.max(0, closeHour - openHour) }, (_, index) => openHour + index)
  const isDirty = Boolean(draft && loadedSets && JSON.stringify(draft) !== JSON.stringify(toDraft(loadedSets)))
  useUnsavedChanges('hourly-sales', isDirty)

  useEffect(() => {
    let cancelled = false
    getHourlySales(storeId).then(result => {
      if (cancelled) return
      if (!result.ok) {
        setMessage(result.error)
        return
      }
      setLoadedSets(result.data)
      setDraft(toDraft(result.data))
      onChange({ wd: result.data.wd.rows, we: result.data.we.rows })
    })
    return () => { cancelled = true }
  }, [onChange, storeId])

  const rowsOf = (type: DayType): HourlySalesRow[] => {
    if (!draft) return []
    return Object.entries(draft[type].sales).flatMap(([hour, value]) => {
      const sales = Math.round(Number(value.replace(/,/g, '')))
      if (!value.trim() || !Number.isFinite(sales) || sales < 0) return []
      const customersText = draft[type].customers[Number(hour)]
      const customers = customersText && Number.isFinite(Number(customersText)) ? Number(customersText) : null
      return [{ hour: Number(hour), sales, customers }]
    }).sort((left, right) => left.hour - right.hour)
  }

  const importReport = async (file: File) => {
    setIsBusy(true)
    setMessage('')
    try {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const sheet = workbook.worksheets[0]
      if (!sheet) throw new Error('シートが見つかりません。')
      const rows: unknown[][] = []
      sheet.eachRow({ includeEmpty: true }, row => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : []
        rows.push(values.map(cellValue))
      })
      const today = new Date().toISOString().slice(0, 10)
      let parsedDays = parsePosHourlyReport(rows, year)
      if (parsedDays.length > 0 && parsedDays[0].date > today) parsedDays = parsePosHourlyReport(rows, year - 1)
      const averages = averageHourlySales(parsedDays, isWeekendOrHoliday)
      if (averages.wd.days + averages.we.days === 0) throw new Error('「時間別売上実績表」の形式を読み取れませんでした（日付・売上・客数の行と、時間の列が必要です）。')
      const label = (type: DayType) => {
        const part = averages[type]
        return part.days > 0 ? `${part.from}〜${part.to}（${DAY_TYPE_LABELS[type]}${part.days}日）` : null
      }
      setDraft(current => current && ({
        wd: averages.wd.days > 0
          ? { sales: Object.fromEntries(averages.wd.rows.map(row => [row.hour, String(row.sales)])), customers: Object.fromEntries(averages.wd.rows.flatMap(row => row.customers === null ? [] : [[row.hour, String(row.customers)]])), source: 'pos', periodLabel: label('wd') }
          : current.wd,
        we: averages.we.days > 0
          ? { sales: Object.fromEntries(averages.we.rows.map(row => [row.hour, String(row.sales)])), customers: Object.fromEntries(averages.we.rows.flatMap(row => row.customers === null ? [] : [[row.hour, String(row.customers)]])), source: 'pos', periodLabel: label('we') }
          : current.we,
      }))
      setMessage(`読み込みました：平日${averages.wd.days}日・土日祝${averages.we.days}日の平均。内容を確認して「時間別売上を保存」を押してください。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。')
    } finally {
      setIsBusy(false)
    }
  }

  const save = async () => {
    if (!draft) return
    setIsBusy(true)
    setMessage('')
    const results = await Promise.all((['wd', 'we'] as const).map(type => saveHourlySales(storeId, type, rowsOf(type), draft[type].source, draft[type].periodLabel)))
    setIsBusy(false)
    const failed = results.find(result => !result.ok)
    if (failed && !failed.ok) {
      setMessage(failed.error)
      return
    }
    const saved = { wd: rowsOf('wd'), we: rowsOf('we') }
    setLoadedSets({
      wd: { rows: saved.wd, source: draft.wd.source, periodLabel: draft.wd.periodLabel, updatedAt: null },
      we: { rows: saved.we, source: draft.we.source, periodLabel: draft.we.periodLabel, updatedAt: null },
    })
    onChange(saved)
    setMessage('時間別売上を保存しました。')
  }

  if (!draft) return <p className="text-sm text-slate-500">{message || '時間別売上を読み込んでいます…'}</p>

  const current = draft[dayType]
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(['wd', 'we'] as const).map(type => (
            <button key={type} type="button" onClick={() => setDayType(type)} aria-pressed={dayType === type}
              className={`min-h-10 rounded-md border px-4 text-sm font-bold ${dayType === type ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
              {DAY_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
          <Upload size={16} aria-hidden="true" />POS の時間別売上実績表（xlsx）を読み込む
          <input type="file" accept=".xlsx" className="sr-only" disabled={isBusy}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importReport(file) }} />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {current.source === 'pos' && current.periodLabel ? `POS から：${current.periodLabel}` : '手入力。1日あたりの平均を入れてください。'}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left">時間</th>
              {hours.map(hour => <th key={hour} className="border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums">{hour}時</th>)}
            </tr>
          </thead>
          <tbody>
            {(['sales', 'customers'] as const).map(kind => (
              <tr key={kind}>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left">{kind === 'sales' ? '売上（円）' : '客数'}</th>
                {hours.map(hour => (
                  <td key={hour} className="border border-slate-200 p-0">
                    <input inputMode="numeric" value={current[kind][hour] ?? ''} aria-label={`${DAY_TYPE_LABELS[dayType]} ${hour}時の${kind === 'sales' ? '売上' : '客数'}`}
                      onChange={event => {
                        const value = event.target.value.replace(/[^\d.,]/g, '')
                        setDraft(previous => previous && ({ ...previous, [dayType]: { ...previous[dayType], source: 'manual', [kind]: { ...previous[dayType][kind], [hour]: value } } }))
                      }}
                      className="h-9 w-20 px-1.5 text-right tabular-nums outline-none focus:bg-slate-50" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {message && <p role="status" className="text-sm font-medium text-slate-600">{message}</p>}
        <button type="button" onClick={() => void save()} disabled={isBusy || !isDirty}
          className="min-h-11 rounded-md bg-[var(--primary)] px-5 text-sm font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300 disabled:text-slate-500">
          {isBusy ? '処理中...' : '時間別売上を保存'}
        </button>
      </div>
    </div>
  )
}
