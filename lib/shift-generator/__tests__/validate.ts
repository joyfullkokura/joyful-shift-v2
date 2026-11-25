// Test-only: counts hard-rule violations of a schedule with a deliberately
// different method from metrics.ts (whole minutes, day numbers instead of date
// strings, its own break rule), so both cannot share the same mistake.

export type ValidateRules = {
  dailyMaxMinutes: number
  weeklyMaxMinutes: number | null
  monthlyMaxMinutes: number | null
  minShiftMinutes: number
  restMinutes: number
  /** Minutes from midnight; the window may wrap past midnight. */
  lateNightStart: number
  lateNightEnd: number
  weekStartDay: number
}

export type ValidateStaff = { id: string; isEmployee: boolean; isMinor: boolean; shifts: Record<string, string> }

const dayNumber = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000)
}

const minutesOf = (label: string): [number, number] | null => {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(label)
  if (!match) return null
  const start = Number(match[1]) * 60 + Number(match[2])
  let end = Number(match[3]) * 60 + Number(match[4])
  if (end <= start) end += 1440
  return [start, end]
}

/** Paid minutes: over 8h -> 60 min break, over 6h -> 45 min. */
const paidMinutes = (length: number) => length - (length > 480 ? 60 : length > 360 ? 45 : 0)

export const countViolations = (
  staff: ValidateStaff[],
  previous: Record<string, Record<string, string>>,
  monthDates: string[],
  rules: ValidateRules,
): Record<string, number> => {
  const counts: Record<string, number> = {}
  const add = (kind: string) => { counts[kind] = (counts[kind] ?? 0) + 1 }
  const firstDay = dayNumber(monthDates[0])
  const lastDay = dayNumber(monthDates[monthDates.length - 1])

  for (const person of staff) {
    // day number -> [start, end] minutes from that day's midnight
    const byDay = new Map<number, [number, number]>()
    for (const [date, label] of Object.entries(previous[person.id] ?? {})) {
      const range = minutesOf(label)
      if (range && dayNumber(date) < firstDay) byDay.set(dayNumber(date), range)
    }
    for (const date of monthDates) {
      const range = minutesOf(person.shifts[date] ?? '')
      if (range) byDay.set(dayNumber(date), range)
    }

    let worked = 0
    let monthPaid = 0
    for (let day = firstDay; day <= lastDay; day++) {
      const range = byDay.get(day)
      if (!range) continue
      worked++
      const paid = paidMinutes(range[1] - range[0])
      monthPaid += paid
      if (paid > rules.dailyMaxMinutes) add('daily_max')
      if (rules.minShiftMinutes > 0 && range[1] - range[0] < rules.minShiftMinutes) add('min_shift')
      if (person.isMinor) {
        let night = false
        for (let minute = range[0]; minute < range[1] && !night; minute++) {
          const clock = minute % 1440
          const inWindow = rules.lateNightStart < rules.lateNightEnd
            ? clock >= rules.lateNightStart && clock < rules.lateNightEnd
            : clock >= rules.lateNightStart || clock < rules.lateNightEnd
          if (inWindow) night = true
        }
        if (night) add('minor_late_night')
      }
      const before = byDay.get(day - 1)
      if (before && (1440 + range[0]) - before[1] < rules.restMinutes) add('rest_interval')
    }
    if (person.isEmployee && worked > 22) add('employee_days')

    if (rules.weeklyMaxMinutes !== null) {
      // 1970-01-01 (day 0) was a Thursday (weekday 4).
      const weekdayOf = (day: number) => ((day % 7) + 7 + 4) % 7
      let start = firstDay - ((weekdayOf(firstDay) - rules.weekStartDay + 7) % 7)
      for (; start <= lastDay; start += 7) {
        let total = 0
        for (let day = start; day < start + 7 && day <= lastDay; day++) {
          const range = byDay.get(day)
          if (range) total += paidMinutes(range[1] - range[0])
        }
        if (total > rules.weeklyMaxMinutes) add('weekly_max')
      }
    }
    if (rules.monthlyMaxMinutes !== null && monthPaid > rules.monthlyMaxMinutes) add('monthly_legal')
  }
  return counts
}
