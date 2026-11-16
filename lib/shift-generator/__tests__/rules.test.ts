import { describe, expect, it } from 'vitest'
import { EMPLOYEE_MAX_DAYS } from '../context'
import { generateShiftPlan } from '../generate'
import {
  OVER_TARGET_PENALTY_PER_DAY,
  RESCUE_BOOST,
  STREAK_PENALTY,
  WEEKEND_FAIRNESS_PENALTY_PER_SHIFT,
  scoreCandidate,
  type CandidateFactors,
} from '../scoring'
import { actualHoursForShifts, calculateActualHours, shiftHoursFromLabel } from '../time'
import type { ShiftRequest } from '../types'
import { dateKey, hallInput, staffMember, workedDates } from './fixtures/builders'

const factors = (overrides: Partial<CandidateFactors>): CandidateFactors => ({
  weeklyTargetDays: 0,
  daysInMonth: 28,
  day: 1,
  assignedDays: 0,
  consecutiveDays: 0,
  rank: null,
  overlappingRanks: [],
  shortfall: 0,
  previousWeekendShifts: 0,
  ...overrides,
})

/** Score breakdown of one staff member's candidacy on a date (first pass). */
const breakdownOn = (plan: ReturnType<typeof generateShiftPlan>, date: string, staffId: string) =>
  plan.decisions.slots.find(slot => slot.date === date)?.candidates.find(candidate => candidate.staffId === staffId)?.breakdown

describe('法定休憩の控除 (calculateActualHours)', () => {
  it.each([
    [10, 16, 6], // exactly 6h: no break
    [10, 16.25, 5.5], // over 6h: 45 minutes
    [10, 18, 7.25], // exactly 8h: still 45 minutes
    [10, 18.25, 7.25], // over 8h: 60 minutes
    [10, 20, 9],
    [20, 2, 6], // overnight given as end < start
    [18, 26, 7.25], // overnight given as end > 24
  ])('%s - %s => %s actual hours', (start, end, expected) => {
    expect(calculateActualHours(start, end)).toBe(expected)
  })

  it('returns 0 for empty or invalid ranges', () => {
    expect(calculateActualHours(10, 10)).toBe(0)
    expect(calculateActualHours(Number.NaN, 12)).toBe(0)
  })

  it('applies to shift labels and month totals', () => {
    expect(shiftHoursFromLabel('10:00-18:30')).toBe(7.5)
    expect(shiftHoursFromLabel('×')).toBe(0)
    expect(actualHoursForShifts({ a: '10:00-16:00', b: '10:00-19:00', c: '×' })).toBe(6 + 8)
  })
})

describe('社員の22日上限', () => {
  it('never schedules an employee on more than 22 days, even with open slots left', () => {
    const plan = generateShiftPlan(hallInput({
      staff: [staffMember({ id: 'emp', is_employee: true })],
      monthlyTargetHours: 400, // far above what 22 days can reach, so every top-up step is tried
    }))
    const employee = plan.schedule.staff[0]
    expect(EMPLOYEE_MAX_DAYS).toBe(22)
    expect(workedDates(employee.shifts)).toHaveLength(22)
    expect(employee.assignedDays).toBe(22)
    expect(plan.schedule.vacancyCount).toBe(31 - 22)
  })

  it('does not apply to part-timers', () => {
    const plan = generateShiftPlan(hallInput({ staff: [staffMember({ id: 'pt' })] }))
    expect(workedDates(plan.schedule.staff[0].shifts)).toHaveLength(31)
  })

  it('does not let an employee at the cap take over a part-timer\'s day', () => {
    const plan = generateShiftPlan(hallInput({
      staff: [staffMember({ id: 'emp', is_employee: true }), staffMember({ id: 'pt', weekly_target_days: 1 })],
      perDay: 2,
      monthlyTargetHours: 400,
    }))
    expect(plan.decisions.adjustments.filter(adjustment => adjustment.type === 'takeover')).toHaveLength(0)
    const employee = plan.schedule.staff.find(staff => staff.id === 'emp')
    expect(employee && workedDates(employee.shifts)).toHaveLength(22)
  })
})

describe('救済ブースト', () => {
  // weekly 7, 28 days => target attendance rate 1.0; boost below 0.5.
  it('is added when attendance is below half of the target rate', () => {
    expect(scoreCandidate(factors({ weeklyTargetDays: 7, day: 11, assignedDays: 4 })).rescueBoost).toBe(RESCUE_BOOST)
  })

  it('is not added at exactly half of the target rate', () => {
    expect(scoreCandidate(factors({ weeklyTargetDays: 7, day: 11, assignedDays: 5 })).rescueBoost).toBe(0)
  })

  it('is not added for staff without a target', () => {
    expect(scoreCandidate(factors({ weeklyTargetDays: 0, day: 11 })).rescueBoost).toBe(0)
  })

  it('applies to everyone with a target on day 1 (no attendance yet)', () => {
    expect(scoreCandidate(factors({ weeklyTargetDays: 1, day: 1 })).rescueBoost).toBe(RESCUE_BOOST)
  })

  it('lets an under-scheduled colleague win the slot', () => {
    // Day 1: both get the boost; 'a' wins on name order. Day 2: 'b' (0/1 days) is
    // boosted while 'a' (1/1) is not, so 'b' takes the slot.
    const plan = generateShiftPlan(hallInput({ staff: [staffMember({ id: 'a', weekly_target_days: 3 }), staffMember({ id: 'b', weekly_target_days: 3 })] }))
    const day2 = plan.decisions.slots.find(slot => slot.date === dateKey(2026, 3, 2))
    expect(day2?.selectedStaffId).toBe('b')
    expect(breakdownOn(plan, dateKey(2026, 3, 2), 'b')?.rescueBoost).toBe(RESCUE_BOOST)
    expect(breakdownOn(plan, dateKey(2026, 3, 2), 'a')?.rescueBoost).toBe(0)
  })
})

describe('超過ブレーキ', () => {
  // weekly 3, 28 days => monthly target 12 days.
  it('is 0 while the next day stays within the monthly target', () => {
    expect(scoreCandidate(factors({ weeklyTargetDays: 3, assignedDays: 11 })).overTarget).toBeCloseTo(0, 10) // -0 (0 x -150)
  })

  it('subtracts 150 for each day beyond the target', () => {
    expect(scoreCandidate(factors({ weeklyTargetDays: 3, assignedDays: 12 })).overTarget).toBe(OVER_TARGET_PENALTY_PER_DAY)
    expect(scoreCandidate(factors({ weeklyTargetDays: 3, assignedDays: 13 })).overTarget).toBe(2 * OVER_TARGET_PENALTY_PER_DAY)
  })

  it('is fractional when the target is not a whole number of days', () => {
    // weekly 2, 31 days => 8.857 target days; the 9th day is 0.143 days over.
    expect(scoreCandidate(factors({ weeklyTargetDays: 2, daysInMonth: 31, assignedDays: 8 })).overTarget)
      .toBeCloseTo((9 - (2 / 7) * 31) * OVER_TARGET_PENALTY_PER_DAY, 10)
  })

  it('does not apply without a target', () => {
    expect(scoreCandidate(factors({ weeklyTargetDays: 0, assignedDays: 20 })).overTarget).toBeCloseTo(0, 10)
  })
})

describe('連勤ペナルティ', () => {
  it('applies to the 3rd consecutive day only', () => {
    expect(scoreCandidate(factors({ consecutiveDays: 1 })).streak).toBe(0)
    expect(scoreCandidate(factors({ consecutiveDays: 2 })).streak).toBe(STREAK_PENALTY)
    expect(scoreCandidate(factors({ consecutiveDays: 5 })).streak).toBe(STREAK_PENALTY)
  })

  it('resets after a day off and is a penalty, not a hard limit', () => {
    const plan = generateShiftPlan(hallInput({
      staff: [staffMember({ id: 'solo' })],
      requests: [{ id: 'off', staff_id: 'solo', date: dateKey(2026, 3, 4), is_off: true }],
    }))
    const streakOn = (day: number) => breakdownOn(plan, dateKey(2026, 3, day), 'solo')?.streak
    expect([streakOn(1), streakOn(2), streakOn(3)]).toEqual([0, 0, STREAK_PENALTY])
    expect(streakOn(4)).toBeUndefined() // day off: not a candidate
    expect([streakOn(5), streakOn(6), streakOn(7)]).toEqual([0, 0, STREAK_PENALTY])
    // The only available person still works the 3rd day.
    expect(workedDates(plan.schedule.staff[0].shifts)).toContain(dateKey(2026, 3, 3))
  })
})

describe('土日勤務の公平さ', () => {
  it('is -30 per weekend / holiday shift already worked', () => {
    expect(scoreCandidate(factors({ previousWeekendShifts: 0 })).weekendFairness).toBeCloseTo(0, 10)
    expect(scoreCandidate(factors({ previousWeekendShifts: 3 })).weekendFairness).toBe(3 * WEEKEND_FAIRNESS_PENALTY_PER_SHIFT)
  })

  it('counts earlier weekend and holiday shifts of the month, and only on weekend / holiday days', () => {
    // March 2026: 1 (Sun), 7-8, 14-15 ... ; a test holiday on Wed 4th.
    const plan = generateShiftPlan(hallInput({ staff: [staffMember({ id: 'solo' })], holidays: { [dateKey(2026, 3, 4)]: 'テスト祝日' } }))
    const fairnessOn = (day: number) => breakdownOn(plan, dateKey(2026, 3, day), 'solo')?.weekendFairness
    expect(fairnessOn(1)).toBeCloseTo(0, 10) // first weekend day of the month
    expect(fairnessOn(2)).toBeCloseTo(0, 10) // Monday
    expect(fairnessOn(4)).toBe(1 * WEEKEND_FAIRNESS_PENALTY_PER_SHIFT) // holiday after Sun 1st
    expect(fairnessOn(7)).toBe(2 * WEEKEND_FAIRNESS_PENALTY_PER_SHIFT) // Sat after 1st and 4th
    expect(fairnessOn(8)).toBe(3 * WEEKEND_FAIRNESS_PENALTY_PER_SHIFT)
    expect(fairnessOn(9)).toBeCloseTo(0, 10) // Monday
  })
})

describe('画面で選んだ日ごとの希望 (request_kind)', () => {
  const day = (d: number) => dateKey(2026, 3, d)
  const request = (d: number, fields: Partial<ShiftRequest>): ShiftRequest => ({ id: `r-${d}`, staff_id: 'solo', date: day(d), is_off: false, ...fields })

  it('終日OK works outside the usual conditions; the usual conditions apply elsewhere', () => {
    const evening = staffMember({ id: 'solo', work_start_1: '18:00', work_end_1: '24:00' })
    const plan = generateShiftPlan(hallInput({ staff: [evening], requests: [request(2, { request_kind: 'any' })] }))
    expect(workedDates(plan.schedule.staff[0].shifts)).toEqual([day(2)])
  })

  it('a time request replaces the usual conditions for that day', () => {
    const plan = generateShiftPlan(hallInput({
      staff: [staffMember({ id: 'solo' })],
      requests: [
        request(2, { request_kind: 'from', start_time: '17:00:00' }), // slot 10-14 not covered
        request(3, { request_kind: 'until', end_time: '15:00' }),
        request(4, { request_kind: 'range', start_time: '10:00', end_time: '14:00' }),
      ],
    }))
    const worked = workedDates(plan.schedule.staff[0].shifts)
    expect(worked).not.toContain(day(2))
    expect(worked).toContain(day(3))
    expect(worked).toContain(day(4))
  })

  it('reads 休み from request_kind and ignores the memo of 希望なし', () => {
    const plan = generateShiftPlan(hallInput({
      staff: [staffMember({ id: 'solo' })],
      requests: [
        request(2, { request_kind: 'off' }),
        request(3, { request_kind: 'none', memo: '休み' }),
        request(5, { request_kind: null, memo: '用事があります', parsed_request: null }), // legacy, unconfirmed: usual conditions
      ],
    }))
    const worked = workedDates(plan.schedule.staff[0].shifts)
    expect(worked).not.toContain(day(2))
    expect(worked).toContain(day(3))
    expect(worked).toContain(day(5))
  })
})

describe('曜日ごとの勤務条件 (weekly_availability)', () => {
  // March 2026: the 2nd is a Monday.
  const day = (d: number) => dateKey(2026, 3, d)
  const everyDay = (value: object) => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(key => [key, value]))
  const weekly = { ...everyDay({ kind: 'range', start: '10:00', end: '14:00' }), wednesday: { kind: 'off', start: null, end: null }, friday: { kind: 'from', start: '17:00', end: null } }

  it('works only on weekdays that are available, within the chosen times, ignoring the old time bands', () => {
    const plan = generateShiftPlan(hallInput({ staff: [staffMember({ id: 'solo', weekly_availability: weekly })] }))
    const worked = workedDates(plan.schedule.staff[0].shifts)
    expect(worked).toContain(day(2)) // Monday 10-14
    expect(worked).not.toContain(day(4)) // Wednesday: 出られない
    expect(worked).not.toContain(day(6)) // Friday 17:00〜: slot 10-14 not covered
    expect(plan.schedule.staff[0].shifts[day(4)]).toBe('×')
  })

  it('a day request still wins over the weekday choice', () => {
    const plan = generateShiftPlan(hallInput({
      staff: [staffMember({ id: 'solo', weekly_availability: weekly })],
      requests: [
        { id: 'a', staff_id: 'solo', date: day(4), request_kind: 'any' }, // Wednesday made available
        { id: 'b', staff_id: 'solo', date: day(2), request_kind: 'off', is_off: true },
        { id: 'c', staff_id: 'solo', date: day(9), request_kind: 'none', memo: 'メモだけ' }, // Monday: weekday choice applies
      ],
    }))
    const worked = workedDates(plan.schedule.staff[0].shifts)
    expect(worked).toContain(day(4))
    expect(worked).not.toContain(day(2))
    expect(worked).toContain(day(9))
  })

  it('ignores an invalid value and keeps the old time bands', () => {
    const plan = generateShiftPlan(hallInput({ staff: [staffMember({ id: 'solo', weekly_availability: { monday: 'x' } })] }))
    expect(workedDates(plan.schedule.staff[0].shifts)).toContain(day(4))
  })
})
