import {
  EMPLOYEE_MAX_DAYS,
  isWeekendOrHoliday,
  matchesGroup,
  requestFor,
  splitList,
  type DailyShift,
  type DailySlot,
  type DayAssignments,
  type GenerationContext,
} from './context'
import { jobForGroup } from './jobs'
import { getRequestedRange, isRequestUnavailable } from './requests'
import { scoreCandidate, type ScoreBreakdown } from './scoring'
import { calculateActualHours, fToT, shiftHoursFromLabel, toTimeRange } from './time'
import type { ShiftRequest, StaffRecord, TimeRange } from './types'

/** A staff member who could take a slot, with the hours they would work. */
export type SlotCandidate = {
  /** Index into staffList / scheduleStaff. */
  index: number
  /** 0 = requested or primary range, 1 = secondary range, 2 = store hours fallback. */
  priority: number
  start: number
  end: number
  score: number
  breakdown: ScoreBreakdown
}

/** The outcome of filling one slot in the first pass. */
export type SlotDecision = {
  date: string
  group: string
  slotIndex: number
  start: number
  end: number
  selectedStaffId: string | null
  /** All eligible candidates, best first. */
  candidates: Array<Omit<SlotCandidate, 'index'> & { staffId: string }>
}

const configTypeFor = (context: GenerationContext, dateStr: string, day: number) => {
  const { targetYear, targetMonth, selectedSpecialDays, holidays } = context.input
  const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()
  return selectedSpecialDays.includes(dateStr)
    ? dateStr
    : weekDay === 0 || weekDay === 6 || holidays[dateStr]
      ? 'we'
      : 'wd'
}

type MatchingRange = { start: number; end: number; priority: number; shortfall: number }

/**
 * The best part of the slot this staff member can cover, allowing up to 2 hours
 * uncovered. The day's request replaces the usual ranges; store hours are a
 * fallback only for staff with no ranges at all.
 */
const findMatchingRange = (
  context: GenerationContext,
  staff: StaffRecord,
  request: ShiftRequest | undefined,
  slotStart: number,
  slotEnd: number,
): MatchingRange | undefined => {
  const requestedRange = getRequestedRange(request)
  const workRange1 = toTimeRange(staff.work_start_1, staff.work_end_1)
  const workRange2 = toTimeRange(staff.work_start_2, staff.work_end_2)
  const hasStaffTimeRange = Boolean(requestedRange || workRange1 || workRange2)
  const availableRanges: { range: TimeRange; priority: number }[] = requestedRange
    ? [{ range: requestedRange, priority: 0 }]
    : [
        ...(workRange1 ? [{ range: workRange1, priority: 0 }] : []),
        ...(workRange2 ? [{ range: workRange2, priority: 1 }] : []),
        ...(!hasStaffTimeRange && context.storeRange ? [{ range: context.storeRange, priority: 2 }] : []),
      ]
  return availableRanges
    .map(({ range, priority }) => {
      const start = Math.max(slotStart, range.start)
      const end = Math.min(slotEnd, range.end)
      const shortfall = (slotEnd - slotStart) - Math.max(0, end - start)
      return { start, end, priority, shortfall }
    })
    .filter(range => range.end > range.start && range.shortfall <= 2)
    .sort((left, right) => left.shortfall - right.shortfall || left.priority - right.priority)[0]
}

/** Weekend / holiday shifts this staff member already has before dateStr. */
const countPreviousWeekendShifts = (shifts: Record<string, string>, dateStr: string, holidays: Readonly<Record<string, string>>) =>
  Object.entries(shifts).filter(([assignedDate, assignedShift]) =>
    assignedDate < dateStr
    && shiftHoursFromLabel(assignedShift) > 0
    && isWeekendOrHoliday(assignedDate, holidays)
  ).length

const compareCandidates = (left: SlotCandidate, right: SlotCandidate) =>
  right.score - left.score || left.priority - right.priority || left.index - right.index

/**
 * First pass: walks the month day by day and fills each slot with the
 * highest-scoring eligible staff member (at most one slot per person per day).
 */
export const assignInitialSlots = (context: GenerationContext) => {
  const { input, staffList, scheduleStaff, daysInMonth } = context
  const { targetYear, targetMonth, groups, counts, slots, holidays } = input
  const consecutiveDays = new Map(staffList.map(staff => [staff.id, 0]))
  const assignmentsByDate = new Map<string, DayAssignments>()
  const decisions: SlotDecision[] = []

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const configType = configTypeFor(context, dateStr, day)
    const dailyAssignments = new Set<string>()

    staffList.forEach((staff, index) => {
      if (isRequestUnavailable(requestFor(context, staff.id, dateStr))) {
        scheduleStaff[index].shifts[dateStr] = '×'
      }
    })

    const dailyShifts: DailyShift[] = []
    const dailySlots: DailySlot[] = []
    const isWeekendDay = isWeekendOrHoliday(dateStr, holidays)

    for (const group of groups) {
      const count = Math.max(0, counts[configType]?.[group] || 0)
      for (let slotIndex = 0; slotIndex < count; slotIndex++) {
        const slot = slots[configType]?.[`${group}_${slotIndex}`] || { start: 10, end: 18 }
        const slotEnd = slot.end < slot.start ? slot.end + 24 : slot.end
        const dailySlot: DailySlot = { group, slotIndex, start: slot.start, end: slotEnd, assigned: false, staffId: null, relayStaffIds: [] }
        dailySlots.push(dailySlot)

        // Ranks of the people already placed on shifts overlapping this slot.
        const overlappingRanks = dailyShifts
          .filter(shift => shift.start < slotEnd && shift.end > slot.start)
          .map(shift => staffList.find(person => person.id === shift.staffId)?.rank)

        const candidates: SlotCandidate[] = []
        staffList.forEach((staff, index) => {
          const request = requestFor(context, staff.id, dateStr)
          if (isRequestUnavailable(request) || dailyAssignments.has(staff.id)) return
          if (staff.is_employee && scheduleStaff[index].assignedDays >= EMPLOYEE_MAX_DAYS) return
          if (!matchesGroup(staff, group)) return

          const matchingRange = findMatchingRange(context, staff, request, slot.start, slotEnd)
          if (!matchingRange) return

          const breakdown = scoreCandidate({
            weeklyTargetDays: staff.target_work_days ?? staff.weekly_target_days ?? 0,
            daysInMonth,
            day,
            assignedDays: scheduleStaff[index].assignedDays,
            consecutiveDays: consecutiveDays.get(staff.id) || 0,
            rank: staff.rank,
            overlappingRanks,
            shortfall: matchingRange.shortfall,
            previousWeekendShifts: isWeekendDay ? countPreviousWeekendShifts(scheduleStaff[index].shifts, dateStr, holidays) : 0,
          })
          candidates.push({
            index,
            priority: matchingRange.priority,
            start: matchingRange.start,
            end: matchingRange.end,
            score: breakdown.total,
            breakdown,
          })
        })

        candidates.sort(compareCandidates)
        const selected = candidates[0]
        decisions.push({
          date: dateStr,
          group,
          slotIndex,
          start: slot.start,
          end: slotEnd,
          selectedStaffId: selected ? staffList[selected.index].id : null,
          candidates: candidates.map(({ index, ...candidate }) => ({ staffId: staffList[index].id, ...candidate })),
        })
        if (!selected) continue

        const assignedStaff = staffList[selected.index]
        const assignedRow = scheduleStaff[selected.index]
        const assignedRole = jobForGroup(group)
        dailyAssignments.add(assignedStaff.id)
        dailySlot.assigned = true
        dailySlot.staffId = assignedStaff.id
        dailyShifts.push({
          staffId: assignedStaff.id,
          start: selected.start,
          end: selected.end,
          skills: splitList(assignedStaff.skills),
          job: assignedRole,
          slotKey: `${group}_${slotIndex}`,
        })
        assignedRow.shifts[dateStr] = `${fToT(selected.start)}-${fToT(selected.end)}`
        if (assignedRole) assignedRow.assignedRoles![dateStr] = assignedRole
        assignedRow.assignedDays++
        assignedRow.assignedHours += calculateActualHours(selected.start, selected.end)
      }
    }

    assignmentsByDate.set(dateStr, { shifts: dailyShifts, slots: dailySlots, assignedStaffIds: dailyAssignments })

    staffList.forEach(staff => {
      consecutiveDays.set(staff.id, dailyAssignments.has(staff.id) ? (consecutiveDays.get(staff.id) || 0) + 1 : 0)
    })
  }

  return { assignmentsByDate, decisions }
}
