import { z } from "zod";
import { isBetaClosed, isValidInviteCode } from "@/lib/beta/config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
  inviteCode: z.string().min(1).max(64)
});

/** 内测注册：校验邀请码后由服务端创建账号（客户端无法绕过）。 */
export async function POST(request: Request) {
  if (!isBetaClosed()) {
    return Response.json({ error: "当前开放注册，请直接在页面登录。" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "请填写邮箱、密码（至少 6 位）和邀请码。" }, { status: 400 });
  }

  const { email, password, inviteCode } = parsed.data;
  if (!isValidInviteCode(inviteCode)) {
    return Response.json({ error: "邀请码无效，请确认后重试。" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "服务端未配置，暂时无法注册。" }, { status: 503 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const created = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { beta_invite: inviteCode.trim(), registered_via: "invite" }
  });

  if (created.error) {
    const message = created.error.message || "";
    if (/already|registered|exist/i.test(message)) {
      return Response.json({ error: "这个邮箱已注册，请直接登录。" }, { status: 409 });
    }
    return Response.json({ error: message || "注册失败，请稍后再试。" }, { status: 500 });
  }

  return Response.json({ ok: true, email: normalizedEmail });
}
