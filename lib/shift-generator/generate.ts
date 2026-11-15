import { parseSkillOptions } from '@/lib/skill-options'
import { calculateScheduleAlerts } from './alerts'
import { assignInitialSlots } from './assign'
import { splitList, type GenerationContext } from './context'
import { balanceEmployeeHours } from './employee-hours'
import { compareStaffOrder, getJobOptions, jobForGroup } from './jobs'
import { fillGapsWithRelays } from './relay'
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
  }
}

/**
 * Builds a month schedule. Pure: same input, same output; no I/O, no randomness.
 *
 * 1. assignInitialSlots   - day by day, best-scoring staff per slot
 * 2. fillGapsWithRelays   - extend colleagues' shifts into uncovered parts of slots
 * 3. balanceEmployeeHours - move employees toward their monthly hour target
 */
export const generateSchedule = (input: GeneratorInput): GeneratedSchedule => {
  const context = createContext(input)
  const { scheduleStaff } = context

  const { assignmentsByDate } = assignInitialSlots(context)
  fillGapsWithRelays(context, assignmentsByDate)
  balanceEmployeeHours(context, assignmentsByDate)

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
  return schedule
}
