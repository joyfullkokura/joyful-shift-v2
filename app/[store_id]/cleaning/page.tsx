'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import saveAs from 'file-saver'
import {
  CalendarDays,
  Check,
  CheckSquare,
  ClipboardCheck,
  Clock3,
  Download,
  FileSpreadsheet,
  Info,
  LockKeyhole,
  Map as MapIcon,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useAdmin } from '@/context/AdminContext'
import { supabase } from '@/lib/supabase'

type AreaKey = '1' | '2' | '3' | '4' | '5' | '6' | '7'
type Areas = Record<AreaKey, boolean>

type CleaningLogRow = {
  id: string
  store_id: string
  date: string
  areas: Partial<Areas>
  worker_name: string
  memo: string
  is_confirmed: boolean
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

type EditableCleaningLog = {
  date: string
  areas: Areas
  workerName: string
  memo: string
  isConfirmed: boolean
  confirmedAt: string | null
}

const AREA_KEYS: AreaKey[] = ['1', '2', '3', '4', '5', '6', '7']
const EMPTY_AREAS: Areas = { '1': false, '2': false, '3': false, '4': false, '5': false, '6': false, '7': false }
const AREA_LABELS: Record<AreaKey, string> = {
  '1': '①',
  '2': '②',
  '3': '③',
  '4': '④',
  '5': '⑤',
  '6': '⑥',
  '7': '⑦',
}

function getSundays(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  const candidates: Array<string | null> = Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, month - 1, index + 1)
    return date.getDay() === 0 ? `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}` : null
  })
  return candidates.filter((date): date is string => date !== null)
}

function normalizeAreas(value: Partial<Areas> | null | undefined): Areas {
  return AREA_KEYS.reduce<Areas>((areas, key) => {
    areas[key] = value?.[key] === true
    return areas
  }, { ...EMPTY_AREAS })
}

function createInitialRecord(date: string): EditableCleaningLog {
  return {
    date,
    areas: { ...EMPTY_AREAS },
    workerName: '',
    memo: '',
    isConfirmed: false,
    confirmedAt: null,
  }
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
}

function formatExcelDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(year, month - 1, day).toLocaleDateString('ja-JP', { weekday: 'short' })
  return `${month}/${day}(${weekday})`
}

function configureA4Worksheet(worksheet: import('exceljs').Worksheet): void {
  worksheet.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.05, footer: 0.05 },
    horizontalCentered: true,
    showGridLines: false,
  }
}

function getPeriodMonths(period: string): number[] {
  const [start, end] = period.split('-').map(Number)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export default function CleaningPage() {
  const params = useParams<{ store_id: string }>()
  const storeId = params.store_id
  const { isAdmin } = useAdmin()
  const today = new Date()
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1)
  const [records, setRecords] = useState<EditableCleaningLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('1-4')
  const [saveMessage, setSaveMessage] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [loadError, setLoadError] = useState('')

  const sundayDates = useMemo(
    () => getSundays(selectedYear, selectedMonth),
    [selectedYear, selectedMonth],
  )

  useEffect(() => {
    let isCurrent = true

    const loadRecords = async () => {
      setIsLoading(true)
      setLoadError('')
      setSaveMessage('')

      if (sundayDates.length === 0) {
        setRecords([])
        setIsLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('cleaning_logs')
        .select('id, store_id, date, areas, worker_name, memo, is_confirmed, confirmed_at, created_at, updated_at')
        .eq('store_id', storeId)
        .in('date', sundayDates)

      if (!isCurrent) return

      if (error) {
        setLoadError(`清掃記録を読み込めませんでした: ${error.message}`)
        setRecords(sundayDates.map(createInitialRecord))
        setIsLoading(false)
        return
      }

      const rows = (data ?? []) as CleaningLogRow[]
      const recordsByDate = new Map(rows.map(row => [row.date, row]))
      setRecords(sundayDates.map(date => {
        const row = recordsByDate.get(date)
        if (!row) return createInitialRecord(date)
        return {
          date: row.date,
          areas: normalizeAreas(row.areas),
          workerName: row.worker_name ?? '',
          memo: row.memo ?? '',
          isConfirmed: row.is_confirmed === true,
          confirmedAt: row.confirmed_at ?? null,
        }
      }))
      setIsLoading(false)
    }

    void loadRecords().catch(() => {
      if (!isCurrent) return
      setLoadError('データ取得中に予期しないエラーが発生しました。')
      setRecords(sundayDates.map(createInitialRecord))
      setIsLoading(false)
    })

    return () => { isCurrent = false }
  }, [selectedMonth, selectedYear, storeId, sundayDates])

  const updateRecord = (date: string, patch: Partial<EditableCleaningLog>) => {
    setRecords(current => current.map(record => record.date === date ? { ...record, ...patch } : record))
    setSaveMessage('')
  }

  const updateArea = (date: string, key: AreaKey, checked: boolean) => {
    setRecords(current => current.map(record => {
      if (record.date !== date) return record
      return {
        ...record,
        areas: { ...record.areas, [key]: checked },
      }
    }))
    setSaveMessage('')
  }

  const saveRecords = async () => {
    if (!isAdmin || isSaving || records.length === 0) return

    setIsSaving(true)
    setSaveMessage('')
    setLoadError('')

    const payloads = records.map(record => ({
      store_id: storeId,
      date: record.date,
      areas: record.areas,
      worker_name: record.workerName.trim(),
      memo: record.memo.trim(),
      is_confirmed: record.isConfirmed,
      confirmed_at: record.isConfirmed ? record.confirmedAt ?? new Date().toISOString() : null,
    }))

    const { error } = await supabase.from('cleaning_logs').upsert(payloads, {
      onConflict: 'store_id,date',
    })

    if (error) {
      setLoadError(`保存に失敗しました: ${error.message}`)
    } else {
      setSaveMessage(`${records.length}件の清掃記録を保存しました。`)
    }
    setIsSaving(false)
  }

  const yearOptions = Array.from({ length: 3 }, (_, index) => today.getFullYear() + index - 1)
  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
  const periodOptions = [
    { value: '1-4', label: '1〜4月' },
    { value: '5-8', label: '5〜8月' },
    { value: '9-12', label: '9〜12月' },
  ]

  const deriveExportRecord = (date: string): EditableCleaningLog => {
    const existing = records.find(record => record.date === date)
    return existing ?? createInitialRecord(date)
  }

  const downloadWorkbook = async (workbook: import('exceljs').Workbook, filename: string) => {
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    saveAs(blob, filename)
  }

  const exportMonthlyReport = async () => {
    if (!isAdmin || isExporting) return
    setIsExporting(true)
    setExportMessage('')
    setLoadError('')

    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet(`清掃報告書_${selectedMonth}月`, { views: [{ state: 'frozen', ySplit: 6 }] })
      configureA4Worksheet(worksheet)

      worksheet.getRow(1).height = 8
      worksheet.mergeCells('A1:I1')
      worksheet.getCell('A2').value = `ジョイフル ${storeId}店 ${selectedYear}年${selectedMonth}月 モップ清掃報告書`
      worksheet.mergeCells('A2:I2')
      worksheet.getCell('A2').font = { name: 'Meiryo UI', size: 22, bold: true, color: { argb: 'FF1F2937' } }
      worksheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' }
      worksheet.getRow(2).height = 32

      const header = ['日付', '①', '②', '③', '④', '⑤', '⑥', '⑦', '一言メモ・担当']
      header.forEach((value, index) => {
        const cell = worksheet.getCell(6, index + 1)
        cell.value = value
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }
        cell.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } }, left: { style: 'thin', color: { argb: 'FF9CA3AF' } }, bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } }, right: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
      })
      worksheet.getRow(6).height = 28

      sundayDates.forEach((date, index) => {
        const rowNumber = 7 + index
        const record = deriveExportRecord(date)
        const row = worksheet.getRow(rowNumber)
        row.height = 45
        worksheet.getCell(rowNumber, 1).value = formatExcelDate(date)
        worksheet.getCell(rowNumber, 1).alignment = { vertical: 'middle', horizontal: 'center' }

        AREA_KEYS.forEach((key, areaIndex) => {
          const cell = worksheet.getCell(rowNumber, areaIndex + 2)
          cell.value = record.areas[key] ? '済' : 'ー'
          cell.font = { name: 'Meiryo UI', size: 11, bold: record.areas[key], color: { argb: record.areas[key] ? 'FFC00000' : 'FF111827' } }
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
        })

        const notes = [record.workerName, record.memo].filter(Boolean).join('\n') || '／'
        const notesCell = worksheet.getCell(rowNumber, 9)
        notesCell.value = notes
        notesCell.alignment = { vertical: 'middle', wrapText: true }
        notesCell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
        row.eachCell(cell => cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } })
      })

      const stampRow = 7 + sundayDates.length
      worksheet.getCell(stampRow, 1).value = '店長確認印'
      worksheet.getCell(stampRow, 1).font = { bold: true, color: { argb: 'FF374151' } }
      worksheet.getCell(stampRow, 1).alignment = { vertical: 'middle', horizontal: 'left' }
      worksheet.mergeCells(`A${stampRow + 1}:I${stampRow + 3}`)
      worksheet.getCell(stampRow + 1, 1).value = '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　'
      worksheet.getCell(stampRow + 1, 1).alignment = { vertical: 'middle', horizontal: 'center' }
      worksheet.getRow(stampRow + 1).height = 18
      worksheet.getRow(stampRow + 2).height = 18
      worksheet.getRow(stampRow + 3).height = 18
      worksheet.getColumn(1).width = 14
      worksheet.getColumn(2).width = 7
      worksheet.getColumn(3).width = 7
      worksheet.getColumn(4).width = 7
      worksheet.getColumn(5).width = 7
      worksheet.getColumn(6).width = 7
      worksheet.getColumn(7).width = 7
      worksheet.getColumn(8).width = 7
      worksheet.getColumn(9).width = 24
      worksheet.autoFilter = { from: 'A6', to: `I${6 + sundayDates.length}` }
      worksheet.views = [{ state: 'frozen', ySplit: 6 }]

      await downloadWorkbook(workbook, `清掃報告書_${storeId}_${selectedYear}_${selectedMonth}.xlsx`)
      setExportMessage(`${selectedYear}年${selectedMonth}月の清掃報告書を作成しました。`)
    } catch (error) {
      setLoadError(`Excel出力に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`)
    } finally {
      setIsExporting(false)
    }
  }

  const exportDisplayWorkbook = async () => {
    if (!isAdmin || isExporting) return
    setIsExporting(true)
    setExportMessage('')
    setLoadError('')

    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('掲示用ワークシート', { views: [{ state: 'frozen' }] })
      configureA4Worksheet(worksheet)
      const periodLabel = selectedPeriod === '1-4' ? '1〜4月' : selectedPeriod === '5-8' ? '5〜8月' : '9〜12月'
      const monthList = getPeriodMonths(selectedPeriod)
      let rowOffset = 1

      monthList.forEach(month => {
        const monthTitleRow = rowOffset
        worksheet.mergeCells(`A${monthTitleRow}:J${monthTitleRow}`)
        worksheet.getCell(monthTitleRow, 1).value = `${selectedYear}年${month}月`
        worksheet.getCell(monthTitleRow, 1).font = { name: 'Meiryo UI', size: 16, bold: true, color: { argb: 'FF1F2937' } }
        worksheet.getCell(monthTitleRow, 1).alignment = { vertical: 'middle', horizontal: 'center' }
        worksheet.getRow(monthTitleRow).height = 28

        const headerRow = monthTitleRow + 1
        const headers = ['清掃日', '①', '②', '③', '④', '⑤', '⑥', '⑦', '担当', '補足']
        headers.forEach((header, index) => {
          const cell = worksheet.getCell(headerRow, index + 1)
          cell.value = header
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }
          cell.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } }, left: { style: 'thin', color: { argb: 'FF9CA3AF' } }, bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } }, right: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
        })
        worksheet.getRow(headerRow).height = 24

        getSundays(selectedYear, month).forEach((date, index) => {
          const currentRow = headerRow + 1 + index
          const row = worksheet.getRow(currentRow)
          row.height = 18
          worksheet.getCell(currentRow, 1).value = formatExcelDate(date)
          worksheet.getCell(currentRow, 1).alignment = { vertical: 'middle', horizontal: 'center' }
          for (let column = 2; column <= 8; column += 1) {
            const cell = worksheet.getCell(currentRow, column)
            cell.value = ''
            cell.alignment = { vertical: 'middle', horizontal: 'center' }
            cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
          }
          worksheet.getCell(currentRow, 9).value = ''
          worksheet.getCell(currentRow, 10).value = ''
          worksheet.getCell(currentRow, 9).alignment = { vertical: 'middle', wrapText: true }
          worksheet.getCell(currentRow, 10).alignment = { vertical: 'middle', wrapText: true }
        })

        rowOffset = headerRow + 2 + getSundays(selectedYear, month).length
      })

      worksheet.columns = [
        { width: 14 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 },
        { width: 7 }, { width: 7 }, { width: 7 }, { width: 15 }, { width: 22 },
      ]
      worksheet.name = '掲示用ワークシート'
      await downloadWorkbook(workbook, `${selectedYear}年_${periodLabel}_掲示用ワークシート.xlsx`)
      setExportMessage(`${selectedYear}年${periodLabel}の掲示用ワークシートを作成しました。`)
    } catch (error) {
      setLoadError(`Excel出力に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-8">
      <header className="mb-6 border-b border-slate-200 pb-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Cleaning record / Check</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">清掃記録・チェック</h1>
            <p className="mt-1 text-sm text-slate-500">{storeId}店 · {isAdmin ? '管理者モード' : '一般スタッフ閲覧モード'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            <span className="px-1 text-xs font-medium text-slate-500">対象</span>
            <label className="sr-only" htmlFor="cleaning-year">年</label>
            <select id="cleaning-year" value={selectedYear} onChange={event => setSelectedYear(Number(event.target.value))} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400">
              {yearOptions.map(year => <option key={year} value={year}>{year}年</option>)}
            </select>
            <span className="text-slate-300">/</span>
            <label className="sr-only" htmlFor="cleaning-month">月</label>
            <select id="cleaning-month" value={selectedMonth} onChange={event => setSelectedMonth(Number(event.target.value))} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400">
              {monthOptions.map(month => <option key={month} value={month}>{month}月</option>)}
            </select>
          </div>
        </div>
      </header>

      {!isAdmin ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">清掃区画マップ</h2>
                <p className="mt-1 text-xs text-slate-500">店内の清掃区画を確認してください。</p>
              </div>
              <div className="hidden h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600 sm:flex"><MapIcon size={17} /></div>
            </div>
            <div className="flex justify-center bg-slate-50 p-4 sm:p-7">
              <Image src="/cleaning_map.png" alt="清掃区画マップ" width={700} height={500} unoptimized className="h-auto w-full max-w-[700px] rounded-md border border-slate-300 bg-white object-contain shadow-sm" />
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-50 text-amber-700"><Info size={17} /></div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">清掃手順</h2>
                  <p className="text-xs text-slate-500">毎週日曜日21時以降に実施</p>
                </div>
              </div>
              <ol className="mt-5 space-y-4">
                {[
                  ['01', '店内を確認し、清掃対象の区画を特定する'],
                  ['02', '①〜⑦の区画を順番に清掃する'],
                  ['03', '担当者名と補足を記録する'],
                  ['04', '店長確認後、記録を完了とする'],
                ].map(([number, text]) => (
                  <li key={number} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{number}</span>
                    <p className="pt-0.5 text-sm leading-5 text-slate-600">{text}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-lg border border-slate-200 bg-slate-900 p-5 text-white shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} />定時確認</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">日曜日21時以降に清掃を開始し、終了後に記録を管理者へ提出してください。</p>
            </section>
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><ClipboardCheck size={17} />清掃記録を編集</h2>
                <p className="mt-1 text-xs text-slate-500">{selectedYear}年{selectedMonth}月の日曜日を対象にします。既存データは自動表示されます。</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-2.5 py-1">{sundayDates.length}日分</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"> Supabase sync</span>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
              <button type="button" onClick={exportMonthlyReport} disabled={isExporting || isLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60">
                <Download size={16} />📥 {selectedMonth}月の清掃報告書を作成 (Excel)
              </button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="display-period">表示用ワークシートの期間</label>
                <select id="display-period" value={selectedPeriod} onChange={event => setSelectedPeriod(event.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400">
                  {periodOptions.map(option => <option key={option.value} value={option.value}>{option.label} 掲示用ワークシート</option>)}
                </select>
                <button type="button" onClick={exportDisplayWorkbook} disabled={isExporting || isLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                  <FileSpreadsheet size={16} />📄 {selectedYear}年 {periodOptions.find(option => option.value === selectedPeriod)?.label} 掲示用ワークシート生成
                </button>
              </div>
            </div>

            {loadError && <div role="alert" className="mx-5 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadError}</div>}
            {exportMessage && <div role="status" className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><Check size={15} />{exportMessage}</div>}


            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="w-[150px] border-b border-r border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide">清掃日</th>
                    {AREA_KEYS.map(key => <th key={key} className="w-[70px] border-b border-r border-slate-200 px-3 py-3 text-center text-xs font-semibold">{AREA_LABELS[key]}区画</th>)}
                    <th className="w-[160px] border-b border-r border-slate-200 px-3 py-3 text-xs font-semibold">担当者</th>
                    <th className="w-[360px] border-b border-r border-slate-200 px-3 py-3 text-xs font-semibold">一言メモ・補足</th>
                    <th className="w-[170px] border-b border-slate-200 px-3 py-3 text-xs font-semibold">店長確認</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={10} className="px-4 py-16 text-center text-sm text-slate-500">清掃記録を取得中です...</td></tr>
                  ) : records.map(record => (
                    <tr key={record.date} className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50/60">
                      <th className="border-r border-slate-200 bg-slate-50/70 px-4 py-3 align-top">
                        <span className="block text-sm font-semibold text-slate-900">{formatDate(record.date)}</span>
                        <span className="mt-1 block text-[11px] text-slate-500">日曜日</span>
                      </th>
                      {AREA_KEYS.map(key => (
                        <td key={key} className="border-r border-slate-200 px-3 py-3 text-center align-top">
                          <label className="inline-flex cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              checked={record.areas[key]}
                              onChange={event => updateArea(record.date, key, event.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 accent-slate-900 focus:ring-slate-500"
                            />
                            <span className="sr-only">{record.date}の{AREA_LABELS[key]}区画を完了</span>
                          </label>
                        </td>
                      ))}
                      <td className="border-r border-slate-200 px-3 py-3 align-top">
                        <label className="sr-only" htmlFor={`worker-${record.date}`}>担当者</label>
                        <div className="flex items-center gap-2">
                          <UserRound size={14} className="shrink-0 text-slate-400" />
                          <input id={`worker-${record.date}`} value={record.workerName} onChange={event => updateRecord(record.date, { workerName: event.target.value })} placeholder="担当者名" className="h-9 min-w-0 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100" />
                        </div>
                      </td>
                      <td className="border-r border-slate-200 px-3 py-3 align-top">
                        <label className="sr-only" htmlFor={`memo-${record.date}`}>一言メモ・補足</label>
                        <input id={`memo-${record.date}`} value={record.memo} onChange={event => updateRecord(record.date, { memo: event.target.value })} placeholder="補足・注意事項" className="h-9 min-w-0 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100" />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input type="checkbox" checked={record.isConfirmed} onChange={event => updateRecord(record.date, { isConfirmed: event.target.checked, confirmedAt: event.target.checked ? record.confirmedAt ?? new Date().toISOString() : null })} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900" />
                          <span className="text-xs leading-5 text-slate-600">{record.isConfirmed ? '確認済み' : '未確認'}</span>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {records.length === 0 && !isLoading && (
              <div className="px-5 py-12 text-center"><p className="text-sm text-slate-500">この月には日曜日がありません。</p></div>
            )}

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck size={14} />店舗×日付の一意キーで保存されます。</p>
              <button type="button" onClick={saveRecords} disabled={isSaving || isLoading || records.length === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">
                {isSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Save size={16} />}
                {isSaving ? '保存中...' : '💾 清掃記録を保存する'}
              </button>
            </div>
            {saveMessage && <p role="status" className="mx-5 mb-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><Check size={15} />{saveMessage}</p>}
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarDays size={16} />日曜日の自動算出</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">選択した年・月の日曜日を対象に、未登録データを自動作成します。</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CheckSquare size={16} />区画チェック</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">①〜⑦の区画ごとに完了状態を選択し、確認情報を付けます。</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><LockKeyhole size={16} />管理者権限</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">通常スタッフは閲覧のみで、管理者のみ編集・保存を実行できます。</p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
