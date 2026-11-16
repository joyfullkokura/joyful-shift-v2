import 'server-only'
import { type BusinessHours, businessHoursOf } from '@/lib/day-request'
import { type WeeklyAvailability, toParsedConditions } from '@/lib/weekly-availability'
import { getAdminClient } from '@/lib/server/supabase-admin'

/** The store's business hours (stores.open_time / close_time), 9:00-24:00 if unset. */
export const getStoreBusinessHours = async (storeId: string): Promise<BusinessHours> => {
  const { data, error } = await getAdminClient().from('stores').select('open_time, close_time').eq('store_id', storeId).maybeSingle()
  if (error) throw error
  const row: unknown = data
  const store = typeof row === 'object' && row !== null ? row as Record<string, unknown> : null
  return businessHoursOf(store?.open_time, store?.close_time)
}

/**
 * Staff columns written together: the weekday choices and the per-day summary
 * derived from them (parsed_conditions, read by the existing displays).
 */
export const weeklyAvailabilityColumns = (weekly: WeeklyAvailability | null, hours: BusinessHours) =>
  weekly
    ? { weekly_availability: weekly, parsed_conditions: toParsedConditions(weekly, hours) }
    : { weekly_availability: null }
