/** i阅 陪读语气：自然口语，像朋友在炉边聊天。 */
import { readJsonResponse } from "@/lib/read-json-response";
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

function waitForAudioMetadata(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
    setTimeout(resolve, 5000);
  });
}

/** 预加载 MiMo 音频，不播放。 */
export async function loadSpeechAudio(options: {
  text: string;
  voice?: string;
  style?: string;
}): Promise<HTMLAudioElement | null> {
  const text = options.text.trim();
  if (!text) return null;

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
    const data = await readJsonResponse(response);
    if (!response.ok || typeof data.audio !== "string") return null;

    const audio = new Audio(data.audio as string);
    audio.preload = "auto";
    await waitForAudioMetadata(audio);
    return audio;
  } catch {
    return null;
  }
}

/** 播放已加载的音频。 */
export async function playSpeechAudio(
  audio: HTMLAudioElement,
  hooks: { onStart?: () => void; onEnd?: () => void }
): Promise<boolean> {
  stopSpeaking();
  currentAudio = audio;

  try {
    hooks.onStart?.();
    await audio.play();
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        currentAudio = null;
        hooks.onEnd?.();
        resolve();
      };
      audio.onerror = () => {
        currentAudio = null;
        reject(new Error("播放失败"));
      };
    });
    return true;
  } catch {
    currentAudio = null;
    hooks.onEnd?.();
    return false;
  }
}

/** 中文朗读时长粗估（秒），metadata 不可用时的兜底。 */
export function estimateSpeechDuration(textLength: number): number {
  return Math.max(2, textLength / 4.2);
}

/**
 * 加载 MiMo 音频后，onReady 与 play 紧挨着触发，供字幕同步打字。
 * onReady(durationMs) → 开始打字；onStart → 开始播放。
 */
export async function speakText(options: {
  text: string;
  voice?: string;
  style?: string;
  onReady?: (durationMs: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}): Promise<boolean> {
  const audio = await loadSpeechAudio(options);
  if (!audio) {
    options.onEnd?.();
    return false;
  }

  const durationMs =
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration * 1000
      : estimateSpeechDuration(options.text.trim().length) * 1000;

  options.onReady?.(durationMs);
  return playSpeechAudio(audio, { onStart: options.onStart, onEnd: options.onEnd });
}
