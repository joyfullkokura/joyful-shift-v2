import { describe, expect, it } from 'vitest'
import { DEFAULT_LABOR_RULES, laborRuleColumns, laborRulesOf, monthlyLegalHours, parseLaborRulesInput } from '@/lib/labor-rules'

describe('laborRulesOf', () => {
  it('uses the defaults for a store row without the new columns', () => {
    expect(laborRulesOf({})).toEqual(DEFAULT_LABOR_RULES)
    expect(laborRulesOf(null).targetSalesPerLaborHour).toBe(4200)
  })

  it('reads numeric columns given as strings and time columns with seconds', () => {
    const rules = laborRulesOf({ labor_time_mode: 'monthly_variable', daily_max_hours: '8.00', late_night_start: '22:30:00', novice_rule: 'hard', week_start_day: 1 })
    expect(rules.laborTimeMode).toBe('monthly_variable')
    expect(rules.dailyMaxHours).toBe(8)
    expect(rules.lateNightStart).toBe(22 * 60 + 30)
    expect(rules.noviceRule).toBe('hard')
    expect(rules.weekStartDay).toBe(1)
  })

  it('falls back to the default for out-of-range values', () => {
    expect(laborRulesOf({ daily_max_hours: 30, novice_rank_floor: 'Z' }).dailyMaxHours).toBe(8)
    expect(laborRulesOf({ novice_rank_floor: 'Z' }).noviceRankFloor).toBe('B')
  })
})

describe('parseLaborRulesInput', () => {
  it('accepts the defaults and round-trips through the columns', () => {
    expect(parseLaborRulesInput(DEFAULT_LABOR_RULES)).toEqual(DEFAULT_LABOR_RULES)
    expect(laborRulesOf(laborRuleColumns(DEFAULT_LABOR_RULES))).toEqual(DEFAULT_LABOR_RULES)
  })

  it('refuses unknown modes, odd steps and missing fields', () => {
    expect(parseLaborRulesInput({ ...DEFAULT_LABOR_RULES, laborTimeMode: 'yearly' })).toBeNull()
    expect(parseLaborRulesInput({ ...DEFAULT_LABOR_RULES, dailyMaxHours: 8.1 })).toBeNull()
    expect(parseLaborRulesInput({ ...DEFAULT_LABOR_RULES, salesOffsetHours: 0.25 })).toBeNull()
    const missing: Record<string, unknown> = { ...DEFAULT_LABOR_RULES }
    delete missing.checkLead
    expect(parseLaborRulesInput(missing)).toBeNull()
    expect(parseLaborRulesInput(null)).toBeNull()
  })
})

describe('monthlyLegalHours', () => {
  it('is 40h x days / 7 rounded down to 0.1h', () => {
    expect(monthlyLegalHours(28)).toBe(160)
    expect(monthlyLegalHours(29)).toBe(165.7)
    expect(monthlyLegalHours(30)).toBe(171.4)
    expect(monthlyLegalHours(31)).toBe(177.1)
  })
})
