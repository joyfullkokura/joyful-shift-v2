import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getServiceRoleKey, getSupabaseUrl } from '@/lib/server/env'
import { createRetryingFetch } from '@/lib/server/retrying-fetch'

let adminClient: SupabaseClient | null = null

/**
 * Service-role client. Bypasses RLS, so every caller must scope queries by the
 * store_id taken from a verified session (or validated public input) itself.
 */
export const getAdminClient = (): SupabaseClient => {
  adminClient ??= createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      // Up to 4 attempts, 150ms -> 300ms -> 600ms (+ jitter): about 1s worst case.
      fetch: createRetryingFetch(fetch, {
        maxAttempts: 4,
        baseDelayMs: 150,
        maxDelayMs: 1_200,
        onRetry: info => console.warn(JSON.stringify({ event: 'supabase_retry', ...info })),
      }),
    },
  })
  return adminClient
}
