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
      .toEqual({ weekly_target_days: 2, main_job: 'キッチン', memo: 'x', skills: undefined, available_hours: null })
  })

  it('rejects missing required fields and non-objects', () => {
    expect(getConditionChangeDetails({ main_job: 'ホール', memo: '' })).toBeNull()
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
        memo: '',
      })
  })

  it('rejects a non-string time', () => {
    expect(getNewStaffRegistrationDetails({ name: 'A', employment_type: '社員', main_job: 'ホール', weekly_target_days: 5, work_start_1: 9 }))
      .toBeNull()
  })
})
