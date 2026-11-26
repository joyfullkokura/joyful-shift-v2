// Evaluation of any schedule (generated, edited by hand, or a test fixture):
// labor hours and expected 人時売上 per day and month, staffing against the
// required-staff curve, late-night hours, and the hard labor rules. Pure; it
// never changes the schedule. The generator does not use it yet.

import { type LaborRules, monthlyLegalHours } from '@/lib/labor-rules'
import { CURVE_JOBS, type CurveJob, type RequiredCurve } from '@/lib/required-curve'
import { calculateActualHours } from './time'

export type EvaluatedStaff = {
  id: string
  name: string
  isEmployee: boolean
  isMinor?: boolean
  mainJob?: string
  /** date → "HH:MM-HH:MM" (anything else = not working). */
  shifts: Record<string, string>
  assignedRoles?: Record<string, string>
  /** For the coverage checks (④⑤⑥). */
  rank?: string | null
  canLead?: boolean
  canOpen?: boolean
  canClose?: boolean
}

export type EvaluationInput = {
  targetYear: number
  /** 1-12 */
  targetMonth: number
  staff: EvaluatedStaff[]
  /** Shifts of the last days of the previous month (weekly limit, rest interval). */
  previousMonth?: { id: string; shifts: Record<string, string> }[]
  rules: LaborRules
  selectedSpecialDays: string[]
  /** YYYY-MM-DD → name */
  holidays: Readonly<Record<string, string>>
  /** Day type (wd / we / special date) → expected sales of one such day. */
  expectedSales: Record<string, number | null | undefined>
  curves: Record<string, RequiredCurve | null | undefined>
  /** Store hours (decimal, end may pass 24) for the 責任者 / opening / closing checks; null = skip them. */
  storeHours?: { start: number; end: number } | null
}

/** One day's on-site coverage (only the checks the store turned on; 新人だけ always). */
export type DayCoverageMetrics = { date: string; noLeadHours: number; noOpen: boolean; noClose: boolean; noviceOnlyHours: number }

export type CoverageSummary = {
  days: DayCoverageMetrics[]
  noLeadHours: number
  noOpenDays: number
  noCloseDays: number
  noviceOnlyHours: number
}

export type DayMetrics = {
  date: string
  configType: string
  people: number
  /** Paid hours (after the legal breaks) of everyone working that day. */
  laborHours: number
  expectedSales: number | null
  salesPerLaborHour: number | null
  /** expectedSales ÷ target: the labor hours the target allows. */
  budgetHours: number | null
  /** budgetHours − laborHours (negative = too many hours). */
  hoursToTarget: number | null
  lateNightHours: number
  /** Person-hours above / below the curve (closing-prep hours never count as above). Null without a curve. */
  overstaffedHours: number | null
  understaffedHours: number | null
  /** hour → staffed − required (total of both jobs), for the heat map. Null without a curve. */
  balanceByHour: Record<number, number> | null
}

export type ViolationKind =
  | 'daily_max' | 'weekly_max' | 'monthly_legal' | 'rest_interval' | 'min_shift' | 'minor_late_night' | 'employee_days'

export type Violation = { kind: ViolationKind; staffId: string; date: string; detail: string }

export type PeriodSummary = { days: number; laborHours: number; expectedSales: number; salesPerLaborHour: number | null }

export type ScheduleEvaluation = {
  days: DayMetrics[]
  month: PeriodSummary & { budgetHours: number | null }
  weekday: PeriodSummary
  weekendHoliday: PeriodSummary
  /** Paid hours above the daily limit, summed over everyone. */
  overtimeHours: number
  lateNightHours: number
  /** Employee working days above the daily limit. */
  employeeDaysOverDaily: number
  /** Part-timers with a week above 20 paid hours. */
  partTimersOver20h: number
  violations: Violation[]
  coverage: CoverageSummary
}

const LABEL = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/
const EMPLOYEE_MAX_DAYS = 22

export const shiftRange = (label: string | undefined): { start: number; end: number } | null => {
  const match = LABEL.exec(label ?? '')
  if (!match) return null
  const start = Number(match[1]) + Number(match[2]) / 60
  let end = Number(match[3]) + Number(match[4]) / 60
  if (end <= start) end += 24
  return { start, end }
}

const pad = (value: number) => String(value).padStart(2, '0')
const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const addDays = (dateStr: string, days: number) => {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return keyOf(date)
}

export const configTypeOf = (dateStr: string, selectedSpecialDays: string[], holidays: Readonly<Record<string, string>>) => {
  if (selectedSpecialDays.includes(dateStr)) return dateStr
  const weekday = new Date(`${dateStr}T00:00:00`).getDay()
  return weekday === 0 || weekday === 6 || holidays[dateStr] ? 'we' : 'wd'
}

/** Hours of [start, end) (decimal hours, end may pass 24) inside the late-night window. */
export const lateNightOverlap = (start: number, end: number, rules: LaborRules) => {
  const windowStart = rules.lateNightStart / 60
  let windowEnd = rules.lateNightEnd / 60
  if (windowEnd <= windowStart) windowEnd += 24
  let total = 0
  for (const offset of [-24, 0, 24]) {
    total += Math.max(0, Math.min(end, windowEnd + offset) - Math.max(start, windowStart + offset))
  }
  return total
}

const jobOf = (person: EvaluatedStaff, date: string): CurveJob => {
  const role = person.assignedRoles?.[date]
  if (role === 'キッチン' || role === 'ホール') return role
  return person.mainJob === 'キッチン' ? 'キッチン' : 'ホール'
}

const round1 = (value: number) => Math.round(value * 10) / 10

const summarize = (days: DayMetrics[]): PeriodSummary => {
  const laborHours = days.reduce((total, day) => total + day.laborHours, 0)
  const withSales = days.filter(day => day.expectedSales !== null)
  const expectedSales = withSales.reduce((total, day) => total + (day.expectedSales ?? 0), 0)
  const salesHours = withSales.reduce((total, day) => total + day.laborHours, 0)
  return {
    days: days.length,
    laborHours: round1(laborHours),
    expectedSales,
    salesPerLaborHour: salesHours > 0 ? Math.round(expectedSales / salesHours) : null,
  }
}

export const evaluateSchedule = (input: EvaluationInput): ScheduleEvaluation => {
  const { targetYear, targetMonth, staff, rules } = input
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, index) => `${targetYear}-${pad(targetMonth)}-${pad(index + 1)}`)
  const target = rules.targetSalesPerLaborHour
  const violations: Violation[] = []

  // Per day.
  const days: DayMetrics[] = dates.map(date => {
    const configType = configTypeOf(date, input.selectedSpecialDays, input.holidays)
    const staffed: Record<CurveJob, number[]> = { ホール: Array(24).fill(0), キッチン: Array(24).fill(0) }
    let laborHours = 0
    let people = 0
    let lateNightHours = 0
    for (const person of staff) {
      const range = shiftRange(person.shifts[date])
      if (!range) continue
      people++
      laborHours += calculateActualHours(range.start, range.end)
      lateNightHours += lateNightOverlap(range.start, range.end, rules)
      const job = jobOf(person, date)
      for (let hour = Math.floor(range.start); hour < Math.min(24, Math.ceil(range.end)); hour++) {
        const overlap = Math.min(range.end, hour + 1) - Math.max(range.start, hour)
        if (overlap > 0) staffed[job][hour] += overlap
      }
    }
    const sales = input.expectedSales[configType]
    const expectedSales = typeof sales === 'number' ? sales : null
    const curve = input.curves[configType] ?? null
    const hasCurve = Boolean(curve && CURVE_JOBS.some(job => Object.keys(curve[job]).length > 0))
    let overstaffedHours: number | null = null
    let understaffedHours: number | null = null
    let balanceByHour: Record<number, number> | null = null
    if (curve && hasCurve) {
      overstaffedHours = 0
      understaffedHours = 0
      balanceByHour = {}
      const prep = new Set(curve.closing_prep)
      for (let hour = 0; hour < 24; hour++) {
        let balance = 0
        let any = false
        for (const job of CURVE_JOBS) {
          const required = curve[job][String(hour)] ?? 0
          const have = staffed[job][hour]
          if (required === 0 && have === 0) continue
          any = true
          balance += have - required
          if (have > required && !prep.has(String(hour))) overstaffedHours += have - required
          if (have < required) understaffedHours += required - have
        }
        if (any) balanceByHour[hour] = round1(balance)
      }
      overstaffedHours = round1(overstaffedHours)
      understaffedHours = round1(understaffedHours)
    }
    const budgetHours = expectedSales !== null && target > 0 ? round1(expectedSales / target) : null
    return {
      date,
      configType,
      people,
      laborHours: round1(laborHours),
      expectedSales,
      salesPerLaborHour: expectedSales !== null && laborHours > 0 ? Math.round(expectedSales / laborHours) : null,
      budgetHours,
      hoursToTarget: budgetHours !== null ? round1(budgetHours - laborHours) : null,
      lateNightHours: round1(lateNightHours),
      overstaffedHours,
      understaffedHours,
      balanceByHour,
    }
  })

  // Per person: hard rules.
  const previous = new Map((input.previousMonth ?? []).map(person => [person.id, person.shifts]))
  let overtimeHours = 0
  let employeeDaysOverDaily = 0
  let partTimersOver20h = 0
  const firstDate = dates[0]
  for (const person of staff) {
    const shiftsOf = (date: string) => (date < firstDate ? previous.get(person.id)?.[date] : person.shifts[date])
    const paidOn = (date: string) => {
      const range = shiftRange(shiftsOf(date))
      return range ? calculateActualHours(range.start, range.end) : 0
    }
    let workedDays = 0
    let monthHours = 0
    for (const date of dates) {
      const range = shiftRange(person.shifts[date])
      if (!range) continue
      workedDays++
      const paid = calculateActualHours(range.start, range.end)
      monthHours += paid
      if (paid > rules.dailyMaxHours + 1e-9) {
        overtimeHours += paid - rules.dailyMaxHours
        if (person.isEmployee) employeeDaysOverDaily++
        violations.push({ kind: 'daily_max', staffId: person.id, date, detail: `実働${round1(paid)}時間` })
      }
      if (rules.minShiftHours > 0 && range.end - range.start < rules.minShiftHours - 1e-9) {
        violations.push({ kind: 'min_shift', staffId: person.id, date, detail: `${round1(range.end - range.start)}時間` })
      }
      if (person.isMinor && lateNightOverlap(range.start, range.end, rules) > 1e-9) {
        violations.push({ kind: 'minor_late_night', staffId: person.id, date, detail: person.shifts[date] })
      }
      const before = shiftRange(shiftsOf(addDays(date, -1)))
      if (before) {
        const gap = 24 + range.start - before.end
        if (gap < rules.restIntervalHours - 1e-9) {
          violations.push({ kind: 'rest_interval', staffId: person.id, date, detail: `${round1(gap)}時間` })
        }
      }
    }
    if (person.isEmployee && workedDays > EMPLOYEE_MAX_DAYS) {
      violations.push({ kind: 'employee_days', staffId: person.id, date: firstDate, detail: `${workedDays}日` })
    }

    // Weeks that touch the month, starting on weekStartDay (days before the month come from previousMonth).
    const firstWeekday = new Date(`${firstDate}T00:00:00`).getDay()
    let weekStart = addDays(firstDate, -((firstWeekday - rules.weekStartDay + 7) % 7))
    let over20 = false
    while (weekStart <= dates[dates.length - 1]) {
      let weekHours = 0
      for (let offset = 0; offset < 7; offset++) {
        const date = addDays(weekStart, offset)
        if (date > dates[dates.length - 1]) break
        weekHours += paidOn(date)
      }
      if (rules.laborTimeMode === 'weekly_40' && weekHours > rules.weeklyMaxHours + 1e-9) {
        violations.push({ kind: 'weekly_max', staffId: person.id, date: weekStart, detail: `${round1(weekHours)}時間` })
      }
      if (!person.isEmployee && weekHours > 20 + 1e-9) over20 = true
      weekStart = addDays(weekStart, 7)
    }
    if (over20) partTimersOver20h++
    if (rules.laborTimeMode === 'monthly_variable') {
      const limit = monthlyLegalHours(daysInMonth, rules.weeklyMaxHours)
      if (monthHours > limit + 1e-9) {
        violations.push({ kind: 'monthly_legal', staffId: person.id, date: firstDate, detail: `${round1(monthHours)} / ${limit}時間` })
      }
    }
  }

  const monthSummary = summarize(days)
  const budget = days.every(day => day.budgetHours !== null) ? round1(days.reduce((total, day) => total + (day.budgetHours ?? 0), 0)) : null
  return {
    days,
    month: { ...monthSummary, budgetHours: budget },
    weekday: summarize(days.filter(day => day.configType === 'wd')),
    weekendHoliday: summarize(days.filter(day => day.configType !== 'wd')),
    overtimeHours: round1(overtimeHours),
    lateNightHours: round1(days.reduce((total, day) => total + day.lateNightHours, 0)),
    employeeDaysOverDaily,
    partTimersOver20h,
    violations,
    coverage: evaluateCoverage(input, dates),
  }
}

const RANK_ORDER: Record<string, number> = { A: 3, B: 2, C: 1 }

/**
 * Coverage checked minute by minute from the shift labels (independent of the
 * generator's coverage.ts): business minutes worked without a 責任者, days
 * without an opener / closer, and minutes worked by novices only (part-timers
 * below the rank floor; unset ranks count as B).
 */
export const evaluateCoverage = (input: EvaluationInput, dates: string[]): CoverageSummary => {
  const { rules, storeHours } = input
  const floor = RANK_ORDER[rules.noviceRankFloor]
  const days: DayCoverageMetrics[] = []
  for (const date of dates) {
    const working = input.staff
      .map(person => ({ person, range: shiftRange(person.shifts[date]) }))
      .filter((item): item is { person: EvaluatedStaff; range: { start: number; end: number } } => item.range !== null)
      .map(({ person, range }) => ({ person, from: Math.round(range.start * 60), to: Math.round(range.end * 60) }))
    const day: DayCoverageMetrics = { date, noLeadHours: 0, noOpen: false, noClose: false, noviceOnlyHours: 0 }
    if (working.length > 0) {
      const open = storeHours ? Math.round(storeHours.start * 60) : null
      const close = storeHours ? Math.round(storeHours.end * 60) : null
      if (rules.checkOpenClose && open !== null && close !== null) {
        day.noOpen = !working.some(item => item.person.canOpen === true && item.from <= open && item.to > open)
        day.noClose = !working.some(item => item.person.canClose === true && item.to >= close && item.from < close)
      }
      const first = Math.min(...working.map(item => item.from))
      const last = Math.max(...working.map(item => item.to))
      let noLead = 0
      let noviceOnly = 0
      for (let minute = first; minute < last; minute++) {
        const here = working.filter(item => item.from <= minute && item.to > minute)
        if (here.length === 0) continue
        if (rules.checkLead && open !== null && close !== null && minute >= open && minute < close && !here.some(item => item.person.canLead === true)) noLead++
        if (here.every(item => !item.person.isEmployee && (RANK_ORDER[item.person.rank ?? ''] ?? 2) < floor)) noviceOnly++
      }
      day.noLeadHours = Math.round(noLead / 60 * 100) / 100
      day.noviceOnlyHours = Math.round(noviceOnly / 60 * 100) / 100
    }
    days.push(day)
  }
  return {
    days,
    noLeadHours: round1(days.reduce((total, day) => total + day.noLeadHours, 0)),
    noOpenDays: days.filter(day => day.noOpen).length,
    noCloseDays: days.filter(day => day.noClose).length,
    noviceOnlyHours: round1(days.reduce((total, day) => total + day.noviceOnlyHours, 0)),
  }
}

export const VIOLATION_LABELS: Record<ViolationKind, string> = {
  daily_max: '1日の上限超え',
  weekly_max: '週の上限超え',
  monthly_legal: '月の法定時間超え（変形労働時間制）',
  rest_interval: '勤務間インターバル不足',
  min_shift: '最低勤務時間より短い',
  minor_late_night: '18歳未満の深夜勤務',
  employee_days: '社員の22日超え',
}
