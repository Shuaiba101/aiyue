/** i阅 陪读语气：自然口语，像朋友在炉边聊天。 */
export const TTS_READING_STYLE =
  "像一个熟悉的读书朋友在旁边聊天，中文自然口语，松弛、不端着，不要播音腔。语速中等偏慢，句尾自然落下，有陪伴感。";

export const TTS_DEFAULT_VOICE = "白桦";

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

/** 调用服务端 MiMo TTS 播放；失败则静默，不降级浏览器朗读。 */
export async function speakText(options: {
  text: string;
  voice?: string;
  style?: string;
  onStart?: () => void;
  onEnd?: () => void;
}): Promise<boolean> {
  const text = options.text.trim();
  if (!text) return false;

  stopSpeaking();

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 1000),
        voice: options.voice || TTS_DEFAULT_VOICE,
        style: options.style || TTS_READING_STYLE
      })
    });
    const data = await response.json();
    if (!response.ok || !data.audio) return false;

    const audio = new Audio(data.audio);
    currentAudio = audio;
    options.onStart?.();

    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        currentAudio = null;
        options.onEnd?.();
        resolve();
      };
      audio.onerror = () => {
        currentAudio = null;
        reject(new Error("播放失败"));
      };
      void audio.play().catch(reject);
    });

    return true;
  } catch {
    options.onEnd?.();
    return false;
  }
}
