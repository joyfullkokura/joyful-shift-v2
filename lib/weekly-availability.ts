// Usual availability per weekday, chosen on screen (no free-text analysis). Pure.

import {
  type BusinessHours,
  type DayRequest,
  DEFAULT_BUSINESS_HOURS,
  formatDayRequest,
  minutesToTime,
  requestSpan,
  toDayRequest,
} from '@/lib/day-request'
import { type ParsedConditions, WEEKDAY_KEYS, type WeekdayKey } from '@/lib/parsed-conditions'

export { WEEKDAY_KEYS, type WeekdayKey }

/** All seven weekdays; kind is never 'none' (every day has an answer). */
export type WeeklyAvailability = Record<WeekdayKey, DayRequest>

/** While editing, days may still be unanswered. */
export type WeeklyAvailabilityDraft = Partial<Record<WeekdayKey, DayRequest>>

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  monday: '月', tuesday: '火', wednesday: '水', thursday: '木', friday: '金', saturday: '土', sunday: '日',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validates a stored / submitted value; null unless all seven days are valid. */
export const parseWeeklyAvailability = (value: unknown): WeeklyAvailability | null => {
  if (!isRecord(value)) return null
  const result = {} as WeeklyAvailability
  for (const day of WEEKDAY_KEYS) {
    const entry = value[day]
    if (!isRecord(entry)) return null
    const request = toDayRequest(entry.kind, entry.start, entry.end)
    if (!request || request.kind === 'none') return null
    result[day] = request
  }
  return result
}

/** Completes a draft, or null while a day is unanswered. */
export const completeWeeklyAvailability = (draft: WeeklyAvailabilityDraft): WeeklyAvailability | null =>
  parseWeeklyAvailability(draft)

/** Weekday key of a YYYY-MM-DD date (local calendar date). */
export const weekdayKeyOf = (dateStr: string): WeekdayKey => {
  const weekday = new Date(`${dateStr}T00:00:00`).getDay()
  return WEEKDAY_KEYS[(weekday + 6) % 7]
}

/** Starting values from the old two time bands: the first band on every day. */
export const weeklyFromWorkRanges = (start: unknown, end: unknown): WeeklyAvailabilityDraft => {
  const range = toDayRequest('range', start, end)
  if (!range) return {}
  return Object.fromEntries(WEEKDAY_KEYS.map(day => [day, range])) as WeeklyAvailability
}

/** The derived per-day summary kept in staff.parsed_conditions for existing displays. */
export const toParsedConditions = (weekly: WeeklyAvailability, hours: BusinessHours = DEFAULT_BUSINESS_HOURS): ParsedConditions => {
  const result = {} as ParsedConditions
  for (const day of WEEKDAY_KEYS) {
    const span = requestSpan(weekly[day], hours)
    result[day] = span
      ? { is_available: true, start_time: minutesToTime(span.start), end_time: minutesToTime(Math.min(span.end, 24 * 60)) }
      : { is_available: false, start_time: null, end_time: null }
  }
  return result
}

/** One line such as 「月 17:00〜 / 火 17:00〜 / 水 ×  …」. */
export const formatWeeklyAvailability = (value: unknown): string | null => {
  const weekly = parseWeeklyAvailability(value)
  if (!weekly) return null
  return WEEKDAY_KEYS.map(day => `${WEEKDAY_LABELS[day]} ${weekly[day].kind === 'off' ? '×' : formatDayRequest(weekly[day])}`).join(' / ')
}
