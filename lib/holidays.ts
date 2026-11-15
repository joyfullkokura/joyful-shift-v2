// Japanese national holidays computed from the rules of 国民の祝日に関する法律,
// so the app needs no yearly list maintenance.
//
// Verified against the Cabinet Office data (syukujitsu.csv) for 2020-2027 in
// lib/__tests__/holidays.test.ts. The equinox days use the standard
// approximation that matches the official announcements for 1980-2099; the
// official dates are fixed by the National Astronomical Observatory every
// February for the following year, so re-run the test against new data then.
//
// When the law changes or a one-off holiday is declared, add it to
// HOLIDAY_OVERRIDES (and the test data) instead of editing the rules.

export type HolidayMap = Readonly<Record<string, string>>

type MonthDay = { month: number; day: number }

/** One-off moves and additions by special laws, keyed by year. */
const HOLIDAY_OVERRIDES: Readonly<Record<number, { moved?: Record<string, MonthDay>; added?: Array<MonthDay & { name: string }> }>> = {
  // Tokyo 2020 Olympics (平成三十一年法律第三十四号 / 令和二年法律第六十八号)
  2020: { moved: { 海の日: { month: 7, day: 23 }, スポーツの日: { month: 7, day: 24 }, 山の日: { month: 8, day: 10 } } },
  2021: { moved: { 海の日: { month: 7, day: 22 }, スポーツの日: { month: 7, day: 23 }, 山の日: { month: 8, day: 8 } } },
}

const pad = (value: number) => String(value).padStart(2, '0')
const keyOf = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`

/** Day of week (0 = Sunday) of a calendar date, independent of the local time zone. */
const weekdayOf = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).getUTCDay()

/** Day of month of the n-th Monday (Happy Monday holidays). */
const nthMonday = (year: number, month: number, n: number) => {
  const firstWeekday = weekdayOf(year, month, 1)
  return 1 + ((8 - firstWeekday) % 7) + (n - 1) * 7
}

/** 春分の日 / 秋分の日 (valid 1980-2099). */
const vernalEquinoxDay = (year: number) => Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
const autumnalEquinoxDay = (year: number) => Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))

/** 国民の祝日 (Article 2) of a year, before 振替休日 / 国民の休日. Rules as in force since 2020. */
const nationalHolidays = (year: number): Array<MonthDay & { name: string }> => {
  const holidays: Array<MonthDay & { name: string }> = [
    { name: '元日', month: 1, day: 1 },
    { name: '成人の日', month: 1, day: nthMonday(year, 1, 2) },
    { name: '建国記念の日', month: 2, day: 11 },
    { name: '天皇誕生日', month: 2, day: 23 },
    { name: '春分の日', month: 3, day: vernalEquinoxDay(year) },
    { name: '昭和の日', month: 4, day: 29 },
    { name: '憲法記念日', month: 5, day: 3 },
    { name: 'みどりの日', month: 5, day: 4 },
    { name: 'こどもの日', month: 5, day: 5 },
    { name: '海の日', month: 7, day: nthMonday(year, 7, 3) },
    { name: '山の日', month: 8, day: 11 },
    { name: '敬老の日', month: 9, day: nthMonday(year, 9, 3) },
    { name: '秋分の日', month: 9, day: autumnalEquinoxDay(year) },
    { name: 'スポーツの日', month: 10, day: nthMonday(year, 10, 2) },
    { name: '文化の日', month: 11, day: 3 },
    { name: '勤労感謝の日', month: 11, day: 23 },
  ]
  const override = HOLIDAY_OVERRIDES[year]
  const moved = holidays.map(holiday => ({ ...holiday, ...(override?.moved?.[holiday.name] ?? {}) }))
  return [...moved, ...(override?.added ?? [])]
}

const shiftDays = (year: number, month: number, day: number, offset: number) => {
  const date = new Date(Date.UTC(year, month - 1, day + offset))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

const cache = new Map<number, HolidayMap>()

/** All holidays of a year: YYYY-MM-DD -> name (振替休日 / 国民の休日 included). */
export const holidaysOfYear = (year: number): HolidayMap => {
  const cached = cache.get(year)
  if (cached) return cached

  const result: Record<string, string> = {}
  const national = nationalHolidays(year)
  national.forEach(({ month, day, name }) => { result[keyOf(year, month, day)] = name })
  const isNational = (key: string) => key in result

  // 国民の休日 (Article 3-3): a day whose previous and next days are both 国民の祝日.
  const sandwiched: string[] = []
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    for (let day = 1; day <= daysInMonth; day++) {
      const key = keyOf(year, month, day)
      if (isNational(key)) continue
      const previous = shiftDays(year, month, day, -1)
      const next = shiftDays(year, month, day, 1)
      if (isNational(keyOf(previous.year, previous.month, previous.day)) && isNational(keyOf(next.year, next.month, next.day))) {
        sandwiched.push(key)
      }
    }
  }
  sandwiched.forEach(key => { result[key] = '国民の休日' })

  // 振替休日 (Article 3-2): a 国民の祝日 on Sunday moves to the nearest following non-holiday.
  national
    .filter(({ month, day }) => weekdayOf(year, month, day) === 0)
    .forEach(({ month, day }) => {
      let offset = 1
      let candidate = shiftDays(year, month, day, offset)
      while (keyOf(candidate.year, candidate.month, candidate.day) in result) {
        offset++
        candidate = shiftDays(year, month, day, offset)
      }
      result[keyOf(candidate.year, candidate.month, candidate.day)] = '振替休日'
    })

  const frozen = Object.freeze(Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right))))
  cache.set(year, frozen)
  return frozen
}

/** Holiday name for a YYYY-MM-DD key, or null. */
export const getHolidayName = (dateKey: string): string | null => {
  const year = Number(dateKey.slice(0, 4))
  if (!Number.isInteger(year)) return null
  return holidaysOfYear(year)[dateKey] ?? null
}

export const isHoliday = (dateKey: string) => getHolidayName(dateKey) !== null
