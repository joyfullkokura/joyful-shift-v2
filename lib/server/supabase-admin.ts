import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getServiceRoleKey, getSupabaseUrl } from '@/lib/server/env'

let adminClient: SupabaseClient | null = null

/**
 * Service-role client. Bypasses RLS, so every caller must scope queries by the
 * store_id taken from a verified session (or validated public input) itself.
 */
export const getAdminClient = (): SupabaseClient => {
  adminClient ??= createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return adminClient
}
