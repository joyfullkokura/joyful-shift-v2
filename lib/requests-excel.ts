// 休み希望 Excel sheet in the layout of the paper 休日申込表:
//   row 1  title, and the submission deadline at the right
//   row 3  区分 / 名前 / 1..31 / 休み日数
//   row 4  weekdays (Saturday blue, Sunday and holidays orange; the date row too)
//   row 5  イベント
//   row 6+ staff grouped by category (one merged 区分 cell per group, a thick
//          line between groups); 休み is 「○」, time requests as 18:00〜 etc.
// Pure layout code: it only fills a worksheet it is given.

import type ExcelJS from 'exceljs'
import { type DayRequest, formatDayRequest } from '@/lib/day-request'
import { STAFF_CATEGORIES, type StaffCategory } from '@/lib/staff-order'

export type RequestsExcelInput = {
  year: number
  /** 1-12 */
  month: number
  /** Already in the store order. */
  staff: { id: string; name: string; category: StaffCategory | null }[]
  requests: { staff_id: string; date: string; memo: string; request: DayRequest | null }[]
  /** date → note */
  events: Record<string, string>
  /** YYYY-MM-DD */
  deadline: string
  isHoliday: (date: string) => boolean
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
export const SATURDAY_FILL = 'FFBFDBFE'
export const SUNDAY_HOLIDAY_FILL = 'FFFED7AA'
const HEADER_FILL = 'FFE2E8F0'
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF94A3B8' } }
const thick: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF0F172A' } }
const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin }
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

const dateKey = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export const columnLetter = (index: number) => {
  let column = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    current = Math.floor((current - 1) / 26)
  }
  return column
}

const groupLabel = (category: StaffCategory | null) => category ?? '区分なし'

export const fillRequestsSheet = (sheet: ExcelJS.Worksheet, input: RequestsExcelInput) => {
  const { year, month, staff, requests, events, deadline, isHoliday } = input
  const days = new Date(year, month, 0).getDate()
  const firstDayColumn = 3
  const lastDayColumn = firstDayColumn + days - 1
  const countColumn = lastDayColumn + 1
  const dayColumn = (day: number) => firstDayColumn + day - 1
  const dayKind = (day: number) => {
    const date = dateKey(year, month, day)
    const weekday = new Date(year, month - 1, day).getDay()
    return isHoliday(date) || weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : 'weekday'
  }
  const dayFill = (day: number) => {
    const kind = dayKind(day)
    return kind === 'sunday' ? solid(SUNDAY_HOLIDAY_FILL) : kind === 'saturday' ? solid(SATURDAY_FILL) : solid(HEADER_FILL)
  }

  sheet.pageSetup = { ...sheet.pageSetup, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 } }
  sheet.getColumn(1).width = 6
  sheet.getColumn(2).width = 12
  for (let day = 1; day <= days; day++) sheet.getColumn(dayColumn(day)).width = 5.2
  sheet.getColumn(countColumn).width = 8

  // Row 1: title and deadline.
  const deadlineStart = Math.max(firstDayColumn, countColumn - 4)
  sheet.mergeCells(1, 1, 1, deadlineStart - 1)
  const title = sheet.getCell(1, 1)
  title.value = `【${year}年${month}月】 休日申込表`
  title.font = { bold: true, size: 16 }
  title.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.mergeCells(1, deadlineStart, 1, countColumn)
  const deadlineCell = sheet.getCell(1, deadlineStart)
  deadlineCell.value = `提出期限 ${Number(deadline.slice(5, 7))}月${Number(deadline.slice(8, 10))}日`
  deadlineCell.font = { bold: true, size: 11 }
  deadlineCell.alignment = { vertical: 'middle', horizontal: 'right' }
  sheet.getRow(1).height = 26

  // Rows 3-5: dates, weekdays, events.
  const headerCell = (row: number, column: number, value: string, fill: ExcelJS.Fill) => {
    const cell = sheet.getCell(row, column)
    cell.value = value
    cell.fill = fill
    cell.border = box
    cell.font = { bold: true, size: 10 }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    return cell
  }
  headerCell(3, 1, '区分', solid(HEADER_FILL))
  headerCell(3, 2, '名前', solid(HEADER_FILL))
  headerCell(3, countColumn, '休み日数', solid(HEADER_FILL))
  sheet.mergeCells(4, 1, 4, 2)
  headerCell(4, 1, '曜日', solid(HEADER_FILL))
  headerCell(4, countColumn, '', solid(HEADER_FILL))
  sheet.mergeCells(5, 1, 5, 2)
  headerCell(5, 1, 'イベント', solid(HEADER_FILL))
  headerCell(5, countColumn, '', solid(HEADER_FILL))
  for (let day = 1; day <= days; day++) {
    const column = dayColumn(day)
    headerCell(3, column, String(day), dayFill(day))
    headerCell(4, column, WEEKDAYS[new Date(year, month - 1, day).getDay()], dayFill(day))
    const event = headerCell(5, column, events[dateKey(year, month, day)] ?? '', solid('FFFFFFFF'))
    event.font = { size: 7 }
    event.alignment = { vertical: 'top', horizontal: 'center', wrapText: true }
  }
  sheet.getRow(3).height = 18
  sheet.getRow(4).height = 16
  sheet.getRow(5).height = 30

  // Staff rows, grouped by category.
  const requestOf = new Map(requests.map(row => [`${row.staff_id}|${row.date}`, row]))
  const groups: { category: StaffCategory | null; people: RequestsExcelInput['staff'] }[] = []
  for (const person of staff) {
    const last = groups[groups.length - 1]
    if (last && last.category === person.category) last.people.push(person)
    else groups.push({ category: person.category, people: [person] })
  }

  let rowIndex = 6
  groups.forEach((group, groupIndex) => {
    const firstRow = rowIndex
    for (const person of group.people) {
      const row = sheet.getRow(rowIndex)
      row.height = 30
      const nameCell = row.getCell(2)
      nameCell.value = person.name
      nameCell.font = { bold: true, size: 10 }
      nameCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      nameCell.border = box
      let offDays = 0
      for (let day = 1; day <= days; day++) {
        const entry = requestOf.get(`${person.id}|${dateKey(year, month, day)}`)
        const cell = row.getCell(dayColumn(day))
        cell.border = box
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        const memo = (entry?.memo ?? '').trim()
        if (entry?.request?.kind === 'off') {
          offDays++
          cell.value = memo ? `○\n${memo}` : '○'
          cell.font = { bold: true, size: memo ? 8 : 12 }
        } else {
          const time = entry?.request ? formatDayRequest(entry.request) : ''
          cell.value = [time, memo].filter(Boolean).join('\n')
          cell.font = { size: 7, bold: Boolean(time) }
        }
      }
      const countCell = row.getCell(countColumn)
      countCell.value = `${offDays}日`
      countCell.border = box
      countCell.alignment = { vertical: 'middle', horizontal: 'center' }
      countCell.font = { bold: true, size: 10 }
      rowIndex++
    }
    const lastRow = rowIndex - 1
    if (lastRow > firstRow) sheet.mergeCells(firstRow, 1, lastRow, 1)
    const categoryCell = sheet.getCell(firstRow, 1)
    categoryCell.value = groupLabel(group.category)
    categoryCell.font = { bold: true, size: 10 }
    categoryCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    categoryCell.fill = solid(HEADER_FILL)
    categoryCell.border = box
    // Thick line under every group (the last one closes the table).
    for (let column = 1; column <= countColumn; column++) {
      const cell = sheet.getCell(lastRow, column)
      cell.border = { ...(cell.border ?? box), bottom: thick }
    }
    if (groupIndex === 0) {
      for (let column = 1; column <= countColumn; column++) {
        const cell = sheet.getCell(5, column)
        cell.border = { ...(cell.border ?? box), bottom: thick }
      }
    }
  })

  return { firstStaffRow: 6, lastRow: rowIndex - 1, countColumn, categories: STAFF_CATEGORIES }
}
