import { describe, expect, it } from 'vitest'
import { getHolidayName, holidaysOfYear, isHoliday } from '@/lib/holidays'
import cao from './fixtures/cao-holidays-2020-2027.json'
import { LEGACY_HOLIDAYS } from '@/lib/shift-generator/__tests__/fixtures/legacy-holidays'

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]

/** The Cabinet Office lists both 振替休日 and 国民の休日 as 「休日」. */
const toCaoName = (name: string) => (name === '振替休日' || name === '国民の休日' ? '休日' : name)

describe('holidaysOfYear vs Cabinet Office data (2020-2027)', () => {
  it.each(YEARS)('%i matches exactly (dates and names)', year => {
    const expected = Object.fromEntries(Object.entries(cao.holidays).filter(([date]) => date.startsWith(`${year}-`)))
    const computed = Object.fromEntries(Object.entries(holidaysOfYear(year)).map(([date, name]) => [date, toCaoName(name)]))
    expect(computed).toEqual(expected)
  })

  it('covers all 143 published dates', () => {
    expect(YEARS.reduce((total, year) => total + Object.keys(holidaysOfYear(year)).length, 0)).toBe(Object.keys(cao.holidays).length)
  })
})

describe('holiday rules', () => {
  it('moves a Sunday holiday to the next non-holiday day (振替休日)', () => {
    // 2026-05-03 (Sun) -> 5/4 and 5/5 are holidays -> 5/6
    expect(getHolidayName('2026-05-06')).toBe('振替休日')
  })

  it('marks a day between two holidays (国民の休日)', () => {
    expect(getHolidayName('2026-09-22')).toBe('国民の休日')
  })

  it('applies the Olympic moves of 2020 and 2021 only in those years', () => {
    expect(getHolidayName('2021-07-23')).toBe('スポーツの日')
    expect(getHolidayName('2021-08-09')).toBe('振替休日') // 山の日 on Sun 8/8
    expect(getHolidayName('2022-10-10')).toBe('スポーツの日')
  })

  it('keeps working after the end of the old hand-written table', () => {
    expect(getHolidayName('2028-01-01')).toBe('元日')
    expect(getHolidayName('2028-01-10')).toBe('成人の日')
    expect(isHoliday('2028-01-11')).toBe(false)
  })

  it('returns null for ordinary days and malformed keys', () => {
    expect(getHolidayName('2026-06-10')).toBeNull()
    expect(getHolidayName('not-a-date')).toBeNull()
  })
})

describe('differences from the old hand-written table (2026-2027)', () => {
  it('only corrects the 2026 vernal equinox day', () => {
    const computed = { ...holidaysOfYear(2026), ...holidaysOfYear(2027) }
    const onlyInOld = Object.keys(LEGACY_HOLIDAYS).filter(date => !(date in computed))
    const onlyInComputed = Object.keys(computed).filter(date => !(date in LEGACY_HOLIDAYS))
    expect(onlyInOld).toEqual(['2026-03-21'])
    expect(onlyInComputed).toEqual(['2026-03-20'])
  })
})
