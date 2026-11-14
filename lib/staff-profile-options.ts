// Option lists for staff profile forms. Shared by the client forms and the
// server-side validation so both accept exactly the same values.

export const TIME_OPTIONS: readonly string[] = Array.from({ length: 61 }, (_, index) => {
  const totalMinutes = 9 * 60 + index * 15
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
})

export const JOB_OPTIONS: readonly string[] = ['ホール', 'キッチン', '共通']

export const EMPLOYMENT_TYPE_OPTIONS: readonly string[] = ['アルバイト・パート', '社員']

export const WEEKLY_DAY_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6]

export const MAX_MEMO_LENGTH = 2_000
export const MAX_NAME_LENGTH = 50
