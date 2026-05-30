import { z } from "zod";
import { sanitizeAssistantReply } from "@/lib/core";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().min(1).max(1000),
  // 预置音色 id（如「苏打」「茉莉」），不传则用 mimo_default
  voice: z.string().optional(),
  // 风格标签：作为 user 消息传入控制语气，不拼进朗读正文（否则会被读出来）
  style: z.string().optional(),
  // 克隆音色样本；传了就走 voiceclone 模型
  voiceSample: z.string().optional()
});

// MiMo 语音合成。默认走预置精品音色（mimo-v2.5-tts），让 i阅 一开口就是自然人声；
// 用户录了自己的声音才走 voiceclone。返回 wav 的 data URL，前端直接播放。
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "语音请求格式不对。" }, { status: 400 });
  }

  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "还没有配置 MIMO_API_KEY。" }, { status: 501 });
  }

  const { text, voice, style, voiceSample } = parsed.data;
  const spokenText = sanitizeAssistantReply(text);
  if (!spokenText) {
    return Response.json({ error: "没有可朗读的正文。" }, { status: 400 });
  }
  const isClone = Boolean(voiceSample);

  const body = isClone
    ? {
        model: "mimo-v2.5-tts-voiceclone",
        messages: [{ role: "assistant", content: spokenText }],
        audio: { format: "wav", voice: voiceSample }
      }
    : {
        model: "mimo-v2.5-tts",
        messages: style
          ? [
              { role: "user", content: style },
              { role: "assistant", content: spokenText }
            ]
          : [{ role: "assistant", content: spokenText }],
        audio: { format: "wav", voice: voice || "mimo_default" }
      };

  const response = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    return Response.json({ error: `MiMo ${response.status}: ${text.slice(0, 160)}` }, { status: 502 });
  }

  const data = await response.json();
  const audioBase64 = data.choices?.[0]?.message?.audio?.data;
  if (!audioBase64) {
    return Response.json({ error: "MiMo 没有返回音频。" }, { status: 502 });
  }

  return Response.json({ audio: `data:audio/wav;base64,${audioBase64}` });
}
