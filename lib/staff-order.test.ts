import { describe, expect, it } from 'vitest'
import { compareStaffOrder, sortByRank, sortStaff, staffRankOf, suggestCategory } from '@/lib/staff-order'

const person = (id: string, name: string, category: string | null, displayOrder: number | null) => ({ id, name, category, display_order: displayOrder })

describe('sortStaff', () => {
  it('orders by category (社員 → DF → DK → LF → LK), then display order, then name', () => {
    const staff = [
      person('1', '渡部', 'LK', 1),
      person('2', '武石優子', 'LF', 1001),
      person('3', '西田', 'LF', 1),
      person('4', '高木', 'DF', 2),
      person('5', '宝村文子', 'DF', 1),
      person('6', '小田川', 'DK', 1),
      person('7', '多田', '社員', 1),
    ]
    expect(sortStaff(staff).map(row => row.name)).toEqual(['多田', '宝村文子', '高木', '小田川', '西田', '武石優子', '渡部'])
  })

  it('puts people without a category after LK, in name order, without failing (TEST store: all null)', () => {
    const staff = [person('a', 'テスト店長', null, null), person('b', 'テストスタッフ', null, null), person('c', '渡部', 'LK', 1)]
    expect(sortStaff(staff).map(row => row.name)).toEqual(['渡部', 'テストスタッフ', 'テスト店長'])
    expect(sortStaff([person('x', 'B', null, null), person('y', 'A', null, null)]).map(row => row.name)).toEqual(['A', 'B'])
  })

  it('treats a missing display order as last inside the category and ignores unknown categories', () => {
    expect(compareStaffOrder(person('1', 'A', 'DF', null), person('2', 'B', 'DF', 5))).toBeGreaterThan(0)
    expect(compareStaffOrder(person('1', 'A', 'XX', 1), person('2', 'B', 'LK', 9))).toBeGreaterThan(0)
  })
})

describe('ranks', () => {
  it('sorts saved schedule rows by the current order; people no longer listed go last', () => {
    const rank = staffRankOf([person('7', '多田', '社員', 1), person('5', '宝村文子', 'DF', 1)])
    const rows = [{ id: 'gone', name: '退職者' }, { id: '5', name: '宝村文子' }, { id: '7', name: '多田' }]
    expect(sortByRank(rows, rank).map(row => row.name)).toEqual(['多田', '宝村文子', '退職者'])
  })
})

describe('suggestCategory', () => {
  const week = (value: object, overrides: Record<string, object> = {}) => ({
    ...Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, value])),
    ...overrides,
  })
  const evening = { kind: 'from', start: '17:00', end: null }
  const lunch = { kind: 'range', start: '10:00', end: '15:00' }
  const off = { kind: 'off', start: null, end: null }

  it('suggests 社員 for employees', () => {
    expect(suggestCategory({ isEmployee: true, main_job: 'キッチン' })).toBe('社員')
  })

  it('uses the main job for F / K and the weekday times for D / L', () => {
    expect(suggestCategory({ isEmployee: false, main_job: 'ホール', weekly_availability: week(evening) })).toBe('DF')
    expect(suggestCategory({ isEmployee: false, main_job: 'キッチン', weekly_availability: week(lunch) })).toBe('LK')
    expect(suggestCategory({ isEmployee: false, main_job: '共通', weekly_availability: week(evening, { saturday: off, sunday: off }) })).toBe('DF')
    // 3 evening days of 6 available: not most of them.
    expect(suggestCategory({ isEmployee: false, main_job: 'キッチン', weekly_availability: week(lunch, { monday: evening, tuesday: evening, wednesday: evening, sunday: off }) })).toBe('LK')
  })

  it('falls back to time band 1, then to L', () => {
    expect(suggestCategory({ isEmployee: false, main_job: 'ホール', work_start_1: '17:00:00' })).toBe('DF')
    expect(suggestCategory({ isEmployee: false, main_job: 'ホール', work_start_1: '11:00:00' })).toBe('LF')
    expect(suggestCategory({ isEmployee: false, main_job: null })).toBe('LF')
  })
})
