import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { SATURDAY_FILL, SUNDAY_HOLIDAY_FILL, columnLetter, fillRequestsSheet } from '@/lib/requests-excel'

// February 2027: the 1st is a Monday, 6th Saturday, 7th Sunday, 11th a holiday.
const build = () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('2月')
  const result = fillRequestsSheet(sheet, {
    year: 2027,
    month: 2,
    staff: [
      { id: 'a', name: '多田', category: '社員' },
      { id: 'b', name: '宝村文子', category: 'DF' },
      { id: 'c', name: '高木', category: 'DF' },
      { id: 'd', name: 'テスト', category: null },
    ],
    requests: [
      { staff_id: 'b', date: '2027-02-03', memo: '', request: { kind: 'off', start: null, end: null } },
      { staff_id: 'c', date: '2027-02-04', memo: '通院', request: { kind: 'off', start: null, end: null } },
      { staff_id: 'c', date: '2027-02-05', memo: '', request: { kind: 'from', start: '18:00', end: null } },
    ],
    events: { '2027-02-14': 'バレンタイン' },
    deadline: '2027-01-22',
    isHoliday: date => date === '2027-02-11',
  })
  return { sheet, result }
}

const fillOf = (cell: ExcelJS.Cell) => (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb

describe('fillRequestsSheet', () => {
  it('puts the title and the deadline on the first row', () => {
    const { sheet, result } = build()
    expect(sheet.getCell('A1').value).toBe('【2027年2月】 休日申込表')
    expect(sheet.getCell(1, result.countColumn - 4).value).toBe('提出期限 1月22日')
  })

  it('has date, weekday and event rows, colouring Saturdays blue and Sundays / holidays orange', () => {
    const { sheet } = build()
    expect(sheet.getCell('A3').value).toBe('区分')
    expect(sheet.getCell('B3').value).toBe('名前')
    expect(sheet.getCell('C3').value).toBe('1')
    expect(sheet.getCell('C4').value).toBe('月')
    expect(sheet.getCell('A5').value).toBe('イベント')
    const column = (day: number) => columnLetter(2 + day)
    expect(fillOf(sheet.getCell(`${column(6)}4`))).toBe(SATURDAY_FILL)
    expect(fillOf(sheet.getCell(`${column(6)}3`))).toBe(SATURDAY_FILL)
    expect(fillOf(sheet.getCell(`${column(7)}4`))).toBe(SUNDAY_HOLIDAY_FILL)
    expect(fillOf(sheet.getCell(`${column(11)}4`))).toBe(SUNDAY_HOLIDAY_FILL)
    expect(fillOf(sheet.getCell(`${column(10)}4`))).not.toBe(SATURDAY_FILL)
    expect(sheet.getCell(`${column(14)}5`).value).toBe('バレンタイン')
  })

  it('groups staff by category with a merged 区分 cell and a thick line between groups', () => {
    const { sheet } = build()
    expect(sheet.getCell('A6').value).toBe('社員')
    expect(sheet.getCell('B6').value).toBe('多田')
    expect(sheet.getCell('A7').value).toBe('DF')
    expect(sheet.getCell('A8').value).toBe('DF') // merged with A7
    expect(sheet.getCell('B8').value).toBe('高木')
    expect(sheet.getCell('A9').value).toBe('区分なし')
    expect(sheet.getCell('B6').border?.bottom?.style).toBe('medium')
    expect(sheet.getCell('B7').border?.bottom?.style).toBe('thin')
    expect(sheet.getCell('B8').border?.bottom?.style).toBe('medium')
  })

  it('marks days off with ○ (memo below) and shows time requests', () => {
    const { sheet, result } = build()
    const column = (day: number) => columnLetter(2 + day)
    expect(sheet.getCell(`${column(3)}7`).value).toBe('○')
    expect(sheet.getCell(`${column(4)}8`).value).toBe('○\n通院')
    expect(sheet.getCell(`${column(5)}8`).value).toBe('18:00〜')
    expect(sheet.getCell(8, result.countColumn).value).toBe('1日')
    expect(sheet.getCell(7, result.countColumn).value).toBe('1日')
  })
})
