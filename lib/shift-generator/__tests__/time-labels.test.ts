import { describe, expect, it } from 'vitest'
import { generateSchedule } from '../generate'
import { fToT, formatAlertTime } from '../time'
import { LEGACY_HOLIDAYS } from './fixtures/legacy-holidays'
import { randomGeneratorInput } from './fixtures/random-input'

describe('fToT', () => {
  it.each([
    [10, '10:00'],
    [19.75, '19:45'],
    [19.999999999, '20:00'], // used to print 19:60
    [23.9999999, '24:00'],
    [24, '24:00'],
    [9.5, '09:30'],
    [25.25, '25:15'],
  ])('%s -> %s', (value, expected) => {
    expect(fToT(value)).toBe(expected)
  })
})

describe('formatAlertTime', () => {
  it.each([
    [19.999999999, '20:00'],
    [23.9999999, '24:00'],
    [24, '24:00'],
    [26, '02:00'],
    [10.25, '10:15'],
  ])('%s -> %s', (value, expected) => {
    expect(formatAlertTime(value)).toBe(expected)
  })
})

describe('generated shift labels', () => {
  it('always use real clock minutes on the 15-minute grid (300 seeded stores)', () => {
    const label = /^(\d{2}):(00|15|30|45)-(\d{2}):(00|15|30|45)$/
    for (let seed = 1; seed <= 300; seed++) {
      const schedule = generateSchedule({ ...randomGeneratorInput(seed), holidays: LEGACY_HOLIDAYS })
      for (const row of schedule.staff) {
        for (const [date, shift] of Object.entries(row.shifts)) {
          if (shift === '×' || shift === '') continue
          if (!label.test(shift)) throw new Error(`seed ${seed} ${row.id} ${date}: ${shift}`)
        }
      }
      for (const alert of schedule.alerts) expect(alert.message).not.toMatch(/:60/)
    }
  }, 60_000)
})
