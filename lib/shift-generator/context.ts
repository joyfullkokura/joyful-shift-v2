import { jobForGroup } from './jobs'
import { getRequestedRange, isUnavailableOn, weeklyRangeFor } from './requests'
import type { GeneratedStaffShift, GeneratorInput, JobRole, ShiftRequest, StaffRecord, TimeRange } from './types'
import { toTimeRange } from './time'

/** Employees are never scheduled on more than this many days in a month. */
export const EMPLOYEE_MAX_DAYS = 22

/** One placed shift of a day (mutable while the passes adjust it). */
export type DailyShift = {
  staffId: string
  start: number
  end: number
  skills: string[]
  job: JobRole | null
  slotKey: string
}

/** One required position of a day, from the store's count / slot settings. */
export type DailySlot = {
  group: string
  slotIndex: number
  start: number
  end: number
  assigned: boolean
  staffId: string | null
  relayStaffIds: string[]
}

export type DayAssignments = {
  shifts: DailyShift[]
  slots: DailySlot[]
  assignedStaffIds: Set<string>
}

/** State shared by the generation passes. Created once per generate call. */
export type GenerationContext = {
  input: GeneratorInput
  staffList: StaffRecord[]
  /** Output rows, index-aligned with staffList. */
  scheduleStaff: GeneratedStaffShift[]
  staffIndexById: Map<string, number>
  requestMap: Record<string, ShiftRequest>
  storeRange: TimeRange | null
  daysInMonth: number
  /** Store closing time in decimal hours (fallback when there is no store range). */
  maxTime: number
}

export const requestFor = (context: GenerationContext, staffId: string, dateStr: string): ShiftRequest | undefined =>
  context.requestMap[`${staffId}_${dateStr}`]

/** Splits a comma-separated column into trimmed, non-empty values. */
export const splitList = (value: string | null | undefined) =>
  (value || '').split(',').map(item => item.trim()).filter(Boolean)

/** Whether the staff member can be placed in a slot of this group (by main job / possible groups). */
export const matchesGroup = (staff: StaffRecord, group: string) => {
  const possibleGroups = splitList(staff.possible_groups)
  const groupJob = jobForGroup(group)
  const mainJob = staff.main_job || staff.role
  return mainJob === group
    || possibleGroups.includes(group)
    || Boolean(groupJob && (
      mainJob === groupJob
      || mainJob === '共通'
      || possibleGroups.includes(groupJob)
    ))
}

/**
 * Whether the staff member is available for the whole of [slot.start, slot.end]
 * on the date: the day's request if any, otherwise their usual ranges, otherwise
 * store hours. Used by the adjustment passes after the first assignment.
 */
export const canWorkSlot = (
  context: GenerationContext,
  staff: StaffRecord,
  dateStr: string,
  slot: { group: string; start: number; end: number },
) => {
  const request = requestFor(context, staff.id, dateStr)
  if (isUnavailableOn(staff, request, dateStr, context.storeRange)) return false
  if (!matchesGroup(staff, slot.group)) return false

  const availableRanges = availableRangesFor(context, staff, request, dateStr)
  return availableRanges.some(range => range.start <= slot.start && range.end >= slot.end)
}

/** The day's requested range, else the weekday choice, else the staff's usual ranges, else store hours. */
export const availableRangesFor = (context: GenerationContext, staff: StaffRecord, request: ShiftRequest | undefined, dateStr: string): TimeRange[] => {
  const requestedRange = getRequestedRange(request, context.storeRange)
  if (requestedRange) return [requestedRange]
  const weeklyRange = weeklyRangeFor(staff, dateStr, context.storeRange)
  if (weeklyRange !== undefined) return weeklyRange ? [weeklyRange] : []
  const workRanges = [
    toTimeRange(staff.work_start_1, staff.work_end_1),
    toTimeRange(staff.work_start_2, staff.work_end_2),
  ].filter((range): range is TimeRange => range !== null)
  return requestedRange ? [requestedRange] : workRanges.length > 0 ? workRanges : context.storeRange ? [context.storeRange] : []
}

/** Monthly hour target of an employee. */
export const employeeTargetHours = (context: GenerationContext, staff: StaffRecord) =>
  staff.monthly_target_hours ?? context.input.monthlyTargetHours

/** Saturday, Sunday or a holiday, judged from a YYYY-MM-DD key in local time. */
export const isWeekendOrHoliday = (dateStr: string, holidays: Readonly<Record<string, string>>) => {
  const weekDay = new Date(`${dateStr}T00:00:00`).getDay()
  return weekDay === 0 || weekDay === 6 || Boolean(holidays[dateStr])
}
