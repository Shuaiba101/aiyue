import { getAuthUser } from "@/lib/auth/server";
import { getUserQuota } from "@/lib/quota/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

/** 返回当前登录用户的平台额度。 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json({ configured: false });
  }

  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "请先登录。" }, { status: 401 });
  }

  const quota = await getUserQuota(user.id);
  if (!quota) {
    return Response.json({ error: "额度服务未配置。" }, { status: 503 });
  }

  return Response.json({ configured: true, ...quota });
}
