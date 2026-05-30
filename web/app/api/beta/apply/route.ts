import { z } from "zod";
import { isBetaClosed } from "@/lib/beta/config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.string().email(),
  note: z.string().max(500).optional()
});

/** 登记邮箱申请内测资格（写入 Supabase，管理员后续手动审核发码）。 */
export async function POST(request: Request) {
  if (!isBetaClosed()) {
    return Response.json({ error: "当前未开启内测申请。" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "请填写有效的邮箱地址。" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "服务端未配置，暂时无法提交申请。" }, { status: 503 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const note = parsed.data.note?.trim() || "";

  const { error } = await admin.from("beta_applications").upsert(
    { email, note },
    { onConflict: "email", ignoreDuplicates: false }
  );

  if (error) {
    return Response.json({ error: "提交失败，请稍后再试。" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
