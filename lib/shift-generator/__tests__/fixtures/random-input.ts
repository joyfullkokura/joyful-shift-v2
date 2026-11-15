import type { GeneratorInput, ShiftRequest, StaffRecord } from '../../types'

// Seeded random inputs for the shift generator. The generator itself uses no
// randomness; the seed only makes these TEST inputs reproducible.

/** mulberry32: small, fast, deterministic PRNG returning [0, 1). */
export const createRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Random = ReturnType<typeof createRandom>

const pick = <T>(random: Random, values: readonly T[]): T => values[Math.floor(random() * values.length)]
const chance = (random: Random, probability: number) => random() < probability
const integer = (random: Random, min: number, max: number) => min + Math.floor(random() * (max - min + 1))

/** Decimal hours -> "HH:MM", optionally "HH:MM:SS" like Postgres time columns. */
const clock = (random: Random, hours: number) => {
  const normalized = ((hours % 24) + 24) % 24
  const text = `${String(Math.floor(normalized)).padStart(2, '0')}:${normalized % 1 === 0.5 ? '30' : '00'}`
  return chance(random, 0.3) ? `${text}:00` : text
}

const GROUP_SETS: readonly string[][] = [
  ['hd', 'hn', 'kd', 'kn'],
  ['ホール', 'キッチン'],
  ['ホール昼', 'キッチン夜', '洗い場'],
  ['hd', 'kd'],
]
const JOBS = ['ホール', 'キッチン', '共通', 'hd', 'kn', '洗い場', null] as const
const NAMES = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', 'Aoki', 'aoki']
const SKILLS = ['[H]レジ', '[H]レジ締め', '[H]ドリンク', '[K]揚げ場', '[K]仕込み', 'レジ締め']

const randomRange = (random: Random): [string | null, string | null] => {
  if (chance(random, 0.25)) return [null, null]
  const start = integer(random, 18, 34) / 2 // 09:00 - 17:00
  const end = start + integer(random, 6, 22) / 2 // 3h - 11h later, may pass midnight
  return [clock(random, start), clock(random, end)]
}

const randomStaff = (random: Random, index: number, groups: string[]): StaffRecord => {
  const [start1, end1] = randomRange(random)
  const [start2, end2] = chance(random, 0.4) ? randomRange(random) : [null, null]
  const isEmployee = chance(random, 0.3)
  return {
    id: `staff-${String(index).padStart(2, '0')}`,
    name: pick(random, NAMES),
    role: chance(random, 0.15) ? pick(random, ['ホール', 'キッチン']) : null,
    rank: pick(random, ['A', 'B', 'C', null]),
    weekly_target_days: chance(random, 0.85) ? integer(random, 0, 6) : null,
    target_work_days: chance(random, 0.15) ? integer(random, 1, 6) : null,
    monthly_target_hours: isEmployee && chance(random, 0.4) ? integer(random, 120, 190) : null,
    skills: SKILLS.filter(() => chance(random, 0.3)).join(','),
    is_employee: isEmployee,
    main_job: pick(random, JOBS),
    possible_groups: chance(random, 0.3) ? groups.filter(() => chance(random, 0.5)).join(',') : null,
    work_start_1: start1,
    work_end_1: end1,
    work_start_2: start2,
    work_end_2: end2,
  }
}

const randomRequest = (random: Random, staffId: string, date: string, index: number): ShiftRequest => {
  const variant = integer(random, 0, 5)
  const base: ShiftRequest = { id: `req-${index}`, staff_id: staffId, date, is_off: false, memo: null, parsed_request: null }
  switch (variant) {
    case 0:
      return { ...base, is_off: true }
    case 1: {
      const start = integer(random, 18, 36) / 2
      return { ...base, start_time: clock(random, start), end_time: clock(random, start + integer(random, 4, 16) / 2) }
    }
    case 2:
      return { ...base, memo: '休み', parsed_request: { is_available: false, start_time: null, end_time: null } }
    case 3: {
      const start = integer(random, 9, 17)
      return { ...base, memo: '時間指定', parsed_request: { is_available: true, start_time: `${String(start).padStart(2, '0')}:00`, end_time: `${String(Math.min(24, start + integer(random, 3, 8))).padStart(2, '0')}:00` } }
    }
    case 4:
      return { ...base, memo: '解析不能', parsed_request: { is_available: 'maybe' } }
    default:
      return { ...base, memo: '未解析' }
  }
}

/** A complete, reproducible generator input for the given seed. */
export const randomGeneratorInput = (seed: number): GeneratorInput => {
  const random = createRandom(seed)
  const targetYear = pick(random, [2026, 2027])
  const targetMonth = integer(random, 1, 12)
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const dateKey = (day: number) => `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const groups = pick(random, GROUP_SETS)
  const selectedSpecialDays = Array.from({ length: integer(random, 0, 2) }, () => dateKey(integer(random, 1, daysInMonth)))
  const configTypes = ['wd', 'we', ...selectedSpecialDays]

  const counts: GeneratorInput['counts'] = {}
  const slots: GeneratorInput['slots'] = {}
  for (const type of configTypes) {
    counts[type] = {}
    slots[type] = {}
    for (const group of groups) {
      const count = integer(random, 0, 4)
      counts[type][group] = count
      for (let slotIndex = 0; slotIndex < count; slotIndex++) {
        if (chance(random, 0.1)) continue // missing slot -> generator default 10:00-18:00
        const start = integer(random, 18, 34) / 2
        let end = start + integer(random, 6, 20) / 2
        if (end > 24 && chance(random, 0.5)) end -= 24 // overnight stored as end < start
        slots[type][`${group}_${slotIndex}`] = { start, end }
      }
    }
  }

  const staff = Array.from({ length: integer(random, 2, 14) }, (_, index) => randomStaff(random, index, groups))
  const requests: ShiftRequest[] = []
  for (const person of staff) {
    for (let day = 1; day <= daysInMonth; day++) {
      if (chance(random, 0.15)) requests.push(randomRequest(random, person.id, dateKey(day), requests.length))
    }
  }
  if (chance(random, 0.3)) requests.push({ id: 'req-orphan', staff_id: 'unknown-staff', date: dateKey(1), is_off: true })

  return {
    staff,
    requests,
    store: {
      open_time: chance(random, 0.1) ? null : pick(random, ['09:00', '10:00', '11:00:00']),
      close_time: chance(random, 0.1) ? null : pick(random, ['22:00', '23:30', '24:00', '02:00']),
      skill_options: chance(random, 0.5) ? SKILLS.filter(() => chance(random, 0.6)).join(',') : SKILLS.filter(() => chance(random, 0.6)),
    },
    targetYear,
    targetMonth,
    groups,
    counts,
    slots,
    selectedSpecialDays,
    monthlyTargetHours: integer(random, 100, 200),
    holidays: {},
  }
}
