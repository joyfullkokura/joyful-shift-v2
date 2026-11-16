/**
 * Plans how a staff member's month of day requests is written, so that the
 * cached AI analysis (parsed_request) of a memo survives re-saving the month
 * unless that memo actually changed. Pure: no database access.
 */

export type IncomingDayRequest = { date: string; memo: string }
export type ExistingDayRequest = { date: string; memo: string | null }

/** Columns that hold the analysis of a memo; cleared whenever the memo changes. */
export const CLEARED_ANALYSIS = { parsed_request: null, parse_error: null, parsed_at: null } as const

export type RequestSavePlan<T extends IncomingDayRequest = IncomingDayRequest> = {
  /** Same memo as stored: keep the analysis columns. */
  keepAnalysis: T[]
  /** New day or changed memo: write together with CLEARED_ANALYSIS. */
  resetAnalysis: T[]
  /** Stored days that are no longer in the month's entries. */
  deleteDates: string[]
}

/** Whitespace-only edits do not change what the memo means, so they keep the analysis. */
const normalizeMemo = (memo: string | null): string => (memo ?? '').trim()

export const planMonthRequestSave = <T extends IncomingDayRequest>(existing: ExistingDayRequest[], incoming: T[]): RequestSavePlan<T> => {
  const storedMemo = new Map(existing.map(row => [row.date, normalizeMemo(row.memo)]))
  const incomingDates = new Set(incoming.map(row => row.date))
  const plan: RequestSavePlan<T> = { keepAnalysis: [], resetAnalysis: [], deleteDates: [] }

  for (const row of incoming) {
    const stored = storedMemo.get(row.date)
    if (stored !== undefined && stored === normalizeMemo(row.memo)) plan.keepAnalysis.push(row)
    else plan.resetAnalysis.push(row)
  }
  plan.deleteDates = [...storedMemo.keys()].filter(date => !incomingDates.has(date)).sort()
  return plan
}
