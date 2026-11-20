'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  type DayRequestInput,
  type RequestStaff,
  type RequestsPageData,
  type StoreDayRequestView,
  getRequestsPageMonth,
  saveMyMonthRequests,
} from '@/app/actions/requests'
import { unwrap } from '@/lib/action-result'
import { type BusinessHours, type DayRequest, DEFAULT_BUSINESS_HOURS, formatDayRequest, timeToMinutes } from '@/lib/day-request'
import { getHolidayName, isHoliday } from '@/lib/holidays'
import { useParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { useAdmin } from '@/context/AdminContext'
import { useFlash } from '@/components/FlashMessage'
import DayRequestSheet from '@/components/DayRequestSheet'
import { useUnsavedChanges } from '@/lib/client/app-version'
import { CalendarSkeleton, LoadingNote, SkeletonRegion, TableSkeleton } from '@/components/Skeleton'
import { type UsualAvailability, isSameAsUsual, usualAvailabilityOf, usualOnDate } from '@/lib/usual-availability'
import { type DayEntry, applyDayChoice, toRequestPayload } from '@/lib/request-entries'
import { sortStaff } from '@/lib/staff-order'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const getDateKind = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00`)
  const weekday = date.getDay()
  if (isHoliday(dateStr)) return 'holiday'
  if (weekday === 0) return 'sunday'
  if (weekday === 6) return 'saturday'
  return 'weekday'
}

const excelCellBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}


const hourText = (time: string | null) => {
  const minutes = timeToMinutes(time)
  if (minutes === null) return ''
  return minutes % 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : String(minutes / 60)
}

/** Very short label for the store-wide table (36px cells). */
const compactLabel = (request: DayRequest | null) => {
  if (!request) return ''
  switch (request.kind) {
    case 'off': return '休'
    case 'any': return '終日'
    case 'from': return `${hourText(request.start)}〜`
    case 'until': return `〜${hourText(request.end)}`
    case 'range': return `${hourText(request.start)}-${hourText(request.end)}`
    default: return ''
  }
}

const toColumnName = (index: number) => {
  let column = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    current = Math.floor((current - 1) / 26)
  }
  return column
}

type SheetTarget = { dates: string[] }


const toEntries = (rows: RequestsPageData['mine']) => {
  const result: Record<string, DayEntry> = {}
  rows.forEach(row => { result[row.date] = { request: row.request, memo: row.memo } })
  return result
}

const monthDate = (monthStart: string) => {
  const [year, month] = monthStart.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

/**
 * 休み希望 screen. The first month arrives with the page (loaded on the server);
 * other months, and the month after a save, are fetched with one Server Action.
 */
export default function RequestsClient({ initialMonth, initial }: { initialMonth: string; initial: RequestsPageData | null }) {
  const params = useParams()
  const storeId = params.store_id as string
  const { currentStaff } = useAdmin()
  const [staff, setStaff] = useState<RequestStaff[]>(() => sortStaff(initial?.staff ?? []))
  const selectedStaff = currentStaff
  const [entries, setEntries] = useState<Record<string, DayEntry>>(() => toEntries(initial?.mine ?? []))
  const [hours, setHours] = useState<BusinessHours>(initial?.hours ?? DEFAULT_BUSINESS_HOURS)
  const [usual, setUsual] = useState<UsualAvailability>(() => initial?.usual ?? usualAvailabilityOf(null))
  /** One line under the calendar after a one-tap choice (休み / 終日OK) that differs from usual. */
  const [statusNote, setStatusNote] = useState('')
  /** Edits not submitted yet (the reload banner warns about them). */
  const [isDirty, setIsDirty] = useState(false)
  useUnsavedChanges('requests', isDirty)
  const [isMultiSelect, setIsMultiSelect] = useState(false)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // Bumped after saving to re-read the month instead of reloading the page.
  const [reloadKey, setReloadKey] = useState(0)
  const { notify } = useFlash()
  const [allRequests, setAllRequests] = useState<StoreDayRequestView[]>(initial?.requests ?? [])
  /**
   * Which month (and which reload) the screen holds. Until the month matches,
   * nothing can be tapped or saved and placeholders are shown.
   */
  const [loaded, setLoaded] = useState<{ key: string; month: string; status: 'ready' | 'error' } | null>(
    () => initial ? { key: `${initial.month}#0`, month: initial.month, status: 'ready' } : null,
  )

  const now = new Date()
  const [viewDate, setViewDate] = useState(() => monthDate(initialMonth))

  const targetYear = viewDate.getFullYear()
  const targetMonth = viewDate.getMonth() + 1

  const entryMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const isReadOnly = viewDate < entryMonthDate

  const currentMonthStart = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
  const isMonthReady = loaded?.month === currentMonthStart && loaded.status === 'ready'
  const monthLoadFailed = loaded?.month === currentMonthStart && loaded.status === 'error'
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)
  const dateKey = (day: number) => `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const dayOf = (date: string) => Number(date.slice(-2))
  const weekdayOf = (date: string) => new Date(`${date}T00:00:00`).getDay()

  const loadKey = `${currentMonthStart}#${reloadKey}`
  useEffect(() => {
    if (!selectedStaff || !storeId || loaded?.key === loadKey) return
    let cancelled = false
    getRequestsPageMonth(storeId, currentMonthStart).then(result => {
      if (cancelled) return
      if (!result.ok) {
        // Saving an empty month here would delete what is stored, so the month stays locked.
        setLoaded({ key: loadKey, month: currentMonthStart, status: 'error' })
        return
      }
      setStaff(sortStaff(result.data.staff))
      setAllRequests(result.data.requests)
      setHours(result.data.hours)
      setUsual(result.data.usual)
      setEntries(toEntries(result.data.mine))
      setIsDirty(false)
      setLoaded({ key: loadKey, month: currentMonthStart, status: 'ready' })
    })
    return () => { cancelled = true }
  }, [selectedStaff, storeId, currentMonthStart, loadKey, loaded?.key])

  const handleDateClick = (dateStr: string) => {
    if (isReadOnly || !isMonthReady) return
    setStatusNote('')
    if (isMultiSelect) {
      setSelectedDates(previous => previous.includes(dateStr) ? previous.filter(date => date !== dateStr) : [...previous, dateStr].sort())
      return
    }
    setSheet({ dates: [dateStr] })
  }

  const setMultiSelect = (enabled: boolean) => {
    setIsMultiSelect(enabled)
    setSelectedDates([])
  }

  /**
   * One line comparing a choice with the usual availability (null when it is the same or unknown).
   * Choosing exactly the usual value is not a change and is not saved.
   */
  const describeChoice = (dates: string[], request: DayRequest): string | null => {
    if (usual.source === 'none' || request.kind === 'none') return null
    if (dates.length === 1) {
      const usualDay = usualOnDate(usual, dates[0])
      if (!usualDay.long || isSameAsUsual(request, usualDay)) return null
      return `いつもは「${usualDay.long}」です。この日だけ「${formatDayRequest(request)}」にします。ずっと変える場合はホームから申請してください。`
    }
    const different = dates.filter(date => !isSameAsUsual(request, usualOnDate(usual, date))).length
    return `選んだ日のうち、いつもと違うのは${different}日です。`
  }

  /** request null = 希望なし. With several dates, each keeps its own memo. */
  // The same as usual is no request at all: only days that differ are saved (lib/request-entries.ts).
  const applyToDates = (dates: string[], request: DayRequest | null, memo: string | undefined) => {
    setEntries(previous => applyDayChoice(previous, dates, request, memo, usual))
    setIsDirty(true)
  }

  const handleSheetApply = (request: DayRequest | null, memo: string | undefined) => {
    if (!sheet) return
    // The time step already showed the comparison in the panel; one-tap choices show it under the calendar.
    setStatusNote(request && (request.kind === 'off' || request.kind === 'any') ? describeChoice(sheet.dates, request) ?? '' : '')
    applyToDates(sheet.dates, request, sheet.dates.length === 1 ? memo : undefined)
    setSheet(null)
    setSelectedDates([])
    setIsMultiSelect(false)
  }

  /** Closing keeps the day's choice; a memo edited in the sheet is kept too. */
  const handleSheetClose = (memo: string | undefined) => {
    if (sheet && sheet.dates.length === 1 && memo !== undefined) {
      const date = sheet.dates[0]
      if ((entries[date]?.memo ?? '') !== memo) setIsDirty(true)
      setEntries(previous => {
        const existing = previous[date]
        if ((existing?.memo ?? '') === memo) return previous
        const next = { ...previous }
        const request = existing ? existing.request : { kind: 'none' as const, start: null, end: null }
        if (request?.kind === 'none' && !memo.trim()) delete next[date]
        else next[date] = { request, memo }
        return next
      })
    }
    setSheet(null)
  }

  const handleSave = async () => {
    if (isReadOnly || !selectedStaff || !isMonthReady) return
    setIsSaving(true)
    try {
      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      // Saved as the logged-in staff member; the server never takes a staff id from here.
      // Days not sent (back to usual, no memo) are deleted by the server.
      const payload: DayRequestInput[] = toRequestPayload(entries)
      unwrap(await saveMyMonthRequests(storeId, startOfMonth, payload))
      notify(`${targetMonth}月の希望を提出しました。`)
      setIsDirty(false)
      setReloadKey(key => key + 1)
    } catch (error) {
      notify('保存できませんでした: ' + (error instanceof Error ? error.message : '通信エラー'), 'error')
    } finally { setIsSaving(false) }
  }

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet(`${targetMonth}月休み希望`)
    worksheet.pageSetup.orientation = 'landscape'
    worksheet.pageSetup.fitToPage = true
    worksheet.pageSetup.fitToWidth = 1
    worksheet.pageSetup.fitToHeight = 1
    worksheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 }

    const titleCell = worksheet.getCell('A1')
    titleCell.value = `【${targetYear}年${targetMonth}月】 休み希望・要望 一覧表`
    titleCell.font = { bold: true, size: 18 }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.mergeCells(1, 1, 1, daysArray.length + 2)

    const headerRow = worksheet.getRow(3)
    headerRow.values = ['名前', ...daysArray.map(d => String(d)), '休み希望数']
    headerRow.height = 24
    headerRow.font = { bold: true, size: 10 }
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' }

    worksheet.getColumn(1).width = 12
    worksheet.getColumn(daysArray.length + 2).width = 12
    for (let i = 0; i < daysArray.length; i += 1) {
      worksheet.getColumn(i + 2).width = 5.2
    }

    staff.forEach((person, staffIdx) => {
      const currentRow = worksheet.getRow(4 + staffIdx)
      currentRow.height = 48
      currentRow.getCell(1).value = person.name
      currentRow.getCell(1).font = { bold: true, size: 11 }
      currentRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' }
      currentRow.getCell(1).border = excelCellBorder

      const staffOffCount = allRequests.filter(r => r.staff_id === person.id && r.request?.kind === 'off').length

      daysArray.forEach((day, dayIdx) => {
        const dateStr = dateKey(day)
        const req = allRequests.find(r => r.staff_id === person.id && r.date === dateStr)
        const cell = currentRow.getCell(dayIdx + 2)
        const isOff = req?.request?.kind === 'off'
        const timeText = isOff ? '' : formatDayRequest(req?.request ?? null, 'long')
        const memoText = (req?.memo || '').trim()

        cell.border = excelCellBorder
        cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }

        if (isOff) {
          cell.value = memoText ? `✖\n${memoText}` : '✖'
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } }
          cell.font = { bold: true, size: 9, color: { argb: 'FFFF0000' } }
        } else {
          cell.value = [timeText, memoText].filter(Boolean).join('\n')
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
          cell.font = { color: { argb: 'FF333333' }, size: 7, bold: Boolean(timeText || memoText) }
        }
      })

      const countCell = currentRow.getCell(daysArray.length + 2)
      countCell.value = `${staffOffCount}日`
      countCell.border = excelCellBorder
      countCell.alignment = { vertical: 'middle', horizontal: 'center' }
      countCell.font = { bold: true, size: 11 }
      countCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
    })

    for (let col = 1; col <= headerRow.cellCount; col += 1) {
      const cell = headerRow.getCell(col)
      cell.border = excelCellBorder
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
      if (col >= 2 && col <= daysArray.length + 1) {
        const dateKind = getDateKind(dateKey(col - 1))
        if (dateKind === 'holiday' || dateKind === 'sunday') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } }
          cell.font = { bold: true, color: { argb: 'FFFF0000' }, size: 10 }
        } else if (dateKind === 'saturday') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } }
          cell.font = { bold: true, color: { argb: 'FF0000FF' }, size: 10 }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }
          cell.font = { bold: true, color: { argb: 'FF333333' }, size: 10 }
        }
      }
      if (col === daysArray.length + 2) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        cell.font = { bold: true, color: { argb: 'FF111827' }, size: 10 }
      }
    }

    worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    worksheet.getCell('A3').font = { bold: true, size: 10 }
    worksheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' }

    const lastColumn = toColumnName(daysArray.length + 2)
    worksheet.getCell(`${lastColumn}1`).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    saveAs(new Blob([buffer]), `${targetMonth}月休み希望_${storeId}.xlsx`)
  }

  const changeMonth = (diff: number) => {
    setViewDate(new Date(targetYear, targetMonth - 1 + diff, 1))
    setMultiSelect(false)
    setSheet(null)
  }

  if (!selectedStaff) {
    return <div className="p-8 text-center text-sm text-slate-500">ログイン情報を読み込んでいます...</div>
  }

  const monthEntries = Object.entries(entries).filter(([date]) => date.startsWith(currentMonthStart.slice(0, 8))).map(([, entry]) => entry)
  const offCount = monthEntries.filter(entry => entry.request?.kind === 'off').length
  const timeCount = monthEntries.filter(entry => entry.request && entry.request.kind !== 'off' && entry.request.kind !== 'none').length
  const submitSummary = [offCount > 0 ? `休み${offCount}日` : '', timeCount > 0 ? `時間の希望${timeCount}日` : ''].filter(Boolean).join('・') || '希望なし'
  const sheetTitle = (dates: string[]) => {
    if (dates.length !== 1) return `${dates.length}日分をまとめて入力`
    return `${targetMonth}月${dayOf(dates[0])}日（${WEEKDAYS[weekdayOf(dates[0])]}）`
  }
  const sheetSubtitle = (dates: string[]) => dates.length === 1
    ? getHolidayName(dates[0]) ?? undefined
    : dates.map(date => `${dayOf(date)}日`).join('・')

  return (
    <div className={`mx-auto max-w-[1600px] p-4 md:p-8 ${isMultiSelect ? 'pb-48' : 'pb-20'}`}>
      <div className="mx-auto mb-8 max-w-md rounded-md border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900">{targetYear}年{targetMonth}月の希望</h1>
            <p className="mt-1 text-sm text-slate-600">{selectedStaff.name} さん</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => changeMonth(-1)} aria-label="前の月" className="flex h-12 w-12 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"><ChevronLeft size={22} /></button>
            <button type="button" onClick={() => changeMonth(1)} aria-label="次の月" className="flex h-12 w-12 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"><ChevronRight size={22} /></button>
          </div>
        </div>

        {isReadOnly
          ? <p className="mb-3 text-sm font-bold text-red-700">過去の月のため変更できません。</p>
          : (
            <div className="-mb-1 flex min-h-9 justify-end">
              <button type="button" onClick={() => setMultiSelect(!isMultiSelect)} disabled={!isMonthReady} className="px-1 py-2 disabled:opacity-50 text-[15px] font-bold text-slate-600 underline underline-offset-4">
                {isMultiSelect ? '複数選択をやめる' : '複数の日を選ぶ'}
              </button>
            </div>
          )}

        {monthLoadFailed && (
          <p role="alert" className="mb-2 text-sm font-bold text-red-700">希望を読み込めませんでした。画面を開き直してください。</p>
        )}

        {!isMonthReady && !monthLoadFailed ? (
          <SkeletonRegion label="保存済みの希望を読み込んでいます…" className="mb-5 space-y-2">
            <LoadingNote label="保存済みの希望を読み込んでいます…" />
            <CalendarSkeleton />
          </SkeletonRegion>
        ) : (
        <div className={`mb-5 grid grid-cols-7 gap-1 ${isMonthReady || isReadOnly ? '' : 'opacity-50'}`}>
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`pb-0.5 text-center text-[13px] font-bold ${i === 0 ? 'text-red-600' : i === 6 ? 'text-sky-700' : 'text-slate-500'}`}>{d}</div>
          ))}
          {emptySlots.map(i => <div key={`empty-${i}`} />)}
          {daysArray.map(day => {
            const dateStr = dateKey(day)
            const entry = entries[dateStr]
            const request = entry?.request ?? null
            const isOff = request?.kind === 'off'
            const isSelected = selectedDates.includes(dateStr)
            const weekDay = weekdayOf(dateStr)
            const holidayName = getHolidayName(dateStr)
            const dayColor = isOff ? '' : weekDay === 0 || holidayName ? 'text-red-600' : weekDay === 6 ? 'text-sky-700' : 'text-slate-900'
            const label = formatDayRequest(request, 'short')
            // Days without a request show the usual availability faintly.
            const usualLabel = label ? '' : usualOnDate(usual, dateStr).short
            const hasMemo = Boolean(entry?.memo.trim())

            return (
              <button
                key={day}
                type="button"
                onClick={() => handleDateClick(dateStr)}
                disabled={isReadOnly || !isMonthReady}
                aria-pressed={isMultiSelect ? isSelected : undefined}
                aria-label={`${targetMonth}月${day}日 ${WEEKDAYS[weekDay]}曜${holidayName ? ` ${holidayName}` : ''} ${formatDayRequest(request) || (usualLabel ? `いつもどおり（${usualOnDate(usual, dateStr).long}）` : '希望なし')}${hasMemo ? ' メモあり' : ''}`}
                className={`relative flex min-h-16 min-w-0 flex-col items-center gap-0.5 rounded-md border px-0.5 pb-1 pt-1 transition-colors disabled:cursor-default ${
                  isOff ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white hover:border-slate-300'
                } ${isSelected ? 'outline outline-[3px] -outline-offset-1 outline-slate-800' : ''}`}
              >
                <span className={`text-[15px] font-bold leading-tight tabular-nums ${isOff ? 'text-red-700' : dayColor}`}>{day}</span>
                {label && (
                  <span className={`whitespace-pre-line text-center font-bold leading-tight tabular-nums ${isOff ? 'text-[15px] text-red-700' : 'text-[11px] text-slate-900'}`}>{label}</span>
                )}
                {usualLabel && (
                  <span aria-hidden="true" className="whitespace-pre-line text-center text-[11px] font-medium leading-tight tabular-nums text-slate-400">{usualLabel}</span>
                )}
                {hasMemo && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
        )}

        <p role="status" aria-live="polite" className={`text-[13px] font-medium leading-snug text-slate-600 ${statusNote ? '-mt-2 mb-4' : 'sr-only'}`}>{statusNote}</p>

        {!isReadOnly && (
          <button type="button" onClick={handleSave} disabled={isSaving || !isMonthReady} className="min-h-14 w-full rounded-md bg-[var(--primary)] px-4 text-[17px] font-bold text-white transition-colors hover:bg-[var(--primary-strong)] disabled:bg-slate-300">
            {isSaving ? '保存中...' : `提出する（${submitSummary}）`}
          </button>
        )}
      </div>

      {isMultiSelect && !isReadOnly && (
        <div className="fixed inset-x-0 bottom-[var(--mobile-nav-height,0px)] z-[60] border-t border-slate-200 bg-white px-4 py-3 md:bottom-0 md:left-[268px]">
          <div className="mx-auto flex max-w-md items-center gap-2">
            <span className="flex-1 text-[15px] font-bold text-slate-900">{selectedDates.length > 0 ? `${selectedDates.length}日を選択中` : '日付を選んでください'}</span>
            <button type="button" disabled={selectedDates.length === 0} onClick={() => setSheet({ dates: selectedDates })}
              className="min-h-[52px] rounded-md bg-[var(--primary)] px-5 text-base font-bold text-white hover:bg-[var(--primary-strong)] disabled:bg-slate-300 disabled:text-slate-500">
              内容を入れる
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <DayRequestSheet
          key={sheet.dates.join(',')}
          title={sheetTitle(sheet.dates)}
          subtitle={sheetSubtitle(sheet.dates)}
          initial={sheet.dates.length === 1 ? (entries[sheet.dates[0]]?.request ?? usualOnDate(usual, sheet.dates[0]).request) : null}
          usualLabel={sheet.dates.length === 1 ? usualOnDate(usual, sheet.dates[0]).long || undefined : undefined}
          describeChoice={request => describeChoice(sheet.dates, request)}
          hours={hours}
          allowClear
          memo={sheet.dates.length === 1 ? entries[sheet.dates[0]]?.memo ?? '' : undefined}
          onApply={handleSheetApply}
          onClose={handleSheetClose}
        />
      )}

      <section className="mt-8 border-t border-slate-200 pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">店舗全体の希望</h2>
            <p className="mt-1 text-xs text-slate-500">{targetYear}年{targetMonth}月</p>
          </div>
          <button type="button" onClick={exportToExcel} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">休み希望をExcel出力</button>
        </div>

        {loaded?.month !== currentMonthStart ? (
          <SkeletonRegion label="店舗全体の希望を読み込んでいます…">
            <TableSkeleton rows={8} columns={12} />
          </SkeletonRegion>
        ) : (
        <div className="w-full overflow-x-auto overscroll-x-contain -webkit-overflow-scrolling-touch rounded-md border border-slate-200 bg-white">
          <table className="w-max min-w-full table-fixed border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-[112px] min-w-[112px] border border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-700">スタッフ名</th>
                {daysArray.map(day => {
                  const dateStr = dateKey(day)
                  const dateKind = getDateKind(dateStr)
                  const headerClass = dateKind === 'holiday' || dateKind === 'sunday'
                    ? 'bg-red-50/40 text-red-600'
                    : dateKind === 'saturday'
                      ? 'bg-blue-50/40 text-blue-600'
                      : 'bg-slate-50 text-slate-600'
                  return <th key={dateStr} title={getHolidayName(dateStr) ?? undefined} className={`w-9 min-w-[36px] border border-slate-200 px-1 py-2 text-center font-semibold ${headerClass}`}>{day}</th>
                })}
                <th className="w-[76px] min-w-[76px] border border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold text-slate-700">休み日数</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(person => {
                const isCurrentStaff = person.id === selectedStaff.id
                const personOffCount = allRequests.filter(request => request.staff_id === person.id && request.request?.kind === 'off').length
                return (
                  <tr key={person.id} className={isCurrentStaff ? 'bg-amber-50/50' : 'bg-white'}>
                    <th scope="row" className={`sticky left-0 z-10 w-[112px] min-w-[112px] border border-slate-200 px-2 py-2 text-left font-medium ${isCurrentStaff ? 'bg-amber-50/50' : 'bg-white'} text-slate-800`}>
                      <span className="block max-w-[104px] truncate">{person.name}</span>
                    </th>
                    {daysArray.map(day => {
                      const dateStr = dateKey(day)
                      const row = allRequests.find(request => request.staff_id === person.id && request.date === dateStr)
                      const isOff = row?.request?.kind === 'off'
                      const memo = (row?.memo || '').trim()
                      const label = compactLabel(row?.request ?? null)
                      const dateKind = getDateKind(dateStr)
                      const dateTint = dateKind === 'holiday' || dateKind === 'sunday'
                        ? 'bg-red-50/20'
                        : dateKind === 'saturday'
                          ? 'bg-blue-50/20'
                          : ''
                      const title = [formatDayRequest(row?.request ?? null), memo].filter(Boolean).join(' / ') || undefined
                      return (
                        <td key={dateStr} title={title} className={`w-9 min-w-[36px] border border-slate-200 px-0.5 py-2 text-center ${isOff ? 'bg-red-50 font-semibold text-red-600' : `${dateTint} ${isCurrentStaff ? 'bg-amber-50/50' : 'bg-white'} text-slate-700`}`}>
                          {label
                            ? <span className="block leading-tight tabular-nums">{label}{memo && !isOff ? <span className="text-slate-400" aria-label="メモあり">•</span> : null}</span>
                            : memo ? <span className="font-bold text-slate-500" aria-label="メモあり">•</span> : ''}
                        </td>
                      )
                    })}
                    <td className={`border border-slate-200 px-2 py-2 text-right font-medium tabular-nums ${isCurrentStaff ? 'bg-amber-50/50 text-slate-900' : 'bg-slate-50/60 text-slate-700'}`}>{personOffCount}日</td>
                  </tr>
                )
              })}
              {staff.length === 0 && <tr><td colSpan={daysArray.length + 2} className="px-4 py-8 text-center text-sm text-slate-500">スタッフ情報がありません。</td></tr>}
            </tbody>
          </table>
        </div>
        )}
      </section>
    </div>
  )
}
