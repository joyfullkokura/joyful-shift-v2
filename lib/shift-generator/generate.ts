import { DEFAULT_LABOR_RULES } from '@/lib/labor-rules'
import { type CoverageGap, type NoviceRemoval, enforceCoverage } from './coverage'
import { parseSkillOptions } from '@/lib/skill-options'
import { calculateScheduleAlerts } from './alerts'
import { assignInitialSlots, type SlotDecision } from './assign'
import { splitList, type GenerationContext } from './context'
import { balanceEmployeeHours, type EmployeeHoursAdjustment } from './employee-hours'
import { compareStaffOrder, getJobOptions, jobForGroup } from './jobs'
import { fillGapsWithRelays, type RelayAdjustment } from './relay'
import { actualHoursForShifts, tToF, toTimeRange } from './time'
import type { GeneratedSchedule, GeneratedStaffShift, GeneratorInput, ShiftRequest } from './types'

const createContext = (input: GeneratorInput): GenerationContext => {
  const { staff: staffList, requests, store, targetYear, targetMonth, monthlyTargetHours } = input

  const requestMap: Record<string, ShiftRequest> = {}
  requests.forEach(row => {
    if (row.staff_id && row.date) requestMap[`${row.staff_id}_${row.date}`] = row
  })

  const scheduleStaff: GeneratedStaffShift[] = staffList.map(staff => ({
    id: staff.id,
    name: staff.name,
    mainJob: staff.main_job || staff.role || '未設定',
    jobOptions: getJobOptions(staff.main_job || staff.role, staff.possible_groups),
    isEmployee: Boolean(staff.is_employee),
    employmentType: staff.is_employee ? '社員' : 'アルバイト',
    shifts: {},
    assignedRoles: {},
    skills: splitList(staff.skills),
    assignedDays: 0,
    assignedHours: 0,
    weeklyTargetDays: staff.target_work_days ?? staff.weekly_target_days ?? undefined,
    monthlyTargetHours: staff.monthly_target_hours ?? (staff.is_employee ? monthlyTargetHours : undefined),
  }))

  return {
    input,
    staffList,
    scheduleStaff,
    staffIndexById: new Map(staffList.map((staff, index) => [staff.id, index])),
    requestMap,
    storeRange: toTimeRange(store.open_time, store.close_time),
    daysInMonth: new Date(targetYear, targetMonth, 0).getDate(),
    maxTime: tToF(store.close_time ?? undefined),
    rules: input.rules ?? DEFAULT_LABOR_RULES,
    previousShifts: new Map((input.previousMonth ?? []).map(person => [person.id, person.shifts])),
  }
}

/** Why the plan looks the way it does; also the basis for comparing plans. */
export type GenerationDecisions = {
  /** First pass: every slot with all eligible candidates (best first) and their score breakdowns. */
  slots: SlotDecision[]
  /** Later passes, in the order they were applied. */
  adjustments: Array<RelayAdjustment | EmployeeHoursAdjustment | NoviceRemoval>
  /** Opening / closing / 責任者 / 新人だけ requirements the finished schedule still misses, per day. */
  coverage: CoverageGap[]
  summary: {
    /** Slots fully uncovered after all passes (same as schedule.vacancyCount). */
    vacancyCount: number
    skillAlertCount: number
    /** Slots that had no eligible candidate in the first pass. */
    unfilledInFirstPass: number
    /** Sum of the winning candidates' total scores in the first pass. */
    totalSelectedScore: number
  }
}

export type ShiftPlan = {
  schedule: GeneratedSchedule
  decisions: GenerationDecisions
}

/**
 * Builds a month schedule. Pure: same input, same output; no I/O, no randomness.
 *
 * 1. assignInitialSlots   - day by day, best-scoring staff per slot
 * 2. fillGapsWithRelays   - extend colleagues' shifts into uncovered parts of slots
 * 3. balanceEmployeeHours - move employees toward their monthly hour target
 * 4. enforceCoverage      - hard novice rule; list missing opening / closing / 責任者 coverage
 */
export const generateShiftPlan = (input: GeneratorInput): ShiftPlan => {
  const context = createContext(input)
  const { scheduleStaff } = context

  const { assignmentsByDate, decisions: slotDecisions } = assignInitialSlots(context)
  const relayAdjustments = fillGapsWithRelays(context, assignmentsByDate)
  const employeeAdjustments = balanceEmployeeHours(context, assignmentsByDate)
  const { removals: noviceRemovals, gaps: coverageGaps } = enforceCoverage(context, assignmentsByDate)

  scheduleStaff.forEach(staff => {
    staff.assignedHours = actualHoursForShifts(staff.shifts)
  })
  const assignedHours = scheduleStaff.reduce((total, staff) => total + staff.assignedHours, 0)
  scheduleStaff.sort(compareStaffOrder)
  const requirements = Object.fromEntries([...assignmentsByDate].map(([date, dayData]) => [
    date,
    dayData.slots.map(slot => ({
      id: `${slot.group}_${slot.slotIndex}`,
      group: slot.group,
      role: jobForGroup(slot.group),
      start: slot.start,
      end: slot.end,
      staffId: slot.staffId,
      staffIds: [slot.staffId, ...slot.relayStaffIds].filter((staffId): staffId is string => Boolean(staffId)),
    })),
  ]))
  const schedule: GeneratedSchedule = {
    staff: scheduleStaff,
    vacancyCount: 0,
    assignedHours,
    alerts: [],
    requirements,
    skillOptions: parseSkillOptions(input.store.skill_options),
    operatingHours: context.storeRange || { start: tToF(input.store.open_time ?? undefined), end: context.maxTime },
  }
  schedule.alerts = calculateScheduleAlerts(schedule, input.targetMonth)
  schedule.vacancyCount = schedule.alerts.filter(alert => alert.type === 'vacancy').length

  return {
    schedule,
    decisions: {
      slots: slotDecisions,
      adjustments: [...relayAdjustments, ...employeeAdjustments, ...noviceRemovals],
      coverage: coverageGaps,
      summary: {
        vacancyCount: schedule.vacancyCount,
        skillAlertCount: schedule.alerts.filter(alert => alert.type === 'skill').length,
        unfilledInFirstPass: slotDecisions.filter(decision => decision.selectedStaffId === null).length,
        totalSelectedScore: slotDecisions.reduce((total, decision) => total + (decision.candidates[0]?.score ?? 0), 0),
      },
    },
  }
}

/** The schedule only (what the generate screen shows and saves). */
export const generateSchedule = (input: GeneratorInput): GeneratedSchedule => generateShiftPlan(input).schedule
