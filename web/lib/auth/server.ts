import { getSupabaseServer } from "@/lib/supabase/server";

/** 从 cookie 会话读取当前登录用户（API 路由用）。 */
export async function getAuthUser() {
  const supabase = await getSupabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
