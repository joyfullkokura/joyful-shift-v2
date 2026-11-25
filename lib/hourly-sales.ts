// Hourly sales (時間別売上) for 平日 / 土日祝: reading the POS report
// 「時間別売上実績表」 (per date three rows 売上 / 客数 / 客単価, columns = hours),
// averaging it per day type, and the people the sales would justify. Pure.

export type HourValues = Record<number, number>
export type PosDay = { date: string; sales: HourValues; customers: HourValues }
export type HourlyAverage = { hour: number; sales: number; customers: number | null }

type Cell = unknown

const text = (value: Cell): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null && 'text' in value && typeof (value as { text: unknown }).text === 'string') return (value as { text: string }).text
  if (typeof value === 'object' && value !== null && 'result' in value) return text((value as { result: unknown }).result)
  return String(value).normalize('NFKC').trim()
}

const numberOf = (value: Cell): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'object' && value !== null && 'result' in value) return numberOf((value as { result: unknown }).result)
  const cleaned = text(value).replace(/[,¥円人\s]/g, '')
  if (!cleaned || cleaned === '-') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

/** "10時" / "10:00" / "10:00〜11:00" / "10-11" / "10時台" → 10. Totals and other headers → null. */
export const hourOfHeader = (value: Cell): number | null => {
  const label = text(value)
  if (!label || /合計|計$|total/i.test(label)) return null
  const match = /^(\d{1,2})\s*(?:時|:\d{2}|[〜~\-ー－]|時台|$)/.exec(label)
  if (!match) return null
  const hour = Number(match[1])
  return hour >= 0 && hour <= 29 ? hour % 24 : null
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Date cell → YYYY-MM-DD. Accepts Date, Excel serials, 2026/11/01, 2026-11-01, 2026年11月1日, 11/1(土) (with fallbackYear). */
export const dateOfCell = (value: Cell, fallbackYear: number): string | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value === 'number' && value > 30_000 && value < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000)
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }
  const label = text(value)
  const full = /(\d{4})\s*[/\-年.]\s*(\d{1,2})\s*[/\-月.]\s*(\d{1,2})/.exec(label)
  if (full) return `${full[1]}-${pad(Number(full[2]))}-${pad(Number(full[3]))}`
  const short = /^(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/.exec(label)
  if (short) return `${fallbackYear}-${pad(Number(short[1]))}-${pad(Number(short[2]))}`
  return null
}

/**
 * Reads the report from its rows (as cell values). The header row is the first
 * row with at least 3 hour columns. Each following row is 売上 / 客数 / 客単価
 * (label in one of the first columns); the date stays until the next date cell.
 */
export const parsePosHourlyReport = (rows: Cell[][], fallbackYear: number): PosDay[] => {
  const headerIndex = rows.findIndex(row => row.filter(cell => hourOfHeader(cell) !== null).length >= 3)
  if (headerIndex < 0) return []
  const hourColumns = rows[headerIndex].flatMap((cell, column) => {
    const hour = hourOfHeader(cell)
    return hour === null ? [] : [{ column, hour }]
  })
  const firstHourColumn = Math.min(...hourColumns.map(item => item.column))
  const days = new Map<string, PosDay>()
  let currentDate: string | null = null

  for (const row of rows.slice(headerIndex + 1)) {
    const leading = row.slice(0, firstHourColumn)
    const date = leading.map(cell => dateOfCell(cell, fallbackYear)).find(Boolean) ?? null
    if (date) currentDate = date
    const label = leading.map(text).join(' ')
    if (/合計|総計/.test(label)) continue
    const kind = /客単価/.test(label) ? null : /客数/.test(label) ? 'customers' : /売上/.test(label) ? 'sales' : null
    if (!kind || !currentDate) continue
    const day = days.get(currentDate) ?? { date: currentDate, sales: {}, customers: {} }
    for (const { column, hour } of hourColumns) {
      const value = numberOf(row[column])
      if (value !== null) day[kind][hour] = (day[kind][hour] ?? 0) + value
    }
    days.set(currentDate, day)
  }
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date))
}

/** Averages per hour over the days of one type (days with no sales at all are skipped). */
export const averageHourlySales = (
  days: PosDay[],
  isWeekendOrHoliday: (date: string) => boolean,
): Record<'wd' | 'we', { rows: HourlyAverage[]; days: number; from: string | null; to: string | null }> => {
  const build = (type: 'wd' | 'we') => {
    const chosen = days.filter(day => (isWeekendOrHoliday(day.date) ? 'we' : 'wd') === type
      && Object.values(day.sales).some(value => value > 0))
    const hours = [...new Set(chosen.flatMap(day => Object.keys(day.sales).map(Number)))].sort((left, right) => left - right)
    const rows = hours.map(hour => {
      const sales = chosen.reduce((total, day) => total + (day.sales[hour] ?? 0), 0) / (chosen.length || 1)
      const hasCustomers = chosen.some(day => day.customers[hour] !== undefined)
      const customers = chosen.reduce((total, day) => total + (day.customers[hour] ?? 0), 0) / (chosen.length || 1)
      return { hour, sales: Math.round(sales), customers: hasCustomers ? Math.round(customers * 10) / 10 : null }
    })
    return { rows, days: chosen.length, from: chosen[0]?.date ?? null, to: chosen[chosen.length - 1]?.date ?? null }
  }
  return { wd: build('wd'), we: build('we') }
}

/**
 * People the sales justify at each hour: sales ÷ the 人時売上 target. Sales are
 * recorded at payment, about offsetHours after the visit, so the people needed
 * at hour h follow the sales recorded at h + offset. Rounded to 0.1.
 */
export const peopleFromSales = (rows: HourlyAverage[], target: number, offsetHours: number): HourValues => {
  const byHour = new Map(rows.map(row => [row.hour, row.sales]))
  const result: HourValues = {}
  if (target <= 0) return result
  for (const row of rows) {
    const hour = row.hour - Math.round(offsetHours)
    if (hour < 0) continue
    result[hour] = Math.round(((byHour.get(row.hour) ?? 0) / target) * 10) / 10
  }
  return result
}
