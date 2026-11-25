// 提出期限 of the monthly requests: "前月〇日" (a day of the previous month).
// Display only: submitting after it stays possible. Pure.

/** Store default when stores.request_deadline_day is not set (前月22日, the paper form). */
export const DEFAULT_REQUEST_DEADLINE_DAY = 22

export const isDeadlineDay = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31

/** The configured day, or the default. */
export const deadlineDayOf = (value: unknown): number => (isDeadlineDay(value) ? value : DEFAULT_REQUEST_DEADLINE_DAY)

/**
 * The deadline (YYYY-MM-DD) for requests of the month that starts at monthStart:
 * that day of the previous month, or its last day when the month is shorter.
 */
export const requestDeadlineDate = (monthStart: string, day: number): string => {
  const [year, month] = monthStart.split('-').map(Number)
  const previousYear = month === 1 ? year - 1 : year
  const previousMonth = month === 1 ? 12 : month - 1
  const lastDay = new Date(previousYear, previousMonth, 0).getDate()
  const clamped = Math.min(Math.max(1, day), lastDay)
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

/** 「1月22日」 */
export const formatDeadline = (date: string): string => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
