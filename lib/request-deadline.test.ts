import { describe, expect, it } from 'vitest'
import {
  DEADLINE_TIME_CHOICES,
  deadlineInstant,
  deadlineSettingOf,
  deadlineStatus,
  formatDeadline,
  formatDeadlineAt,
  isDeadlinePassed,
  requestDeadlineDate,
  resolveRequestDeadline,
} from '@/lib/request-deadline'

// Japan time is UTC+9: 2026-11-20 21:00 JST = 2026-11-20T12:00:00.000Z.
const jst = (dateTime: string) => Date.parse(`${dateTime}+09:00`)

describe('request deadline: when it is', () => {
  it('monthly setting: that day and time of the previous month, in Japan time', () => {
    expect(deadlineInstant('2026-12-01', { day: 20, time: '21:00' })).toBe('2026-11-20T12:00:00.000Z')
    expect(deadlineInstant('2026-12-01', { day: 20, time: '23:59' })).toBe('2026-11-20T14:59:00.000Z')
    // Before 09:00 JST the instant is on the previous UTC day.
    expect(deadlineInstant('2026-12-01', { day: 20, time: '08:30' })).toBe('2026-11-19T23:30:00.000Z')
  })

  it('a day past the end of the month falls on its last day', () => {
    expect(requestDeadlineDate('2027-03-01', 31)).toBe('2027-02-28')
    expect(requestDeadlineDate('2028-03-01', 30)).toBe('2028-02-29')
    expect(deadlineInstant('2027-05-01', { day: 31, time: '21:00' })).toBe(new Date(jst('2027-04-30T21:00:00')).toISOString())
  })

  it('across the year: January requests are due in December', () => {
    expect(requestDeadlineDate('2027-01-01', 22)).toBe('2026-12-22')
    expect(deadlineInstant('2027-01-01', { day: 22, time: '21:00' })).toBe(new Date(jst('2026-12-22T21:00:00')).toISOString())
  })

  it('an override wins for its month; otherwise the monthly setting; otherwise none', () => {
    const monthly = { day: 20, time: '21:00' }
    expect(resolveRequestDeadline('2026-12-01', monthly, '2026-11-25T03:00:00+00:00'))
      .toEqual({ at: '2026-11-25T03:00:00.000Z', source: 'override' })
    expect(resolveRequestDeadline('2026-12-01', monthly, null)).toEqual({ at: '2026-11-20T12:00:00.000Z', source: 'monthly' })
    expect(resolveRequestDeadline('2026-12-01', null, null)).toBeNull()
    expect(resolveRequestDeadline('2026-12-01', null, '2026-11-25T03:00:00Z')?.source).toBe('override')
  })

  it('reads the store columns: no day = no deadline, the time defaults to 23:59', () => {
    expect(deadlineSettingOf(null, '21:00:00')).toBeNull()
    expect(deadlineSettingOf(0, null)).toBeNull()
    expect(deadlineSettingOf(20, '21:00:00')).toEqual({ day: 20, time: '21:00' })
    expect(deadlineSettingOf(20, null)).toEqual({ day: 20, time: '23:59' })
  })

  it('offers every 15 minutes and 23:59', () => {
    expect(DEADLINE_TIME_CHOICES).toContain('00:00')
    expect(DEADLINE_TIME_CHOICES).toContain('21:45')
    expect(DEADLINE_TIME_CHOICES).toContain('23:59')
    expect(DEADLINE_TIME_CHOICES).not.toContain('21:10')
    expect(DEADLINE_TIME_CHOICES).toHaveLength(97)
  })
})

describe('request deadline: what the screen says', () => {
  const at = '2026-11-20T12:00:00.000Z' // 11/20 (金) 21:00 JST

  it('formats the deadline', () => {
    expect(formatDeadlineAt(at)).toBe('11月20日（金）21:00')
    expect(formatDeadline('2027-01-22')).toBe('1月22日')
  })

  it('counts calendar days in Japan time, not 24-hour periods', () => {
    expect(deadlineStatus(at, jst('2026-11-17T23:59:00'))).toMatchObject({ kind: 'days', daysLeft: 3, urgent: true, label: 'あと 3 日' })
    expect(deadlineStatus(at, jst('2026-11-16T23:59:00'))).toMatchObject({ kind: 'days', daysLeft: 4, urgent: false, label: 'あと 4 日' })
    // 00:30 JST on the 18th is still the 17th in UTC: it must already count as 2 days.
    expect(deadlineStatus(at, jst('2026-11-18T00:30:00'))).toMatchObject({ kind: 'days', daysLeft: 2, label: 'あと 2 日' })
    expect(deadlineStatus(at, jst('2026-11-19T00:00:00'))).toMatchObject({ kind: 'tomorrow', label: '明日 21:00 まで', urgent: true })
    expect(deadlineStatus(at, jst('2026-11-19T23:59:59'))).toMatchObject({ kind: 'tomorrow' })
    expect(deadlineStatus(at, jst('2026-11-20T00:00:00'))).toMatchObject({ kind: 'today', label: '今日 21:00 まで', urgent: true })
  })

  it('the deadline minute itself is still open; one millisecond later it is closed', () => {
    expect(isDeadlinePassed(at, Date.parse(at))).toBe(false)
    expect(deadlineStatus(at, Date.parse(at))).toMatchObject({ kind: 'today', label: '今日 21:00 まで' })
    expect(isDeadlinePassed(at, Date.parse(at) + 1)).toBe(true)
    expect(deadlineStatus(at, Date.parse(at) + 1)).toMatchObject({ kind: 'closed', urgent: false, label: '締め切りました（閲覧のみ）' })
  })

  it('a deadline at 23:59 counts as today until it passes', () => {
    const late = deadlineInstant('2026-12-01', { day: 20, time: '23:59' })
    expect(deadlineStatus(late, jst('2026-11-20T23:58:00')).label).toBe('今日 23:59 まで')
    expect(deadlineStatus(late, jst('2026-11-21T00:00:00')).kind).toBe('closed')
  })
})
