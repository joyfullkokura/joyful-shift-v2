import type { TimeRange } from './types'

// Time-of-day values are decimal hours (10.5 = 10:30); overnight ends exceed 24.

export const tToF = (t: string | undefined) => {
  if (!t) return 10
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

/**
 * Decimal hours to HH:MM. Rounds to whole minutes first, so a value such as
 * 19.99999 becomes 20:00 (never 19:60).
 */
export const fToT = (f: number) => {
  const totalMinutes = Math.round(f * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes - h * 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const toTimeRange = (startValue?: string | null, endValue?: string | null): TimeRange | null => {
  if (!startValue || !endValue) return null
  const start = tToF(startValue)
  let end = tToF(endValue)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end < start) end += 24
  return end > start ? { start, end } : null
}

/** Clock time for alert messages; overnight times wrap (26 -> 02:00), but 24 stays 24:00. */
export const formatAlertTime = (time: number) => {
  const totalMinutes = Math.round(time * 60)
  if (totalMinutes === 24 * 60) return '24:00'
  const minutesOfDay = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hour = Math.floor(minutesOfDay / 60)
  const minute = minutesOfDay - hour * 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export const calculateActualHours = (start: number, end: number) => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  let duration = end - start
  if (duration < 0) duration += 24
  if (duration <= 0) return 0
  const breakHours = duration > 8 ? 1 : duration > 6 ? 0.75 : 0
  return Math.max(0, duration - breakHours)
}

export const shiftHoursFromLabel = (shift: string) => {
  const match = shift.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
  if (!match) return 0
  const start = Number(match[1]) + Number(match[2]) / 60
  const end = Number(match[3]) + Number(match[4]) / 60
  return calculateActualHours(start, end)
}

export const actualHoursForShifts = (shifts: Record<string, string>) => (
  Object.values(shifts).reduce((total, shift) => total + shiftHoursFromLabel(shift), 0)
)

export const shiftRangeFromLabel = (shift: string) => {
  const [start, end] = shift.split('-')
  return toTimeRange(start, end)
}
