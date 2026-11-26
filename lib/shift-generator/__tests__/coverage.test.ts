import { describe, expect, it } from 'vitest'
import { DEFAULT_LABOR_RULES, type LaborRules } from '@/lib/labor-rules'
import { generateShiftPlan } from '../generate'
import { evaluateCoverage } from '../metrics'
import { dateKey, hallInput, staffMember } from './fixtures/builders'
import { REPORT_SEEDS, reportInput } from './fixtures/report-input'
import { toTimeRange } from '../time'
import type { GeneratorInput } from '../types'

const onDay = (plan: ReturnType<typeof generateShiftPlan>, staffId: string, date = '2026-03-02') =>
  plan.schedule.staff.find(person => person.id === staffId)?.shifts[date]

const withRules = (input: GeneratorInput, rules: Partial<LaborRules>): GeneratorInput => ({ ...input, rules: { ...DEFAULT_LABOR_RULES, ...rules } })

// Store hours of hallInput: 09:00-24:00.
describe('coverage (④ 責任者, ⑤ 開店・締め, ⑥ 新人だけ)', () => {
  it('puts an opener on the opening slot when the check is on', () => {
    // b would win on rank; a is the only one marked 開店.
    const staff = [staffMember({ id: 'a', rank: 'C', can_open: true }), staffMember({ id: 'b', rank: 'A' })]
    const input = hallInput({ staff, slot: { start: 9, end: 14 } })
    const daysOf = (plan: ReturnType<typeof generateShiftPlan>) => plan.schedule.staff.find(person => person.id === 'a')?.assignedDays
    expect(daysOf(generateShiftPlan(withRules(input, { noviceRankFloor: 'C' })))).toBeLessThan(31)
    expect(daysOf(generateShiftPlan(withRules(input, { noviceRankFloor: 'C', checkOpenClose: true })))).toBe(31)
  })

  it('puts a 責任者 on a slot whose hours have none yet', () => {
    const staff = [staffMember({ id: 'a', rank: 'C', can_lead: true }), staffMember({ id: 'b', rank: 'A' })]
    const input = hallInput({ staff, slot: { start: 12, end: 17 } })
    expect(onDay(generateShiftPlan(withRules(input, { noviceRankFloor: 'C', checkLead: true })), 'a')).toBe('12:00-17:00')
  })

  it('lists days the checks could not meet', () => {
    const staff = [staffMember({ id: 'b', rank: 'A' })]
    const plan = generateShiftPlan(withRules(hallInput({ staff, slot: { start: 9, end: 14 } }), { checkOpenClose: true, checkLead: true }))
    const gaps = plan.decisions.coverage.filter(gap => gap.date === '2026-03-02').map(gap => gap.kind).sort()
    expect(gaps).toEqual(['no_close', 'no_lead', 'no_open'])
  })

  it('soft: prefers an experienced part-timer over a novice working alone', () => {
    const staff = [staffMember({ id: 'novice', rank: 'C' }), staffMember({ id: 'senior', rank: 'B', weekly_target_days: 3 })]
    const plan = generateShiftPlan(withRules(hallInput({ staff }), {}))
    expect(onDay(plan, 'senior')).toBe('10:00-14:00')
    expect(onDay(plan, 'novice')).toBeUndefined()
  })

  it('soft: a novice alone still fills the slot when no one else can', () => {
    const plan = generateShiftPlan(withRules(hallInput({ staff: [staffMember({ id: 'novice', rank: 'C' })] }), {}))
    expect(onDay(plan, 'novice')).toBe('10:00-14:00')
  })

  it('hard: leaves the slot empty rather than a novice alone, and says why', () => {
    const plan = generateShiftPlan(withRules(hallInput({ staff: [staffMember({ id: 'novice', rank: 'C' })] }), { noviceRule: 'hard' }))
    expect(onDay(plan, 'novice')).toBeUndefined()
    expect(plan.decisions.adjustments).toContainEqual({ type: 'novice_only', date: '2026-03-02', staffId: 'novice', slotKey: 'ホール_0' })
    expect(plan.schedule.staff[0].assignedDays).toBe(0)
  })

  it('hard: a novice may work next to an experienced colleague', () => {
    const staff = [staffMember({ id: 'novice', rank: 'C' }), staffMember({ id: 'senior', rank: 'A' })]
    const plan = generateShiftPlan(withRules(hallInput({ staff, perDay: 2 }), { noviceRule: 'hard' }))
    expect(onDay(plan, 'novice')).toBe('10:00-14:00')
    expect(onDay(plan, 'senior')).toBe('10:00-14:00')
  })

  it('the generator and the independent minute check agree, and hard leaves no novice-only time (300 stores)', () => {
    for (const seed of REPORT_SEEDS) {
      const base = reportInput(seed)
      const staff = base.staff.map((person, index) => ({
        ...person, can_lead: (seed + index) % 3 === 0, can_open: (seed + index) % 4 === 0, can_close: (seed + index) % 4 === 1,
      }))
      const rules: LaborRules = { ...DEFAULT_LABOR_RULES, checkLead: true, checkOpenClose: true, noviceRule: seed % 2 === 0 ? 'hard' : 'soft' }
      const input = { ...base, staff, rules }
      const plan = generateShiftPlan(input)
      const recordById = new Map(staff.map(person => [person.id, person]))
      const days = new Date(input.targetYear, input.targetMonth, 0).getDate()
      const dates = Array.from({ length: days }, (_, index) => dateKey(input.targetYear, input.targetMonth, index + 1))
      const evaluated = evaluateCoverage({
        targetYear: input.targetYear, targetMonth: input.targetMonth, rules, selectedSpecialDays: [], holidays: {}, expectedSales: {}, curves: {},
        staff: plan.schedule.staff.map(person => ({
          id: person.id, name: person.name, isEmployee: person.isEmployee, shifts: person.shifts,
          rank: recordById.get(person.id)?.rank, canLead: recordById.get(person.id)?.can_lead, canOpen: recordById.get(person.id)?.can_open, canClose: recordById.get(person.id)?.can_close,
        })),
        storeHours: toTimeRange(input.store.open_time, input.store.close_time),
      }, dates)
      for (const day of evaluated.days) {
        const gaps = plan.decisions.coverage.filter(gap => gap.date === day.date)
        const hoursOf = (kind: string) => gaps.find(gap => gap.kind === kind)?.hours ?? 0
        expect(day.noOpen, `seed ${seed} ${day.date} open`).toBe(gaps.some(gap => gap.kind === 'no_open'))
        expect(day.noClose, `seed ${seed} ${day.date} close`).toBe(gaps.some(gap => gap.kind === 'no_close'))
        expect(day.noLeadHours, `seed ${seed} ${day.date} lead`).toBeCloseTo(hoursOf('no_lead'), 1)
        expect(day.noviceOnlyHours, `seed ${seed} ${day.date} novice`).toBeCloseTo(hoursOf('novice_only'), 1)
        if (rules.noviceRule === 'hard') expect(day.noviceOnlyHours, `seed ${seed} ${day.date} hard`).toBe(0)
      }
    }
  }, 180_000)
})
