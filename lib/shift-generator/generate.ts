import { parseSkillOptions } from '@/lib/skill-options'
import { calculateScheduleAlerts } from './alerts'
import { compareStaffOrder, getJobOptions, jobForGroup } from './jobs'
import { getRequestedRange, isRequestUnavailable } from './requests'
import { actualHoursForShifts, calculateActualHours, fToT, shiftHoursFromLabel, tToF, toTimeRange } from './time'
import type { GeneratedSchedule, GeneratedStaffShift, GeneratorInput, ShiftRequest, StaffRecord, TimeRange } from './types'

/**
 * Builds a month schedule. Pure: same input, same output; no I/O, no randomness.
 * The body was moved verbatim from the generate screen; outer variables of the
 * former closure are bound below under their original names.
 */
export const generateSchedule = (input: GeneratorInput): GeneratedSchedule => {
  const {
    staff: staffData,
    requests,
    store: storeInfo,
    targetYear,
    targetMonth,
    groups,
    counts,
    slots,
    selectedSpecialDays,
    monthlyTargetHours,
    holidays: HOLIDAYS,
  } = input
  const minTime = tToF(storeInfo.open_time ?? undefined)
  const maxTime = tToF(storeInfo.close_time ?? undefined)

  const requestMap: Record<string, ShiftRequest> = {}
  requests.forEach((row) => {
    if (row.staff_id && row.date) requestMap[`${row.staff_id}_${row.date}`] = row
  })

  const storeRange = toTimeRange(storeInfo.open_time, storeInfo.close_time)
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()

  const staffList = (staffData || []) as StaffRecord[]
  const scheduleStaff: GeneratedStaffShift[] = staffList.map(staff => ({
    id: staff.id,
    name: staff.name,
    mainJob: staff.main_job || staff.role || '未設定',
    jobOptions: getJobOptions(staff.main_job || staff.role, staff.possible_groups),
    isEmployee: Boolean(staff.is_employee),
    employmentType: staff.is_employee ? '社員' : 'アルバイト',
    shifts: {},
    assignedRoles: {},
    skills: (staff.skills || '').split(',').map(skill => skill.trim()).filter(Boolean),
    assignedDays: 0,
    assignedHours: 0,
    weeklyTargetDays: staff.target_work_days ?? staff.weekly_target_days ?? undefined,
    monthlyTargetHours: staff.monthly_target_hours ?? (staff.is_employee ? monthlyTargetHours : undefined),
  }))
  let assignedHours = 0
  const consecutiveDays = new Map(staffList.map(staff => [staff.id, 0]))
  const skillOptions = parseSkillOptions(storeInfo.skill_options)
  const assignmentsByDate = new Map<string, {
    shifts: { staffId: string; start: number; end: number; skills: string[]; job: 'ホール' | 'キッチン' | null; slotKey: string }[]
    slots: { group: string; slotIndex: number; start: number; end: number; assigned: boolean; staffId: string | null; relayStaffIds: string[] }[]
    assignedStaffIds: Set<string>
  }>()

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()
    const configType = selectedSpecialDays.includes(dateStr)
      ? dateStr
      : weekDay === 0 || weekDay === 6 || HOLIDAYS[dateStr]
        ? 'we'
        : 'wd'
    const dailyAssignments = new Set<string>()

    staffList.forEach((staff, index) => {
      if (isRequestUnavailable(requestMap[`${staff.id}_${dateStr}`])) {
        scheduleStaff[index].shifts[dateStr] = '×'
      }
    })

    const dailyShifts: { staffId: string; start: number; end: number; skills: string[]; job: 'ホール' | 'キッチン' | null; slotKey: string }[] = []
    const dailySlots: { group: string; slotIndex: number; start: number; end: number; assigned: boolean; staffId: string | null; relayStaffIds: string[] }[] = []

    for (const group of groups) {
      const count = Math.max(0, counts[configType]?.[group] || 0)
      for (let slotIndex = 0; slotIndex < count; slotIndex++) {
        const slot = slots[configType]?.[`${group}_${slotIndex}`] || { start: 10, end: 18 }
        const slotEnd = slot.end < slot.start ? slot.end + 24 : slot.end
        const dailySlot = { group, slotIndex, start: slot.start, end: slotEnd, assigned: false, staffId: null as string | null, relayStaffIds: [] as string[] }
        dailySlots.push(dailySlot)
        const candidates: { index: number; priority: number; score: number; start: number; end: number }[] = []

        staffList.forEach((staff, index) => {
          const request = requestMap[`${staff.id}_${dateStr}`]
          if (isRequestUnavailable(request) || dailyAssignments.has(staff.id)) return
          if (staff.is_employee && scheduleStaff[index].assignedDays >= 22) return

          const possibleGroups = (staff.possible_groups || '').split(',').map(value => value.trim()).filter(Boolean)
          const groupJob = jobForGroup(group)
          const mainJob = staff.main_job || staff.role
          const matchesJob = mainJob === group
            || possibleGroups.includes(group)
            || Boolean(groupJob && (
              mainJob === groupJob
              || mainJob === '共通'
              || possibleGroups.includes(groupJob)
            ))
          if (!matchesJob) return

          const requestedRange = getRequestedRange(request)
          const workRange1 = toTimeRange(staff.work_start_1, staff.work_end_1)
          const workRange2 = toTimeRange(staff.work_start_2, staff.work_end_2)
          const hasStaffTimeRange = Boolean(requestedRange || workRange1 || workRange2)
          const availableRanges = requestedRange
            ? [{ range: requestedRange, priority: 0 }]
            : [
                ...(workRange1 ? [{ range: workRange1, priority: 0 }] : []),
                ...(workRange2 ? [{ range: workRange2, priority: 1 }] : []),
                ...(!hasStaffTimeRange && storeRange ? [{ range: storeRange, priority: 2 }] : []),
              ]
          const matchingRange = availableRanges
            .map(({ range, priority }) => {
              const start = Math.max(slot.start, range.start)
              const end = Math.min(slotEnd, range.end)
              const shortfall = (slotEnd - slot.start) - Math.max(0, end - start)
              return { start, end, priority, shortfall }
            })
            .filter(range => range.end > range.start && range.shortfall <= 2)
            .sort((left, right) => left.shortfall - right.shortfall || left.priority - right.priority)[0]
          if (matchingRange) {
            const targetRate = ((staff.target_work_days ?? staff.weekly_target_days ?? 0) * 4) / daysInMonth
            const previousDays = day - 1
            const currentRate = previousDays > 0 ? scheduleStaff[index].assignedDays / previousDays : 0
            const attendanceScore = (targetRate - currentRate) * 100
            const rescueBoostScore = targetRate > 0 && currentRate < targetRate * 0.5 ? 250 : 0
            const targetMonthDays = ((staff.target_work_days ?? staff.weekly_target_days ?? 0) / 7) * daysInMonth
            const excessWorkDays = targetMonthDays > 0
              ? Math.max(0, scheduleStaff[index].assignedDays + 1 - targetMonthDays)
              : 0
            const overTargetPenalty = excessWorkDays * -150
            const wouldReachThreeConsecutiveDays = (consecutiveDays.get(staff.id) || 0) + 1 >= 3
            const streakScore = wouldReachThreeConsecutiveDays ? -500 : 0
            const rankScore = staff.rank === 'A' ? 30 : staff.rank === 'B' ? 20 : 0
            const assignedRankScores = dailyShifts
              .filter(shift => shift.start < slotEnd && shift.end > slot.start)
              .map(shift => {
                const assignedStaff = staffList.find(person => person.id === shift.staffId)
                return assignedStaff?.rank === 'A' ? 30 : assignedStaff?.rank === 'B' ? 20 : 0
              })
            const averageRankScore = assignedRankScores.length > 0
              ? assignedRankScores.reduce<number>((total, score) => total + score, 0) / assignedRankScores.length
              : 0
            const rankMultiplier = averageRankScore < 20 ? 3 : 1
            const rankAdjustedScore = rankScore * rankMultiplier
            const timeShortfallPenalty = -Math.round(matchingRange.shortfall / 0.25) * 15
            const date = new Date(`${dateStr}T00:00:00`)
            const isWeekendOrHoliday = date.getDay() === 0 || date.getDay() === 6 || Boolean(HOLIDAYS[dateStr])
            const previousWeekendShifts = isWeekendOrHoliday
              ? Object.entries(scheduleStaff[index].shifts).filter(([assignedDate, assignedShift]) => {
                  const assignedDay = new Date(`${assignedDate}T00:00:00`).getDay()
                  return assignedDate < dateStr
                    && shiftHoursFromLabel(assignedShift) > 0
                    && (assignedDay === 0 || assignedDay === 6 || Boolean(HOLIDAYS[assignedDate]))
                }).length
              : 0
            const weekendFatiguePenalty = previousWeekendShifts * -30
            candidates.push({
              index,
              priority: matchingRange.priority,
              start: matchingRange.start,
              end: matchingRange.end,
              score: attendanceScore + rescueBoostScore + overTargetPenalty + streakScore + rankAdjustedScore + timeShortfallPenalty + weekendFatiguePenalty,
            })
          }
        })

        candidates.sort((left, right) =>
          right.score - left.score || left.priority - right.priority || left.index - right.index
        )
        const candidateIndex = candidates[0]?.index ?? -1

        if (candidateIndex < 0) {
          continue
        }

        const selectedCandidate = candidates[0]
        if (!selectedCandidate) continue
        const assignedStaff = staffList[candidateIndex]
        const assignedRow = scheduleStaff[candidateIndex]
        const assignedRole = jobForGroup(group)
        dailyAssignments.add(assignedStaff.id)
        dailySlot.assigned = true
        dailySlot.staffId = assignedStaff.id
        dailyShifts.push({
          staffId: assignedStaff.id,
          start: selectedCandidate.start,
          end: selectedCandidate.end,
          skills: (assignedStaff.skills || '').split(',').map(skill => skill.trim()).filter(Boolean),
          job: assignedRole,
          slotKey: `${group}_${slotIndex}`,
        })
        assignedRow.shifts[dateStr] = `${fToT(selectedCandidate.start)}-${fToT(selectedCandidate.end)}`
        if (assignedRole) assignedRow.assignedRoles![dateStr] = assignedRole
        assignedRow.assignedDays++
        const slotHours = calculateActualHours(selectedCandidate.start, selectedCandidate.end)
        assignedRow.assignedHours += slotHours
        assignedHours += slotHours
      }
    }

    assignmentsByDate.set(dateStr, {
      shifts: dailyShifts,
      slots: dailySlots,
      assignedStaffIds: dailyAssignments,
    })

    staffList.forEach(staff => {
      consecutiveDays.set(
        staff.id,
        dailyAssignments.has(staff.id) ? (consecutiveDays.get(staff.id) || 0) + 1 : 0
      )
    })
  }

  const staffIndexById = new Map(staffList.map((staff, index) => [staff.id, index]))
  const employeeTarget = (staff: StaffRecord) => staff.monthly_target_hours ?? monthlyTargetHours
  const canWorkSlot = (staff: StaffRecord, dateStr: string, slot: { group: string; start: number; end: number }) => {
    const request = requestMap[`${staff.id}_${dateStr}`]
    if (isRequestUnavailable(request)) return false
    const possibleGroups = (staff.possible_groups || '').split(',').map(value => value.trim()).filter(Boolean)
    const job = jobForGroup(slot.group)
    const mainJob = staff.main_job || staff.role
    const matchesJob = mainJob === slot.group
      || possibleGroups.includes(slot.group)
      || Boolean(job && (
        mainJob === job
        || mainJob === '共通'
        || possibleGroups.includes(job)
      ))
    if (!matchesJob) return false

    const requestedRange = getRequestedRange(request)
    const workRanges = [
      toTimeRange(staff.work_start_1, staff.work_end_1),
      toTimeRange(staff.work_start_2, staff.work_end_2),
    ].filter((range): range is TimeRange => range !== null)
    const availableRanges = requestedRange ? [requestedRange] : workRanges.length > 0 ? workRanges : storeRange ? [storeRange] : []
    return availableRanges.some(range => range.start <= slot.start && range.end >= slot.end)
  }

  for (const [dateStr, dayData] of assignmentsByDate) {
    for (const targetSlot of dayData.slots) {
      const role = jobForGroup(targetSlot.group)
      if (!role) continue
      const slotKey = `${targetSlot.group}_${targetSlot.slotIndex}`
      const assignedShift = dayData.shifts.find(shift => shift.slotKey === slotKey)
      const gaps = assignedShift
        ? [
            { start: targetSlot.start, end: Math.min(assignedShift.start, targetSlot.end) },
            { start: Math.max(assignedShift.end, targetSlot.start), end: targetSlot.end },
          ].filter(gap => gap.end - gap.start > 0.001)
        : [{ start: targetSlot.start, end: targetSlot.end }]

      for (const gap of gaps) {
        const relayCandidates = dayData.shifts
          .filter(shift => shift.job === role && shift.staffId !== assignedShift?.staffId)
          .map(shift => {
            const staffIndex = staffIndexById.get(shift.staffId)
            const staff = staffIndex === undefined ? undefined : staffList[staffIndex]
            const row = staffIndex === undefined ? undefined : scheduleStaff[staffIndex]
            const ownSlot = dayData.slots.find(slot => slot.staffId === shift.staffId)
            const extendsAfter = Math.abs(shift.end - gap.start) <= 0.001
            const extendsBefore = Math.abs(shift.start - gap.end) <= 0.001
            const conflictsWithAnotherSlot = dayData.slots.some(slot =>
              slot !== targetSlot
              && (slot.staffId === shift.staffId || slot.relayStaffIds.includes(shift.staffId))
              && slot.start < gap.end
              && slot.end > gap.start
            )
            if (
              !staff
              || !row
              || !ownSlot
              || (!extendsAfter && !extendsBefore)
              || conflictsWithAnotherSlot
            ) return null

            const start = extendsBefore ? gap.start : shift.start
            const end = extendsAfter ? gap.end : shift.end
            if (!canWorkSlot(staff, dateStr, { group: ownSlot.group, start, end })) return null
            return { staff, row, shift, start, end }
          })
          .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
          .sort((left, right) => left.staff.name.localeCompare(right.staff.name, 'ja') || left.staff.id.localeCompare(right.staff.id))

        const relay = relayCandidates[0]
        if (!relay) continue
        relay.shift.start = relay.start
        relay.shift.end = relay.end
        relay.row.shifts[dateStr] = `${fToT(relay.start)}-${fToT(relay.end)}`
        relay.row.assignedHours = actualHoursForShifts(relay.row.shifts)
        if (!targetSlot.relayStaffIds.includes(relay.staff.id)) targetSlot.relayStaffIds.push(relay.staff.id)
      }
    }
  }

  while (true) {
    const employeesBelowTarget = staffList
      .map((staff, index) => ({ staff, row: scheduleStaff[index] }))
      .filter(({ staff, row }) => staff.is_employee && row.assignedHours < employeeTarget(staff))
      .sort((left, right) =>
        (employeeTarget(right.staff) - right.row.assignedHours)
        - (employeeTarget(left.staff) - left.row.assignedHours)
      )
    if (employeesBelowTarget.length === 0) break

    let progress = false
    for (const { staff: employee, row: employeeRow } of employeesBelowTarget) {
      const employeeIndex = staffIndexById.get(employee.id)
      if (employeeIndex === undefined) continue
      let employeeProgress = false

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
            ||
            !partTimeStaff
            || partTimeStaff.is_employee
            || !partTimeShift
            || !canWorkSlot(employee, dateStr, longerSlot)
            || !canWorkSlot(partTimeStaff, dateStr, employeeSlot)
          ) continue

          const partTimeRow = scheduleStaff[partTimeIndex]
          const employeeSkillSet = (employee.skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
          const partTimeSkillSet = (partTimeStaff.skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
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
          employeeProgress = true
          break
        }
        if (employeeProgress) break
      }

      if (!employeeProgress && employeeRow.assignedDays < 22) {
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
            .filter((candidate): candidate is typeof candidate & { staff: StaffRecord; row: GeneratedStaffShift } =>
              Boolean(candidate.staff && candidate.row && !candidate.staff.is_employee)
            )
            .sort((left, right) => Number(right.daysAtTarget) - Number(left.daysAtTarget))

          for (const { slot, staff: partTimeStaff, row: partTimeRow } of partTimeSlots) {
            if (!canWorkSlot(employee, dateStr, slot)) continue
            const shift = dayData.shifts.find(item => item.slotKey === `${slot.group}_${slot.slotIndex}`)
            if (!shift) continue
            shift.staffId = employee.id
            shift.skills = (employee.skills || '').split(',').map(skill => skill.trim()).filter(Boolean)
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
            employeeProgress = true
            break
          }
          if (employeeProgress) break
        }
      }

      if (!employeeProgress) {
        const maxShiftHours = 10
        for (const [dateStr, dayData] of assignmentsByDate) {
          const shift = dayData.shifts.find(item => item.staffId === employee.id)
          if (!shift) continue
          const slot = dayData.slots.find(item => item.staffId === employee.id)
          if (!slot) continue
          const request = requestMap[`${employee.id}_${dateStr}`]
          if (isRequestUnavailable(request)) continue
          const requestedRange = getRequestedRange(request)
          const workRanges = [
            toTimeRange(employee.work_start_1, employee.work_end_1),
            toTimeRange(employee.work_start_2, employee.work_end_2),
          ].filter((range): range is TimeRange => range !== null)
          const availableRanges = requestedRange ? [requestedRange] : workRanges.length > 0 ? workRanges : storeRange ? [storeRange] : []
          const extensionRanges = availableRanges.filter(range => range.start <= slot.start && range.end >= shift.end)
          if (extensionRanges.length === 0) continue
          const availableEnd = Math.min(
            storeRange?.end ?? maxTime,
            shift.start + maxShiftHours,
            Math.max(...extensionRanges.map(range => range.end))
          )
          const currentShiftHours = calculateActualHours(shift.start, shift.end)
          const otherShiftHours = employeeRow.assignedHours - currentShiftHours
          let lowerEnd = shift.end
          let upperEnd = availableEnd
          for (let attempt = 0; attempt < 32; attempt++) {
            const candidateEnd = (lowerEnd + upperEnd) / 2
            const candidateHours = otherShiftHours + calculateActualHours(shift.start, candidateEnd)
            if (candidateHours <= employeeTarget(employee)) lowerEnd = candidateEnd
            else upperEnd = candidateEnd
          }
          if (lowerEnd - shift.end <= 0.01) continue
          shift.end = lowerEnd
          slot.end = Math.max(slot.end, lowerEnd)
          employeeRow.shifts[dateStr] = `${fToT(shift.start)}-${fToT(shift.end)}`
          employeeRow.assignedHours = actualHoursForShifts(employeeRow.shifts)
          employeeProgress = true
          break
        }
      }

      if (employeeProgress) {
        progress = true
        break
      }
    }
    if (!progress) break
  }

  scheduleStaff.forEach(staff => {
    staff.assignedHours = actualHoursForShifts(staff.shifts)
  })
  assignedHours = scheduleStaff.reduce((total, staff) => total + staff.assignedHours, 0)
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
    skillOptions,
    operatingHours: storeRange || { start: minTime, end: maxTime },
  }
  schedule.alerts = calculateScheduleAlerts(schedule, targetMonth)
  schedule.vacancyCount = schedule.alerts.filter(alert => alert.type === 'vacancy').length
  return schedule
}
