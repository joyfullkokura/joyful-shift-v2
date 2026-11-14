import 'server-only'
import { UserFacingError } from '@/lib/server/action'

// Server Actions accept arbitrary POST bodies, so every argument is validated
// here even when the TypeScript signature already describes it.

export const INVALID_INPUT = '入力内容を確認してください。'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const assert: (condition: unknown, message?: string) => asserts condition = (condition, message = INVALID_INPUT) => {
  if (!condition) throw new UserFacingError(message)
}

export const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64

/** First day of a month, e.g. 2026-12-01 (the format used by target_month). */
export const isMonthStart = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)

export const isDateKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)

/** HH:MM or HH:MM:SS as stored in time columns. */
export const isTimeText = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-4]):[0-5]\d(:[0-5]\d)?$/.test(value)

export const isShortText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

/** Exclusive end of the month that starts at monthStart (YYYY-MM-01). */
export const nextMonthStart = (monthStart: string): string => {
  const [year, month] = monthStart.split('-').map(Number)
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
}

/** First day of next month in Japan time (stores operate in JST regardless of server TZ). */
export const nextMonthStartInJapan = (): string => {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return nextMonthStart(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`)
}

/** Rough cap for JSON payloads such as schedules and generation settings. */
export const isJsonWithin = (value: unknown, maxBytes: number): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes
  } catch {
    return false
  }
}
