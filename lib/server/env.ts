import 'server-only'

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

// Static property access keeps each variable explicit; none of these are NEXT_PUBLIC_
// except the Supabase URL, which is already public.
export const getSupabaseUrl = () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL)
export const getServiceRoleKey = () => required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY)
export const getSessionSecret = () => required('SESSION_SECRET', process.env.SESSION_SECRET)
export const getPinPepper = () => required('PIN_PEPPER', process.env.PIN_PEPPER)
