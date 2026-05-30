import { sanitizeAssistantReply } from "@/lib/core";

export const TTS_READING_STYLE =
  "像一个熟悉的读书朋友在旁边聊天，中文自然口语，松弛、不端着，不要播音腔。语速中等偏慢，句尾自然落下，有陪伴感。";

export const TTS_DEFAULT_VOICE = "白桦";

/** 调用 MiMo 合成语音，返回 wav data URL；失败返回 null。 */
export async function synthesizeMimoSpeech(
  text: string,
  options?: { voice?: string; style?: string }
): Promise<string | null> {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) return null;

  const spokenText = sanitizeAssistantReply(text);
  if (!spokenText) return null;

  const style = options?.style || TTS_READING_STYLE;
  const voice = options?.voice || TTS_DEFAULT_VOICE;

  const response = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      model: "mimo-v2.5-tts",
      messages: [
        { role: "user", content: style },
        { role: "assistant", content: spokenText }
      ],
      audio: { format: "wav", voice }
    })
  });

  if (!response.ok) return null;

  const data = await response.json();
  const audioBase64 = data.choices?.[0]?.message?.audio?.data;
  if (!audioBase64) return null;

  return `data:audio/wav;base64,${audioBase64}`;
}
