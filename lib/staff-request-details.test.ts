import { describe, expect, it } from 'vitest'
import { getConditionChangeDetails, getNewStaffRegistrationDetails } from '@/lib/staff-request-details'

describe('getConditionChangeDetails', () => {
  it('accepts a complete request', () => {
    expect(getConditionChangeDetails({
      weekly_target_days: 3,
      main_job: 'ホール',
      memo: '',
      skills: ['レジ'],
      available_hours: { start: '10:00', end: '18:00' },
    })).toEqual({
      weekly_target_days: 3,
      main_job: 'ホール',
      memo: '',
      skills: ['レジ'],
      available_hours: { start: '10:00', end: '18:00' },
    })
  })

  it('keeps an explicit null for available_hours and drops malformed skills', () => {
    expect(getConditionChangeDetails({ weekly_target_days: 2, main_job: 'キッチン', memo: 'x', skills: ['a', 1], available_hours: null }))
      .toEqual({ weekly_target_days: 2, main_job: 'キッチン', memo: 'x', available_hours: null })
  })

  it('accepts a request with only some fields and leaves the others absent', () => {
    const off = { kind: 'off', start: null, end: null }
    const weekly = { monday: off, tuesday: off, wednesday: off, thursday: off, friday: off, saturday: { kind: 'from', start: '18:00', end: null }, sunday: off }
    expect(getConditionChangeDetails({ weekly_availability: weekly })).toEqual({ weekly_availability: weekly })
    expect(getConditionChangeDetails({ main_job: 'ホール', memo: '' })).toEqual({ main_job: 'ホール', memo: '' })
  })

  it('accepts only some weekdays (the changed ones) and refuses unknown weekday keys', () => {
    const evening = { kind: 'from', start: '18:00', end: null }
    expect(getConditionChangeDetails({ weekly_availability: { tuesday: evening } })).toEqual({ weekly_availability: { tuesday: evening } })
    expect(getConditionChangeDetails({ weekly_availability: { tuesday: evening, holiday: evening } })).toBeNull()
    expect(getConditionChangeDetails({ weekly_availability: {} })).toBeNull()
  })

  it('rejects wrong types, invalid weekday choices, empty requests and non-objects', () => {
    expect(getConditionChangeDetails({ weekly_target_days: '3' })).toBeNull()
    expect(getConditionChangeDetails({ main_job: 1 })).toBeNull()
    expect(getConditionChangeDetails({ weekly_availability: { monday: 'x' } })).toBeNull()
    expect(getConditionChangeDetails({ available_hours: 'all day' })).toBeNull()
    expect(getConditionChangeDetails({})).toBeNull()
    expect(getConditionChangeDetails(null)).toBeNull()
    expect(getConditionChangeDetails(['x'])).toBeNull()
  })
})

describe('getNewStaffRegistrationDetails', () => {
  it('fills missing times with null and missing memo with an empty string', () => {
    expect(getNewStaffRegistrationDetails({ name: 'A', employment_type: '社員', main_job: 'ホール', weekly_target_days: 5 }))
      .toEqual({
        name: 'A',
        employment_type: '社員',
        main_job: 'ホール',
        weekly_target_days: 5,
        work_start_1: null,
        work_end_1: null,
        work_start_2: null,
        work_end_2: null,
        weekly_availability: null,
        memo: '',
      })
  })

  it('reads the weekday choices of newer registrations', () => {
    const off = { kind: 'off', start: null, end: null }
    const weekly = { monday: off, tuesday: off, wednesday: off, thursday: off, friday: off, saturday: { kind: 'any', start: null, end: null }, sunday: off }
    expect(getNewStaffRegistrationDetails({ name: 'A', employment_type: '社員', main_job: 'ホール', weekly_target_days: 1, weekly_availability: weekly })?.weekly_availability)
      .toEqual(weekly)
  })

  it('rejects a non-string time', () => {
    expect(getNewStaffRegistrationDetails({ name: 'A', employment_type: '社員', main_job: 'ホール', weekly_target_days: 5, work_start_1: 9 }))
      .toBeNull()
  })
})
