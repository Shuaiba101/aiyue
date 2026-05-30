import { z } from "zod";
import { sanitizeAssistantReply } from "@/lib/core";
import { TTS_DEFAULT_VOICE, TTS_READING_STYLE, synthesizeMimoSpeech } from "@/lib/mimo-tts";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  text: z.string().min(1).max(1000),
  voice: z.string().optional(),
  style: z.string().optional(),
  voiceSample: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "语音请求格式不对。" }, { status: 400 });
  }

  if (!process.env.MIMO_API_KEY) {
    return Response.json({ error: "还没有配置 MIMO_API_KEY。" }, { status: 501 });
  }

  const { text, voice, style, voiceSample } = parsed.data;
  if (voiceSample) {
    // 克隆音色保留原逻辑
    const spokenText = sanitizeAssistantReply(text);
    if (!spokenText) {
      return Response.json({ error: "没有可朗读的正文。" }, { status: 400 });
    }
    const apiKey = process.env.MIMO_API_KEY!;
    const response = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        model: "mimo-v2.5-tts-voiceclone",
        messages: [{ role: "assistant", content: spokenText }],
        audio: { format: "wav", voice: voiceSample }
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return Response.json({ error: `MiMo ${response.status}: ${err.slice(0, 160)}` }, { status: 502 });
    }
    const data = await response.json();
    const audioBase64 = data.choices?.[0]?.message?.audio?.data;
    if (!audioBase64) {
      return Response.json({ error: "MiMo 没有返回音频。" }, { status: 502 });
    }
    return Response.json({ audio: `data:audio/wav;base64,${audioBase64}` });
  }

  const audio = await synthesizeMimoSpeech(text, { voice: voice || TTS_DEFAULT_VOICE, style: style || TTS_READING_STYLE });
  if (!audio) {
    return Response.json({ error: "MiMo 没有返回音频。" }, { status: 502 });
  }
  return Response.json({ audio });
}
