import { DEFAULT_BUSINESS_HOURS, dayRequestOfRow, requestSpan } from '@/lib/day-request'
import { parseParsedShiftRequest } from '@/lib/parsed-conditions'
import { toTimeRange } from './time'
import type { ShiftRequest, TimeRange } from './types'

// A row with request_kind is a request chosen on screen and always wins over the
// usual conditions for that day. Rows without it were saved before requests were
// structured and keep the old reading (is_off / explicit times / cached AI result),
// so generation of old months is unchanged.

export const isRequestUnavailable = (request?: ShiftRequest) => {
  const structured = dayRequestOfRow(request)
  if (structured) return structured.kind === 'off'
  return request?.is_off === true || parseParsedShiftRequest(request?.parsed_request)?.is_available === false
}

/**
 * The range the day's request allows (decimal hours), or null when the usual
 * conditions apply. 終日OK means the whole business day even outside the usual
 * conditions; 〇時から / 〇時まで are bounded by the business hours.
 */
export const getRequestedRange = (request: ShiftRequest | undefined, storeRange: TimeRange | null): TimeRange | null => {
  const structured = dayRequestOfRow(request)
  if (structured) {
    const hours = storeRange
      ? { open: Math.round(storeRange.start * 60), close: Math.round(storeRange.end * 60) }
      : DEFAULT_BUSINESS_HOURS
    const span = requestSpan(structured, hours)
    return span ? { start: span.start / 60, end: span.end / 60 } : null
  }
  const explicitRange = toTimeRange(request?.start_time, request?.end_time)
  if (explicitRange) return explicitRange
  const parsedRequest = parseParsedShiftRequest(request?.parsed_request)
  return parsedRequest?.is_available
    ? toTimeRange(parsedRequest.start_time, parsedRequest.end_time)
    : null
}
