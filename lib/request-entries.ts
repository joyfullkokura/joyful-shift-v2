// The 休み希望 calendar's editing rules, kept pure so that they can be tested:
// what a choice does to the month's entries, and what is sent when saving.

import type { DayRequest } from '@/lib/day-request'
import { type UsualAvailability, isSameAsUsual, usualOnDate } from '@/lib/usual-availability'

/**
 * One day being edited. request null with a memo is an old memo-only request
 * the rules could not read; it is saved back unchanged until someone chooses.
 */
export type DayEntry = { request: DayRequest | null; memo: string }

export type DayEntries = Record<string, DayEntry>

/** What saving sends for one day (the server validates it again). */
export type DayEntryPayload = { date: string; kind: DayRequest['kind'] | null; start: string | null; end: string | null; memo: string }

const NO_REQUEST: DayRequest = { kind: 'none', start: null, end: null }

/**
 * Applies a choice to some dates. request null = 希望なし. A choice equal to the
 * usual availability of that date is no request either. A day left with no
 * request and no memo disappears from the entries, so saving deletes its row.
 * memo undefined keeps each day's own memo (several dates at once).
 */
export const applyDayChoice = (
  previous: DayEntries,
  dates: string[],
  request: DayRequest | null,
  memo: string | undefined,
  usual: UsualAvailability,
): DayEntries => {
  const next = { ...previous }
  for (const date of dates) {
    const keptMemo = memo ?? previous[date]?.memo ?? ''
    const sameAsUsual = isSameAsUsual(request, usualOnDate(usual, date))
    const value: DayEntry = { request: request && !sameAsUsual ? request : NO_REQUEST, memo: keptMemo }
    if (value.request?.kind === 'none' && !keptMemo.trim()) delete next[date]
    else next[date] = value
  }
  return next
}

/**
 * Days sent when saving: a real request, or a memo (kept as 希望なし with the
 * memo). Days not sent are deleted by the server (planMonthRequestSave).
 */
export const toRequestPayload = (entries: DayEntries): DayEntryPayload[] =>
  Object.entries(entries)
    .filter(([, entry]) => (entry.request && entry.request.kind !== 'none') || entry.memo.trim() !== '')
    .map(([date, entry]) => ({
      date,
      kind: entry.request?.kind ?? null,
      start: entry.request?.start ?? null,
      end: entry.request?.end ?? null,
      memo: entry.memo,
    }))
