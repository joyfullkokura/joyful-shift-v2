// Hard labor rules for one staff member: may they work start-end on this date,
// given everything already in the ledger? Every pass that creates or changes a
// shift asks this first (assign, relay, swap, takeover, extension).
//   ① 18歳未満の深夜禁止  ② 1日の上限（休憩を除く実働）
//   ③ 週の上限（週40時間）または月の法定時間（1か月単位の変形労働時間制）
//   ⑦ 最低勤務時間  ⑨ 勤務間インターバル
// (The 22-day cap for employees is checked where days are added.)

import { monthlyLegalHours } from '@/lib/labor-rules'
import type { GenerationContext } from './context'
import { paidHoursOn, shiftDate, shiftOn } from './ledger'
import { lateNightOverlap } from './metrics'
import { calculateActualHours } from './time'

export type ConstraintReason = 'minor_late_night' | 'daily_max' | 'weekly_max' | 'monthly_legal' | 'min_shift' | 'rest_interval'

const EPSILON = 1e-9

/**
 * Null when the shift is allowed, otherwise the first rule it breaks. The shift
 * replaces whatever the staff member already has on that date.
 */
export const checkShift = (
  context: GenerationContext,
  staffIndex: number,
  dateStr: string,
  start: number,
  end: number,
): ConstraintReason | null => {
  const { rules } = context
  const staff = context.staffList[staffIndex]
  const paid = calculateActualHours(start, end)

  if (rules.minShiftHours > 0 && end - start < rules.minShiftHours - EPSILON) return 'min_shift'
  if (paid > rules.dailyMaxHours + EPSILON) return 'daily_max'
  if (staff?.is_minor === true && lateNightOverlap(start, end, rules) > EPSILON) return 'minor_late_night'

  const before = shiftOn(context, staffIndex, shiftDate(dateStr, -1))
  if (before && 24 + start - before.end < rules.restIntervalHours - EPSILON) return 'rest_interval'
  const after = shiftOn(context, staffIndex, shiftDate(dateStr, 1))
  if (after && 24 + after.start - end < rules.restIntervalHours - EPSILON) return 'rest_interval'

  if (rules.laborTimeMode === 'weekly_40') {
    const weekday = new Date(`${dateStr}T00:00:00`).getDay()
    const weekStart = shiftDate(dateStr, -((weekday - rules.weekStartDay + 7) % 7))
    let weekHours = paid
    for (let offset = 0; offset < 7; offset++) {
      const date = shiftDate(weekStart, offset)
      if (date !== dateStr) weekHours += paidHoursOn(context, staffIndex, date)
    }
    if (weekHours > rules.weeklyMaxHours + EPSILON) return 'weekly_max'
  } else {
    const { targetYear, targetMonth } = context.input
    let monthHours = paid
    for (let day = 1; day <= context.daysInMonth; day++) {
      const date = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (date !== dateStr) monthHours += paidHoursOn(context, staffIndex, date)
    }
    if (monthHours > monthlyLegalHours(context.daysInMonth, rules.weeklyMaxHours) + EPSILON) return 'monthly_legal'
  }
  return null
}
