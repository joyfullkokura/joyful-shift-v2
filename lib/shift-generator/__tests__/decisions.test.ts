import { describe, expect, it } from 'vitest'
import { generateSchedule, generateShiftPlan } from '../generate'
import { LEGACY_HOLIDAYS } from './fixtures/legacy-holidays'
import { randomGeneratorInput } from './fixtures/random-input'

const SEEDS = [1, 2, 3, 11, 42, 99, 123, 150]
const planFor = (seed: number) => generateShiftPlan({ ...randomGeneratorInput(seed), holidays: LEGACY_HOLIDAYS })

describe('generateShiftPlan decisions', () => {
  it('does not change the schedule', () => {
    for (const seed of SEEDS) {
      const input = { ...randomGeneratorInput(seed), holidays: LEGACY_HOLIDAYS }
      expect(JSON.stringify(generateShiftPlan(input).schedule)).toBe(JSON.stringify(generateSchedule(input)))
    }
  })

  it('selects the first candidate of every slot and orders candidates best first', () => {
    for (const seed of SEEDS) {
      for (const decision of planFor(seed).decisions.slots) {
        expect(decision.selectedStaffId).toBe(decision.candidates[0]?.staffId ?? null)
        decision.candidates.slice(1).forEach((candidate, index) => {
          const previous = decision.candidates[index]
          expect(previous.score > candidate.score || (previous.score === candidate.score && previous.priority <= candidate.priority)).toBe(true)
        })
      }
    }
  })

  it('keeps each breakdown consistent with its total', () => {
    for (const decision of planFor(42).decisions.slots) {
      for (const { breakdown, score } of decision.candidates) {
        const sum = breakdown.attendance + breakdown.rescueBoost + breakdown.overTarget + breakdown.streak
          + breakdown.rank + breakdown.timeShortfall + breakdown.weekendFairness
        expect(breakdown.total).toBe(sum)
        expect(score).toBe(breakdown.total)
      }
    }
  })

  it('summarises the plan for comparison', () => {
    for (const seed of SEEDS) {
      const { schedule, decisions } = planFor(seed)
      expect(decisions.summary.vacancyCount).toBe(schedule.vacancyCount)
      expect(decisions.summary.skillAlertCount).toBe(schedule.alerts.filter(alert => alert.type === 'skill').length)
      expect(decisions.summary.unfilledInFirstPass).toBe(decisions.slots.filter(slot => slot.candidates.length === 0).length)
    }
  })
})
