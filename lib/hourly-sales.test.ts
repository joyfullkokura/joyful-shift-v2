import { describe, expect, it } from 'vitest'
import { averageHourlySales, dateOfCell, hourOfHeader, parsePosHourlyReport, peopleFromSales } from '@/lib/hourly-sales'

describe('hourOfHeader / dateOfCell', () => {
  it.each([['10時', 10], ['10:00', 10], ['10:00〜11:00', 10], ['10-11', 10], ['９時台', 9], ['24時', 0], [17, 17]])('%s -> %s', (label, hour) => {
    expect(hourOfHeader(label)).toBe(hour)
  })

  it.each(['合計', '日付', '', '区分'])('%s is not an hour', label => {
    expect(hourOfHeader(label)).toBeNull()
  })

  it('reads dates in several forms', () => {
    expect(dateOfCell('2026/11/01', 2026)).toBe('2026-11-01')
    expect(dateOfCell('2026年11月3日(火)', 2026)).toBe('2026-11-03')
    expect(dateOfCell('11/5(木)', 2026)).toBe('2026-11-05')
    expect(dateOfCell(new Date(Date.UTC(2026, 10, 7)), 2026)).toBe('2026-11-07')
    expect(dateOfCell(46333, 2026)).toBe('2026-11-07') // Excel serial
    expect(dateOfCell('売上', 2026)).toBeNull()
  })
})

// A made-up minimal sample in the layout of the POS 「時間別売上実績表」 (no real figures):
// the date (column A) and 曜日 (column B, 祝 on holidays) are on the 客数 row, 売上 is the row
// above and 客単価 the row below; hours run 15時 … 24時, 1時 … 14時; average rows close the table.
const hoursHeader = ['15時', '16時', '17時', '18時', '19時', '20時', '21時', '22時', '23時', '24時', '1時', '2時', '3時', '4時', '5時', '6時', '7時', '8時', '9時', '10時', '11時', '12時', '13時', '14時']
const values = (byHour: Record<number, number>) => hoursHeader.map(label => byHour[Number(label.replace('時', '')) % 24] ?? 0)
const block = (date: string, weekday: string, sales: Record<number, number>, customers: Record<number, number>) => [
  ['', '', '売上', ...values(sales)],
  [date, weekday, '客数', ...values(customers)],
  ['', '', '客単価', ...values({})],
]
const report = [
  ['時間別売上実績表', '', '売上単位：千円'],
  ['日付', '曜日', '項目', ...hoursHeader],
  ...block('12/25', '金', { 11: 10_000, 12: 20_000, 18: 30_000 }, { 11: 5, 12: 10, 18: 12 }),
  ...block('12/28', '祝', { 11: 40_000, 12: 80_000 }, { 11: 20, 12: 40 }),
  ...block('12/30', '水', { 11: 20_000, 12: 40_000, 18: 50_000, 0: 2_000 }, { 11: 10, 12: 20, 18: 20, 0: 1 }),
  ...block('1/2', '土', { 11: 60_000 }, { 11: 30 }),
  ['', '', '売上', ...values({ 11: 15_000 })],
  ['【平日平均】', '', '客数', ...values({ 11: 7 })],
  ['', '', '客単価', ...values({})],
  ['', '', '売上', ...values({ 11: 50_000 })],
  ['【休日平均】', '', '客数', ...values({ 11: 25 })],
  ['', '', '客単価', ...values({})],
]

describe('parsePosHourlyReport', () => {
  it('reads each day from the 売上 row above and the 客数 row of its date, skipping 客単価 and average rows', () => {
    const days = parsePosHourlyReport(report, 2026)
    expect(days.map(day => day.date)).toEqual(['2026-12-25', '2026-12-28', '2026-12-30', '2027-01-02'])
    expect(days[0]).toEqual({ date: '2026-12-25', weekdayLabel: '金', sales: { ...zeroes(), 11: 10_000, 12: 20_000, 18: 30_000 }, customers: { ...zeroes(), 11: 5, 12: 10, 18: 12 } })
    expect(days[2].sales[0]).toBe(2_000) // 24時 is hour 0 of the same business day
  })

  it('returns nothing without a header of hours', () => {
    expect(parsePosHourlyReport([['a', 'b'], ['c', 'd']], 2026)).toEqual([])
  })
})

function zeroes() {
  return Object.fromEntries(hoursHeader.map(label => [Number(label.replace('時', '')) % 24, 0])) as Record<number, number>
}

describe('averageHourlySales / peopleFromSales', () => {
  const noCalendar = () => false

  it('uses the report 曜日 column (土 / 日 / 祝 = 土日祝) and averages each type', () => {
    const result = averageHourlySales(parsePosHourlyReport(report, 2026), noCalendar)
    expect(result.wd.days).toBe(2) // 12/25 金, 12/30 水
    expect(result.we.days).toBe(2) // 12/28 祝, 1/2 土
    expect(result.wd.rows.find(row => row.hour === 11)).toEqual({ hour: 11, sales: 15_000, customers: 7.5 })
    expect(result.we.rows.find(row => row.hour === 11)).toEqual({ hour: 11, sales: 50_000, customers: 25 })
    expect(result.we.from).toBe('2026-12-28')
    expect(result.we.to).toBe('2027-01-02')
  })

  it('moves sales one hour earlier and divides by the target', () => {
    const rows = [{ hour: 11, sales: 8400, customers: null }, { hour: 12, sales: 21000, customers: null }]
    expect(peopleFromSales(rows, 4200, 1)).toEqual({ 10: 2, 11: 5 })
    expect(peopleFromSales(rows, 4200, 0)).toEqual({ 11: 2, 12: 5 })
  })
})
