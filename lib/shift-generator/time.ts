import type { TimeRange } from './types'

// Time-of-day values are decimal hours (10.5 = 10:30); overnight ends exceed 24.

export const tToF = (t: string | undefined) => {
  if (!t) return 10
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

export const fToT = (f: number) => {
  const h = Math.floor(f)
  const m = Math.round((f % 1) * 60)
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

export const formatAlertTime = (time: number) => {
  if (time === 24) return '24:00'
  const normalizedTime = time % 24
  const hour = Math.floor(normalizedTime)
  const minute = Math.round((normalizedTime - hour) * 60)
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
