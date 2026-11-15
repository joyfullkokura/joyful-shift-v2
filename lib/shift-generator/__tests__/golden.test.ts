import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateSchedule } from '../generate'
import golden from './fixtures/golden-hashes.json'
import { LEGACY_HOLIDAYS } from './fixtures/legacy-holidays'
import { randomGeneratorInput } from './fixtures/random-input'

// Characterization tests. The expected hashes were computed with the generator
// as it existed inside the generate page before the refactor (commit 018e024),
// so any behaviour change in lib/shift-generator shows up here.

const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const inputFor = (seed: number) => ({ ...randomGeneratorInput(seed), holidays: LEGACY_HOLIDAYS })

describe('generateSchedule golden output', () => {
  const seeds = Object.keys(golden.hashes).map(Number)

  it('covers 200 seeded stores', () => {
    expect(seeds).toHaveLength(200)
  })

  it.each(seeds)('seed %i matches the pre-refactor output', seed => {
    expect(hashOf(generateSchedule(inputFor(seed)))).toBe(golden.hashes[String(seed) as keyof typeof golden.hashes])
  })
})

describe('generateSchedule purity', () => {
  it('returns identical output for identical input', () => {
    for (const seed of [3, 42, 177]) {
      expect(JSON.stringify(generateSchedule(inputFor(seed)))).toBe(JSON.stringify(generateSchedule(inputFor(seed))))
    }
  })

  it('does not mutate its input', () => {
    const input = inputFor(7)
    const before = JSON.stringify(input)
    generateSchedule(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
