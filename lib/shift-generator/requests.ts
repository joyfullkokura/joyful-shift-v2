import { parseParsedShiftRequest } from '@/lib/parsed-conditions'
import { toTimeRange } from './time'
import type { ShiftRequest } from './types'

export const isRequestUnavailable = (request?: ShiftRequest) =>
  request?.is_off === true || parseParsedShiftRequest(request?.parsed_request)?.is_available === false

export const getRequestedRange = (request?: ShiftRequest) => {
  const explicitRange = toTimeRange(request?.start_time, request?.end_time)
  if (explicitRange) return explicitRange
  const parsedRequest = parseParsedShiftRequest(request?.parsed_request)
  return parsedRequest?.is_available
    ? toTimeRange(parsedRequest.start_time, parsedRequest.end_time)
    : null
}
