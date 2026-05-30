import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!SUPABASE_URL || !key) return null;
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return adminClient;
}
