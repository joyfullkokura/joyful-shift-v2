import { describe, expect, it } from 'vitest'
import {
  formatWeeklyAvailability,
  parseWeeklyAvailability,
  toParsedConditions,
  weekdayKeyOf,
  applyWeeklyAvailabilityChange,
  parseWeeklyAvailabilityChange,
  weeklyFromWorkRanges,
} from '@/lib/weekly-availability'

const off = { kind: 'off', start: null, end: null }
const sample = {
  monday: { kind: 'from', start: '17:00', end: null },
  tuesday: { kind: 'from', start: '17:00:00', end: null },
  wednesday: off,
  thursday: { kind: 'until', start: null, end: '15:00' },
  friday: { kind: 'range', start: '10:00', end: '14:00' },
  saturday: { kind: 'any', start: null, end: null },
  sunday: off,
}

describe('parseWeeklyAvailability', () => {
  it('accepts all seven days and normalises times', () => {
    expect(parseWeeklyAvailability(sample)?.tuesday).toEqual({ kind: 'from', start: '17:00', end: null })
  })

  it('rejects missing days, none and invalid ranges', () => {
    const sixDays: Record<string, unknown> = { ...sample }
    delete sixDays.sunday
    expect(parseWeeklyAvailability(sixDays)).toBeNull()
    expect(parseWeeklyAvailability({ ...sample, sunday: { kind: 'none', start: null, end: null } })).toBeNull()
    expect(parseWeeklyAvailability({ ...sample, friday: { kind: 'range', start: '14:00', end: '10:00' } })).toBeNull()
    expect(parseWeeklyAvailability(null)).toBeNull()
  })
})

describe('helpers', () => {
  it('maps dates to weekday keys', () => {
    expect(weekdayKeyOf('2027-02-01')).toBe('monday')
    expect(weekdayKeyOf('2027-02-07')).toBe('sunday')
  })

  it('starts from the first old time band on every day', () => {
    expect(weeklyFromWorkRanges('17:00:00', '22:00:00').monday).toEqual({ kind: 'range', start: '17:00', end: '22:00' })
    expect(weeklyFromWorkRanges(null, '22:00')).toEqual({})
  })

  it('derives parsed_conditions within business hours', () => {
    const weekly = parseWeeklyAvailability(sample)
    expect(weekly).not.toBeNull()
    const parsed = toParsedConditions(weekly!, { open: 9 * 60, close: 24 * 60 })
    expect(parsed.monday).toEqual({ is_available: true, start_time: '17:00', end_time: '24:00' })
    expect(parsed.wednesday).toEqual({ is_available: false, start_time: null, end_time: null })
    expect(parsed.thursday).toEqual({ is_available: true, start_time: '09:00', end_time: '15:00' })
    expect(parsed.saturday).toEqual({ is_available: true, start_time: '09:00', end_time: '24:00' })
  })

  it('formats one line', () => {
    expect(formatWeeklyAvailability(sample)).toBe('月 17:00〜 / 火 17:00〜 / 水 × / 木 〜15:00 / 金 10:00〜14:00 / 土 終日OK / 日 ×')
  })
})

describe('weekday change requests', () => {
  const evening = { kind: 'from', start: '18:00', end: null } as const

  it('accepts some valid weekdays and refuses unknown keys, none and empty changes', () => {
    expect(parseWeeklyAvailabilityChange({ monday: evening })).toEqual({ monday: evening })
    expect(parseWeeklyAvailabilityChange({})).toBeNull()
    expect(parseWeeklyAvailabilityChange({ funday: evening })).toBeNull()
    expect(parseWeeklyAvailabilityChange({ monday: { kind: 'none', start: null, end: null } })).toBeNull()
    expect(parseWeeklyAvailabilityChange({ monday: { kind: 'range', start: '14:00', end: '10:00' } })).toBeNull()
    expect(parseWeeklyAvailabilityChange(null)).toBeNull()
  })

  it('lays the change over the current weekday choices (manager edits after the request survive)', () => {
    const current = parseWeeklyAvailability(sample)!
    const editedByManager = { ...current, sunday: { kind: 'any', start: null, end: null } }
    const merged = applyWeeklyAvailabilityChange({ weekly_availability: editedByManager }, { monday: { kind: 'off', start: null, end: null } })
    expect(merged?.monday).toEqual({ kind: 'off', start: null, end: null })
    expect(merged?.sunday).toEqual({ kind: 'any', start: null, end: null })
    expect(merged?.tuesday).toEqual(current.tuesday)
  })

  it('starts from the main old time band when no weekday choices exist', () => {
    const merged = applyWeeklyAvailabilityChange({ work_start_1: '10:00:00', work_end_1: '14:00:00' }, { saturday: { kind: 'off', start: null, end: null } })
    expect(merged?.monday).toEqual({ kind: 'range', start: '10:00', end: '14:00' })
    expect(merged?.saturday).toEqual({ kind: 'off', start: null, end: null })
  })

  it('cannot complete a partial change for someone with no conditions at all', () => {
    expect(applyWeeklyAvailabilityChange({}, { monday: evening })).toBeNull()
  })
})
