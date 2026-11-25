import { describe, expect, it } from 'vitest'
import { DEFAULT_REQUEST_DEADLINE_DAY, deadlineDayOf, formatDeadline, requestDeadlineDate } from '@/lib/request-deadline'

describe('request deadline', () => {
  it('defaults to 前月22日 when the store has none', () => {
    expect(deadlineDayOf(null)).toBe(DEFAULT_REQUEST_DEADLINE_DAY)
    expect(deadlineDayOf(undefined)).toBe(22)
    expect(deadlineDayOf(0)).toBe(22)
    expect(deadlineDayOf(15)).toBe(15)
  })

  it('is that day of the previous month, across the year boundary', () => {
    expect(requestDeadlineDate('2027-02-01', 22)).toBe('2027-01-22')
    expect(requestDeadlineDate('2027-01-01', 22)).toBe('2026-12-22')
  })

  it('falls on the last day of a shorter month', () => {
    expect(requestDeadlineDate('2027-03-01', 31)).toBe('2027-02-28')
    expect(requestDeadlineDate('2028-03-01', 30)).toBe('2028-02-29')
    expect(requestDeadlineDate('2027-05-01', 31)).toBe('2027-04-30')
  })

  it('formats as 〇月〇日', () => {
    expect(formatDeadline('2027-01-22')).toBe('1月22日')
    expect(formatDeadline('2026-12-05')).toBe('12月5日')
  })
})
