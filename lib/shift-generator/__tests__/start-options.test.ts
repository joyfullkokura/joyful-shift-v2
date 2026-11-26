import { describe, expect, it } from 'vitest'
import { generateShiftPlan } from '../generate'
import { parseSlotSettings, parseStartOffsets, pickStartTime, startTimesOf } from '../start-options'
import { hallInput, staffMember } from './fixtures/builders'
import { REPORT_SEEDS, reportInput } from './fixtures/report-input'

const firstShift = (shifts: Record<string, string>) => Object.values(shifts).find(label => /^\d/.test(label))

describe('start-time candidates', () => {
  it('parses offsets: only the allowed choices, always with the slot start, sorted', () => {
    expect(parseStartOffsets([2, 0.5])).toEqual([0, 0.5, 2])
    expect(parseStartOffsets([])).toEqual([0])
    expect(parseStartOffsets([0.25])).toBeUndefined()
    expect(parseStartOffsets('1')).toBeUndefined()
    expect(parseSlotSettings({ a: { start: 10, end: 18, startOffsets: [1] }, b: { start: 10, end: 18, startOffsets: [3] }, c: { start: '10' } }))
      .toEqual({ a: { start: 10, end: 18, startOffsets: [0, 1] }, b: { start: 10, end: 18 } })
  })

  it('defaults to the slot start, +1h and +2h, and drops times at or after the slot end', () => {
    expect(startTimesOf({ start: 10, end: 18 })).toEqual([10, 11, 12])
    expect(startTimesOf({ start: 17, end: 18.5 })).toEqual([17, 18])
    expect(pickStartTime([10, 11, 12], 10.5)).toBe(11)
    expect(pickStartTime([10, 11, 12], 9)).toBe(10)
    expect(pickStartTime([10, 11, 12], 12.5)).toBeUndefined()
  })

  it('rounds a late available start up to the next candidate', () => {
    const staff = [staffMember({ id: 'a', work_start_1: '10:30', work_end_1: '24:00' })]
    const plan = generateShiftPlan(hallInput({ staff, slot: { start: 10, end: 16 } }))
    expect(firstShift(plan.schedule.staff[0].shifts)).toBe('11:00-16:00')
  })

  it('uses only the candidates the manager chose', () => {
    const staff = [staffMember({ id: 'a', work_start_1: '10:30', work_end_1: '24:00' })]
    const plan = generateShiftPlan(hallInput({ staff, slot: { start: 10, end: 16, startOffsets: [0, 0.5] } }))
    expect(firstShift(plan.schedule.staff[0].shifts)).toBe('10:30-16:00')
    const strict = generateShiftPlan(hallInput({ staff, slot: { start: 10, end: 16, startOffsets: [0] } }))
    expect(firstShift(strict.schedule.staff[0].shifts)).toBeUndefined()
  })

  it('every first-pass shift starts at a candidate of its slot (300 stores)', () => {
    for (const seed of REPORT_SEEDS) {
      const input = reportInput(seed)
      const plan = generateShiftPlan(input)
      for (const decision of plan.decisions.slots) {
        if (!decision.selectedStaffId) continue
        const chosen = decision.candidates.find(candidate => candidate.staffId === decision.selectedStaffId)
        const times = startTimesOf({ start: decision.start, end: decision.end })
        expect(times, `seed ${seed} ${decision.date} ${decision.group}`).toContain(chosen?.start)
      }
    }
  }, 120_000)
})
