import { describe, expect, it } from 'vitest'
import { type PastSchedule, curveTotalAt, parseRequiredCurve, pastStaffingCurve } from '@/lib/required-curve'

describe('parseRequiredCurve', () => {
  it('accepts hours 0-23 with up to one decimal and drops zeros', () => {
    expect(parseRequiredCurve({ ホール: { '10': 2, '11': 0, '21': 3.5 }, キッチン: { '17': 1.2 }, closing_prep: ['21', '21'] }))
      .toEqual({ ホール: { '10': 2, '21': 3.5 }, キッチン: { '17': 1.2 }, closing_prep: ['21'] })
  })

  it('refuses other hours, negative or too precise numbers and bad prep hours', () => {
    expect(parseRequiredCurve({ ホール: { '24': 1 } })).toBeNull()
    expect(parseRequiredCurve({ ホール: { '10': -1 } })).toBeNull()
    expect(parseRequiredCurve({ ホール: { '10': 1.25 } })).toBeNull()
    expect(parseRequiredCurve({ closing_prep: ['25'] })).toBeNull()
    expect(parseRequiredCurve(null)).toBeNull()
  })

  it('accepts an empty curve', () => {
    expect(parseRequiredCurve({})).toEqual({ ホール: {}, キッチン: {}, closing_prep: [] })
  })
})

describe('pastStaffingCurve', () => {
  // 2027-02-01 Monday, 02 Tuesday, 06 Saturday.
  const weekend = (date: string) => ['2027-02-06', '2027-02-07'].includes(date)
  const schedules: PastSchedule[] = [{
    staff: [
      { mainJob: 'ホール', shifts: { '2027-02-01': '10:00-14:00', '2027-02-02': '10:30-12:00', '2027-02-06': '17:00-22:00' } },
      { mainJob: 'キッチン', shifts: { '2027-02-01': '11:00-15:00', '2027-02-02': '×' } },
      { mainJob: '共通', assignedRoles: { '2027-02-01': 'キッチン' }, shifts: { '2027-02-01': '20:00-24:00' } },
    ],
  }]

  it('averages people per hour by share of the hour, separately for weekdays and weekends', () => {
    const result = pastStaffingCurve(schedules, '2027-02-01', '2027-02-28', weekend)
    expect(result.wd.days).toBe(2)
    // Hall at 10: Monday 1, Tuesday 0.5 -> 0.75 -> rounded 0.8.
    expect(result.wd.curve['ホール']['10']).toBe(0.8)
    expect(result.wd.curve['ホール']['13']).toBe(0.5)
    expect(result.wd.curve['キッチン']['11']).toBe(0.5)
    expect(result.wd.curve['キッチン']['23']).toBe(0.5) // the 共通 person worked the kitchen
    expect(result.we.days).toBe(1)
    expect(result.we.curve['ホール']['17']).toBe(1)
    expect(curveTotalAt(result.wd.curve, 11)).toBe(1.5) // hall 1 + kitchen 0.5
  })

  it('ignores dates outside the window and has no values without data', () => {
    const result = pastStaffingCurve(schedules, '2027-03-01', '2027-03-31', weekend)
    expect(result.wd).toEqual({ curve: { ホール: {}, キッチン: {}, closing_prep: [] }, days: 0 })
  })
})
