import { describe, expect, it } from 'vitest'
import {
  businessHoursOf,
  convertLegacyRequest,
  dayRequestOfRow,
  formatDayRequest,
  requestSpan,
  timeChoices,
  timeToMinutes,
  toDayRequest,
} from '@/lib/day-request'

const hours = { open: 9 * 60, close: 24 * 60 }

describe('toDayRequest', () => {
  it('accepts valid combinations and normalises HH:MM:SS', () => {
    expect(toDayRequest('off', null, null)).toEqual({ kind: 'off', start: null, end: null })
    expect(toDayRequest('from', '18:00:00', null)).toEqual({ kind: 'from', start: '18:00', end: null })
    expect(toDayRequest('until', null, '24:00')).toEqual({ kind: 'until', start: null, end: '24:00' })
    expect(toDayRequest('range', '10:00', '14:30:00')).toEqual({ kind: 'range', start: '10:00', end: '14:30' })
  })

  it('drops stray times on kinds without times', () => {
    expect(toDayRequest('any', '10:00', '12:00')).toEqual({ kind: 'any', start: null, end: null })
  })

  it('rejects unknown kinds, missing times and reversed ranges', () => {
    expect(toDayRequest('maybe', null, null)).toBeNull()
    expect(toDayRequest('from', null, null)).toBeNull()
    expect(toDayRequest('range', '14:00', '10:00')).toBeNull()
    expect(toDayRequest('range', '10:00', '25:00')).toBeNull()
  })
})

describe('time helpers', () => {
  it('parses time columns', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('24:00:00')).toBe(1440)
    expect(timeToMinutes('24:30')).toBeNull()
    expect(timeToMinutes(null)).toBeNull()
  })

  it('reads business hours, falling back to 9:00-24:00', () => {
    expect(businessHoursOf('10:00:00', '22:00:00')).toEqual({ open: 600, close: 1320 })
    expect(businessHoursOf('17:00', '00:00')).toEqual({ open: 1020, close: 1440 })
    expect(businessHoursOf(null, undefined)).toEqual(hours)
  })

  it('lists 30-minute choices', () => {
    expect(timeChoices(9 * 60, 11 * 60)).toEqual([540, 570, 600, 630, 660])
  })
})

describe('dayRequestOfRow', () => {
  it('reads structured rows and treats a null kind as legacy', () => {
    expect(dayRequestOfRow({ request_kind: 'from', start_time: '18:00:00', end_time: null })).toEqual({ kind: 'from', start: '18:00', end: null })
    expect(dayRequestOfRow({ request_kind: null, start_time: '18:00', end_time: '20:00' })).toBeNull()
  })
})

describe('convertLegacyRequest', () => {
  it('keeps day offs and old explicit times', () => {
    expect(convertLegacyRequest({ is_off: true, memo: '18時以降' })).toEqual({ kind: 'off', start: null, end: null })
    expect(convertLegacyRequest({ is_off: false, start_time: '10:00:00', end_time: '15:00:00' })).toEqual({ kind: 'range', start: '10:00', end: '15:00' })
  })

  it('treats an empty memo as no request', () => {
    expect(convertLegacyRequest({ is_off: false, memo: '  ' })).toEqual({ kind: 'none', start: null, end: null })
  })

  it('reads fixed phrases before an earlier AI result', () => {
    expect(convertLegacyRequest({ memo: '18時以降', parsed_request: { is_available: true, start_time: '19:00', end_time: '23:00' } }, hours))
      .toEqual({ kind: 'from', start: '18:00', end: null })
  })

  it('falls back to a valid earlier AI result', () => {
    expect(convertLegacyRequest({ memo: '夕方から', parsed_request: { is_available: true, start_time: '17:00', end_time: '24:00' } }))
      .toEqual({ kind: 'range', start: '17:00', end: '24:00' })
    expect(convertLegacyRequest({ memo: '用事', parsed_request: { is_available: false, start_time: null, end_time: null } }))
      .toEqual({ kind: 'off', start: null, end: null })
  })

  it('leaves everything else to the manager', () => {
    expect(convertLegacyRequest({ memo: '夕方から行けるかも', parsed_request: null })).toBeNull()
    expect(convertLegacyRequest({ memo: '夕方', parsed_request: { is_available: 'maybe' } })).toBeNull()
  })
})

describe('requestSpan / formatDayRequest', () => {
  it('turns kinds into spans within business hours', () => {
    expect(requestSpan({ kind: 'any', start: null, end: null }, hours)).toEqual({ start: 540, end: 1440 })
    expect(requestSpan({ kind: 'from', start: '18:00', end: null }, hours)).toEqual({ start: 1080, end: 1440 })
    expect(requestSpan({ kind: 'until', start: null, end: '15:00' }, hours)).toEqual({ start: 540, end: 900 })
    expect(requestSpan({ kind: 'range', start: '10:00', end: '14:00' }, hours)).toEqual({ start: 600, end: 840 })
    expect(requestSpan({ kind: 'off', start: null, end: null }, hours)).toBeNull()
    expect(requestSpan({ kind: 'none', start: null, end: null }, hours)).toBeNull()
  })

  it('formats labels', () => {
    expect(formatDayRequest({ kind: 'off', start: null, end: null }, 'short')).toBe('休')
    expect(formatDayRequest({ kind: 'any', start: null, end: null }, 'short')).toBe('終日')
    expect(formatDayRequest({ kind: 'from', start: '18:00', end: null })).toBe('18:00〜')
    expect(formatDayRequest({ kind: 'until', start: null, end: '09:30' })).toBe('〜9:30')
    expect(formatDayRequest({ kind: 'range', start: '10:00', end: '14:00' })).toBe('10:00〜14:00')
    expect(formatDayRequest({ kind: 'off', start: null, end: null }, 'long', '出られない')).toBe('出られない')
    expect(formatDayRequest(null)).toBe('')
  })
})
