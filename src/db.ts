import { createClient } from '@supabase/supabase-js'
import { mockSupabase } from './db-mock'

const useMock = process.env.USE_MOCK_DB === 'true'

let supabase: any

if (useMock) {
  supabase = mockSupabase
} else {
  supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export { supabase }