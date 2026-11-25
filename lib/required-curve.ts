// Required staff per job and hour for one day type (generation_settings.required_curve),
// and its starting values: the average number of people actually working in each
// hour in past confirmed schedules. Pure.

export const CURVE_JOBS = ['ホール', 'キッチン'] as const
export type CurveJob = (typeof CURVE_JOBS)[number]

/** hour ("0"-"23") → people; closing_prep: hours that are closing preparation (not excess). */
export type RequiredCurve = Record<CurveJob, Record<string, number>> & { closing_prep: string[] }

export const MAX_CURVE_PEOPLE = 50

export const emptyCurve = (): RequiredCurve => ({ ホール: {}, キッチン: {}, closing_prep: [] })

const isHourKey = (key: string) => /^(\d|1\d|2[0-3])$/.test(key)
const isPeople = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_CURVE_PEOPLE && Math.abs(Math.round(value * 10) - value * 10) < 1e-9

/** Validates a stored / submitted curve (one decimal allowed); null when invalid. */
export const parseRequiredCurve = (value: unknown): RequiredCurve | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const result = emptyCurve()
  for (const job of CURVE_JOBS) {
    const hours = record[job] ?? {}
    if (typeof hours !== 'object' || hours === null || Array.isArray(hours)) return null
    for (const [hour, people] of Object.entries(hours as Record<string, unknown>)) {
      if (!isHourKey(hour) || !isPeople(people)) return null
      if (people > 0) result[job][hour] = people
    }
  }
  const prep = record.closing_prep ?? []
  if (!Array.isArray(prep) || !prep.every(hour => typeof hour === 'string' && isHourKey(hour))) return null
  result.closing_prep = [...new Set(prep as string[])].sort((left, right) => Number(left) - Number(right))
  return result
}

export const curveTotalAt = (curve: RequiredCurve, hour: number) =>
  CURVE_JOBS.reduce((total, job) => total + (curve[job][String(hour)] ?? 0), 0)

/** A saved schedule as stored in monthly_shifts.schedule_data (only what is needed here). */
export type PastSchedule = {
  staff: { mainJob?: string; shifts: Record<string, string>; assignedRoles?: Record<string, string> }[]
}

export type DayType = 'wd' | 'we'

const LABEL = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/

const jobOf = (person: PastSchedule['staff'][number], date: string): CurveJob => {
  const role = person.assignedRoles?.[date]
  if (role === 'キッチン' || role === 'ホール') return role
  return person.mainJob === 'キッチン' ? 'キッチン' : 'ホール'
}

/**
 * Average people per job and hour on 平日 (wd) and 土日祝 (we) over the dates
 * in [from, to] (YYYY-MM-DD) that appear in the schedules. A shift counts by its
 * share of each hour (10:30-... counts 0.5 in the 10 o'clock hour). Breaks are
 * not recorded in saved schedules, so they are not subtracted. Rounded to 0.1.
 */
export const pastStaffingCurve = (
  schedules: PastSchedule[],
  from: string,
  to: string,
  isWeekendOrHoliday: (date: string) => boolean,
): Record<DayType, { curve: RequiredCurve; days: number }> => {
  const sums: Record<DayType, Record<CurveJob, number[]>> = {
    wd: { ホール: Array(24).fill(0), キッチン: Array(24).fill(0) },
    we: { ホール: Array(24).fill(0), キッチン: Array(24).fill(0) },
  }
  const dates: Record<DayType, Set<string>> = { wd: new Set(), we: new Set() }

  for (const schedule of schedules) {
    for (const person of schedule.staff) {
      for (const [date, label] of Object.entries(person.shifts ?? {})) {
        if (date < from || date > to) continue
        const type: DayType = isWeekendOrHoliday(date) ? 'we' : 'wd'
        dates[type].add(date)
        const match = LABEL.exec(label)
        if (!match) continue
        const start = Number(match[1]) + Number(match[2]) / 60
        let end = Number(match[3]) + Number(match[4]) / 60
        if (end <= start) end += 24
        const job = jobOf(person, date)
        for (let hour = Math.floor(start); hour < Math.min(24, Math.ceil(end)); hour++) {
          const overlap = Math.min(end, hour + 1) - Math.max(start, hour)
          if (overlap > 0) sums[type][job][hour] += overlap
        }
      }
    }
  }

  const build = (type: DayType) => {
    const days = dates[type].size
    const curve = emptyCurve()
    if (days > 0) {
      for (const job of CURVE_JOBS) {
        sums[type][job].forEach((total, hour) => {
          const average = Math.round((total / days) * 10) / 10
          if (average > 0) curve[job][String(hour)] = average
        })
      }
    }
    return { curve, days }
  }
  return { wd: build('wd'), we: build('we') }
}
