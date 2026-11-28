// 提出期限 of the monthly requests. Pure; every calculation is in Japan time
// (Asia/Tokyo, UTC+9 all year), whatever the server or browser time zone is.
//
//   monthly setting   stores.request_deadline_day / request_deadline_time:
//                     "前月〇日 〇時まで" for every month (the day is clamped to
//                     the previous month's last day).
//   this month only   store_request_deadline_overrides.deadline_at wins for its month.
//   neither           no deadline: nothing is locked.
//
// "21:00まで" means up to and including 21:00:00.000; one millisecond later the
// month is closed for part-timers.

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** Time used when only the day is set (stores.request_deadline_time default). */
export const DEFAULT_REQUEST_DEADLINE_TIME = '23:59'

/** "前月〇日 HH:MM まで". */
export type DeadlineSetting = { day: number; time: string }

/** The deadline that applies to one month: an instant (ISO, UTC) and where it comes from. */
export type RequestDeadline = { at: string; source: 'monthly' | 'override' }

export const isDeadlineDay = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31

/** Times offered when editing: every 15 minutes, plus 23:59 (the default, "その日のうち"). */
export const DEADLINE_TIME_CHOICES: readonly string[] = [
  ...Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`),
  DEFAULT_REQUEST_DEADLINE_TIME,
]

export const isDeadlineTime = (value: unknown): value is string =>
  typeof value === 'string' && DEADLINE_TIME_CHOICES.includes(value)

/**
 * The store's monthly setting from its columns, or null when no day is set.
 * A time column reads back as HH:MM:SS; a missing or odd time falls back to 23:59.
 */
export const deadlineSettingOf = (day: unknown, time: unknown): DeadlineSetting | null => {
  if (!isDeadlineDay(day)) return null
  const hhmm = typeof time === 'string' ? time.slice(0, 5) : ''
  return { day, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm) ? hhmm : DEFAULT_REQUEST_DEADLINE_TIME }
}

const previousMonthOf = (monthStart: string) => {
  const [year, month] = monthStart.split('-').map(Number)
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

/**
 * The deadline date (YYYY-MM-DD) for the month that starts at monthStart: that
 * day of the previous month, or its last day when the month is shorter.
 */
export const requestDeadlineDate = (monthStart: string, day: number): string => {
  const { year, month } = previousMonthOf(monthStart)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const clamped = Math.min(Math.max(1, day), lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

/** The instant (ISO, UTC) of "前月〇日 HH:MM" in Japan time for the month that starts at monthStart. */
export const deadlineInstant = (monthStart: string, setting: DeadlineSetting): string => {
  const [year, month, day] = requestDeadlineDate(monthStart, setting.day).split('-').map(Number)
  const [hour, minute] = setting.time.split(':').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS).toISOString()
}

/** The override wins; otherwise the monthly setting; otherwise no deadline. */
export const resolveRequestDeadline = (monthStart: string, monthly: DeadlineSetting | null, overrideAt: string | null): RequestDeadline | null => {
  if (overrideAt && Number.isFinite(Date.parse(overrideAt))) return { at: new Date(overrideAt).toISOString(), source: 'override' }
  if (monthly) return { at: deadlineInstant(monthStart, monthly), source: 'monthly' }
  return null
}

/** Strictly after the deadline (the deadline minute itself is still open). */
export const isDeadlinePassed = (at: string, now: number): boolean => now > Date.parse(at)

/** Japan-time date (YYYY-MM-DD) and time (HH:MM) of an instant. */
export const japanParts = (instant: string | number): { date: string; time: string } => {
  const iso = new Date((typeof instant === 'number' ? instant : Date.parse(instant)) + JST_OFFSET_MS).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
}

/** 「11月20日（金）21:00」 */
export const formatDeadlineAt = (at: string): string => {
  const { date, time } = japanParts(at)
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${WEEKDAYS[weekday]}）${time}`
}

/** 「1月22日」 */
export const formatDeadline = (date: string): string => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`

export type DeadlineStatus = {
  kind: 'days' | 'tomorrow' | 'today' | 'closed'
  /** Calendar days (Japan time) from today to the deadline day; 0 on the day. */
  daysLeft: number
  /** From 3 days before up to the deadline itself: shown a little stronger. */
  urgent: boolean
  /** 「あと3日」「明日 21:00 まで」「今日 21:00 まで」「締め切りました（閲覧のみ）」 */
  label: string
}

export const deadlineStatus = (at: string, now: number): DeadlineStatus => {
  const deadline = japanParts(at)
  const daysLeft = Math.round((Date.parse(`${deadline.date}T00:00:00Z`) - Date.parse(`${japanParts(now).date}T00:00:00Z`)) / DAY_MS)
  if (isDeadlinePassed(at, now)) return { kind: 'closed', daysLeft, urgent: false, label: '締め切りました（閲覧のみ）' }
  const urgent = daysLeft <= 3
  if (daysLeft <= 0) return { kind: 'today', daysLeft, urgent, label: `今日 ${deadline.time} まで` }
  if (daysLeft === 1) return { kind: 'tomorrow', daysLeft, urgent, label: `明日 ${deadline.time} まで` }
  return { kind: 'days', daysLeft, urgent, label: `あと ${daysLeft} 日` }
}

/** Shown to part-timers on a closed month, and the reason a save is refused. */
export const DEADLINE_LOCKED_MESSAGE = '提出期限を過ぎたため閲覧のみです。変更は店長に相談してください。'
