// Shapes shared between server actions and client components.
// None of these ever carry pin_hash.

/** The logged-in staff member as resolved from the server-verified session. */
export type SessionStaff = {
  id: string
  name: string
  is_employee: boolean
}

/** Profile values used to pre-fill the first-time setup form. */
export type SetupDefaults = {
  weekly_target_days: number | null
  main_job: string | null
  work_start_1: string | null
  work_end_1: string | null
  work_start_2: string | null
  work_end_2: string | null
  memo: string | null
}

/** One entry of the pre-login name picker. */
export type LoginMember = {
  id: string
  name: string
  hasPin: boolean
  /** Only present for members without a PIN (they will see the setup form). */
  setupDefaults: SetupDefaults | null
}

export type SetupProfileInput = {
  weekly_target_days: number
  main_job: string
  wants_employee: boolean
  work_start_1: string
  work_end_1: string
  work_start_2: string | null
  work_end_2: string | null
  memo: string
}

export type NewStaffRegistrationInput = {
  name: string
  pin: string
  employment_type: string
  main_job: string
  weekly_target_days: number
  work_start_1: string | null
  work_end_1: string | null
  work_start_2: string | null
  work_end_2: string | null
  memo: string
}

export type ActionFailure = { status: 'error'; message: string }

export type PinCheckResult =
  | { status: 'ok' }
  | { status: 'mismatch' }
  | { status: 'locked'; retryAfterMinutes: number }
  | { status: 'unavailable' }
  | ActionFailure

export type LoginResult =
  | { status: 'ok'; staff: SessionStaff }
  | Exclude<PinCheckResult, { status: 'ok' }>

export type SetupResult =
  | { status: 'ok'; staff: SessionStaff; employeeRequestPending: boolean }
  | { status: 'locked'; retryAfterMinutes: number }
  | { status: 'unavailable' }
  | ActionFailure

export type SimpleResult = { status: 'ok' } | { status: 'locked'; retryAfterMinutes: number } | ActionFailure
