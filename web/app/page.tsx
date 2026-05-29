"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  applyConsolidation,
  buildConsolidationMessages,
  buildSystemPrompt,
  captureTurn,
  defaultMemory,
  recordConversation,
  shouldConsolidate,
  shouldSearch
} from "@/lib/core.mjs";
import type { ChatMessage, Memory, ModeKey } from "@/lib/core.mjs";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { loadMemory, saveMemory } from "@/lib/memory-store";

type VoiceKey = "elder" | "friend" | "night" | "clone";
type UserSession = {
  name: string;
  email: string;
  voice: VoiceKey;
  voiceSample: string;
  plan: "trial" | "pro";
  trialRemaining: number;
  userApiKey: string;
};
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results?: { [index: number]: { [index: number]: { transcript?: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const SESSION_KEY = "iyue_web_session_v1";
const FREE_TRIAL_TURNS = 5;
// 体验模式由 AI 内置，不再让用户选择。固定用「炉边智者」作为基础人格。
const MODE: ModeKey = "fireplace";
const GREETING = "你好，我是 i阅。今晚想读哪本书？告诉我书名，我们就开始。";
const voiceSampleScript = "我正在读一本书。读到有触动的地方，我会停下来，把这一刻的想法说给 i阅。";
// MiMo 预置音色 + 风格映射；rate/pitch 仅用于浏览器朗读兜底。
const voiceOptions: Record<VoiceKey, { name: string; desc: string; preset: string; style: string; rate: number; pitch: number }> = {
  elder: { name: "炉边长者", desc: "沉稳、温厚的男声，适合深夜读完一段后听一句回应。", preset: "苏打", style: "温柔", rate: 0.86, pitch: 0.78 },
  friend: { name: "读书朋友", desc: "自然、亲切的女声，适合白天随手聊两句。", preset: "茉莉", style: "亲切", rate: 0.96, pitch: 0.92 },
  night: { name: "夜读电台", desc: "更轻、更近的男声，声音不抢走书。", preset: "白桦", style: "温柔", rate: 0.88, pitch: 0.84 },
  clone: { name: "我的声音", desc: "录一小段作为音色样本，让 i阅 用你的声音回应。", preset: "mimo_default", style: "温柔", rate: 0.92, pitch: 0.88 }
};

function defaultSession(email: string): UserSession {
  const name = (email || "").split("@")[0] || "读者";
  return { name, email, voice: "elder", voiceSample: "", plan: "trial", trialRemaining: FREE_TRIAL_TURNS, userApiKey: "" };
}

export default function Home() {
  const mode = MODE;
  const cloudEnabled = isSupabaseConfigured();

  const [session, setSession] = useState<UserSession | null>(null);
  const [memory, setMemory] = useState<Memory>(() => defaultMemory());
  const [book, setBook] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subtitle, setSubtitle] = useState(GREETING);
  const [isThinking, setIsThinking] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [modal, setModal] = useState<"memory" | "account" | "paywall" | null>(null);
  const [toast, setToast] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [draftVoiceSample, setDraftVoiceSample] = useState("");

  // 认证（Supabase 邮箱+密码）
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authEmailDraft, setAuthEmailDraft] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [localEntered, setLocalEntered] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const entered = cloudEnabled ? Boolean(authUserId) : localEntered;

  useEffect(() => {
    try {
      setSession(JSON.parse(localStorage.getItem(SESSION_KEY) || "null"));
    } catch {
      // 本地解析失败保持默认。
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setAuthUserId(data.user?.id ?? null);
      setAuthEmail(data.user?.email ?? "");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setAuthUserId(sess?.user?.id ?? null);
      setAuthEmail(sess?.user?.email ?? "");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 进入后若还没有会话设置，自动创建一个（不再让用户填表）。
  useEffect(() => {
    if (entered && !session) setSession(defaultSession(authEmail));
  }, [entered, session, authEmail]);

  // 进入但还没选书时，自动展开输入框，等他说书名。
  useEffect(() => {
    if (entered && !book) {
      setSubtitle(GREETING);
      setInputOpen(true);
    }
  }, [entered, book]);

  // 记忆按身份加载：登录走云端（首登自动迁移本地），未登录走本地。
  useEffect(() => {
    hydratedRef.current = false;
    let cancelled = false;
    loadMemory(authUserId).then((loaded) => {
      if (cancelled) return;
      setMemory(loaded);
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // 记忆变化后防抖落盘：本地缓存 + 云端 upsert（hydrate 完成后才写，避免初始值覆盖云端）。
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveMemory(memory, authUserId);
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [memory, authUserId]);

  useEffect(() => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }, [session]);

  useEffect(() => {
    if (inputOpen) setTimeout(() => inputRef.current?.focus(), 20);
  }, [inputOpen]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }

  // 打字机式逐字浮现。传入 durationMs 时，按语音时长配速，实现“字随声出”。
  function revealText(full: string, durationMs?: number) {
    if (revealRef.current) clearInterval(revealRef.current);
    setSubtitle("");
    const perChar = durationMs && full.length ? Math.min(90, Math.max(16, durationMs / full.length)) : 42;
    let index = 0;
    revealRef.current = setInterval(() => {
      index += 1;
      setSubtitle(full.slice(0, index));
      if (index >= full.length) {
        if (revealRef.current) clearInterval(revealRef.current);
        revealRef.current = null;
      }
    }, perChar);
  }

  useEffect(() => () => {
    if (revealRef.current) clearInterval(revealRef.current);
  }, []);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setLocalEntered(true);
      return;
    }
    const email = authEmailDraft.trim();
    const password = authPassword;
    if (!email || !password) {
      flash("填一下邮箱和密码。");
      return;
    }
    if (password.length < 6) {
      flash("密码至少 6 位。");
      return;
    }
    setAuthBusy(true);
    try {
      // 统一入口：先按已注册账号登录；登录不成再视作新账号注册。用户不用自己分辨“登录还是注册”。
      const signIn = await supabase.auth.signInWithPassword({ email, password });
      if (signIn.data.session) {
        setAuthPassword("");
        return;
      }
      const signUp = await supabase.auth.signUp({ email, password });
      if (signUp.data.session) {
        setAuthPassword("");
        return;
      }
      // 没拿到 session：要么是已注册但密码不对，要么是开了邮箱确认。
      const message = signUp.error?.message || signIn.error?.message || "";
      if (/already|registered|exist/i.test(message)) {
        flash("这个邮箱已注册，密码不对，再试一次。");
      } else if (signUp.error) {
        flash(signUp.error.message);
      } else {
        flash("注册成功，请去邮箱确认后再回来。");
        setAuthPassword("");
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : "进不去，稍后再试一次。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const supabase = getSupabaseBrowser();
    if (supabase) await supabase.auth.signOut();
    setAuthUserId(null);
    setAuthEmail("");
    setSession(null);
    setLocalEntered(false);
    setBook("");
    setMessages([]);
    setModal(null);
    flash("已退出。");
  }

  function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("音频读取失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function saveVoiceSample(blob: Blob) {
    const dataUrl = await blobToDataUrl(blob);
    setDraftVoiceSample(dataUrl);
    setSession((current) => (current ? { ...current, voice: "clone", voiceSample: dataUrl } : current));
    flash("声音样本已保存。");
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      flash("当前浏览器不支持录音。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        await saveVoiceSample(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.start();
      setIsRecording(true);
      flash("开始录音，请读屏幕上那句话。");
    } catch {
      setIsRecording(false);
      flash("没有拿到麦克风权限，可以改为上传录音。");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  async function handleVoiceUpload(file: File | null) {
    if (!file) return;
    await saveVoiceSample(file);
  }

  function fallbackSpeakText(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    utterance.lang = "zh-CN";
    const voice = session ? voiceOptions[session.voice] : voiceOptions.elder;
    utterance.rate = voice.rate;
    utterance.pitch = voice.pitch;
    utterance.voice = voices.find((item) => /zh|Chinese|中文|普通话/i.test(`${item.lang} ${item.name}`)) || null;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    synth.speak(utterance);
  }

  // 声画同步：合成期间保持“思考”状态，音频就绪后才开始打字，并按音频时长配速，让字随声出。
  // 默认走 MiMo 自然人声（预置音色）；录了自己的声音才走克隆；都失败再退浏览器朗读。
  async function deliver(text: string) {
    if (typeof window === "undefined") {
      revealText(text);
      return;
    }
    const voiceKey = session?.voice || "elder";
    const preset = voiceOptions[voiceKey];
    const useClone = voiceKey === "clone" && Boolean(session?.voiceSample);
    const payload = useClone
      ? { text: text.slice(0, 480), voiceSample: session?.voiceSample }
      : { text: text.slice(0, 480), voice: preset.preset, style: preset.style };
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.audio) throw new Error(data.error || "语音暂不可用");
      const audio = new Audio(data.audio);
      // 等音频可播放（或拿到时长）再开始，最多兜底 2.5s。
      await new Promise<void>((resolve) => {
        let settled = false;
        const go = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        audio.oncanplay = go;
        audio.onloadedmetadata = go;
        setTimeout(go, 2500);
      });
      setIsThinking(false);
      setIsSpeaking(true);
      const durMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : text.length * 70;
      revealText(text, durMs);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      await audio.play();
    } catch {
      setIsThinking(false);
      revealText(text);
      fallbackSpeakText(text);
    }
  }

  function recordTurn(userText: string, assistantText: string) {
    setMemory((current) => captureTurn(current, { book, mode, userText, assistantText }));
  }

  function persistSession(nextMessages: ChatMessage[]) {
    if (!book || !nextMessages.length) return;
    setMemory((current) => recordConversation(current, { book, mode, messages: nextMessages }));
  }

  // 梦境整理 / 人格进化：把最近的陪读记录交给模型，提炼洞察并更新沟通策略。
  async function runConsolidation(latestMemory: Memory) {
    if (!session || !shouldConsolidate(latestMemory)) return;
    try {
      const response = await fetch("/api/consolidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: buildConsolidationMessages(latestMemory),
          userApiKey: session.userApiKey || undefined
        })
      });
      const data = await response.json();
      if (!response.ok || !data.raw) return;
      setMemory((current) => applyConsolidation(current, data.raw));
      flash("i阅 又更懂你了一点。");
    } catch {
      // 后台增益，失败静默。
    }
  }

  // 进入一本书：让 i阅 主动用一句自然的话打招呼（DeepSeek 生成 + 朗读）。
  async function openWithBook(title: string) {
    setBook(title);
    setMessages([]);
    setMessageDraft("");
    setInputOpen(false);
    setMemory((current) => {
      const next = structuredClone(current);
      if (!next.reader_profile.reading_history.includes(title)) {
        next.reader_profile.reading_history = [...next.reader_profile.reading_history, title].slice(-30);
      }
      return next;
    });
    setIsThinking(true);
    const fallback = `今晚就从《${title}》开始。你自己读，有触动就说给我听。`;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book: title,
          mode,
          needsSearch: false,
          messages: [
            {
              role: "user",
              content: `我今晚想读《${title}》。用一两句温暖、自然的话跟我打个招呼，别客套，并问我一个跟这本书或此刻心情有关的小问题。`
            }
          ],
          userApiKey: session?.userApiKey || undefined,
          systemPrompt: buildSystemPrompt(memory, title, mode)
        })
      });
      const data = await response.json();
      const greeting = response.ok && data.reply ? data.reply : fallback;
      setMessages([{ role: "assistant", content: greeting }]);
      void deliver(greeting);
    } catch {
      setMessages([{ role: "assistant", content: fallback }]);
      void deliver(fallback);
    }
  }

  async function submitUserText(rawText: string) {
    const text = rawText.trim();
    if (!text || !session) return;

    // 还没选书 → 第一句话就是书名，进入阅读现场。
    if (!book) {
      await openWithBook(text);
      return;
    }

    const canUseQuota = session.plan === "pro" || session.trialRemaining > 0;
    if (!session.userApiKey && !canUseQuota) {
      setModal("paywall");
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setSubtitle(text);
    setMessageDraft("");
    setInputOpen(false);
    setIsThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          mode,
          needsSearch: shouldSearch(text),
          messages: nextMessages.slice(-10),
          userApiKey: session.userApiKey || undefined,
          systemPrompt: buildSystemPrompt(memory, book, mode)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const assistantMessage: ChatMessage = { role: "assistant", content: data.reply };
      const completed = [...nextMessages, assistantMessage];
      setMessages(completed);
      void deliver(data.reply);
      recordTurn(text, data.reply);
      const consolidated = recordConversation(memory, { book, mode, messages: completed });
      persistSession(completed);
      void runConsolidation(consolidated);
      if (data.usedSearch) flash("查了一点资料。");
      if (data.demo) flash("演示回应：配置 DeepSeek Key 后会变成真实 AI。");
      if (!session.userApiKey && session.plan === "trial") {
        setSession((current) => (current ? { ...current, trialRemaining: Math.max(0, current.trialRemaining - 1) } : current));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求失败";
      setIsThinking(false);
      setSubtitle(`这里卡住了：${message}`);
      flash(message);
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    await submitUserText(messageDraft);
  }

  function startDictation() {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: BrowserSpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      flash("当前浏览器不支持语音输入，可以用输入法语音。");
      setInputOpen(true);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      setIsListening(true);
      setInputOpen(true);
    };
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript || "";
      if (!text) return;
      setMessageDraft(text);
      void submitUserText(text);
    };
    recognition.onerror = () => {
      setIsListening(false);
      flash("语音输入失败，再试一次。");
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  }

  function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSession((current) => {
      if (!current) return current;
      return {
        ...current,
        name: String(form.get("name") || "").trim() || current.name,
        voice: (String(form.get("voice") || current.voice) as VoiceKey),
        userApiKey: String(form.get("userApiKey") || "").trim()
      };
    });
    setModal(null);
    flash("设置已保存。");
  }

  function activateProPlan() {
    setSession((current) => (current ? { ...current, plan: "pro", trialRemaining: 999 } : current));
    setModal(null);
    flash("已模拟开通套餐。");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    if (event.key === "Escape") {
      setInputOpen(false);
      setModal(null);
    }
    if (event.code === "Space" && !isTyping && !modal) {
      event.preventDefault();
      setInputOpen(true);
    }
  }

  // ① 登录 / 注册（极简一屏）
  if (!entered) {
    return (
      <main className="reader landing">
        <div className="outerHalo" />
        <div className="glowCore" />
        <section className="loginShell">
          <div className="loginIntro">
            <div className="bootBrand">i阅</div>
            <h1>把书读到心里去</h1>
            <p>你读纸质书，i阅 安静地在旁边。读到有灵感、疑问或触动，说给它听，它会陪你想下去——并且越来越懂你。</p>
          </div>
          <form className="loginForm" onSubmit={handleAuth}>
            {cloudEnabled ? (
              <>
                <label>邮箱</label>
                <input
                  type="email"
                  autoFocus
                  value={authEmailDraft}
                  onChange={(event) => setAuthEmailDraft(event.target.value)}
                  placeholder="you@example.com"
                />
                <label>密码</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="至少 6 位"
                />
                <button type="submit" disabled={authBusy}>
                  {authBusy ? "稍等…" : "进入"}
                </button>
                <p className="loginHint">第一次来会自动建账号，老朋友直接进。</p>
              </>
            ) : (
              <>
                <p>当前未配置云端账户，可直接以本地模式体验（记忆只存在这台设备）。</p>
                <button type="submit">进入阅读</button>
              </>
            )}
          </form>
        </section>
      </main>
    );
  }

  // 会话设置还在初始化的极短暂间隙
  if (!session) {
    return (
      <main className="reader">
        <div className="outerHalo" />
        <div className="glowCore" />
      </main>
    );
  }

  // ② 进入即对话 + ③ 阅读陪伴
  return (
    <main className={`reader ${isThinking ? "thinking" : ""} ${isSpeaking ? "speaking" : ""}`} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="outerHalo" />
      <div className="glowCore" />

      <nav className="topbar">
        <div className="brandMark">i阅</div>
        <button className="quotaPill" onClick={() => setModal("account")} type="button">
          {session.userApiKey ? "自带 API" : session.plan === "pro" ? "套餐用户" : `免费 ${session.trialRemaining}/${FREE_TRIAL_TURNS}`}
        </button>
      </nav>

      <section className="subtitle" aria-live="polite">{subtitle}</section>
      {isThinking && (
        <div className="thinkingDots" aria-label="i阅 正在思考">
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="bottomHint">
        {isThinking ? "i阅 在想…" : !book ? "输入书名，按 Enter 开始" : isSpeaking ? "正在朗读" : "按空格说话 · 或直接打字"}
      </div>

      <section className={`inputDock ${inputOpen ? "open" : ""}`} onClick={() => setInputOpen(true)}>
        <div className="inputLine" />
        <form onSubmit={sendMessage}>
          <div className="inputRow">
            <input
              ref={inputRef}
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              placeholder={book ? "把刚才的灵感说给 i阅" : "今晚想读哪本书？"}
            />
            <button className={isListening ? "listening" : ""} onClick={startDictation} type="button">
              {isListening ? "听" : "说"}
            </button>
          </div>
        </form>
      </section>

      <div className="cornerActions">
        <button onClick={() => setModal("memory")} title="记忆" type="button">◇</button>
        <button onClick={() => setModal("account")} title="账户" type="button">¤</button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {modal === "memory" && (
        <section className="modal">
          <div className="panel">
            <h2>i阅 记得</h2>
            <div className="memoryItem"><strong>正在读</strong><br />{book || "尚未开始"}{memory.reader_profile.currentChapter ? ` · ${memory.reader_profile.currentChapter}` : ""}</div>
            {memory.reader_profile.reading_history.length > 0 && (
              <div className="memoryItem"><strong>读过</strong><br />{memory.reader_profile.reading_history.slice(-8).join("、")}</div>
            )}
            {memory.reader_profile.personality_notes && (
              <div className="memoryItem"><strong>关于怎么陪你</strong><br />{memory.reader_profile.personality_notes}</div>
            )}
            {memory.dream_notes.length > 0 && (
              <div className="memoryItem"><strong>跨会话的洞察</strong><br />{memory.dream_notes.slice(-2).map((item) => item.content).join("\n\n")}</div>
            )}
            <div className="memoryItem"><strong>最近聊过</strong><br />{memory.conversations.slice(-4).reverse().map((item) => `《${item.book}》：${item.summary}`).join("\n\n") || "暂无"}</div>
            <div className="actions">
              <button onClick={() => setMemory(defaultMemory())} type="button">清空</button>
              <button onClick={() => setModal(null)} type="button">关闭</button>
            </div>
          </div>
        </section>
      )}

      {modal === "account" && (
        <section className="modal">
          <form className="panel accountPanel" onSubmit={saveAccount}>
            <h2>账户</h2>
            <div className="planStrip">
              <div>
                <strong>{cloudEnabled ? (authEmail || "已登录") : "本地模式"}</strong>
                <span>{cloudEnabled ? "记忆已跨设备保存" : "记忆只存在这台设备"}</span>
              </div>
              <button onClick={signOut} type="button">退出</button>
            </div>
            <div className="planStrip">
              <div>
                <strong>{session.plan === "pro" ? "i阅套餐" : "免费试读"}</strong>
                <span>{session.userApiKey ? "当前使用自己的 API Key" : session.plan === "pro" ? "平台额度可用" : `还剩 ${session.trialRemaining} 轮`}</span>
              </div>
              <button onClick={activateProPlan} type="button">模拟购买套餐</button>
            </div>

            <label>称呼</label>
            <input name="name" defaultValue={session.name} />

            <label>声音</label>
            <div className="voiceGrid compact">
              {(Object.keys(voiceOptions) as VoiceKey[]).map((key) => (
                <label className="voiceChoice" key={key}>
                  <input name="voice" type="radio" value={key} defaultChecked={session.voice === key} />
                  <span>
                    <strong>{voiceOptions[key].name}</strong>
                    <em>{voiceOptions[key].desc}</em>
                  </span>
                </label>
              ))}
            </div>

            <div className="cloneBox">
              <div className="sampleScript">
                <span>想用自己的声音？读一遍这句话</span>
                <strong>{voiceSampleScript}</strong>
              </div>
              <div className="cloneActions">
                <button onClick={isRecording ? stopRecording : startRecording} type="button">
                  {isRecording ? "结束录音并保存" : "录制我的声音"}
                </button>
                <label>
                  上传录音
                  <input accept="audio/*" onChange={(event) => handleVoiceUpload(event.target.files?.[0] || null)} type="file" />
                </label>
              </div>
              <span>{isRecording ? "正在录音..." : session.voiceSample || draftVoiceSample ? "已保存声音样本，选「我的声音」即可启用。" : "可选；不录就用默认嗓音。"}</span>
              {(session.voiceSample || draftVoiceSample) && <audio controls src={session.voiceSample || draftVoiceSample} />}
            </div>

            <label>高级：DeepSeek API Key（留空用平台额度）</label>
            <input name="userApiKey" defaultValue={session.userApiKey} placeholder="sk-..." />

            <div className="actions">
              <button onClick={() => setModal(null)} type="button">关闭</button>
              <button type="submit">保存</button>
            </div>
          </form>
        </section>
      )}

      {modal === "paywall" && (
        <section className="modal">
          <div className="panel paywallPanel">
            <h2>今晚还想继续读吗？</h2>
            <p>刚才几轮先让你感受一下：你自己读，想到什么就说，i阅 再陪你想下去。想继续保留这种读书现场，可以开通套餐；已有模型额度的话，也可以接入自己的 API。</p>
            <div className="priceGrid">
              <button onClick={activateProPlan} type="button">
                <strong>开通套餐</strong>
                <span>模拟购买，立即继续读</span>
              </button>
              <button onClick={() => setModal("account")} type="button">
                <strong>使用自己的 API</strong>
                <span>在账户里填写 Key</span>
              </button>
            </div>
            <div className="actions">
              <button onClick={() => setModal(null)} type="button">稍后再说</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
