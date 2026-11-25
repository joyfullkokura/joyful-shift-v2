// Store rules for labor time and on-site staffing (stores columns of migration H).
// Pure: parsing with defaults, validation of what the manager submits, and the
// legal monthly limit of the 1-month variable working hours system.

import { timeToMinutes } from '@/lib/day-request'

export type LaborTimeMode = 'weekly_40' | 'monthly_variable'
export type NoviceRule = 'soft' | 'hard'
export type RankFloor = 'A' | 'B' | 'C'

export type LaborRules = {
  /** weekly_40: 8h/day and 40h/week. monthly_variable: 8h/day and 40h x days / 7 per month. */
  laborTimeMode: LaborTimeMode
  dailyMaxHours: number
  weeklyMaxHours: number
  minShiftHours: number
  restIntervalHours: number
  /** Minutes from midnight (22:00 = 1320, 05:00 = 300). */
  lateNightStart: number
  lateNightEnd: number
  /** 0 = Sunday. */
  weekStartDay: number
  checkLead: boolean
  checkOpenClose: boolean
  noviceRankFloor: RankFloor
  noviceRule: NoviceRule
  applyWeekly20hLine: boolean
  /** 人時売上 target in yen. */
  targetSalesPerLaborHour: number
  /** Sales are recorded at payment; visits are this many hours earlier. */
  salesOffsetHours: number
}

export const DEFAULT_LABOR_RULES: LaborRules = {
  laborTimeMode: 'weekly_40',
  dailyMaxHours: 8,
  weeklyMaxHours: 40,
  minShiftHours: 3,
  restIntervalHours: 11,
  lateNightStart: 22 * 60,
  lateNightEnd: 5 * 60,
  weekStartDay: 0,
  checkLead: false,
  checkOpenClose: false,
  noviceRankFloor: 'B',
  noviceRule: 'soft',
  applyWeekly20hLine: true,
  targetSalesPerLaborHour: 4200,
  salesOffsetHours: 1,
}

/** numeric columns may arrive as numbers or strings. */
const numberOf = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

const within = (value: number | null, min: number, max: number) => value !== null && value >= min && value <= max

/** Store row (snake_case columns) to rules; anything missing or invalid uses the default. */
export const laborRulesOf = (row: Record<string, unknown> | null | undefined): LaborRules => {
  const d = DEFAULT_LABOR_RULES
  const pick = (key: string, min: number, max: number, fallback: number) => {
    const value = numberOf(row?.[key])
    return within(value, min, max) ? (value as number) : fallback
  }
  const time = (key: string, fallback: number) => timeToMinutes(row?.[key]) ?? fallback
  const mode = row?.labor_time_mode === 'monthly_variable' ? 'monthly_variable' : 'weekly_40'
  const floor = row?.novice_rank_floor
  return {
    laborTimeMode: mode,
    dailyMaxHours: pick('daily_max_hours', 1, 24, d.dailyMaxHours),
    weeklyMaxHours: pick('weekly_max_hours', 1, 168, d.weeklyMaxHours),
    minShiftHours: pick('min_shift_hours', 0, 24, d.minShiftHours),
    restIntervalHours: pick('rest_interval_hours', 0, 24, d.restIntervalHours),
    lateNightStart: time('late_night_start', d.lateNightStart),
    lateNightEnd: time('late_night_end', d.lateNightEnd),
    weekStartDay: Math.round(pick('week_start_day', 0, 6, d.weekStartDay)),
    checkLead: typeof row?.check_lead === 'boolean' ? row.check_lead : d.checkLead,
    checkOpenClose: typeof row?.check_open_close === 'boolean' ? row.check_open_close : d.checkOpenClose,
    noviceRankFloor: floor === 'A' || floor === 'B' || floor === 'C' ? floor : d.noviceRankFloor,
    noviceRule: row?.novice_rule === 'hard' ? 'hard' : 'soft',
    applyWeekly20hLine: typeof row?.apply_weekly_20h_line === 'boolean' ? row.apply_weekly_20h_line : d.applyWeekly20hLine,
    targetSalesPerLaborHour: Math.round(pick('target_sales_per_labor_hour', 1, 1_000_000, d.targetSalesPerLaborHour)),
    salesOffsetHours: pick('sales_offset_hours', 0, 6, d.salesOffsetHours),
  }
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isMinutes = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 24 * 60
const isStep = (value: unknown, min: number, max: number, step: number): value is number =>
  typeof value === 'number' && value >= min && value <= max && Math.abs(Math.round(value / step) * step - value) < 1e-9

/** Validates rules sent by the screen; null when anything is out of range. */
export const parseLaborRulesInput = (value: unknown): LaborRules | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!(v.laborTimeMode === 'weekly_40' || v.laborTimeMode === 'monthly_variable')) return null
  if (!isStep(v.dailyMaxHours, 1, 24, 0.25) || !isStep(v.weeklyMaxHours, 1, 168, 0.25)) return null
  if (!isStep(v.minShiftHours, 0, 24, 0.25) || !isStep(v.restIntervalHours, 0, 24, 0.25)) return null
  if (!isMinutes(v.lateNightStart) || !isMinutes(v.lateNightEnd)) return null
  if (!(typeof v.weekStartDay === 'number' && Number.isInteger(v.weekStartDay) && v.weekStartDay >= 0 && v.weekStartDay <= 6)) return null
  if (!isBoolean(v.checkLead) || !isBoolean(v.checkOpenClose) || !isBoolean(v.applyWeekly20hLine)) return null
  if (!(v.noviceRankFloor === 'A' || v.noviceRankFloor === 'B' || v.noviceRankFloor === 'C')) return null
  if (!(v.noviceRule === 'soft' || v.noviceRule === 'hard')) return null
  if (!(typeof v.targetSalesPerLaborHour === 'number' && Number.isInteger(v.targetSalesPerLaborHour) && v.targetSalesPerLaborHour >= 1 && v.targetSalesPerLaborHour <= 1_000_000)) return null
  if (!isStep(v.salesOffsetHours, 0, 6, 0.5)) return null
  return {
    laborTimeMode: v.laborTimeMode,
    dailyMaxHours: v.dailyMaxHours,
    weeklyMaxHours: v.weeklyMaxHours,
    minShiftHours: v.minShiftHours,
    restIntervalHours: v.restIntervalHours,
    lateNightStart: v.lateNightStart,
    lateNightEnd: v.lateNightEnd,
    weekStartDay: v.weekStartDay,
    checkLead: v.checkLead,
    checkOpenClose: v.checkOpenClose,
    noviceRankFloor: v.noviceRankFloor,
    noviceRule: v.noviceRule,
    applyWeekly20hLine: v.applyWeekly20hLine,
    targetSalesPerLaborHour: v.targetSalesPerLaborHour,
    salesOffsetHours: v.salesOffsetHours,
  }
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Rules to stores columns. */
export const laborRuleColumns = (rules: LaborRules) => ({
  labor_time_mode: rules.laborTimeMode,
  daily_max_hours: rules.dailyMaxHours,
  weekly_max_hours: rules.weeklyMaxHours,
  min_shift_hours: rules.minShiftHours,
  rest_interval_hours: rules.restIntervalHours,
  late_night_start: clock(rules.lateNightStart % (24 * 60)),
  late_night_end: clock(rules.lateNightEnd % (24 * 60)),
  week_start_day: rules.weekStartDay,
  check_lead: rules.checkLead,
  check_open_close: rules.checkOpenClose,
  novice_rank_floor: rules.noviceRankFloor,
  novice_rule: rules.noviceRule,
  apply_weekly_20h_line: rules.applyWeekly20hLine,
  target_sales_per_labor_hour: rules.targetSalesPerLaborHour,
  sales_offset_hours: rules.salesOffsetHours,
})

/**
 * Legal working hours of a month under the 1-month variable working hours
 * system: 40h x days / 7, rounded down to 0.1h (28 days: 160.0, 30: 171.4, 31: 177.1).
 */
export const monthlyLegalHours = (daysInMonth: number, weeklyHours = 40): number =>
  Math.floor((weeklyHours * daysInMonth / 7) * 10 + 1e-9) / 10
