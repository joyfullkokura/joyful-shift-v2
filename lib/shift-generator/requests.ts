import { type BusinessHours, DEFAULT_BUSINESS_HOURS, dayRequestOfRow, requestSpan } from '@/lib/day-request'
import { parseParsedShiftRequest } from '@/lib/parsed-conditions'
import { type WeeklyAvailability, parseWeeklyAvailability, weekdayKeyOf } from '@/lib/weekly-availability'
import { toTimeRange } from './time'
import type { ShiftRequest, StaffRecord, TimeRange } from './types'

// Availability on a date, strongest first:
//   1. the day's request chosen on screen (request_kind other than none)
//   2. a legacy request row (is_off / explicit times / cached AI result)
//   3. the staff member's weekday choices (weekly_availability)
//   4. the old time bands work_start_1 / work_start_2, else store hours (see callers)
// Rows and staff without the newer columns keep the old behaviour exactly.

const businessHours = (storeRange: TimeRange | null): BusinessHours => storeRange
  ? { open: Math.round(storeRange.start * 60), close: Math.round(storeRange.end * 60) }
  : DEFAULT_BUSINESS_HOURS

const toHours = (span: { start: number; end: number } | null): TimeRange | null =>
  span ? { start: span.start / 60, end: span.end / 60 } : null

const isLegacyUnavailable = (request?: ShiftRequest) =>
  request?.is_off === true || parseParsedShiftRequest(request?.parsed_request)?.is_available === false

/**
 * The range the day's request allows (decimal hours), or null when the usual
 * conditions apply. 終日OK means the whole business day even outside the usual
 * conditions; 〇時から / 〇時まで are bounded by the business hours.
 */
export const getRequestedRange = (request: ShiftRequest | undefined, storeRange: TimeRange | null): TimeRange | null => {
  const structured = dayRequestOfRow(request)
  if (structured) return toHours(requestSpan(structured, businessHours(storeRange)))
  const explicitRange = toTimeRange(request?.start_time, request?.end_time)
  if (explicitRange) return explicitRange
  const parsedRequest = parseParsedShiftRequest(request?.parsed_request)
  return parsedRequest?.is_available
    ? toTimeRange(parsedRequest.start_time, parsedRequest.end_time)
    : null
}

const weeklyCache = new WeakMap<StaffRecord, WeeklyAvailability | null>()
const weeklyOf = (staff: StaffRecord): WeeklyAvailability | null => {
  if (!weeklyCache.has(staff)) weeklyCache.set(staff, parseWeeklyAvailability(staff.weekly_availability))
  return weeklyCache.get(staff) ?? null
}

/**
 * Usual range on the date from the weekday choices: a range, null when the
 * weekday is 出られない, or undefined when the staff member has no weekday
 * choices (the old time bands apply).
 */
export const weeklyRangeFor = (staff: StaffRecord, dateStr: string, storeRange: TimeRange | null): TimeRange | null | undefined => {
  const weekly = weeklyOf(staff)
  if (!weekly) return undefined
  return toHours(requestSpan(weekly[weekdayKeyOf(dateStr)], businessHours(storeRange)))
}

/** Whether the staff member cannot work at all on the date. */
export const isUnavailableOn = (staff: StaffRecord, request: ShiftRequest | undefined, dateStr: string, storeRange: TimeRange | null): boolean => {
  const structured = dayRequestOfRow(request)
  if (structured && structured.kind !== 'none') return structured.kind === 'off'
  if (!structured) {
    if (isLegacyUnavailable(request)) return true
    if (getRequestedRange(request, storeRange)) return false
  }
  return weeklyRangeFor(staff, dateStr, storeRange) === null
}
