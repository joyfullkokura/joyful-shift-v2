// On-site coverage of a day (④⑤⑥):
//   ④ 時間帯責任者: someone marked 責任者 at every business hour someone works (store setting, default off)
//   ⑤ 開店・締め: someone marked 開店 at opening and 締め at closing (store setting, default off)
//   ⑥ 新人だけの時間帯: no time staffed only by part-timers below the store's rank floor
//      (soft: −200 per hour in the score; hard: such shifts are removed and the slot stays empty)
// Times are checked on a 15-minute grid, the grid of every generated shift.

import type { RankFloor } from '@/lib/labor-rules'
import type { DayAssignments, GenerationContext } from './context'
import type { StaffRecord } from './types'

const STEP = 0.25
const EPSILON = 1e-9

/** Score deducted per hour a novice candidate would work with no one experienced on shift. */
export const NOVICE_ONLY_PENALTY_PER_HOUR = -200

const RANK_VALUE: Record<string, number> = { A: 3, B: 2, C: 1 }
/** Unset ranks count as B (what the roster shows for them). */
export const rankValueOf = (rank: string | null | undefined) => RANK_VALUE[rank ?? ''] ?? RANK_VALUE.B

/** Part-timers ranked below the floor. Employees are never novices. */
export const isNovice = (staff: StaffRecord | undefined, floor: RankFloor) =>
  Boolean(staff && !staff.is_employee && rankValueOf(staff.rank) < RANK_VALUE[floor])

export type CoverageShift = { staffId: string; start: number; end: number }

export type CoverageGapKind = 'no_lead' | 'no_open' | 'no_close' | 'novice_only'

/** A coverage requirement the finished day does not meet. */
export type CoverageGap = { date: string; kind: CoverageGapKind; hours: number }

/** A novice's shift removed under the hard rule; its slot is left empty. */
export type NoviceRemoval = { type: 'novice_only'; date: string; staffId: string; slotKey: string }

const staffOf = (context: GenerationContext, staffId: string) => {
  const index = context.staffIndexById.get(staffId)
  return index === undefined ? undefined : context.staffList[index]
}

const covers = (shift: { start: number; end: number }, time: number) =>
  shift.start <= time + EPSILON && shift.end >= time + STEP - EPSILON

const gridOf = (from: number, to: number) => {
  const times: number[] = []
  for (let time = from; time < to - EPSILON; time += STEP) times.push(time)
  return times
}

const opensStore = (staff: StaffRecord | undefined, shift: CoverageShift, open: number) =>
  staff?.can_open === true && shift.start <= open + EPSILON && shift.end > open + EPSILON

const closesStore = (staff: StaffRecord | undefined, shift: CoverageShift, close: number) =>
  staff?.can_close === true && shift.end >= close - EPSILON && shift.start < close - EPSILON

export type DayCoverage = {
  openMissing: boolean
  closeMissing: boolean
  /** Business hours with someone on shift but no 責任者. */
  leadGapHours: number
  /** Hours with someone on shift and every one of them a novice. */
  noviceOnlyHours: number
}

/** Coverage of a day's shifts, counting only the checks the store turned on. */
export const dayCoverage = (context: GenerationContext, shifts: readonly CoverageShift[]): DayCoverage => {
  const { rules, storeRange } = context
  const people = shifts.map(shift => ({ shift, staff: staffOf(context, shift.staffId) }))
  const result: DayCoverage = { openMissing: false, closeMissing: false, leadGapHours: 0, noviceOnlyHours: 0 }
  if (people.length === 0) return result

  if (rules.checkOpenClose && storeRange) {
    result.openMissing = !people.some(({ staff, shift }) => opensStore(staff, shift, storeRange.start))
    result.closeMissing = !people.some(({ staff, shift }) => closesStore(staff, shift, storeRange.end))
  }
  if (rules.checkLead && storeRange) {
    for (const time of gridOf(storeRange.start, storeRange.end)) {
      const here = people.filter(({ shift }) => covers(shift, time))
      if (here.length > 0 && !here.some(({ staff }) => staff?.can_lead === true)) result.leadGapHours += STEP
    }
  }
  const from = Math.min(...shifts.map(shift => shift.start))
  const to = Math.max(...shifts.map(shift => shift.end))
  for (const time of gridOf(from, to)) {
    const here = people.filter(({ shift }) => covers(shift, time))
    if (here.length > 0 && here.every(({ staff }) => isNovice(staff, rules.noviceRankFloor))) result.noviceOnlyHours += STEP
  }
  return result
}

/** Whether `after` is worse than `before` in any check (used before moving people between slots). */
export const losesCoverage = (before: DayCoverage, after: DayCoverage) =>
  (after.openMissing && !before.openMissing)
  || (after.closeMissing && !before.closeMissing)
  || after.leadGapHours > before.leadGapHours + EPSILON
  || after.noviceOnlyHours > before.noviceOnlyHours + EPSILON

/**
 * Number of still-missing requirements (opening, closing, 責任者 hours) this
 * candidate would meet, given the shifts already placed that day. Candidates
 * meeting more are chosen first; 0 for everyone while the checks are off.
 */
export const coverageGain = (
  context: GenerationContext,
  placed: readonly CoverageShift[],
  staff: StaffRecord,
  start: number,
  end: number,
) => {
  const { rules, storeRange } = context
  if (!storeRange) return 0
  const people = placed.map(shift => ({ shift, staff: staffOf(context, shift.staffId) }))
  const shift = { staffId: staff.id, start, end }
  let gain = 0
  if (rules.checkOpenClose) {
    if (opensStore(staff, shift, storeRange.start) && !people.some(person => opensStore(person.staff, person.shift, storeRange.start))) gain++
    if (closesStore(staff, shift, storeRange.end) && !people.some(person => closesStore(person.staff, person.shift, storeRange.end))) gain++
  }
  if (rules.checkLead && staff.can_lead === true) {
    const uncovered = gridOf(Math.max(start, storeRange.start), Math.min(end, storeRange.end))
      .some(time => !people.some(person => person.staff?.can_lead === true && covers(person.shift, time)))
    if (uncovered) gain++
  }
  return gain
}

/** Hours a novice candidate would work with no one experienced on shift (0 for everyone else). */
export const noviceOnlyHoursFor = (
  context: GenerationContext,
  placed: readonly CoverageShift[],
  staff: StaffRecord,
  start: number,
  end: number,
) => {
  const floor = context.rules.noviceRankFloor
  if (!isNovice(staff, floor)) return 0
  const experienced = placed.filter(shift => !isNovice(staffOf(context, shift.staffId), floor))
  return gridOf(start, end).filter(time => !experienced.some(shift => covers(shift, time))).length * STEP
}

/**
 * After every pass: under the hard novice rule, removes novices' shifts until
 * no time is staffed only by novices (the shift with the most such time goes
 * first; its slot stays empty). Then lists what each day still misses.
 */
export const enforceCoverage = (context: GenerationContext, assignmentsByDate: Map<string, DayAssignments>) => {
  const removals: NoviceRemoval[] = []
  const gaps: CoverageGap[] = []
  const floor = context.rules.noviceRankFloor

  for (const [dateStr, dayData] of assignmentsByDate) {
    if (context.rules.noviceRule === 'hard') {
      for (;;) {
        if (dayCoverage(context, dayData.shifts).noviceOnlyHours <= EPSILON) break
        let worstIndex = -1
        let worstHours = 0
        for (let index = 0; index < dayData.shifts.length; index++) {
          const shift = dayData.shifts[index]
          const staff = staffOf(context, shift.staffId)
          if (!staff || !isNovice(staff, floor)) continue
          const others = dayData.shifts.filter((_, otherIndex) => otherIndex !== index)
          const hours = noviceOnlyHoursFor(context, others, staff, shift.start, shift.end)
          if (hours > EPSILON && hours >= worstHours) {
            worstIndex = index
            worstHours = hours
          }
        }
        if (worstIndex < 0) break
        const [removed] = dayData.shifts.splice(worstIndex, 1)
        const rowIndex = context.staffIndexById.get(removed.staffId)
        if (rowIndex !== undefined) {
          const row = context.scheduleStaff[rowIndex]
          delete row.shifts[dateStr]
          if (row.assignedRoles) delete row.assignedRoles[dateStr]
          row.assignedDays--
        }
        dayData.assignedStaffIds.delete(removed.staffId)
        for (const slot of dayData.slots) {
          if (slot.staffId === removed.staffId) {
            slot.staffId = null
            slot.assigned = false
          }
          slot.relayStaffIds = slot.relayStaffIds.filter(staffId => staffId !== removed.staffId)
        }
        removals.push({ type: 'novice_only', date: dateStr, staffId: removed.staffId, slotKey: removed.slotKey })
      }
    }

    const coverage = dayCoverage(context, dayData.shifts)
    if (coverage.openMissing) gaps.push({ date: dateStr, kind: 'no_open', hours: 0 })
    if (coverage.closeMissing) gaps.push({ date: dateStr, kind: 'no_close', hours: 0 })
    if (coverage.leadGapHours > EPSILON) gaps.push({ date: dateStr, kind: 'no_lead', hours: coverage.leadGapHours })
    if (coverage.noviceOnlyHours > EPSILON) gaps.push({ date: dateStr, kind: 'novice_only', hours: coverage.noviceOnlyHours })
  }
  return { removals, gaps }
}
