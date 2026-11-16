// Parsers for staff_requests.details. Shared by the dashboard UI and the
// server actions that apply approved requests, so both read them identically.

import { type WeeklyAvailability, parseWeeklyAvailability } from '@/lib/weekly-availability'

export type AvailableHours = {
  start: string
  end: string
}

export type ConditionChangeDetails = {
  weekly_target_days: number
  main_job: string
  memo: string
  skills?: string[]
  /** Older requests only (one time band). */
  available_hours?: AvailableHours | null
  weekly_availability?: WeeklyAvailability
}

export type NewStaffRegistrationDetails = {
  name: string
  employment_type: string
  main_job: string
  weekly_target_days: number
  work_start_1: string | null
  work_end_1: string | null
  work_start_2: string | null
  work_end_2: string | null
  /** Registrations made after weekday choices were introduced. */
  weekly_availability: WeeklyAvailability | null
  memo: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getConditionChangeDetails = (value: unknown): ConditionChangeDetails | null => {
  if (!isRecord(value)) return null
  const { weekly_target_days: weeklyTargetDays, main_job: mainJob, memo, skills, available_hours: hours } = value
  if (!(typeof weeklyTargetDays === 'number' && typeof mainJob === 'string' && typeof memo === 'string')) return null

  const parsedSkills = Array.isArray(skills) && skills.every((skill): skill is string => typeof skill === 'string')
    ? skills
    : undefined
  const availableHours = hours === null
    ? null
    : isRecord(hours) && typeof hours.start === 'string' && typeof hours.end === 'string'
      ? { start: hours.start, end: hours.end }
      : undefined

  let weeklyAvailability: WeeklyAvailability | undefined
  if (value.weekly_availability !== undefined) {
    const parsedWeekly = parseWeeklyAvailability(value.weekly_availability)
    if (!parsedWeekly) return null
    weeklyAvailability = parsedWeekly
  }

  return {
    weekly_target_days: weeklyTargetDays,
    main_job: mainJob,
    memo,
    skills: parsedSkills,
    available_hours: availableHours,
    ...(weeklyAvailability ? { weekly_availability: weeklyAvailability } : {}),
  }
}

export const getNewStaffRegistrationDetails = (value: unknown): NewStaffRegistrationDetails | null => {
  if (!isRecord(value)) return null
  const { name, employment_type: employmentType, main_job: mainJob, weekly_target_days: weeklyTargetDays, memo } = value
  if (!(typeof name === 'string' && typeof employmentType === 'string' &&
    typeof mainJob === 'string' && typeof weeklyTargetDays === 'number')) return null

  const nullableTime = (candidate: unknown): string | null | false =>
    typeof candidate === 'string' ? candidate : candidate === null || candidate === undefined ? null : false
  const times = [value.work_start_1, value.work_end_1, value.work_start_2, value.work_end_2].map(nullableTime)
  if (times.some(time => time === false)) return null
  const [workStart1, workEnd1, workStart2, workEnd2] = times as Array<string | null>

  return {
    name,
    employment_type: employmentType,
    main_job: mainJob,
    weekly_target_days: weeklyTargetDays,
    work_start_1: workStart1,
    work_end_1: workEnd1,
    work_start_2: workStart2,
    work_end_2: workEnd2,
    weekly_availability: parseWeeklyAvailability(value.weekly_availability),
    memo: typeof memo === 'string' ? memo : '',
  }
}
