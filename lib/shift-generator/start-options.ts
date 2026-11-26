// Start-time candidates of a slot (⑧). A shift that fills a slot starts at the
// slot start or at one of the later times the manager allowed, never at an
// arbitrary time in between.

/** Offsets (hours after the slot start) the manager can allow. */
export const START_OFFSET_CHOICES = [0, 0.5, 1, 1.5, 2] as const

/** Used when a slot has no candidates set: the slot start, +1h and +2h. */
export const DEFAULT_START_OFFSETS: readonly number[] = [0, 1, 2]

/** One slot of generation_settings.slots. */
export type SlotSetting = {
  start: number
  end: number
  /** Hours after `start` a shift may begin; missing = DEFAULT_START_OFFSETS. The slot start (0) is always included. */
  startOffsets?: number[]
}

const isChoice = (value: unknown): value is number =>
  typeof value === 'number' && (START_OFFSET_CHOICES as readonly number[]).includes(value)

/** Normalized offsets (sorted, unique, always with 0), or undefined when not set / malformed. */
export const parseStartOffsets = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value) || !value.every(isChoice)) return undefined
  return [...new Set([0, ...value])].sort((left, right) => left - right)
}

/** Start times a shift on this slot may use, earliest first (all before the slot end). */
export const startTimesOf = (slot: { start: number; end: number; startOffsets?: readonly number[] }, slotEnd = slot.end) =>
  (slot.startOffsets ?? DEFAULT_START_OFFSETS)
    .map(offset => slot.start + offset)
    .filter(time => time < slotEnd)

/** The earliest allowed start at or after `availableFrom`, or undefined. */
export const pickStartTime = (startTimes: readonly number[], availableFrom: number) =>
  startTimes.find(time => time >= availableFrom - 1e-9)

/** generation_settings.slots of one day type, keeping only well-formed slots. */
export const parseSlotSettings = (value: unknown): Record<string, SlotSetting> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, SlotSetting> = {}
  for (const [key, slot] of Object.entries(value)) {
    if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) continue
    const { start, end, startOffsets } = slot as Record<string, unknown>
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) continue
    const offsets = parseStartOffsets(startOffsets)
    result[key] = offsets ? { start, end, startOffsets: offsets } : { start, end }
  }
  return result
}
