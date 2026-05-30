import { z } from "zod";
import { getAuthUser } from "@/lib/auth/server";
import { checkPlatformAccess } from "@/lib/quota/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  userApiKey: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string()
  })).min(1)
});

// 「梦境整理 / 人格进化」的服务端推理。消息由内核 buildConsolidationMessages 构造，
// 这里只负责调用模型、回传原始文本，解析与写回交给内核 applyConsolidation。
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "请求格式不对。" }, { status: 400 });
  }

  const userApiKey = parsed.data.userApiKey?.trim();
  const usingUserKey = Boolean(userApiKey);
  const cloudEnabled = isSupabaseConfigured();

  if (cloudEnabled && !usingUserKey) {
    const user = await getAuthUser();
    if (!user) {
      return Response.json({ error: "请先登录。" }, { status: 401 });
    }
    const access = await checkPlatformAccess(user.id);
    if (!access.ok) {
      return Response.json({ error: "额度已用完。", code: "quota_exhausted" }, { status: 402 });
    }
  }

  const apiKey = userApiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ raw: "", skipped: true });
  }

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages: parsed.data.messages,
      temperature: 0.4,
      max_tokens: 700
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return Response.json({ error: `DeepSeek ${response.status}: ${text.slice(0, 160)}` }, { status: 502 });
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  return Response.json({ raw });
}
