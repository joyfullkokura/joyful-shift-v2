import { describe, expect, it } from 'vitest'
import {
  formatWeeklyAvailability,
  parseWeeklyAvailability,
  toParsedConditions,
  weekdayKeyOf,
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
    const { sunday: _sunday, ...sixDays } = sample
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
