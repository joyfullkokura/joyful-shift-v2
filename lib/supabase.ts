import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// これがデータベースと通信する「窓口」になります
export const supabase = createClient(supabaseUrl, supabaseAnonKey)