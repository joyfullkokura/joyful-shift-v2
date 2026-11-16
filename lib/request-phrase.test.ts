import { describe, expect, it } from 'vitest'
import { DEFAULT_BUSINESS_HOURS } from '@/lib/day-request'
import { parseRequestPhrase } from '@/lib/request-phrase'

const parse = (memo: string) => parseRequestPhrase(memo, DEFAULT_BUSINESS_HOURS)
const off = { kind: 'off', start: null, end: null }

describe('parseRequestPhrase', () => {
  it.each(['休み', 'お休み', '休', '休み希望', '休みでお願いします', '×', 'ｘ', '不可', '出勤不可', '有給', ' 休み。'])('reads %s as a day off', memo => {
    expect(parse(memo)).toEqual(off)
  })

  it.each(['終日OK', '終日可', 'いつでもOK', '終日'])('reads %s as the whole day', memo => {
    expect(parse(memo)).toEqual({ kind: 'any', start: null, end: null })
  })

  it.each([
    ['18時以降', '18:00'], ['18時から', '18:00'], ['18:00〜', '18:00'], ['１８時以降', '18:00'], ['18時~', '18:00'],
    ['17時半以降', '17:30'], ['18時以降OK', '18:00'], ['18時以降なら可', null], ['18時から可能', '18:00'], ['18〜', '18:00'],
  ])('reads %s as from %s', (memo, start) => {
    expect(parse(memo)).toEqual(start ? { kind: 'from', start, end: null } : null)
  })

  it.each([
    ['15時まで', '15:00'], ['〜15時', '15:00'], ['～15:00', '15:00'], ['15時迄', '15:00'], ['14時30分まで', '14:30'], ['15時までOK', '15:00'],
  ])('reads %s as until %s', (memo, end) => {
    expect(parse(memo)).toEqual({ kind: 'until', start: null, end })
  })

  it.each([
    ['10時から14時まで', '10:00', '14:00'], ['10時〜14時', '10:00', '14:00'], ['10:00-14:00', '10:00', '14:00'],
    ['10-14', '10:00', '14:00'], ['１０時～１４時', '10:00', '14:00'], ['9時半から13時', '09:30', '13:00'], ['18時から24時まで', '18:00', '24:00'],
  ])('reads %s as %s-%s', (memo, start, end) => {
    expect(parse(memo)).toEqual({ kind: 'range', start, end })
  })

  it('clamps times to the business hours', () => {
    expect(parse('8時から')).toEqual({ kind: 'from', start: '09:00', end: null })
    expect(parse('7時から12時')).toEqual({ kind: 'range', start: '09:00', end: '12:00' })
    expect(parseRequestPhrase('20時から24時', { open: 9 * 60, close: 22 * 60 })).toEqual({ kind: 'range', start: '20:00', end: '22:00' })
  })

  it.each([
    '', '夕方から行けるかもしれません', '午前中は病院なのでそのあと', '18時', '15時以降なら、ただし土曜は不可',
    '14時から10時', '25時から', '7時まで', '9時まで', '24時以降', '午後から', '休みかも', '18時以降で、早上がり希望',
  ])('leaves %s to the manager', memo => {
    expect(parse(memo)).toBeNull()
  })
})
