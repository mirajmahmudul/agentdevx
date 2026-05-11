import { createClient } from '@supabase/supabase-js'

let supabase: any

supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export { supabase }