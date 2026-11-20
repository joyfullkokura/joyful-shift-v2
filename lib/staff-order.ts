// Staff order of every screen and the Excel sheet, matching the paper 休日申込表:
// category (社員 → DF → DK → LF → LK), then display_order inside the category,
// then name. People without a category come after LK. Pure.

import { timeToMinutes, toDayRequest } from '@/lib/day-request'
import { WEEKDAY_KEYS, parseWeeklyAvailability } from '@/lib/weekly-availability'

export const STAFF_CATEGORIES = ['社員', 'DF', 'DK', 'LF', 'LK'] as const
export type StaffCategory = (typeof STAFF_CATEGORIES)[number]

/** D = ディナー, L = ランチ, F = フロア, K = キッチン. */
export const STAFF_CATEGORY_LABELS: Record<StaffCategory, string> = {
  社員: '社員',
  DF: 'DF（ディナー・フロア）',
  DK: 'DK（ディナー・キッチン）',
  LF: 'LF（ランチ・フロア）',
  LK: 'LK（ランチ・キッチン）',
}

export const isStaffCategory = (value: unknown): value is StaffCategory =>
  typeof value === 'string' && (STAFF_CATEGORIES as readonly string[]).includes(value)

export type OrderableStaff = { id: string; name: string; category?: unknown; display_order?: unknown }

const categoryIndex = (value: unknown) => {
  const index = isStaffCategory(value) ? STAFF_CATEGORIES.indexOf(value) : -1
  return index === -1 ? STAFF_CATEGORIES.length : index
}

const orderValue = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY)

export const compareStaffOrder = (left: OrderableStaff, right: OrderableStaff): number =>
  categoryIndex(left.category) - categoryIndex(right.category)
  || (orderValue(left.display_order) === orderValue(right.display_order) ? 0 : orderValue(left.display_order) < orderValue(right.display_order) ? -1 : 1)
  || left.name.localeCompare(right.name, 'ja')
  || left.id.localeCompare(right.id)

export const sortStaff = <T extends OrderableStaff>(staff: readonly T[]): T[] => [...staff].sort(compareStaffOrder)

/** id → position (0-based) in the store order, for sorting rows that only carry an id (saved schedules). */
export type StaffRank = Record<string, number>

export const staffRankOf = (staff: readonly OrderableStaff[]): StaffRank =>
  Object.fromEntries(sortStaff(staff).map((person, index) => [person.id, index]))

/** Sorts rows by the store order; rows of people no longer on the roster go last, by name. */
export const sortByRank = <T extends { id: string; name: string }>(rows: readonly T[], rank: StaffRank): T[] =>
  [...rows].sort((left, right) => {
    const leftRank = rank[left.id] ?? Number.POSITIVE_INFINITY
    const rightRank = rank[right.id] ?? Number.POSITIVE_INFINITY
    if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1
    return left.name.localeCompare(right.name, 'ja') || left.id.localeCompare(right.id)
  })

export type CategorySuggestionInput = {
  /** 社員 when the person registered / works as an employee. */
  isEmployee: boolean
  main_job?: unknown
  weekly_availability?: unknown
  work_start_1?: unknown
}

const EVENING_START = 16 * 60

/**
 * Suggested category (approving a registration; the initial SQL uses the same
 * rule): 社員 for employees; otherwise F / K from the main job and D / L from
 * the weekday times (D when most available weekdays start at 16:00 or later),
 * or from time band 1 when there are no weekday times.
 */
export const suggestCategory = (input: CategorySuggestionInput): StaffCategory => {
  if (input.isEmployee) return '社員'
  const job = input.main_job === 'キッチン' ? 'K' : 'F'
  const weekly = parseWeeklyAvailability(input.weekly_availability)
  let dinner: boolean
  if (weekly) {
    const available = WEEKDAY_KEYS.filter(day => weekly[day].kind !== 'off')
    const evening = available.filter(day => {
      const request = weekly[day]
      if (request.kind !== 'from' && request.kind !== 'range') return false
      const start = timeToMinutes(request.start)
      return start !== null && start >= EVENING_START
    })
    dinner = available.length > 0 && evening.length * 2 > available.length
  } else {
    const start = timeToMinutes(toDayRequest('from', input.work_start_1, null)?.start ?? null)
    dinner = start !== null && start >= EVENING_START
  }
  return `${dinner ? 'D' : 'L'}${job}` as StaffCategory
}
