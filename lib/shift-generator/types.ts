// Data shapes used by the shift generator and the generate screen.

export type JobRole = 'ホール' | 'キッチン'

export type ShiftRequirement = {
  id: string
  group: string
  role: JobRole | null
  start: number
  end: number
  staffId?: string | null
  staffIds?: string[]
}

export type GeneratedStaffShift = {
  id: string
  name: string
  mainJob: string
  jobOptions?: string[]
  isEmployee: boolean
  employmentType: string
  shifts: Record<string, string>
  assignedRoles?: Record<string, JobRole>
  skills?: string[]
  assignedDays: number
  assignedHours: number
  weeklyTargetDays?: number
  monthlyTargetHours?: number
}

export type GeneratedSchedule = {
  staff: GeneratedStaffShift[]
  vacancyCount: number
  assignedHours: number
  alerts: ScheduleAlert[]
  requirements?: Record<string, ShiftRequirement[]>
  skillOptions?: string[]
  operatingHours?: { start: number; end: number } | null
}

export type ScheduleAlert = {
  id: string
  type: 'vacancy' | 'skill'
  message: string
}

export type StaffRecord = {
  id: string
  name: string
  role?: string | null
  rank?: string | null
  weekly_target_days?: number | null
  target_work_days?: number | null
  monthly_target_hours?: number | null
  skills?: string | null
  is_employee?: boolean | null
  main_job?: string | null
  possible_groups?: string | null
  work_start_1?: string | null
  work_end_1?: string | null
  work_start_2?: string | null
  work_end_2?: string | null
}

export type ShiftRequest = {
  id?: string
  staff_id?: string | null
  date?: string | null
  is_off?: boolean | null
  start_time?: string | null
  end_time?: string | null
  memo?: string | null
  parsed_request?: unknown
}

export type TimeRange = {
  start: number
  end: number
}

/** Store columns the generator reads. */
export type GeneratorStore = {
  open_time?: string | null
  close_time?: string | null
  skill_options?: unknown
}

/** Everything the generator depends on. It performs no I/O and has no hidden state. */
export type GeneratorInput = {
  staff: StaffRecord[]
  /** Requests of the target month, with parsed_request already filled in where available. */
  requests: ShiftRequest[]
  store: GeneratorStore
  targetYear: number
  /** 1-12 */
  targetMonth: number
  groups: string[]
  counts: Record<string, Record<string, number>>
  slots: Record<string, Record<string, { start: number; end: number }>>
  selectedSpecialDays: string[]
  monthlyTargetHours: number
  /** YYYY-MM-DD -> holiday name. Weekends are detected separately. */
  holidays: Readonly<Record<string, string>>
}
