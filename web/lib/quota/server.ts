import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { FREE_TRIAL_TURNS, type QuotaPlan, type QuotaSnapshot } from "./constants";

type QuotaRow = {
  user_id: string;
  plan: QuotaPlan;
  turns_used: number;
  turns_limit: number;
};

function toSnapshot(row: QuotaRow): QuotaSnapshot {
  const turnsRemaining =
    row.plan === "pro" ? row.turns_limit : Math.max(0, row.turns_limit - row.turns_used);
  return {
    plan: row.plan,
    turnsUsed: row.turns_used,
    turnsLimit: row.turns_limit,
    turnsRemaining,
    canUsePlatform: row.plan === "pro" || turnsRemaining > 0
  };
}

async function ensureQuotaRow(userId: string): Promise<QuotaRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data: existing } = await admin.from("user_quotas").select("*").eq("user_id", userId).maybeSingle();
  if (existing) return existing as QuotaRow;

  const { data: created, error } = await admin
    .from("user_quotas")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error) {
    // 并发首登可能撞 unique，再读一次。
    const { data: retry } = await admin.from("user_quotas").select("*").eq("user_id", userId).maybeSingle();
    return (retry as QuotaRow | null) ?? null;
  }
  return created as QuotaRow;
}

/** 读取用户额度（不存在则创建 trial 记录）。 */
export async function getUserQuota(userId: string): Promise<QuotaSnapshot | null> {
  const row = await ensureQuotaRow(userId);
  return row ? toSnapshot(row) : null;
}

/** 是否还能使用平台 Key（不扣次）。 */
export async function checkPlatformAccess(userId: string): Promise<{ ok: true; quota: QuotaSnapshot } | { ok: false; quota: QuotaSnapshot }> {
  const quota = await getUserQuota(userId);
  if (!quota) {
    return {
      ok: false,
      quota: {
        plan: "trial",
        turnsUsed: FREE_TRIAL_TURNS,
        turnsLimit: FREE_TRIAL_TURNS,
        turnsRemaining: 0,
        canUsePlatform: false
      }
    };
  }
  return quota.canUsePlatform ? { ok: true, quota } : { ok: false, quota };
}

/** 成功完成一次平台推理后原子扣次；pro 用户不扣次。 */
export async function consumePlatformTurn(
  userId: string
): Promise<{ ok: true; quota: QuotaSnapshot } | { ok: false; quota: QuotaSnapshot }> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return {
      ok: false,
      quota: {
        plan: "trial",
        turnsUsed: FREE_TRIAL_TURNS,
        turnsLimit: FREE_TRIAL_TURNS,
        turnsRemaining: 0,
        canUsePlatform: false
      }
    };
  }

  const { data, error } = await admin.rpc("consume_platform_turn", { p_user_id: userId });
  if (error || !data) {
    const quota = await getUserQuota(userId);
    return quota ? { ok: false, quota } : { ok: false, quota: {
      plan: "trial",
      turnsUsed: FREE_TRIAL_TURNS,
      turnsLimit: FREE_TRIAL_TURNS,
      turnsRemaining: 0,
      canUsePlatform: false
    }};
  }

  const payload = data as {
    ok: boolean;
    plan: QuotaPlan;
    turns_used: number;
    turns_limit: number;
    turns_remaining: number;
  };

  const quota: QuotaSnapshot = {
    plan: payload.plan,
    turnsUsed: payload.turns_used,
    turnsLimit: payload.turns_limit,
    turnsRemaining: payload.turns_remaining,
    canUsePlatform: payload.ok || payload.plan === "pro"
  };

  return payload.ok ? { ok: true, quota } : { ok: false, quota };
}

/** 模拟开通套餐（后续可换成支付 webhook）。 */
export async function activateProPlan(userId: string): Promise<QuotaSnapshot | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  await ensureQuotaRow(userId);
  const { data, error } = await admin
    .from("user_quotas")
    .update({ plan: "pro" })
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error || !data) return null;
  return toSnapshot(data as QuotaRow);
}
