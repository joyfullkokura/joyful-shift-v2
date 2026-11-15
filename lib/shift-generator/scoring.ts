// Candidate scoring for the first assignment pass. Higher is better.
// Every term is kept separately so tests (and future multi-start comparison)
// can see why a candidate won. The arithmetic, including the order in which the
// terms are summed, matches the original page implementation exactly.

export const RESCUE_BOOST = 250
export const OVER_TARGET_PENALTY_PER_DAY = -150
export const STREAK_PENALTY = -500
/** A staff member's 3rd consecutive working day triggers STREAK_PENALTY. */
export const STREAK_LENGTH = 3
export const WEEKEND_FATIGUE_PENALTY_PER_SHIFT = -30
/** Deducted per uncovered quarter hour of the slot. */
export const TIME_SHORTFALL_PENALTY_PER_QUARTER_HOUR = 15

export const rankScoreOf = (rank: string | null | undefined) => (rank === 'A' ? 30 : rank === 'B' ? 20 : 0)

export type CandidateFactors = {
  /** target_work_days ?? weekly_target_days ?? 0 */
  weeklyTargetDays: number
  daysInMonth: number
  /** 1-based day of month being filled. */
  day: number
  /** Days already assigned before this day. */
  assignedDays: number
  /** Consecutive working days up to (not including) this day. */
  consecutiveDays: number
  rank: string | null | undefined
  /** Ranks of staff already placed on overlapping shifts this day (undefined = unknown staff). */
  overlappingRanks: Array<string | null | undefined>
  /** Hours of the slot the candidate cannot cover. */
  shortfall: number
  /** Weekend / holiday shifts already worked this month; 0 when the day is a weekday. */
  previousWeekendShifts: number
}

export type ScoreBreakdown = {
  /** (target rate - current attendance rate) x 100 */
  attendance: number
  /** 救済ブースト: attendance below half of the target rate. */
  rescueBoost: number
  /** 超過ブレーキ: each day beyond the monthly target. */
  overTarget: number
  /** 連勤ペナルティ */
  streak: number
  /** Rank bonus, tripled when the overlapping crew is weak. */
  rank: number
  timeShortfall: number
  /** 週末疲労ペナルティ */
  weekendFatigue: number
  total: number
}

export const scoreCandidate = (factors: CandidateFactors): ScoreBreakdown => {
  const targetRate = (factors.weeklyTargetDays * 4) / factors.daysInMonth
  const previousDays = factors.day - 1
  const currentRate = previousDays > 0 ? factors.assignedDays / previousDays : 0
  const attendance = (targetRate - currentRate) * 100
  const rescueBoost = targetRate > 0 && currentRate < targetRate * 0.5 ? RESCUE_BOOST : 0

  const targetMonthDays = (factors.weeklyTargetDays / 7) * factors.daysInMonth
  const excessWorkDays = targetMonthDays > 0 ? Math.max(0, factors.assignedDays + 1 - targetMonthDays) : 0
  const overTarget = excessWorkDays * OVER_TARGET_PENALTY_PER_DAY

  const streak = factors.consecutiveDays + 1 >= STREAK_LENGTH ? STREAK_PENALTY : 0

  const overlappingScores = factors.overlappingRanks.map(rankScoreOf)
  const averageRankScore = overlappingScores.length > 0
    ? overlappingScores.reduce<number>((total, score) => total + score, 0) / overlappingScores.length
    : 0
  const rank = rankScoreOf(factors.rank) * (averageRankScore < 20 ? 3 : 1)

  const timeShortfall = -Math.round(factors.shortfall / 0.25) * TIME_SHORTFALL_PENALTY_PER_QUARTER_HOUR
  const weekendFatigue = factors.previousWeekendShifts * WEEKEND_FATIGUE_PENALTY_PER_SHIFT

  return {
    attendance,
    rescueBoost,
    overTarget,
    streak,
    rank,
    timeShortfall,
    weekendFatigue,
    total: attendance + rescueBoost + overTarget + streak + rank + timeShortfall + weekendFatigue,
  }
}
