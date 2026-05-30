import { readJsonResponse } from "@/lib/read-json-response";
import { TTS_DEFAULT_VOICE, TTS_READING_STYLE } from "@/lib/mimo-tts";

/** 极短静音 wav，用于解锁移动端音频播放。 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function prepareAudioElement(audio: HTMLAudioElement) {
  audio.preload = "auto";
  audio.volume = 1;
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
}

function releaseObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

/** 在用户触摸/发送时调用，解除移动端自动播放限制。 */
export function unlockAudioPlayback() {
  if (typeof window === "undefined") return;
  const probe = new Audio(SILENT_WAV);
  prepareAudioElement(probe);
  probe.volume = 0.01;
  void probe
    .play()
    .then(() => probe.pause())
    .catch(() => {});
}

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  releaseObjectUrl();
}

function waitForAudioReady(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 3) return Promise.resolve();
  return new Promise((resolve) => {
    audio.addEventListener("canplaythrough", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
    setTimeout(resolve, 2500);
  });
}

async function attachAudioSrc(audio: HTMLAudioElement, dataUrl: string) {
  releaseObjectUrl();
  if (prefersMobileLayout() && dataUrl.startsWith("data:")) {
    try {
      const blob = await fetch(dataUrl).then((res) => res.blob());
      currentObjectUrl = URL.createObjectURL(blob);
      audio.src = currentObjectUrl;
    } catch {
      audio.src = dataUrl;
    }
  } else {
    audio.src = dataUrl;
  }
  audio.load();
}

/** 从 data URL 创建可播放的 Audio（服务端预生成时用）。 */
export async function audioFromDataUrl(dataUrl: string): Promise<HTMLAudioElement | null> {
  try {
    const audio = new Audio();
    prepareAudioElement(audio);
    await attachAudioSrc(audio, dataUrl);
    await waitForAudioReady(audio);
    return audio;
  } catch {
    return null;
  }
}

/** 预加载 MiMo 音频（独立 /api/tts 请求，兜底用）。 */
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
    return audioFromDataUrl(data.audio as string);
  } catch {
    return null;
  }
}

async function tryPlay(audio: HTMLAudioElement): Promise<void> {
  audio.currentTime = 0;
  await audio.play();
}

export async function playSpeechAudio(
  audio: HTMLAudioElement,
  hooks: { onStart?: () => void; onEnd?: () => void }
): Promise<boolean> {
  stopSpeaking();
  currentAudio = audio;

  const finish = () => {
    currentAudio = null;
    releaseObjectUrl();
    hooks.onEnd?.();
  };

  try {
    await tryPlay(audio);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 120));
    try {
      await tryPlay(audio);
    } catch {
      finish();
      return false;
    }
  }

  hooks.onStart?.();
  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        finish();
        resolve();
      };
      audio.onerror = () => reject(new Error("播放失败"));
    });
    return true;
  } catch {
    finish();
    return false;
  }
}

export async function speakText(options: {
  text: string;
  voice?: string;
  style?: string;
  onStart?: () => void;
  onEnd?: () => void;
}): Promise<boolean> {
  const audio = await loadSpeechAudio(options);
  if (!audio) {
    options.onEnd?.();
    return false;
  }
  return playSpeechAudio(audio, { onStart: options.onStart, onEnd: options.onEnd });
}

/** 播放服务端预生成的音频 data URL。 */
export async function speakPrefetchedAudio(
  dataUrl: string,
  hooks: { onStart?: () => void; onEnd?: () => void }
): Promise<boolean> {
  const audio = await audioFromDataUrl(dataUrl);
  if (!audio) {
    hooks.onEnd?.();
    return false;
  }
  return playSpeechAudio(audio, { onStart: hooks.onStart, onEnd: hooks.onEnd });
}

export function prefersMobileLayout(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
}

export function textRevealIntervalMs(): number {
  return prefersMobileLayout() ? 26 : 36;
}

export function msPerCharForDuration(textLength: number, durationMs: number): number {
  if (!textLength) return textRevealIntervalMs();
  const duration = durationMs > 0 ? durationMs : textLength * 250;
  return Math.min(68, Math.max(24, duration / textLength));
}

export function estimateSpeechDuration(textLength: number): number {
  return Math.max(2, textLength / 4.2);
}

export function mobilePlaybackHint(): string {
  return "语音未播放：请用 Chrome 打开，调高媒体音量，勿在回复时切到后台。";
}

export { TTS_READING_STYLE, TTS_DEFAULT_VOICE };
