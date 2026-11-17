// A staff member's usual availability per weekday, for display and comparison:
// the weekday choices (weekly_availability) when set, otherwise the old time
// bands (work_start_1 / work_start_2), otherwise nothing. Pure.

import { type DayRequest, formatClock, formatDayRequest, timeToMinutes, toDayRequest } from '@/lib/day-request'
import { WEEKDAY_KEYS, type WeekdayKey, type WeeklyAvailability, parseWeeklyAvailability, weekdayKeyOf } from '@/lib/weekly-availability'

export type UsualSource = 'weekly' | 'bands' | 'none'

export type UsualDay = {
  /** Comparable usual request; null when there is none or it cannot be one request (two bands). */
  request: DayRequest | null
  /** Short calendar label: 18:00〜 / × / 終日 / 10:00〜(newline)14:00 / 10-14・17-22. Empty when unknown. */
  short: string
  /** Long label: 出られない / 終日OK / 18:00〜 / 10:00〜14:00. Empty when unknown. */
  long: string
}

export type UsualAvailability = { source: UsualSource; days: Record<WeekdayKey, UsualDay> }

export type UsualAvailabilityInput = {
  weekly_availability?: unknown
  work_start_1?: unknown
  work_end_1?: unknown
  work_start_2?: unknown
  work_end_2?: unknown
}

const hour = (time: string | null) => {
  const minutes = timeToMinutes(time)
  if (minutes === null) return ''
  return minutes % 60 ? formatClock(minutes) : String(minutes / 60)
}

const fromRequest = (request: DayRequest): UsualDay => ({
  request,
  short: request.kind === 'off' ? '×' : formatDayRequest(request, 'short'),
  long: formatDayRequest(request, 'long', '出られない'),
})

const everyDay = (day: UsualDay): Record<WeekdayKey, UsualDay> =>
  Object.fromEntries(WEEKDAY_KEYS.map(key => [key, day])) as Record<WeekdayKey, UsualDay>

export const usualAvailabilityOf = (staff: UsualAvailabilityInput | null | undefined): UsualAvailability => {
  const weekly = parseWeeklyAvailability(staff?.weekly_availability)
  if (weekly) {
    return { source: 'weekly', days: Object.fromEntries(WEEKDAY_KEYS.map(key => [key, fromRequest(weekly[key])])) as Record<WeekdayKey, UsualDay> }
  }
  const band1 = toDayRequest('range', staff?.work_start_1, staff?.work_end_1)
  const band2 = toDayRequest('range', staff?.work_start_2, staff?.work_end_2)
  if (band1 && band2) {
    return {
      source: 'bands',
      days: everyDay({
        request: null,
        short: `${hour(band1.start)}-${hour(band1.end)}・${hour(band2.start)}-${hour(band2.end)}`,
        long: `${formatDayRequest(band1)}・${formatDayRequest(band2)}`,
      }),
    }
  }
  const band = band1 ?? band2
  if (band) return { source: 'bands', days: everyDay(fromRequest(band)) }
  return { source: 'none', days: everyDay({ request: null, short: '', long: '' }) }
}

/** The usual availability on a date (YYYY-MM-DD). */
export const usualOnDate = (usual: UsualAvailability, dateStr: string): UsualDay => usual.days[weekdayKeyOf(dateStr)]

/** Whether a choice means the same as the usual availability (so nothing needs saving). */
export const isSameAsUsual = (choice: DayRequest | null, usualDay: UsualDay): boolean =>
  Boolean(choice && usualDay.request &&
    choice.kind === usualDay.request.kind && choice.start === usualDay.request.start && choice.end === usualDay.request.end)

/** Weekday choices as a starting point for a change request (the first band on every day otherwise). */
export const usualAsWeeklyDraft = (usual: UsualAvailability): Partial<WeeklyAvailability> =>
  Object.fromEntries(WEEKDAY_KEYS.flatMap(key => usual.days[key].request ? [[key, usual.days[key].request]] : [])) as Partial<WeeklyAvailability>

/** Weekdays whose choice differs between two weekday sets. */
export const changedWeekdays = (before: Partial<WeeklyAvailability>, after: Partial<WeeklyAvailability>): WeekdayKey[] =>
  WEEKDAY_KEYS.filter(key => {
    const left = before[key]
    const right = after[key]
    if (!left || !right) return left !== right
    return left.kind !== right.kind || left.start !== right.start || left.end !== right.end
  })
