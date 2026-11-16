import {
  EMPLOYEE_MAX_DAYS,
  availableRangesFor,
  canWorkSlot,
  employeeTargetHours,
  requestFor,
  splitList,
  type DayAssignments,
  type GenerationContext,
} from './context'
import { isUnavailableOn } from './requests'
import { actualHoursForShifts, calculateActualHours, fToT } from './time'
import type { GeneratedStaffShift, StaffRecord } from './types'

/** Longest shift (in clock hours) the extension step may create. */
export const MAX_EXTENDED_SHIFT_HOURS = 10

/** Extended ends lie on the same 15-minute grid as manual edits (ShiftTimeEditor). */
export const EXTENSION_STEPS_PER_HOUR = 4

export type EmployeeHoursAdjustment =
  | { type: 'swap'; date: string; employeeId: string; partTimeId: string }
  | { type: 'takeover'; date: string; employeeId: string; partTimeId: string }
  | { type: 'extend'; date: string; employeeId: string; end: number }

type StaffWithRow = { staff: StaffRecord; row: GeneratedStaffShift }

/**
 * Same day: give the employee a longer slot held by a part-timer and the
 * part-timer the employee's shorter slot, if both can work the other's slot.
 */
const swapForLongerSlot = (
  context: GenerationContext,
  assignmentsByDate: Map<string, DayAssignments>,
  { staff: employee, row: employeeRow }: StaffWithRow,
): EmployeeHoursAdjustment | null => {
  const { staffList, scheduleStaff, staffIndexById } = context
  for (const [dateStr, dayData] of assignmentsByDate) {
    if (!dayData.assignedStaffIds.has(employee.id)) continue
    const employeeShift = dayData.shifts.find(shift => shift.staffId === employee.id)
    const employeeSlot = employeeShift && dayData.slots.find(slot => slot.staffId === employee.id)
    if (!employeeShift || !employeeSlot) continue

    const longerSlots = dayData.slots
      .filter(slot => slot.staffId && slot.end - slot.start > employeeSlot.end - employeeSlot.start)
      .sort((left, right) => (right.end - right.start) - (left.end - left.start))
    for (const longerSlot of longerSlots) {
      const partTimeIndex = staffIndexById.get(longerSlot.staffId || '')
      const partTimeStaff = partTimeIndex === undefined ? undefined : staffList[partTimeIndex]
      const partTimeShift = dayData.shifts.find(shift => shift.slotKey === `${longerSlot.group}_${longerSlot.slotIndex}`)
      if (
        partTimeIndex === undefined
        || !partTimeStaff
        || partTimeStaff.is_employee
        || !partTimeShift
        || !canWorkSlot(context, employee, dateStr, longerSlot)
        || !canWorkSlot(context, partTimeStaff, dateStr, employeeSlot)
      ) continue

      const partTimeRow = scheduleStaff[partTimeIndex]
      const employeeSkillSet = splitList(employee.skills)
      const partTimeSkillSet = splitList(partTimeStaff.skills)
      employeeShift.staffId = partTimeStaff.id
      employeeShift.skills = partTimeSkillSet
      employeeSlot.staffId = partTimeStaff.id
      partTimeShift.staffId = employee.id
      partTimeShift.skills = employeeSkillSet
      longerSlot.staffId = employee.id
      employeeRow.shifts[dateStr] = `${fToT(longerSlot.start)}-${fToT(longerSlot.end)}`
      partTimeRow.shifts[dateStr] = `${fToT(employeeSlot.start)}-${fToT(employeeSlot.end)}`
      employeeRow.assignedHours = actualHoursForShifts(employeeRow.shifts)
      partTimeRow.assignedHours = actualHoursForShifts(partTimeRow.shifts)
      employeeRow.assignedRoles ??= {}
      partTimeRow.assignedRoles ??= {}
      if (employeeShift.job) employeeRow.assignedRoles[dateStr] = employeeShift.job
      if (partTimeShift.job) partTimeRow.assignedRoles[dateStr] = partTimeShift.job
      return { type: 'swap', date: dateStr, employeeId: employee.id, partTimeId: partTimeStaff.id }
    }
  }
  return null
}

/**
 * A day the employee is off: take over a part-timer's slot, preferring
 * part-timers who already reached their monthly day target.
 */
const takeOverPartTimeSlot = (
  context: GenerationContext,
  assignmentsByDate: Map<string, DayAssignments>,
  { staff: employee, row: employeeRow }: StaffWithRow,
): EmployeeHoursAdjustment | null => {
  const { staffList, scheduleStaff, staffIndexById, daysInMonth } = context
  for (const [dateStr, dayData] of assignmentsByDate) {
    if (dayData.assignedStaffIds.has(employee.id)) continue
    const partTimeSlots = dayData.slots
      .filter(slot => slot.staffId)
      .map(slot => {
        const index = staffIndexById.get(slot.staffId || '')
        const staff = index === undefined ? undefined : staffList[index]
        const row = index === undefined ? undefined : scheduleStaff[index]
        const monthlyTargetDays = (staff?.target_work_days ?? staff?.weekly_target_days ?? 0) * daysInMonth / 7
        return { slot, staff, row, daysAtTarget: Boolean(row && monthlyTargetDays > 0 && row.assignedDays >= monthlyTargetDays) }
      })
      .filter((candidate): candidate is typeof candidate & StaffWithRow =>
        Boolean(candidate.staff && candidate.row && !candidate.staff.is_employee)
      )
      .sort((left, right) => Number(right.daysAtTarget) - Number(left.daysAtTarget))

    for (const { slot, staff: partTimeStaff, row: partTimeRow } of partTimeSlots) {
      if (!canWorkSlot(context, employee, dateStr, slot)) continue
      const shift = dayData.shifts.find(item => item.slotKey === `${slot.group}_${slot.slotIndex}`)
      if (!shift) continue
      shift.staffId = employee.id
      shift.skills = splitList(employee.skills)
      slot.staffId = employee.id
      dayData.assignedStaffIds.delete(partTimeStaff.id)
      dayData.assignedStaffIds.add(employee.id)
      partTimeRow.assignedDays--
      delete partTimeRow.shifts[dateStr]
      partTimeRow.assignedHours = actualHoursForShifts(partTimeRow.shifts)
      if (partTimeRow.assignedRoles) delete partTimeRow.assignedRoles[dateStr]
      employeeRow.assignedDays++
      employeeRow.shifts[dateStr] = `${fToT(slot.start)}-${fToT(slot.end)}`
      employeeRow.assignedHours = actualHoursForShifts(employeeRow.shifts)
      if (shift.job) {
        employeeRow.assignedRoles ??= {}
        employeeRow.assignedRoles[dateStr] = shift.job
      }
      return { type: 'takeover', date: dateStr, employeeId: employee.id, partTimeId: partTimeStaff.id }
    }
  }
  return null
}

/**
 * Extend one of the employee's shifts toward the monthly hour target (binary
 * search on the end time), within their availability, store closing time and
 * MAX_EXTENDED_SHIFT_HOURS.
 */
const extendShift = (
  context: GenerationContext,
  assignmentsByDate: Map<string, DayAssignments>,
  { staff: employee, row: employeeRow }: StaffWithRow,
): EmployeeHoursAdjustment | null => {
  for (const [dateStr, dayData] of assignmentsByDate) {
    const shift = dayData.shifts.find(item => item.staffId === employee.id)
    if (!shift) continue
    const slot = dayData.slots.find(item => item.staffId === employee.id)
    if (!slot) continue
    const request = requestFor(context, employee.id, dateStr)
    if (isUnavailableOn(employee, request, dateStr, context.storeRange)) continue
    const availableRanges = availableRangesFor(context, employee, request, dateStr)
    const extensionRanges = availableRanges.filter(range => range.start <= slot.start && range.end >= shift.end)
    if (extensionRanges.length === 0) continue
    const availableEnd = Math.min(
      context.storeRange?.end ?? context.maxTime,
      shift.start + MAX_EXTENDED_SHIFT_HOURS,
      Math.max(...extensionRanges.map(range => range.end))
    )
    const currentShiftHours = calculateActualHours(shift.start, shift.end)
    const otherShiftHours = employeeRow.assignedHours - currentShiftHours
    const targetHours = employeeTargetHours(context, employee)
    // The latest 15-minute end that keeps the month within the target. Candidates are
    // exact quarters (k / 4), so no rounding error can reach the label. Paid hours are
    // not monotonic in the end (breaks start at 6h / 8h), hence a full scan.
    const EPSILON = 1e-9
    const firstStep = Math.floor(shift.end * EXTENSION_STEPS_PER_HOUR + EPSILON) + 1
    const lastStep = Math.floor(availableEnd * EXTENSION_STEPS_PER_HOUR + EPSILON)
    let extendedEnd: number | null = null
    for (let step = firstStep; step <= lastStep; step++) {
      const candidateEnd = step / EXTENSION_STEPS_PER_HOUR
      if (otherShiftHours + calculateActualHours(shift.start, candidateEnd) <= targetHours + EPSILON) extendedEnd = candidateEnd
    }
    if (extendedEnd === null) continue
    shift.end = extendedEnd
    slot.end = Math.max(slot.end, extendedEnd)
    employeeRow.shifts[dateStr] = `${fToT(shift.start)}-${fToT(shift.end)}`
    employeeRow.assignedHours = actualHoursForShifts(employeeRow.shifts)
    return { type: 'extend', date: dateStr, employeeId: employee.id, end: extendedEnd }
  }
  return null
}

/**
 * Third pass: while some employee is below their monthly hour target, make one
 * improvement for the employee furthest below it (swap, then take over a day
 * off, then extend a shift) and start over. Stops when nobody can improve.
 */
export const balanceEmployeeHours = (context: GenerationContext, assignmentsByDate: Map<string, DayAssignments>): EmployeeHoursAdjustment[] => {
  const { staffList, scheduleStaff, staffIndexById } = context
  const adjustments: EmployeeHoursAdjustment[] = []

  while (true) {
    const employeesBelowTarget = staffList
      .map((staff, index) => ({ staff, row: scheduleStaff[index] }))
      .filter(({ staff, row }) => staff.is_employee && row.assignedHours < employeeTargetHours(context, staff))
      .sort((left, right) =>
        (employeeTargetHours(context, right.staff) - right.row.assignedHours)
        - (employeeTargetHours(context, left.staff) - left.row.assignedHours)
      )
    if (employeesBelowTarget.length === 0) break

    let progress: EmployeeHoursAdjustment | null = null
    for (const employee of employeesBelowTarget) {
      if (staffIndexById.get(employee.staff.id) === undefined) continue
      progress = swapForLongerSlot(context, assignmentsByDate, employee)
        ?? (employee.row.assignedDays < EMPLOYEE_MAX_DAYS ? takeOverPartTimeSlot(context, assignmentsByDate, employee) : null)
        ?? extendShift(context, assignmentsByDate, employee)
      if (progress) break
    }
    if (!progress) break
    adjustments.push(progress)
  }
  return adjustments
}
