import { describe, expect, it } from 'vitest'
import { applyDayChoice, toRequestPayload, type DayEntries } from '@/lib/request-entries'
import { planMonthRequestSave } from '@/lib/server/request-save-plan'
import { usualAvailabilityOf } from '@/lib/usual-availability'

const off = { kind: 'off', start: null, end: null } as const
const evening = { kind: 'from', start: '18:00', end: null } as const
const allWeek = (value: object) => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, value]))
const usual = usualAvailabilityOf({ weekly_availability: allWeek(evening) })
const DAY = '2027-02-03'

describe('applyDayChoice', () => {
  it('turning a saved day off back to the usual time removes the day, and saving deletes its row', () => {
    const saved: DayEntries = { [DAY]: { request: off, memo: '' } }
    const entries = applyDayChoice(saved, [DAY], { kind: 'from', start: '18:00', end: null }, undefined, usual)
    expect(entries).toEqual({})
    const payload = toRequestPayload(entries)
    expect(payload).toEqual([])
    expect(planMonthRequestSave([{ date: DAY, memo: '' }], payload).deleteDates).toEqual([DAY])
  })

  it('「希望なしに戻す」 removes the day the same way', () => {
    const entries = applyDayChoice({ [DAY]: { request: off, memo: '' } }, [DAY], null, undefined, usual)
    expect(planMonthRequestSave([{ date: DAY, memo: '' }], toRequestPayload(entries)).deleteDates).toEqual([DAY])
  })

  it('keeps a day that still has a memo, as 希望なし with the memo', () => {
    const entries = applyDayChoice({ [DAY]: { request: off, memo: '通院' } }, [DAY], evening, undefined, usual)
    expect(entries[DAY]).toEqual({ request: { kind: 'none', start: null, end: null }, memo: '通院' })
    expect(toRequestPayload(entries)).toEqual([{ date: DAY, kind: 'none', start: null, end: null, memo: '通院' }])
  })

  it('keeps a choice that differs from usual', () => {
    const entries = applyDayChoice({}, [DAY, '2027-02-04'], off, undefined, usual)
    expect(Object.keys(entries)).toEqual([DAY, '2027-02-04'])
    expect(toRequestPayload(entries).map(day => day.kind)).toEqual(['off', 'off'])
  })

  it('saves every choice when nothing usual is known', () => {
    const entries = applyDayChoice({}, [DAY], evening, undefined, usualAvailabilityOf(null))
    expect(entries[DAY].request).toEqual(evening)
  })

  it('keeps an old memo-only day untouched in the payload', () => {
    expect(toRequestPayload({ [DAY]: { request: null, memo: '夕方なら' } })).toEqual([{ date: DAY, kind: null, start: null, end: null, memo: '夕方なら' }])
  })
})
