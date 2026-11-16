// A staff member's request for one day, chosen on screen (no free-text analysis).
// Shared by the request screen, the server actions and the shift generator. Pure.

import { parseParsedShiftRequest } from '@/lib/parsed-conditions'
import { parseRequestPhrase } from '@/lib/request-phrase'

export const DAY_REQUEST_KINDS = ['off', 'any', 'from', 'until', 'range', 'none'] as const
export type DayRequestKind = (typeof DAY_REQUEST_KINDS)[number]

/**
 * off: 休み / any: 終日OK / from: start..close / until: open..end /
 * range: start..end / none: 希望なし (memo only, usual conditions apply).
 * Times are HH:MM (24:00 allowed).
 */
export type DayRequest = { kind: DayRequestKind; start: string | null; end: string | null }

/** Business hours in minutes from midnight; close may exceed 1440 for late closing. */
export type BusinessHours = { open: number; close: number }

export const DEFAULT_BUSINESS_HOURS: BusinessHours = { open: 9 * 60, close: 24 * 60 }

export const isDayRequestKind = (value: unknown): value is DayRequestKind =>
  typeof value === 'string' && (DAY_REQUEST_KINDS as readonly string[]).includes(value)

/** HH:MM or HH:MM:SS (as returned by a time column) to minutes; null if invalid. */
export const timeToMinutes = (value: unknown): number | null => {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes <= 24 * 60 ? minutes : null
}

/** Minutes to HH:MM (1440 -> 24:00). */
export const minutesToTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** H:MM for display (9:00, 18:30, 24:00). */
export const formatClock = (minutes: number): string => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

/** Store open / close columns to business hours; falls back to 9:00-24:00. */
export const businessHoursOf = (openTime: unknown, closeTime: unknown): BusinessHours => {
  const open = timeToMinutes(openTime)
  let close = timeToMinutes(closeTime)
  if (open === null || close === null) return DEFAULT_BUSINESS_HOURS
  if (close <= open) close += 24 * 60
  return { open, close }
}

const time = (value: unknown): string | null => {
  const minutes = timeToMinutes(value)
  return minutes === null ? null : minutesToTime(minutes)
}

/** Validates and normalises a request; null when the combination is invalid. */
export const toDayRequest = (kind: unknown, start: unknown, end: unknown): DayRequest | null => {
  if (!isDayRequestKind(kind)) return null
  const startTime = time(start)
  const endTime = time(end)
  switch (kind) {
    case 'off':
    case 'any':
    case 'none':
      return { kind, start: null, end: null }
    case 'from':
      return startTime ? { kind, start: startTime, end: null } : null
    case 'until':
      return endTime ? { kind, start: null, end: endTime } : null
    case 'range':
      return startTime && endTime && startTime < endTime ? { kind, start: startTime, end: endTime } : null
  }
}

/** The structured request stored on a row, or null for a legacy (memo-only) row. */
export const dayRequestOfRow = (row: { request_kind?: unknown; start_time?: unknown; end_time?: unknown } | undefined): DayRequest | null =>
  row && row.request_kind != null ? toDayRequest(row.request_kind, row.start_time, row.end_time) : null

export type LegacyRequestRow = {
  is_off?: unknown
  start_time?: unknown
  end_time?: unknown
  memo?: unknown
  parsed_request?: unknown
}

/**
 * Converts a row saved before requests were structured:
 * day off -> old explicit times -> empty memo (none) -> phrase rules on the memo
 * -> an earlier AI result. Null means the manager has to decide.
 */
export const convertLegacyRequest = (row: LegacyRequestRow, hours: BusinessHours = DEFAULT_BUSINESS_HOURS): DayRequest | null => {
  if (row.is_off === true) return { kind: 'off', start: null, end: null }
  const explicit = toDayRequest('range', row.start_time, row.end_time)
  if (explicit) return explicit
  const memo = typeof row.memo === 'string' ? row.memo.trim() : ''
  if (!memo) return { kind: 'none', start: null, end: null }
  const byRule = parseRequestPhrase(memo, hours)
  if (byRule) return byRule
  const parsed = parseParsedShiftRequest(row.parsed_request)
  if (parsed) {
    return parsed.is_available
      ? toDayRequest('range', parsed.start_time, parsed.end_time)
      : { kind: 'off', start: null, end: null }
  }
  return null
}

/** The time span the request allows, in minutes; null for off / none. */
export const requestSpan = (request: DayRequest, hours: BusinessHours): { start: number; end: number } | null => {
  const start = timeToMinutes(request.start)
  const end = timeToMinutes(request.end)
  switch (request.kind) {
    case 'any': return { start: hours.open, end: hours.close }
    case 'from': return start !== null && start < hours.close ? { start, end: hours.close } : null
    case 'until': return end !== null && end > hours.open ? { start: hours.open, end } : null
    case 'range': return start !== null && end !== null && start < end ? { start, end } : null
    default: return null
  }
}

/** Calendar / list label. short: 休 / 終日 / 18:00〜 / 〜15:00 / 10:00〜14:00 (two lines). */
export const formatDayRequest = (request: DayRequest | null, variant: 'short' | 'long' = 'long', offLabel = '休み'): string => {
  if (!request) return ''
  const start = timeToMinutes(request.start)
  const end = timeToMinutes(request.end)
  switch (request.kind) {
    case 'off': return variant === 'short' ? '休' : offLabel
    case 'any': return variant === 'short' ? '終日' : '終日OK'
    case 'from': return start === null ? '' : `${formatClock(start)}〜`
    case 'until': return end === null ? '' : `〜${formatClock(end)}`
    case 'range': return start === null || end === null ? '' : variant === 'short' ? `${formatClock(start)}〜\n${formatClock(end)}` : `${formatClock(start)}〜${formatClock(end)}`
    case 'none': return ''
  }
}

/** Time buttons between from and to (inclusive), every step minutes. */
export const timeChoices = (from: number, to: number, step = 30): number[] => {
  const result: number[] = []
  for (let minutes = Math.ceil(from / step) * step; minutes <= to; minutes += step) result.push(minutes)
  return result
}
