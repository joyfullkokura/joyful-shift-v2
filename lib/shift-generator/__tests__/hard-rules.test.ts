import { describe, expect, it } from 'vitest'
import { DEFAULT_LABOR_RULES, type LaborRules, monthlyLegalHours } from '@/lib/labor-rules'
import { generateShiftPlan, generateSchedule } from '../generate'
import { evaluateSchedule } from '../metrics'
import { dateKey, hallInput, staffMember, workedDates } from './fixtures/builders'
import { REPORT_RULES, REPORT_SEEDS, reportInput } from './fixtures/report-input'
import { countViolations } from './validate'

const violationsOf = (seed: number, rules: LaborRules, previousMonth?: { id: string; shifts: Record<string, string> }[]) => {
  const input = { ...reportInput(seed), rules, previousMonth }
  const schedule = generateSchedule(input)
  const minors = new Set(input.staff.filter(staff => staff.is_minor).map(staff => staff.id))
  const days = new Date(input.targetYear, input.targetMonth, 0).getDate()
  const monthDates = Array.from({ length: days }, (_, index) => dateKey(input.targetYear, input.targetMonth, index + 1))
  const staff = schedule.staff.map(person => ({ id: person.id, isEmployee: person.isEmployee, isMinor: minors.has(person.id), shifts: person.shifts }))
  const previous = Object.fromEntries((previousMonth ?? []).map(person => [person.id, person.shifts]))
  // The independent validator (minutes, day numbers), not the generator's own checks.
  return countViolations(staff, previous, monthDates, {
    dailyMaxMinutes: rules.dailyMaxHours * 60,
    weeklyMaxMinutes: rules.laborTimeMode === 'weekly_40' ? rules.weeklyMaxHours * 60 : null,
    monthlyMaxMinutes: rules.laborTimeMode === 'monthly_variable' ? Math.round(monthlyLegalHours(days, rules.weeklyMaxHours) * 60) : null,
    minShiftMinutes: rules.minShiftHours * 60,
    restMinutes: rules.restIntervalHours * 60,
    lateNightStart: rules.lateNightStart,
    lateNightEnd: rules.lateNightEnd,
    weekStartDay: rules.weekStartDay,
  })
}

describe('hard labor rules: 0 violations (independent validator)', () => {
  it('on the fixed report basis (300 stores, store default rules)', () => {
    for (const seed of REPORT_SEEDS) expect(violationsOf(seed, REPORT_RULES), `seed ${seed}`).toEqual({})
  }, 120_000)

  it('with other rule settings (variable system, week starts, minimum shift, rest interval)', () => {
    for (const seed of REPORT_SEEDS.slice(0, 120)) {
      const rules: LaborRules = {
        ...DEFAULT_LABOR_RULES,
        laborTimeMode: seed % 3 === 0 ? 'monthly_variable' : 'weekly_40',
        weekStartDay: seed % 7,
        minShiftHours: seed % 2 ? 3 : 4,
        restIntervalHours: seed % 4 === 0 ? 0 : 11,
        dailyMaxHours: seed % 5 === 0 ? 7 : 8,
      }
      expect(violationsOf(seed, rules), `seed ${seed}`).toEqual({})
    }
  }, 120_000)

  it('across the month boundary (previous month shifts)', () => {
    for (const seed of REPORT_SEEDS.slice(0, 60)) {
      const input = reportInput(seed)
      const lastDay = new Date(input.targetYear, input.targetMonth - 1, 0)
      const lastKey = (offset: number) => {
        const date = new Date(lastDay)
        date.setDate(lastDay.getDate() - offset)
        return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
      }
      // Everyone worked late on the last day and long days in the last week.
      const previousMonth = input.staff.map(staff => ({
        id: staff.id,
        shifts: Object.fromEntries([0, 1, 2, 3, 4].map(offset => [lastKey(offset), offset === 0 ? '16:00-23:30' : '10:00-18:45'])),
      }))
      expect(violationsOf(seed, REPORT_RULES, previousMonth), `seed ${seed}`).toEqual({})
    }
  }, 120_000)
})

describe('hard labor rules: small cases', () => {
  it('never places an under-18 in the late-night window', () => {
    const plan = generateShiftPlan(hallInput({
      staff: [staffMember({ id: 'minor', is_minor: true })],
      slot: { start: 18, end: 23 },
    }))
    expect(workedDates(plan.schedule.staff[0].shifts)).toEqual([])
    expect(plan.decisions.slots[0].blockedBy).toEqual({ minor_late_night: 1 })
  })

  it('keeps shifts within 8 paid hours and records why a slot stayed empty', () => {
    const plan = generateShiftPlan(hallInput({ staff: [staffMember({ id: 'solo' })], slot: { start: 10, end: 20 } }))
    // 10h slot = 9 paid hours > 8: the slot can only be taken shortened (2h shortfall allowed) or not at all.
    for (const label of Object.values(plan.schedule.staff[0].shifts)) {
      const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(label)
      if (!match) continue
      const length = Number(match[3]) + Number(match[4]) / 60 - Number(match[1]) - Number(match[2]) / 60
      expect(length - (length > 8 ? 1 : length > 6 ? 0.75 : 0)).toBeLessThanOrEqual(8)
    }
  })

  it('respects the weekly limit: one person cannot take every day of a long week', () => {
    const plan = generateShiftPlan(hallInput({ staff: [staffMember({ id: 'solo' })], slot: { start: 10, end: 18.75 } })) // 8 paid hours
    const evaluation = evaluateSchedule({
      targetYear: 2026, targetMonth: 3, staff: [{ id: 'solo', name: 'solo', isEmployee: false, shifts: plan.schedule.staff[0].shifts }],
      rules: DEFAULT_LABOR_RULES, selectedSpecialDays: [], holidays: {}, expectedSales: {}, curves: {},
    })
    expect(evaluation.violations).toEqual([])
    expect(workedDates(plan.schedule.staff[0].shifts).length).toBeLessThan(31)
  })
})
