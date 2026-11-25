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

// The layout of the POS 「時間別売上実績表」: per date 売上 / 客数 / 客単価, hours as columns.
const report = [
  ['時間別売上実績表', '', '', '', '', ''],
  ['日付', '項目', '10時', '11時', '12時', '合計'],
  ['2026/11/02(月)', '売上', '10,000', '20,000', '30,000', '60,000'],
  ['', '客数', 5, 10, 15, 30],
  ['', '客単価', 2000, 2000, 2000, 2000],
  ['2026/11/03(火)', '売上', 20000, 40000, 50000, 110000],
  ['', '客数', 10, 20, 25, 55],
  ['', '客単価', 2000, 2000, 2000, 2000],
  ['2026/11/07(土)', '売上', 40000, 80000, 90000, 210000],
  ['', '客数', 20, 40, 45, 105],
  ['', '客単価', 2000, 2000, 2000, 2000],
  ['合計', '売上', 70000, 140000, 170000, 380000],
]

describe('parsePosHourlyReport', () => {
  it('reads sales and customers per date and hour, skipping totals and 客単価', () => {
    const days = parsePosHourlyReport(report, 2026)
    expect(days.map(day => day.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-07'])
    expect(days[0]).toEqual({ date: '2026-11-02', sales: { 10: 10000, 11: 20000, 12: 30000 }, customers: { 10: 5, 11: 10, 12: 15 } })
  })

  it('returns nothing without a header of hours', () => {
    expect(parsePosHourlyReport([['a', 'b'], ['c', 'd']], 2026)).toEqual([])
  })
})

describe('averageHourlySales / peopleFromSales', () => {
  const weekend = (date: string) => date === '2026-11-07'

  it('averages weekdays and weekends separately', () => {
    const result = averageHourlySales(parsePosHourlyReport(report, 2026), weekend)
    expect(result.wd.days).toBe(2)
    expect(result.wd.rows).toEqual([
      { hour: 10, sales: 15000, customers: 7.5 },
      { hour: 11, sales: 30000, customers: 15 },
      { hour: 12, sales: 40000, customers: 20 },
    ])
    expect(result.we.days).toBe(1)
    expect(result.wd.from).toBe('2026-11-02')
  })

  it('moves sales one hour earlier and divides by the target', () => {
    const rows = [{ hour: 11, sales: 8400, customers: null }, { hour: 12, sales: 21000, customers: null }]
    expect(peopleFromSales(rows, 4200, 1)).toEqual({ 10: 2, 11: 5 })
    expect(peopleFromSales(rows, 4200, 0)).toEqual({ 11: 2, 12: 5 })
  })
})
