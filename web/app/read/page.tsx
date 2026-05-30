"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  applyConsolidation,
  buildConsolidationMessages,
  buildNewBookGreetingUserMessage,
  buildReturnGreetingUserMessage,
  buildSystemPrompt,
  buildBookTrajectory,
  buildMemoryTimeline,
  buildTurnCompanionPrompt,
  buildWelcomeBackHint,
  resolveBookEntryIntent,
  commitTurn,
  defaultMemory,
  detectReplyStance,
  ensureReaderReady,
  fallbackReturnGreeting,
  formatTimelineEntry,
  getBookSessionMessages,
  hasBookHistory,
  inferReadingPhase,
  recordConversation,
  shouldConsolidate,
  shouldSearch
} from "@/lib/core";
import type { ChatMessage, Memory, ModeKey } from "@/lib/core";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { loadMemory, saveMemory, clearLocalMemory } from "@/lib/memory-store";
import { FREE_TRIAL_TURNS, type QuotaPlan } from "@/lib/quota/constants";
import {
  loadSpeechAudio,
  playSpeechAudio,
  audioFromDataUrl,
  stopSpeaking,
  unlockAudioPlayback,
  textRevealIntervalMs,
  msPerCharForDuration,
  estimateSpeechDuration,
  mobilePlaybackHint,
  prefersMobileLayout
} from "@/lib/tts-client";
import { sanitizeAssistantReply } from "@/lib/core";
import { readJsonResponse } from "@/lib/read-json-response";

type UserSession = {
  name: string;
  email: string;
  plan: QuotaPlan;
  trialRemaining: number;
  userApiKey: string;
  ttsEnabled: boolean;
};
type AuthTab = "invite" | "apply" | "login";

const SESSION_KEY = "iyue_web_session_v1";
const MODE: ModeKey = "fireplace";
const GREETING = "今天你想读什么书？书在你手里，有想聊的随时发给我。";

function defaultSession(email: string): UserSession {
  const name = (email || "").split("@")[0] || "读者";
  return { name, email, plan: "trial", trialRemaining: FREE_TRIAL_TURNS, userApiKey: "", ttsEnabled: true };
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

  // 认证（Supabase 邮箱+密码）
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authEmailDraft, setAuthEmailDraft] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [betaClosed, setBetaClosed] = useState(false);
  const [betaReady, setBetaReady] = useState(false);
  const [authTab, setAuthTab] = useState<AuthTab>("apply");
  const [inviteCodeDraft, setInviteCodeDraft] = useState("");
  const [applyNoteDraft, setApplyNoteDraft] = useState("");
  const [applySubmitted, setApplySubmitted] = useState(false);
  const [wechatEnabled, setWechatEnabled] = useState(false);
  const [localEntered, setLocalEntered] = useState(false);
  const [memoryReady, setMemoryReady] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakTokenRef = useRef(0);

  const entered = cloudEnabled ? Boolean(authUserId) : localEntered;

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as UserSession | null;
      if (raw) {
        setSession({
          ...defaultSession(raw.email || ""),
          ...raw,
          ttsEnabled: raw.ttsEnabled !== false
        });
      }
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

  useEffect(() => {
    fetch("/api/beta/status")
      .then((res) => res.json())
      .then((data) => setBetaClosed(Boolean(data.closed)))
      .catch(() => setBetaClosed(false))
      .finally(() => setBetaReady(true));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (authError) {
      flash(decodeURIComponent(authError));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/wechat")
      .then((res) => res.json())
      .then((data) => setWechatEnabled(Boolean(data.enabled)))
      .catch(() => setWechatEnabled(false));
  }, []);

  // 进入后若还没有会话设置，自动创建一个（不再让用户填表）。
  useEffect(() => {
    if (entered && !session) setSession(defaultSession(authEmail));
  }, [entered, session, authEmail]);

  // 登录后直接进入选书；有近期记录则牵挂式提示，否则默认开场。
  useEffect(() => {
    if (!entered || !memoryReady) return;
    if (!book) {
      const hint = buildWelcomeBackHint(memory);
      setSubtitle(hint || GREETING);
      setInputOpen(true);
    }
  }, [entered, book, memoryReady, memory]);

  // 记忆按身份加载：登录走云端（首登自动迁移本地），未登录走本地。
  useEffect(() => {
    hydratedRef.current = false;
    let cancelled = false;
    loadMemory(authUserId).then((loaded) => {
      if (cancelled) return;
      const ready = ensureReaderReady(loaded, authEmail);
      setMemory(ready);
      hydratedRef.current = true;
      setMemoryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authUserId, authEmail]);

  // 登录后从服务端同步额度（绑 user_id，不可清缓存绕过）。
  useEffect(() => {
    void refreshQuota();
  }, [authUserId, cloudEnabled]);

  // 记忆变化后防抖落盘
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

  function pickQuotaFields(data: Record<string, unknown>): { plan?: QuotaPlan; turnsRemaining?: number } {
    const plan = data.plan === "trial" || data.plan === "pro" ? data.plan : undefined;
    const turnsRemaining = typeof data.turnsRemaining === "number" ? data.turnsRemaining : undefined;
    return { plan, turnsRemaining };
  }

  function applyQuotaFromServer(quota: {
    plan?: QuotaPlan;
    turnsRemaining?: number;
  }) {
    if (quota.plan === undefined && quota.turnsRemaining === undefined) return;
    setSession((current) => {
      if (!current) return current;
      return {
        ...current,
        ...(quota.plan !== undefined ? { plan: quota.plan } : {}),
        ...(quota.turnsRemaining !== undefined ? { trialRemaining: quota.turnsRemaining } : {})
      };
    });
  }

  async function refreshQuota() {
    if (!cloudEnabled || !authUserId) return;
    try {
      const response = await fetch("/api/quota");
      if (!response.ok) return;
      const data = await readJsonResponse(response);
      applyQuotaFromServer(pickQuotaFields(data));
    } catch {
      // 额度拉取失败时保留本地展示。
    }
  }

  function handleQuotaExhausted() {
    setIsThinking(false);
    setModal("paywall");
    applyQuotaFromServer({ plan: "trial", turnsRemaining: 0 });
    flash("试读额度已用完。");
  }

  // 打字机：固定节奏
  function revealText(full: string, msPerChar?: number) {
    if (revealRef.current) clearInterval(revealRef.current);
    setSubtitle("");
    if (!full) return;
    const interval = msPerChar ?? textRevealIntervalMs();
    let index = 0;
    revealRef.current = setInterval(() => {
      index += 1;
      setSubtitle(full.slice(0, index));
      if (index >= full.length) {
        if (revealRef.current) clearInterval(revealRef.current);
        revealRef.current = null;
      }
    }, interval);
  }

  /** 字幕与语音时长对齐 */
  function revealTextSynced(full: string, durationMs: number, token: number) {
    if (revealRef.current) clearInterval(revealRef.current);
    setSubtitle("");
    if (!full || token !== speakTokenRef.current) return;
    const interval = msPerCharForDuration(full.length, durationMs);
    let index = 0;
    revealRef.current = setInterval(() => {
      if (token !== speakTokenRef.current) {
        if (revealRef.current) clearInterval(revealRef.current);
        revealRef.current = null;
        return;
      }
      index += 1;
      setSubtitle(full.slice(0, index));
      if (index >= full.length) {
        if (revealRef.current) clearInterval(revealRef.current);
        revealRef.current = null;
      }
    }, interval);
  }

  useEffect(() => () => {
    if (revealRef.current) clearInterval(revealRef.current);
    stopSpeaking();
  }, []);

  async function startWechatLogin() {
    setAuthBusy(true);
    try {
      const response = await fetch("/api/auth/wechat");
      const data = await readJsonResponse(response);
      if (!data.enabled || typeof data.url !== "string") {
        flash("微信登录即将开放，请先用邮箱进入。");
        return;
      }
      window.location.href = data.url;
    } catch {
      flash("微信登录暂时不可用。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      if (betaClosed) {
        flash("内测期间需要账号登录，请稍后再试。");
        return;
      }
      setLocalEntered(true);
      return;
    }
    const email = authEmailDraft.trim();
    const password = authPassword;
    if (!email || !password) {
      flash("填一下邮箱和密码。");
      return;
    }
    setAuthBusy(true);
    try {
      const signIn = await supabase.auth.signInWithPassword({ email, password });
      if (signIn.data.session) {
        setAuthPassword("");
        return;
      }
      flash(signIn.error?.message || "登录失败，请检查邮箱和密码。");
    } catch (error) {
      flash(error instanceof Error ? error.message : "进不去，稍后再试一次。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleInviteSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      flash("云端账号未配置，暂时无法注册。");
      return;
    }
    const email = authEmailDraft.trim();
    const password = authPassword;
    const inviteCode = inviteCodeDraft.trim();
    if (!email || !password || !inviteCode) {
      flash("请填写邮箱、密码和邀请码。");
      return;
    }
    if (password.length < 6) {
      flash("密码至少 6 位。");
      return;
    }
    setAuthBusy(true);
    try {
      const response = await fetch("/api/beta/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, inviteCode })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        flash(typeof data.error === "string" ? data.error : "注册失败。");
        return;
      }
      const signIn = await supabase.auth.signInWithPassword({ email, password });
      if (signIn.data.session) {
        setAuthPassword("");
        setInviteCodeDraft("");
        flash("欢迎进入 i阅。");
        return;
      }
      flash("账号已创建，请用邮箱和密码登录。");
      setAuthTab("login");
    } catch (error) {
      flash(error instanceof Error ? error.message : "注册失败，稍后再试。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = authEmailDraft.trim();
    if (!email) {
      flash("请填写邮箱。");
      return;
    }
    setAuthBusy(true);
    try {
      const response = await fetch("/api/beta/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, note: applyNoteDraft.trim() || undefined })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        flash(typeof data.error === "string" ? data.error : "提交失败。");
        return;
      }
      setApplySubmitted(true);
      flash("已收到你的申请，我们会通过邮箱联系你。");
    } catch (error) {
      flash(error instanceof Error ? error.message : "提交失败，稍后再试。");
    } finally {
      setAuthBusy(false);
    }
  }

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
    stopSpeaking();
    speakTokenRef.current += 1;
    setIsSpeaking(false);
    clearLocalMemory();
    setAuthUserId(null);
    setAuthEmail("");
    setSession(null);
    setLocalEntered(false);
    setBook("");
    setMessages([]);
    setModal(null);
    setMemory(defaultMemory());
    setMemoryReady(false);
    setSubtitle(GREETING);
    setIsThinking(false);
    setInputOpen(false);
    flash("已退出登录。");
  }

  // 语音开启时：等音频就绪后与朗读同步出字；服务端预生成音频可大幅缩短等待。
  function deliver(text: string, prefetchedAudio?: string) {
    setIsThinking(false);
    const clean = sanitizeAssistantReply(text);
    const useTts = session?.ttsEnabled !== false && Boolean(clean);
    const token = ++speakTokenRef.current;

    if (!useTts) {
      revealText(clean);
      return;
    }

    void (async () => {
      const audio = prefetchedAudio
        ? await audioFromDataUrl(prefetchedAudio)
        : await loadSpeechAudio({ text: clean });
      if (token !== speakTokenRef.current) return;

      if (!audio) {
        revealText(clean);
        if (prefersMobileLayout()) flash(mobilePlaybackHint());
        return;
      }

      const durationMs =
        audio.duration > 0 ? audio.duration * 1000 : estimateSpeechDuration(clean.length) * 1000;

      const ok = await playSpeechAudio(audio, {
        onStart: () => {
          if (token !== speakTokenRef.current) return;
          revealTextSynced(clean, durationMs, token);
          setIsSpeaking(true);
        },
        onEnd: () => {
          if (token !== speakTokenRef.current) return;
          setIsSpeaking(false);
          setSubtitle(clean);
        }
      });

      if (token !== speakTokenRef.current) return;
      if (!ok) {
        revealText(clean);
        setIsSpeaking(false);
        if (prefersMobileLayout()) flash(mobilePlaybackHint());
      }
    })();
  }

  function commitAndSave(
    userText: string,
    assistantText: string,
    completed: ChatMessage[]
  ) {
    setMemory((current) => {
      const next = commitTurn(current, { book, mode, userText, assistantText, messages: completed });
      void saveMemory(next, authUserId);
      void runConsolidation(next);
      return next;
    });
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
      const data = await readJsonResponse(response);
      if (!response.ok || typeof data.raw !== "string" || !data.raw) return;
      setMemory((current) => {
        const next = applyConsolidation(current, data.raw as string);
        void saveMemory(next, authUserId);
        return next;
      });
      flash("i阅 又更懂你了一点。");
    } catch {
      // 后台增益，失败静默。
    }
  }

  function persistGreeting(title: string, greeting: string) {
    setMemory((current) => {
      const messages: ChatMessage[] = [{ role: "assistant", content: greeting }];
      const next = recordConversation(current, { book: title, mode, messages });
      void saveMemory(next, authUserId);
      return next;
    });
  }

  // 进入一本书：有保存的对话则恢复；否则让 i阅 主动打招呼。
  async function openWithBook(title: string) {
    setBook(title);
    setMessageDraft("");
    setInputOpen(false);

    const priorMessages = getBookSessionMessages(memory, title);
    if (priorMessages.length > 0) {
      setMessages(priorMessages);
      const lastLine = priorMessages[priorMessages.length - 1]?.content || "";
      setSubtitle(lastLine);
      setIsThinking(false);
      setMemory((current) => {
        const next = structuredClone(current);
        if (!next.reader_profile.reading_history.includes(title)) {
          next.reader_profile.reading_history = [...next.reader_profile.reading_history, title].slice(-30);
        }
        return next;
      });
      flash(`接着聊《${title}》。`);
      return;
    }

    setMessages([]);
    setMemory((current) => {
      const next = structuredClone(current);
      if (!next.reader_profile.reading_history.includes(title)) {
        next.reader_profile.reading_history = [...next.reader_profile.reading_history, title].slice(-30);
      }
      return next;
    });
    setIsThinking(true);
    const returning = hasBookHistory(memory, title);
    const fallback = returning
      ? fallbackReturnGreeting(memory, title)
      : `好，今晚读《${title}》。书在你手里，我陪着——有触动、有疑问，随便发给我，我帮你记着。`;
    const greetingPrompt = returning
      ? buildReturnGreetingUserMessage(memory, title)
      : buildNewBookGreetingUserMessage(memory, title);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book: title,
          mode,
          needsSearch: false,
          messages: [{ role: "user", content: greetingPrompt }],
          userApiKey: session?.userApiKey || undefined,
          systemPrompt: buildSystemPrompt(memory, title, mode),
          turnCompanionPrompt: buildTurnCompanionPrompt({
            phase: returning ? "reading" : "opening",
            stance: "deepen",
            searchUsed: false
          }),
          wantTts: session?.ttsEnabled !== false
        })
      });
      const data = await readJsonResponse(response);
      if (response.status === 402) {
        handleQuotaExhausted();
        return;
      }
      const greeting = response.ok && typeof data.reply === "string" ? data.reply : fallback;
      if (data.quota && typeof data.quota === "object") applyQuotaFromServer(pickQuotaFields(data.quota as Record<string, unknown>));
      setMessages([{ role: "assistant", content: greeting }]);
      persistGreeting(title, greeting);
      void deliver(greeting, typeof data.audio === "string" ? data.audio : undefined);
    } catch {
      setMessages([{ role: "assistant", content: fallback }]);
      persistGreeting(title, fallback);
      void deliver(fallback, undefined);
    }
  }

  async function handleBookEntry(text: string) {
    const welcomeHint = buildWelcomeBackHint(memory);
    let intent = resolveBookEntryIntent(text, memory);

    if (intent.action === "unclear" && intent.lastBook) {
      const fallbackBook = intent.lastBook;
      try {
        const response = await fetch("/api/classify-entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            lastBook: fallbackBook,
            welcomeHint: welcomeHint || undefined
          })
        });
        const data = await readJsonResponse(response);
        if (data.intent === "continue" && typeof data.book === "string") {
          intent = { action: "continue", book: data.book };
        } else if (data.intent === "new_book_pending") {
          intent = { action: "prompt_new" };
        } else if (data.intent === "title" && typeof data.book === "string" && data.book) {
          intent = { action: "open", book: data.book };
        } else if (typeof data.book === "string" && data.book) {
          intent = { action: "continue", book: data.book };
        }
      } catch {
        intent = { action: "continue", book: fallbackBook };
      }
    }

    if (intent.action === "continue") {
      flash(`好，接着读《${intent.book}》。`);
      await openWithBook(intent.book);
      return;
    }
    if (intent.action === "open") {
      await openWithBook(intent.book);
      return;
    }
    if (intent.action === "prompt_new") {
      setSubtitle("好，换一本。输入书名就可以开始。");
      setInputOpen(true);
      return;
    }
    if (intent.action === "none") return;

    await openWithBook(text);
  }

  async function submitUserText(rawText: string) {
    const text = rawText.trim();
    if (!text || !session) return;
    unlockAudioPlayback();

    // 还没选书 → 先理解意图（继续上一本 / 换书 / 报书名），再进入阅读。
    if (!book) {
      await handleBookEntry(text);
      return;
    }

    if (!session.userApiKey && session.plan !== "pro" && session.trialRemaining <= 0) {
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

    const phase = inferReadingPhase(memory, book, messages, text);
    const stance = detectReplyStance(text);
    const needsSearch = shouldSearch(text);
    const turnCompanionPrompt = buildTurnCompanionPrompt({
      phase,
      stance,
      searchUsed: needsSearch,
      trajectory: phase === "reflecting" ? buildBookTrajectory(memory, book) : ""
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          mode,
          needsSearch,
          messages: nextMessages.slice(-10),
          userApiKey: session.userApiKey || undefined,
          systemPrompt: buildSystemPrompt(memory, book, mode),
          turnCompanionPrompt,
          wantTts: session.ttsEnabled !== false
        })
      });
      const data = await readJsonResponse(response);
      if (response.status === 402) {
        handleQuotaExhausted();
        setMessages(messages);
        return;
      }
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
      }
      if (data.quota && typeof data.quota === "object") {
        applyQuotaFromServer(pickQuotaFields(data.quota as Record<string, unknown>));
      }
      const reply = typeof data.reply === "string" ? data.reply : "";
      const assistantMessage: ChatMessage = { role: "assistant", content: reply };
      const completed = [...nextMessages, assistantMessage];
      setMessages(completed);
      void deliver(reply, typeof data.audio === "string" ? data.audio : undefined);
      commitAndSave(text, reply, completed);
      if (data.usedSearch) flash("查了一点资料。");
      if (phase === "reflecting") flash("帮你把和这本书的轨迹记下了。");
      if (data.demo) flash("演示回应：配置 DeepSeek Key 后会变成真实 AI。");
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

  function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim() || session?.name || "读者";
    const userApiKey = String(form.get("userApiKey") || "").trim();
    const ttsEnabled = form.get("ttsEnabled") === "on";
    setSession((current) => (current ? { ...current, name, userApiKey, ttsEnabled } : current));
    if (!ttsEnabled) {
      stopSpeaking();
      speakTokenRef.current += 1;
      setIsSpeaking(false);
    }
    if (name) {
      setMemory((current) => ({
        ...current,
        reader_profile: { ...current.reader_profile, name }
      }));
    }
    setModal(null);
    flash("设置已保存。");
  }

  async function activateProPlan() {
    if (cloudEnabled && authUserId) {
      try {
        const response = await fetch("/api/quota/activate", { method: "POST" });
        const data = await readJsonResponse(response);
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "开通失败");
        }
        applyQuotaFromServer(pickQuotaFields(data));
        setModal(null);
        flash("已开通套餐，继续读吧。");
        return;
      } catch (error) {
        flash(error instanceof Error ? error.message : "开通失败");
        return;
      }
    }
    setSession((current) => (current ? { ...current, plan: "pro", trialRemaining: FREE_TRIAL_TURNS } : current));
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

  // ① 登录 / 内测入口
  if (!entered) {
    const showBetaGate = cloudEnabled && betaClosed;
    const authLoading = cloudEnabled && !betaReady;

    return (
      <main className="reader landing">
        <div className="outerHalo" />
        <div className="glowCore" />
        <section className="loginShell">
          <div className="loginIntro">
            <div className="bootBrand">i阅</div>
            <h1>{showBetaGate ? "内测邀请制" : "陪你读书"}</h1>
            <p>
              {showBetaGate
                ? "i阅 正在内测中。有邀请码可直接注册；没有的话先登记邮箱，我们会联系你。"
                : "你读纸质书，i阅 在文字里陪着。有想聊的随时发——我帮你记着，也会越来越懂你。"}
            </p>
          </div>
          {authLoading ? (
            <div className="loginForm authLoading">
              <p>稍等，正在加载…</p>
            </div>
          ) : cloudEnabled ? (
            showBetaGate ? (
              <div className="loginForm betaGate">
                <div className="authTabs">
                  <button
                    className={authTab === "invite" ? "active" : ""}
                    onClick={() => setAuthTab("invite")}
                    type="button"
                  >
                    邀请码注册
                  </button>
                  <button
                    className={authTab === "apply" ? "active" : ""}
                    onClick={() => setAuthTab("apply")}
                    type="button"
                  >
                    申请内测
                  </button>
                  <button
                    className={authTab === "login" ? "active" : ""}
                    onClick={() => setAuthTab("login")}
                    type="button"
                  >
                    已有账号
                  </button>
                </div>
                {authTab === "invite" && (
                  <form onSubmit={handleInviteSignup}>
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
                    <label>邀请码</label>
                    <input
                      type="text"
                      value={inviteCodeDraft}
                      onChange={(event) => setInviteCodeDraft(event.target.value)}
                      placeholder="向 i阅 团队索取"
                    />
                    <button type="submit" disabled={authBusy}>
                      {authBusy ? "稍等…" : "注册并进入"}
                    </button>
                    <p className="loginHint">邀请码仅内测用户持有，请勿公开分享。</p>
                  </form>
                )}
                {authTab === "apply" && (
                  <form onSubmit={handleApply}>
                    {applySubmitted ? (
                      <p className="applySuccess">
                        已收到你的申请。审核通过后，我们会把邀请码发到你的邮箱。
                      </p>
                    ) : (
                      <>
                        <label>邮箱</label>
                        <input
                          type="email"
                          autoFocus
                          value={authEmailDraft}
                          onChange={(event) => setAuthEmailDraft(event.target.value)}
                          placeholder="you@example.com"
                        />
                        <label>简单说说你为什么想试 i阅（可选）</label>
                        <textarea
                          rows={3}
                          value={applyNoteDraft}
                          onChange={(event) => setApplyNoteDraft(event.target.value)}
                          placeholder="例如：平时读纸质书，希望有人陪着聊…"
                        />
                        <button type="submit" disabled={authBusy}>
                          {authBusy ? "提交中…" : "提交申请"}
                        </button>
                        <p className="loginHint">我们会人工审核，通过后邮件发送邀请码。</p>
                      </>
                    )}
                  </form>
                )}
                {authTab === "login" && (
                  <form onSubmit={handleLogin}>
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
                      placeholder="你的密码"
                    />
                    <button type="submit" disabled={authBusy}>
                      {authBusy ? "稍等…" : "登录"}
                    </button>
                    <p className="loginHint">内测期间，新用户需要邀请码才能注册。</p>
                  </form>
                )}
              </div>
            ) : (
              <form className="loginForm" onSubmit={handleAuth}>
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
                  {authBusy ? "稍等…" : "邮箱进入"}
                </button>
                <button className="wechatBtn" disabled={authBusy} onClick={startWechatLogin} type="button">
                  {wechatEnabled ? "微信扫码登录" : "微信登录（即将开放）"}
                </button>
                <p className="loginHint">第一次来会自动建账号，老朋友直接进。</p>
              </form>
            )
          ) : (
            <form className="loginForm" onSubmit={handleLogin}>
              <p>当前未配置云端账户，可直接以本地模式体验（记忆只存在这台设备）。</p>
              <button type="submit">进入阅读</button>
            </form>
          )}
        </section>
        {toast && <div className="toast loginToast">{toast}</div>}
      </main>
    );
  }

  // 会话设置还在初始化的极短暂间隙
  if (!session || (entered && !memoryReady)) {
    return (
      <main className="reader">
        <div className="outerHalo" />
        <div className="glowCore" />
      </main>
    );
  }

  // ③ 进入即对话 + 阅读陪伴
  return (
    <main className={`reader ${isThinking ? "thinking" : ""} ${isSpeaking ? "speaking" : ""} ${!book && !isThinking ? "invite" : ""}`} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="outerHalo" />
      <div className={`glowCore ${!book && !isThinking ? "invitePulse" : ""}`} />

      <nav className="topbar">
        <div className="brandMark">i阅</div>
        <div className="topbarActions">
          <button className="quotaPill" onClick={() => setModal("account")} type="button">
            {session.userApiKey ? "自带 API" : session.plan === "pro" ? "套餐用户" : `免费 ${session.trialRemaining}/${FREE_TRIAL_TURNS}`}
          </button>
          <button className="signOutBtn" onClick={() => void signOut()} type="button">
            退出
          </button>
        </div>
      </nav>

      <section className={`subtitle ${!book && !isThinking ? "inviteText" : ""}`} aria-live="polite">{subtitle}</section>
      {isThinking && (
        <div className="thinkingDots" aria-label="i阅 正在思考">
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="bottomHint">
        {isSpeaking ? (
          "i阅 在说话…"
        ) : isThinking ? (
          "i阅 在想…"
        ) : session.ttsEnabled === false ? (
          "文字模式 · 语音已关闭"
        ) : !book ? (
          <>
            <span className="hintDesktop">输入书名，按 Enter 开始</span>
            <span className="hintMobile">轻触下方，输入书名</span>
          </>
        ) : (
          <>
            <span className="hintDesktop">书在你手里 · 有想聊的随时发</span>
            <span className="hintMobile">轻触下方 · 聊点什么</span>
          </>
        )}
      </div>

      {!book && !isThinking && <div className="breathCue" aria-hidden="true" />}

      <section
        className={`inputDock ${inputOpen ? "open" : ""}`}
        onClick={() => {
          unlockAudioPlayback();
          setInputOpen(true);
        }}
        onTouchStart={() => unlockAudioPlayback()}
        role="button"
        tabIndex={-1}
        aria-label="打开输入框"
      >
        <div className="inputLine" />
        <form
          onSubmit={sendMessage}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={messageDraft}
            onChange={(event) => setMessageDraft(event.target.value)}
            onFocus={() => unlockAudioPlayback()}
            placeholder={book ? "触动、疑问、摘抄、随便什么想聊的…" : "今天想读什么书？"}
            enterKeyHint={book ? "send" : "done"}
            autoComplete="off"
            autoCorrect="off"
          />
        </form>
      </section>

      <div className="cornerActions">
        <button onClick={() => setModal("memory")} title="记忆" type="button">◇</button>
        <button onClick={() => setModal("account")} title="账户" type="button">¤</button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {modal === "memory" && (
        <section className="modal">
          <div className="panel memoryPanel">
            <h2>心迹 · i阅 帮你记着</h2>
            <p className="memoryLead">每一句触动、每一次陪读、每一条洞察——都会留下来，越聊越懂你。</p>
            {memory.reader_profile.name && (
              <div className="memoryItem"><strong>称呼</strong><br />{memory.reader_profile.name}</div>
            )}
            <div className="memoryItem"><strong>正在读</strong><br />{book || "尚未开始"}{memory.reader_profile.currentChapter ? ` · ${memory.reader_profile.currentChapter}` : ""}</div>
            {book && buildBookTrajectory(memory, book) && (
              <div className="memoryItem"><strong>你和《{book}》的轨迹</strong><br />{buildBookTrajectory(memory, book)}</div>
            )}
            {memory.reader_profile.personality_notes && (
              <div className="memoryItem"><strong>怎么陪你更好</strong><br />{memory.reader_profile.personality_notes}</div>
            )}
            <div className="memoryTimeline">
              <strong className="timelineHeading">痕迹</strong>
              {buildMemoryTimeline(memory, book || null).length === 0 ? (
                <p className="timelineEmpty">还没有痕迹——聊几句，这里会慢慢长出来。</p>
              ) : (
                buildMemoryTimeline(memory, book || null).map((entry, index) => {
                  const { prefix, content } = formatTimelineEntry(entry);
                  return (
                    <article className={`traceItem trace-${entry.kind}`} key={`${entry.date}-${index}`}>
                      <span className="traceMeta">{prefix}</span>
                      <p>{content}</p>
                    </article>
                  );
                })
              )}
            </div>
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
              <button onClick={() => void signOut()} type="button">退出登录</button>
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

            <label className="switchRow">
              <span>
                <strong>语音朗读</strong>
                <small>用 MiMo 把 i阅 的回复读出来（炉边陪读感）</small>
              </span>
              <input defaultChecked={session.ttsEnabled !== false} name="ttsEnabled" type="checkbox" />
            </label>

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
            <p>试读额度用完了。i阅 记得你读过的书、聊过的话——开通月读，继续陪你读；或填入自己的 DeepSeek Key。</p>
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
