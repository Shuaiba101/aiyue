import { z } from "zod";
import { getAuthUser } from "@/lib/auth/server";
import { demoReply, sanitizeAssistantReply } from "@/lib/core";
import { checkPlatformAccess, consumePlatformTurn } from "@/lib/quota/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  book: z.string().min(1),
  mode: z.enum(["fireplace", "desk", "starmap"]),
  needsSearch: z.boolean().default(false),
  userApiKey: z.string().optional(),
  systemPrompt: z.string().min(1),
  turnCompanionPrompt: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  })).min(1)
});

async function tavilySearch(book: string, query: string) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "";

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${book} ${query}`,
      search_depth: "basic",
      max_results: 3,
      include_answer: false
    })
  });

  if (!response.ok) return "";
  const data = await response.json();
  return (data.results || [])
    .slice(0, 3)
    .map((item: { title?: string; content?: string; url?: string }, index: number) => {
      return `[搜索结果${index + 1}] ${item.title || ""}\n${item.content || ""}\n${item.url || ""}`;
    })
    .join("\n\n");
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "请求格式不对。" }, { status: 400 });
  }

  const input = parsed.data;
  const userApiKey = input.userApiKey?.trim();
  const usingUserKey = Boolean(userApiKey);
  const cloudEnabled = isSupabaseConfigured();
  let authUserId: string | null = null;

  if (cloudEnabled && !usingUserKey) {
    const user = await getAuthUser();
    if (!user) {
      return Response.json({ error: "请先登录后再使用平台额度。" }, { status: 401 });
    }
    authUserId = user.id;

    const access = await checkPlatformAccess(user.id);
    if (!access.ok) {
      return Response.json(
        {
          error: "试读额度已用完，请开通套餐或填入自己的 DeepSeek Key。",
          code: "quota_exhausted",
          quota: access.quota
        },
        { status: 402 }
      );
    }
  }

  const apiKey = userApiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content || "";
    return Response.json({
      reply: demoReply(input.book, lastUserMessage),
      usedSearch: false,
      demo: true
    });
  }

  const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content || "";
  const searchContext = input.needsSearch ? await tavilySearch(input.book, lastUserMessage) : "";
  const turnPrompt =
    input.turnCompanionPrompt?.trim() ||
    `【本轮陪伴】
工具：${searchContext ? "已查了一点资料" : "未联网搜索"}
策略：
- 读者自己读纸质书，你只是陪着；接住他这条消息，不要抢话、不要代读
- 他说什么都能聊：书里的、生活的、情绪的，都先接住
- 自然运用你对他的记忆，让他感到被懂、被记着
- 2-4 句；他在情绪里时可不提问；否则最多一个好问题；不输出括号旁白`;
  const messages = [
    { role: "system", content: input.systemPrompt },
    { role: "system", content: turnPrompt },
    ...(searchContext ? [{ role: "system", content: `以下是按需联网搜索结果，只在可靠时使用，不要机械复述：\n${searchContext}` }] : []),
    ...input.messages
  ];

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      max_tokens: 900
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return Response.json({ error: `DeepSeek ${response.status}: ${text.slice(0, 160)}` }, { status: 502 });
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  const reply = sanitizeAssistantReply(message?.content || "");

  let quota;
  if (cloudEnabled && !usingUserKey && authUserId) {
    const consumed = await consumePlatformTurn(authUserId);
    quota = consumed.quota;
  }

  return Response.json({ reply, usedSearch: Boolean(searchContext), quota });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[api/chat]", message);
    return Response.json({ error: "对话服务暂时不可用，请稍后再试。" }, { status: 500 });
  }
}
