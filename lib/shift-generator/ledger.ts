// The ledger: every staff member's shift per date, as the generation passes
// build it (scheduleStaff[].shifts), plus the last days of the previous month.
// It is the one place the hard rules read from, so a shift written by any pass
// (assign, relay, swap, takeover, extension) is seen by every later check.

import type { GenerationContext } from './context'
import { calculateActualHours } from './time'

export type ShiftSpan = { start: number; end: number }

const LABEL = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/

export const spanOfLabel = (label: string | undefined): ShiftSpan | null => {
  const match = LABEL.exec(label ?? '')
  if (!match) return null
  const start = Number(match[1]) + Number(match[2]) / 60
  let end = Number(match[3]) + Number(match[4]) / 60
  if (end <= start) end += 24
  return { start, end }
}

const pad = (value: number) => String(value).padStart(2, '0')

export const shiftDate = (dateStr: string, days: number) => {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const monthStartOf = (context: GenerationContext) =>
  `${context.input.targetYear}-${pad(context.input.targetMonth)}-01`

/** The shift of a staff member (by index) on a date, inside the month or in the previous month's tail. */
export const shiftOn = (context: GenerationContext, staffIndex: number, dateStr: string): ShiftSpan | null => {
  if (dateStr < monthStartOf(context)) {
    const staffId = context.staffList[staffIndex]?.id
    return staffId ? spanOfLabel(context.previousShifts.get(staffId)?.[dateStr]) : null
  }
  return spanOfLabel(context.scheduleStaff[staffIndex]?.shifts[dateStr])
}

export const paidHoursOn = (context: GenerationContext, staffIndex: number, dateStr: string) => {
  const span = shiftOn(context, staffIndex, dateStr)
  return span ? calculateActualHours(span.start, span.end) : 0
}
