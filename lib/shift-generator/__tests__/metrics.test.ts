import { describe, expect, it } from 'vitest'
import { DEFAULT_LABOR_RULES, type LaborRules, monthlyLegalHours } from '@/lib/labor-rules'
import { generateSchedule } from '../generate'
import { evaluateSchedule, lateNightOverlap, type EvaluatedStaff } from '../metrics'
import { LEGACY_HOLIDAYS } from './fixtures/legacy-holidays'
import { randomGeneratorInput } from './fixtures/random-input'
import { countViolations } from './validate'
import { checkCapacity } from '../capacity'
import { hallInput, staffMember } from './fixtures/builders'

const rules = (overrides: Partial<LaborRules> = {}): LaborRules => ({ ...DEFAULT_LABOR_RULES, ...overrides })
const base = (staff: EvaluatedStaff[], overrides: Partial<Parameters<typeof evaluateSchedule>[0]> = {}) => evaluateSchedule({
  targetYear: 2027,
  targetMonth: 2,
  staff,
  rules: rules(),
  selectedSpecialDays: [],
  holidays: { '2027-02-11': '建国記念の日' },
  expectedSales: { wd: 230_000, we: 345_000 },
  curves: {},
  ...overrides,
})

describe('evaluateSchedule: labor hours and 人時売上', () => {
  it('sums paid hours per day and divides the expected sales', () => {
    // Monday 2027-02-01: 10-18 (8h -> 7.25 paid) + 17-22 (5h).
    const result = base([
      { id: 'a', name: 'A', isEmployee: true, shifts: { '2027-02-01': '10:00-18:00' } },
      { id: 'b', name: 'B', isEmployee: false, shifts: { '2027-02-01': '17:00-22:00', '2027-02-06': '10:00-16:00' } },
    ])
    const monday = result.days[0]
    expect(monday.configType).toBe('wd')
    expect(monday.laborHours).toBe(12.3) // 7.25 + 5, rounded to 0.1
    expect(monday.salesPerLaborHour).toBe(Math.round(230_000 / 12.25))
    expect(monday.budgetHours).toBe(54.8) // 230,000 / 4,200
    expect(result.days[5].configType).toBe('we')
    expect(result.days[10].configType).toBe('we') // holiday
    expect(result.weekday.laborHours).toBe(12.3)
    expect(result.weekendHoliday.laborHours).toBe(6)
  })

  it('compares staffing with the curve, not counting closing-prep hours as excess', () => {
    const curve = { ホール: { '17': 1, '21': 1 }, キッチン: {}, closing_prep: ['21'] }
    const result = base([
      { id: 'a', name: 'A', isEmployee: false, mainJob: 'ホール', shifts: { '2027-02-01': '17:00-22:00' } },
      { id: 'b', name: 'B', isEmployee: false, mainJob: 'ホール', shifts: { '2027-02-01': '17:00-22:00' } },
    ], { curves: { wd: curve } })
    const monday = result.days[0]
    // 17: 2 staffed vs 1 -> +1 excess; 18-20 no requirement -> excess 2 each; 21: prep -> not excess.
    expect(monday.overstaffedHours).toBe(1 + 2 + 2 + 2)
    expect(monday.understaffedHours).toBe(0)
    expect(monday.balanceByHour?.[21]).toBe(1)
    expect(result.days[1].overstaffedHours).toBe(0)
  })

  it('counts late-night hours inside the window, also past midnight', () => {
    expect(lateNightOverlap(20, 24, rules())).toBe(2)
    expect(lateNightOverlap(23, 26, rules())).toBe(3)
    expect(lateNightOverlap(4, 6, rules())).toBe(1)
  })
})

describe('evaluateSchedule: hard rules', () => {
  it('finds the daily limit, short shifts, minors at night and short rest', () => {
    const result = base([
      { id: 'e', name: 'E', isEmployee: true, shifts: { '2027-02-01': '10:00-20:00', '2027-02-02': '05:00-09:00' } },
      { id: 'm', name: 'M', isEmployee: false, isMinor: true, shifts: { '2027-02-03': '18:00-22:30', '2027-02-04': '10:00-12:00' } },
    ])
    const kinds = result.violations.map(violation => violation.kind).sort()
    expect(kinds).toEqual(['daily_max', 'min_shift', 'minor_late_night', 'rest_interval'])
    expect(result.overtimeHours).toBe(1) // 10h -> 9 paid -> 1 over 8
    expect(result.employeeDaysOverDaily).toBe(1)
  })

  it('uses the previous month for the first week and the first rest interval', () => {
    // 2027-02-01 is a Monday; the week starts on Sunday 2027-01-31.
    const result = base(
      [{ id: 'p', name: 'P', isEmployee: false, shifts: { '2027-02-01': '06:00-14:00' } }],
      { previousMonth: [{ id: 'p', shifts: { '2027-01-31': '14:00-23:30' } }] },
    )
    expect(result.violations.map(violation => violation.kind)).toContain('rest_interval')
  })

  it('switches from the weekly limit to the monthly legal total', () => {
    const shifts = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`2027-02-0${index + 1}`, '10:00-18:45'])) // 8h paid x 6
    const weekly = base([{ id: 'w', name: 'W', isEmployee: false, shifts }])
    expect(weekly.violations.some(violation => violation.kind === 'weekly_max')).toBe(true)
    const variable = base([{ id: 'w', name: 'W', isEmployee: false, shifts }], { rules: rules({ laborTimeMode: 'monthly_variable' }) })
    expect(variable.violations.some(violation => violation.kind === 'weekly_max')).toBe(false)
    expect(variable.violations.some(violation => violation.kind === 'monthly_legal')).toBe(false) // 48h < 160h
    expect(monthlyLegalHours(28)).toBe(160)
  })
})

describe('evaluateSchedule agrees with the independent validator (300 seeded stores)', () => {
  it('counts the same violations of each kind', () => {
    const totals: Record<string, number> = {}
    for (let seed = 1; seed <= 300; seed++) {
      const input = { ...randomGeneratorInput(seed), holidays: LEGACY_HOLIDAYS }
      const schedule = generateSchedule(input)
      const ruleSet = rules({
        laborTimeMode: seed % 3 === 0 ? 'monthly_variable' : 'weekly_40',
        weekStartDay: seed % 7,
        minShiftHours: seed % 2 ? 3 : 4,
        restIntervalHours: seed % 4 === 0 ? 0 : 11,
      })
      const staff = schedule.staff.map((person, index) => ({
        id: person.id, name: person.name, isEmployee: person.isEmployee, isMinor: (seed + index) % 5 === 0,
        mainJob: person.mainJob, shifts: person.shifts, assignedRoles: person.assignedRoles,
      }))
      const evaluation = evaluateSchedule({
        targetYear: input.targetYear, targetMonth: input.targetMonth, staff, rules: ruleSet,
        selectedSpecialDays: input.selectedSpecialDays, holidays: input.holidays, expectedSales: {}, curves: {},
      })
      const days = new Date(input.targetYear, input.targetMonth, 0).getDate()
      const monthDates = Array.from({ length: days }, (_, index) => `${input.targetYear}-${String(input.targetMonth).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`)
      const expected = countViolations(staff.map(person => ({ ...person, isMinor: Boolean(person.isMinor) })), {}, monthDates, {
        dailyMaxMinutes: ruleSet.dailyMaxHours * 60,
        weeklyMaxMinutes: ruleSet.laborTimeMode === 'weekly_40' ? ruleSet.weeklyMaxHours * 60 : null,
        monthlyMaxMinutes: ruleSet.laborTimeMode === 'monthly_variable' ? Math.round(monthlyLegalHours(days) * 60) : null,
        minShiftMinutes: ruleSet.minShiftHours * 60,
        restMinutes: ruleSet.restIntervalHours * 60,
        lateNightStart: ruleSet.lateNightStart,
        lateNightEnd: ruleSet.lateNightEnd,
        weekStartDay: ruleSet.weekStartDay,
      })
      const actual: Record<string, number> = {}
      for (const violation of evaluation.violations) actual[violation.kind] = (actual[violation.kind] ?? 0) + 1
      expect(actual, `seed ${seed}`).toEqual(expected)
      for (const [kind, count] of Object.entries(expected)) totals[kind] = (totals[kind] ?? 0) + count
    }
    // The comparison is only meaningful if today's generator produces such cases.
    console.info(JSON.stringify(totals))
    for (const kind of ['daily_max', 'weekly_max', 'rest_interval', 'minor_late_night']) expect(totals[kind] ?? 0, kind).toBeGreaterThan(0)
  }, 120_000)
})

describe('checkCapacity', () => {
  const capacityInput = (overrides: Partial<Parameters<typeof checkCapacity>[0]> = {}) => ({
    ...hallInput({ staff: [staffMember({ id: 'a', work_start_1: '10:00', work_end_1: '20:00' })], year: 2027, month: 2, slot: { start: 10, end: 14 } }),
    rules: DEFAULT_LABOR_RULES,
    expectedSales: { wd: 8_400, we: 8_400 },
    ...overrides,
  })

  it('caps the available hours by the daily and weekly limits', () => {
    const result = checkCapacity(capacityInput())
    // 10-20 = 10h -> 9 paid -> capped at 8 per day; weeks capped at 40h.
    expect(result.availableHours).toBeLessThanOrEqual(5 * 40)
    expect(result.slotHours).toBe(28 * 4)
    expect(result.budgetHours).toBe(28 * 2)
  })

  it('warns when the slots exceed the labor-hour budget and when staff cannot cover them', () => {
    const result = checkCapacity(capacityInput())
    expect(result.warnings.some(warning => warning.includes('人時売上の目標'))).toBe(true)
    const fewStaff = checkCapacity(capacityInput({ ...hallInput({ staff: [], year: 2027, month: 2 }), expectedSales: {} }))
    expect(fewStaff.warnings.some(warning => warning.includes('足りません'))).toBe(true)
    expect(fewStaff.budgetHours).toBeNull()
  })
})
