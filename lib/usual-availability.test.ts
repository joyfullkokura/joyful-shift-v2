import { describe, expect, it } from 'vitest'
import { changedWeekdays, isSameAsUsual, usualAsWeeklyDraft, usualAvailabilityOf, usualOnDate } from '@/lib/usual-availability'

const off = { kind: 'off', start: null, end: null } as const
const evening = { kind: 'from', start: '18:00', end: null } as const
const weekly = { monday: evening, tuesday: evening, wednesday: off, thursday: evening, friday: evening, saturday: { kind: 'any', start: null, end: null }, sunday: off }

describe('usualAvailabilityOf', () => {
  it('uses the weekday choices when they are set', () => {
    const usual = usualAvailabilityOf({ weekly_availability: weekly, work_start_1: '10:00', work_end_1: '14:00' })
    expect(usual.source).toBe('weekly')
    expect(usual.days.monday).toEqual({ request: evening, short: '18:00〜', long: '18:00〜' })
    expect(usual.days.wednesday).toEqual({ request: off, short: '×', long: '出られない' })
    expect(usual.days.saturday.short).toBe('終日')
  })

  it('falls back to one old time band on every day', () => {
    const usual = usualAvailabilityOf({ work_start_1: '10:00:00', work_end_1: '14:30:00' })
    expect(usual.source).toBe('bands')
    expect(usual.days.friday).toEqual({ request: { kind: 'range', start: '10:00', end: '14:30' }, short: '10:00〜\n14:30', long: '10:00〜14:30' })
  })

  it('shows two old time bands but cannot compare them as one request', () => {
    const usual = usualAvailabilityOf({ work_start_1: '10:00', work_end_1: '14:00', work_start_2: '17:00', work_end_2: '22:30' })
    expect(usual.days.monday).toEqual({ request: null, short: '10-14・17-22:30', long: '10:00〜14:00・17:00〜22:30' })
  })

  it('has nothing when no conditions are set', () => {
    expect(usualAvailabilityOf({}).source).toBe('none')
    expect(usualAvailabilityOf(null).days.sunday).toEqual({ request: null, short: '', long: '' })
  })
})

describe('comparisons', () => {
  const usual = usualAvailabilityOf({ weekly_availability: weekly })

  it('finds the usual day of a date', () => {
    expect(usualOnDate(usual, '2027-02-03').request).toEqual(off) // Wednesday
  })

  it('treats the same choice as unchanged', () => {
    expect(isSameAsUsual({ kind: 'from', start: '18:00', end: null }, usual.days.monday)).toBe(true)
    expect(isSameAsUsual({ kind: 'from', start: '17:00', end: null }, usual.days.monday)).toBe(false)
    expect(isSameAsUsual(null, usual.days.monday)).toBe(false)
    expect(isSameAsUsual(off, usualAvailabilityOf({ work_start_1: '10:00', work_end_1: '14:00', work_start_2: '17:00', work_end_2: '22:00' }).days.monday)).toBe(false)
  })

  it('lists changed weekdays and builds a starting draft', () => {
    const draft = usualAsWeeklyDraft(usual)
    expect(changedWeekdays(draft, { ...draft, monday: off, sunday: off })).toEqual(['monday'])
    expect(Object.keys(usualAsWeeklyDraft(usualAvailabilityOf({})))).toEqual([])
  })
})
