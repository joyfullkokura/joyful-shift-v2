import { labelForGroup } from './jobs'
import { formatAlertTime, shiftRangeFromLabel } from './time'
import type { GeneratedSchedule, JobRole, ScheduleAlert, TimeRange } from './types'

export const calculateScheduleAlerts = (schedule: GeneratedSchedule, targetMonth: number): ScheduleAlert[] => {
  if (!schedule.requirements) return schedule.alerts
  const alerts: ScheduleAlert[] = []
  const requirementsByDate = schedule.requirements || {}
  const skillOptions = schedule.skillOptions || []
  const operatingStart = schedule.operatingHours?.start ?? 0
  const operatingEnd = schedule.operatingHours?.end ?? 24
  const skillsByRole: { role: JobRole; skills: string[] }[] = [
    { role: 'ホール', skills: skillOptions.filter(skill => skill.startsWith('[H]')) },
    { role: 'キッチン', skills: skillOptions.filter(skill => skill.startsWith('[K]')) },
  ]

  Object.entries(requirementsByDate).forEach(([date, requirements]) => {
    const shiftDetails = schedule.staff.map(staff => ({
      staff,
      range: shiftRangeFromLabel(staff.shifts[date] || ''),
      role: staff.assignedRoles?.[date]
        || (staff.mainJob === 'ホール' || staff.mainJob === 'キッチン'
          ? staff.mainJob
          : requirements.find(requirement => requirement.staffId === staff.id)?.role || null),
    }))

    requirements.forEach(requirement => {
      const assignedIds = requirement.staffIds || (requirement.staffId ? [requirement.staffId] : [])
      const ranges = shiftDetails
        .filter(({ staff, role }) => assignedIds.includes(staff.id) && (!requirement.role || role === requirement.role))
        .map(({ range }) => range)
        .filter((range): range is TimeRange => range !== null)
        .sort((left, right) => left.start - right.start)
      let coveredUntil = requirement.start
      ranges.forEach(range => {
        if (range.start <= coveredUntil + 0.001) coveredUntil = Math.max(coveredUntil, range.end)
      })
      const covered = coveredUntil >= requirement.end - 0.001
      if (!covered) {
        const day = Number(date.slice(-2))
        alerts.push({
          id: `${date}-${requirement.id}-vacancy`,
          type: 'vacancy',
          message: `${targetMonth}/${String(day).padStart(2, '0')} ${formatAlertTime(requirement.start)}-${formatAlertTime(requirement.end)} ${labelForGroup(requirement.group)} 1枠欠員`,
        })
      }
    })

    const missingIntervals = new Map<string, { role: JobRole; start: number; end: number }[]>()
    for (let intervalStart = operatingStart; intervalStart < operatingEnd; intervalStart += 0.5) {
      const intervalEnd = Math.min(intervalStart + 0.5, operatingEnd)
      skillsByRole.forEach(({ role, skills }) => skills.forEach(skill => {
        if (skill.includes('レジ締め') && role === 'ホール') return
        const covered = shiftDetails.some(({ staff, range, role: assignedRole }) =>
          assignedRole === role
          && Boolean(range && range.start <= intervalStart && range.end >= intervalEnd)
          && Boolean(staff.skills?.includes(skill))
        )
        if (covered) return
        const ranges = missingIntervals.get(skill) || []
        const previous = ranges[ranges.length - 1]
        if (previous && previous.role === role && Math.abs(previous.end - intervalStart) < 0.001) previous.end = intervalEnd
        else ranges.push({ role, start: intervalStart, end: intervalEnd })
        missingIntervals.set(skill, ranges)
      }))
    }

    const grouped = new Map<string, { role: JobRole; start: number; end: number; skills: string[] }>()
    missingIntervals.forEach((ranges, skill) => ranges.forEach(({ role, start, end }) => {
      const key = `${role}-${start}-${end}`
      const entry = grouped.get(key) || { role, start, end, skills: [] }
      entry.skills.push(skill)
      grouped.set(key, entry)
    }))
    grouped.forEach(({ role, start, end, skills }, index) => {
      const day = Number(date.slice(-2))
      alerts.push({
        id: `${date}-skills-${index}`,
        type: 'skill',
        message: `${targetMonth}/${String(day).padStart(2, '0')} ${formatAlertTime(start)}-${formatAlertTime(end)} ${role}: スキル不足 (${skills.join(', ')})`,
      })
    })

    const closingSkill = skillOptions.find(skill => skill.includes('レジ締め') && !skill.startsWith('[K]'))
    const lastHallEnd = requirements
      .filter(requirement => requirement.role === 'ホール')
      .reduce((latestEnd, requirement) => Math.max(latestEnd, requirement.end), Number.NEGATIVE_INFINITY)
    if (closingSkill && Number.isFinite(lastHallEnd)) {
      const hasClosingStaff = shiftDetails.some(({ staff, range, role }) =>
        role === 'ホール'
        && Boolean(range && range.start <= lastHallEnd && range.end >= lastHallEnd)
        && Boolean(staff.skills?.some(skill => skill.replace(/^\[H\]\s*/, '').includes('レジ締め')))
      )
      if (!hasClosingStaff) {
        const day = Number(date.slice(-2))
        alerts.push({
          id: `${date}-skills-register-closing`,
          type: 'skill',
          message: `${targetMonth}/${String(day).padStart(2, '0')} ラスト スキル不足 (${closingSkill.startsWith('[H]') ? closingSkill : `[H]${closingSkill}`})`,
        })
      }
    }
  })

  return alerts
}
