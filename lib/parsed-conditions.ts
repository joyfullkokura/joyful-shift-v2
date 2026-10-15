export const WEEKDAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const

export type WeekdayKey = typeof WEEKDAY_KEYS[number]

export type ParsedConditionDay = {
  is_available: boolean
  start_time: string | null
  end_time: string | null
}

export type ParsedConditions = Record<WeekdayKey, ParsedConditionDay>

export type ConditionAnalysisInput = {
  work_start_1: string | null
  work_end_1: string | null
  work_start_2: string | null
  work_end_2: string | null
  memo: string
}

const isTime = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false
  const [hours, minutes] = value.split(':').map(Number)
  return hours >= 0 && hours <= 24 && minutes >= 0 && minutes < 60 && !(hours === 24 && minutes !== 0)
}

export const parseParsedConditions = (value: unknown): ParsedConditions | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<Record<WeekdayKey, unknown>>
  const result = {} as ParsedConditions
  for (const day of WEEKDAY_KEYS) {
    const condition = candidate[day]
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null
    const entry = condition as Partial<ParsedConditionDay>
    if (typeof entry.is_available !== 'boolean') return null
    if (!entry.is_available) {
      if (entry.start_time !== null || entry.end_time !== null) return null
      result[day] = { is_available: false, start_time: null, end_time: null }
      continue
    }
    if (!isTime(entry.start_time) || !isTime(entry.end_time) || entry.start_time >= entry.end_time) return null
    result[day] = { is_available: true, start_time: entry.start_time, end_time: entry.end_time }
  }
  return result
}

export const formatParsedConditions = (value: unknown): string | null => {
  const conditions = parseParsedConditions(value)
  if (!conditions) return null
  const labels: Record<WeekdayKey, string> = {
    monday: '月', tuesday: '火', wednesday: '水', thursday: '木', friday: '金', saturday: '土', sunday: '日',
  }
  return WEEKDAY_KEYS.map(day => {
    const condition = conditions[day]
    return `[${labels[day]}] ${condition.is_available ? `${condition.start_time}-${condition.end_time}` : '休'}`
  }).join(' ')
}
