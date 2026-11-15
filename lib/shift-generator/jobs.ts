import type { GeneratedStaffShift } from './types'

export const getJobOptions = (mainJob: string | null | undefined, possibleGroups: string | null | undefined) => {
  const options = new Set<string>()
  const addJob = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'hd' || normalized === 'hn' || value.includes('ホール')) options.add('ホール')
    if (normalized === 'kd' || normalized === 'kn' || value.includes('キッチン')) options.add('キッチン')
    if (value.trim() && value !== '共通' && !['hd', 'hn', 'kd', 'kn'].includes(normalized) && !value.includes('ホール') && !value.includes('キッチン')) options.add(value.trim())
  }

  if (mainJob === '共通') {
    options.add('ホール')
    options.add('キッチン')
  } else if (mainJob) {
    addJob(mainJob)
  }
  ;(possibleGroups || '').split(',').filter(Boolean).forEach(addJob)
  return [...options]
}

export const jobForGroup = (group: string): 'ホール' | 'キッチン' | null => {
  const normalizedGroup = group.trim().toLowerCase()
  if (normalizedGroup === 'hd' || normalizedGroup === 'hn' || group.includes('ホール')) return 'ホール'
  if (normalizedGroup === 'kd' || normalizedGroup === 'kn' || group.includes('キッチン')) return 'キッチン'
  return null
}

export const labelForGroup = (group: string) => {
  const labels: Record<string, string> = {
    hd: 'ホール昼',
    hn: 'ホール夜',
    kd: 'キッチン昼',
    kn: 'キッチン夜',
  }
  return labels[group.trim().toLowerCase()] || group
}

export const isMultiRoleStaff = (staff: Pick<GeneratedStaffShift, 'mainJob' | 'jobOptions'>) => (
  staff.mainJob === '共通'
  || Boolean(staff.jobOptions?.includes('ホール') && staff.jobOptions.includes('キッチン'))
)

export const compareStaffOrder = (left: GeneratedStaffShift, right: GeneratedStaffShift) => {
  const roleOrder = (staff: GeneratedStaffShift) => isMultiRoleStaff(staff)
    ? 0
    : staff.mainJob === 'ホール'
      ? 1
      : staff.mainJob === 'キッチン'
        ? 2
        : 3
  return roleOrder(left) - roleOrder(right)
    || Number(right.isEmployee) - Number(left.isEmployee)
    || left.name.localeCompare(right.name, 'ja')
    || left.id.localeCompare(right.id)
}
