import { DEFAULT_LABOR_RULES, type LaborRules } from '@/lib/labor-rules'
import type { GeneratorInput } from '../../types'
import { LEGACY_HOLIDAYS } from './legacy-holidays'
import { randomGeneratorInput } from './random-input'

/**
 * The fixed basis of every before / after report from step 6 on: the 300
 * seeded stores with the store default rules (8h / 40h, weeks from Sunday,
 * 3h minimum, 11h rest, 22:00-05:00), no previous month, and every 5th staff
 * member (by input order, shifted by the seed) under 18.
 */
export const REPORT_RULES: LaborRules = DEFAULT_LABOR_RULES

export const reportInput = (seed: number): GeneratorInput => {
  const input = randomGeneratorInput(seed)
  return {
    ...input,
    holidays: LEGACY_HOLIDAYS,
    staff: input.staff.map((staff, index) => ({ ...staff, is_minor: (seed + index) % 5 === 0 })),
    rules: REPORT_RULES,
  }
}

export const REPORT_SEEDS = Array.from({ length: 300 }, (_, index) => index + 1)
