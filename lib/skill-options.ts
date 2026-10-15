/**
 * Normalizes the store-managed skill list returned by Supabase.
 * `skill_options` has existed as both a comma-separated string and an array,
 * so callers can safely use this while stores are migrated.
 */
export const parseSkillOptions = (value: unknown): string[] => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)))
}
