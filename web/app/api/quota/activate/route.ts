import { getAuthUser } from "@/lib/auth/server";
import { activateProPlan } from "@/lib/quota/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

function mockBillingAllowed() {
  return process.env.ALLOW_MOCK_BILLING === "true";
}

/** 模拟开通套餐；正式支付接入后由 webhook 调用同等逻辑。 */
export async function POST() {
  if (!mockBillingAllowed()) {
    return Response.json({ error: "套餐开通尚未开放。" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return Response.json({ error: "未启用云端账户。" }, { status: 503 });
  }

  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "请先登录。" }, { status: 401 });
  }

  const quota = await activateProPlan(user.id);
  if (!quota) {
    return Response.json({ error: "开通失败，请稍后再试。" }, { status: 503 });
  }

  return Response.json({ ok: true, ...quota });
}
