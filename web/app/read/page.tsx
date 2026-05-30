"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  applyConsolidation,
  buildConsolidationMessages,
  buildNewBookGreetingUserMessage,
  buildReturnGreetingUserMessage,
  buildSystemPrompt,
  buildWelcomeBackHint,
  captureTurn,
  defaultMemory,
  fallbackReturnGreeting,
  hasBookHistory,
  recordConversation,
  shouldConsolidate,
  shouldSearch
} from "@/lib/core.mjs";
import type { ChatMessage, Memory, ModeKey } from "@/lib/core.mjs";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { loadMemory, saveMemory } from "@/lib/memory-store";

type UserSession = {
  name: string;
  email: string;
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
const FREE_TRIAL_TURNS = 30;
const MODE: ModeKey = "fireplace";
const GREETING = "今天你想读什么书？书在你手里，有想聊的随时发给我。";

function defaultSession(email: string): UserSession {
  const name = (email || "").split("@")[0] || "读者";
  return { name, email, plan: "trial", trialRemaining: FREE_TRIAL_TURNS, userApiKey: "" };
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
  const [isListening, setIsListening] = useState(false);

  // 认证（Supabase 邮箱+密码）
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authEmailDraft, setAuthEmailDraft] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [wechatEnabled, setWechatEnabled] = useState(false);
  const [localEntered, setLocalEntered] = useState(false);
  const [memoryReady, setMemoryReady] = useState(false);

  // 首次进入：三步了解用户（称呼 / 工作与生活 / 诉求与陪伴方式）
  const [onboardStep, setOnboardStep] = useState(0);
  const [onboardDraft, setOnboardDraft] = useState({ name: "", work: "", lifeFocus: "", companion: "" });

  const inputRef = useRef<HTMLInputElement>(null);
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

  // 完成画像引导后才进入选书；有近期记录则牵挂式提示，否则默认开场。
  useEffect(() => {
    if (!entered || !memoryReady || onboardStep > 0) return;
    if (!memory.reader_profile.initialized) return;
    if (!book) {
      const hint = buildWelcomeBackHint(memory);
      setSubtitle(hint || GREETING);
      setInputOpen(true);
    }
  }, [entered, book, memoryReady, onboardStep, memory]);

  // 记忆按身份加载：登录走云端（首登自动迁移本地），未登录走本地。
  useEffect(() => {
    hydratedRef.current = false;
    let cancelled = false;
    loadMemory(authUserId).then((loaded) => {
      if (cancelled) return;
      setMemory(loaded);
      hydratedRef.current = true;
      setMemoryReady(true);
      if (!loaded.reader_profile.initialized) {
        setOnboardDraft({
          name: loaded.reader_profile.name || "",
          work: loaded.reader_profile.work || "",
          lifeFocus: loaded.reader_profile.life_focus || "",
          companion: loaded.reader_profile.companion_preference || ""
        });
        setOnboardStep(1);
      }
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

  // 早期只做文字：回复以打字机方式浮现，不调用语音合成。
  function revealText(full: string) {
    if (revealRef.current) clearInterval(revealRef.current);
    setSubtitle("");
    let index = 0;
    revealRef.current = setInterval(() => {
      index += 1;
      setSubtitle(full.slice(0, index));
      if (index >= full.length) {
        if (revealRef.current) clearInterval(revealRef.current);
        revealRef.current = null;
      }
    }, 42);
  }

  useEffect(() => () => {
    if (revealRef.current) clearInterval(revealRef.current);
  }, []);

  async function startWechatLogin() {
    setAuthBusy(true);
    try {
      const response = await fetch("/api/auth/wechat");
      const data = await response.json();
      if (!data.enabled || !data.url) {
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

  function finishOnboarding() {
    const name = onboardDraft.name.trim();
    const work = onboardDraft.work.trim();
    const lifeFocus = onboardDraft.lifeFocus.trim();
    const companion = onboardDraft.companion.trim();
    if (!name) {
      flash("先告诉我怎么称呼你。");
      return;
    }
    if (!work) {
      flash("简单说说你是做什么的，或在什么样的生活状态。");
      return;
    }
    if (!lifeFocus && !companion) {
      flash("说说你现在最想解决什么，或者希望我怎么陪你。");
      return;
    }
    setMemory((current) => ({
      ...current,
      reader_profile: {
        ...current.reader_profile,
        name,
        work,
        life_focus: lifeFocus,
        companion_preference: companion,
        initialized: true
      }
    }));
    setSession((current) => (current ? { ...current, name } : current));
    setOnboardStep(0);
    setSubtitle(GREETING);
    setInputOpen(true);
    flash(`好的，${name}。`);
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
    setAuthUserId(null);
    setAuthEmail("");
    setSession(null);
    setLocalEntered(false);
    setBook("");
    setMessages([]);
    setModal(null);
    flash("已退出。");
  }

  // 文字送达：思考结束后逐字显示 i阅 的回复。
  function deliver(text: string) {
    setIsThinking(false);
    revealText(text);
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

  // 进入一本书：让 i阅 主动用一句自然的话打招呼。
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
    const name = String(form.get("name") || "").trim() || session?.name || "读者";
    const userApiKey = String(form.get("userApiKey") || "").trim();
    setSession((current) => (current ? { ...current, name, userApiKey } : current));
    if (name) {
      setMemory((current) => ({
        ...current,
        reader_profile: { ...current.reader_profile, name }
      }));
    }
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
            <h1>陪你读书</h1>
            <p>你读纸质书，i阅 在文字里陪着。有想聊的随时发——我帮你记着，也会越来越懂你。</p>
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
                  {authBusy ? "稍等…" : "邮箱进入"}
                </button>
                <button className="wechatBtn" disabled={authBusy} onClick={startWechatLogin} type="button">
                  {wechatEnabled ? "微信扫码登录" : "微信登录（即将开放）"}
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
  if (!session || (entered && !memoryReady)) {
    return (
      <main className="reader">
        <div className="outerHalo" />
        <div className="glowCore" />
      </main>
    );
  }

  // ② 首次进入：三步了解用户
  if (onboardStep > 0) {
    return (
      <main className="reader landing onboarding">
        <div className="outerHalo" />
        <div className="glowCore invitePulse" />
        <section className="loginShell onboardShell">
          <div className="loginIntro">
            <div className="bootBrand">i阅</div>
            <p className="onboardProgress">认识一下 · {onboardStep}/3</p>
            {onboardStep === 1 && (
              <>
                <h1>怎么称呼你？</h1>
                <p>我会用这个称呼陪你读书，也会写进记忆里。</p>
              </>
            )}
            {onboardStep === 2 && (
              <>
                <h1>你是做什么的？</h1>
                <p>不用很正式——工作、角色，或者最近的生活状态，都可以。</p>
              </>
            )}
            {onboardStep === 3 && (
              <>
                <h1>此刻最想解决什么？</h1>
                <p>以及，你希望 i阅 怎么陪你——少说教、多提问，还是更像朋友闲聊？</p>
              </>
            )}
          </div>
          <form
            className="loginForm"
            onSubmit={(event) => {
              event.preventDefault();
              if (onboardStep === 1 && !onboardDraft.name.trim()) {
                flash("先告诉我怎么称呼你。");
                return;
              }
              if (onboardStep === 2 && !onboardDraft.work.trim()) {
                flash("简单说说你是做什么的，或在什么样的生活状态。");
                return;
              }
              if (onboardStep < 3) setOnboardStep((onboardStep + 1) as 1 | 2 | 3);
              else finishOnboarding();
            }}
          >
            {onboardStep === 1 && (
              <input
                autoFocus
                value={onboardDraft.name}
                onChange={(event) => setOnboardDraft((draft) => ({ ...draft, name: event.target.value }))}
                placeholder="例如：周先生、阿阅"
              />
            )}
            {onboardStep === 2 && (
              <textarea
                autoFocus
                rows={3}
                value={onboardDraft.work}
                onChange={(event) => setOnboardDraft((draft) => ({ ...draft, work: event.target.value }))}
                placeholder="例如：产品经理，最近在换工作 / 全职妈妈，晚上才有自己的阅读时间"
              />
            )}
            {onboardStep === 3 && (
              <>
                <textarea
                  autoFocus
                  rows={2}
                  value={onboardDraft.lifeFocus}
                  onChange={(event) => setOnboardDraft((draft) => ({ ...draft, lifeFocus: event.target.value }))}
                  placeholder="最想解决的问题：例如想搞清职业方向、缓解焦虑、把书读进去"
                />
                <textarea
                  rows={2}
                  value={onboardDraft.companion}
                  onChange={(event) => setOnboardDraft((draft) => ({ ...draft, companion: event.target.value }))}
                  placeholder="希望的陪伴方式：例如别讲大道理，多问我感受"
                />
              </>
            )}
            <button type="submit">{onboardStep < 3 ? "下一步" : "开始阅读"}</button>
          </form>
        </section>
      </main>
    );
  }

  // ③ 进入即对话 + 阅读陪伴
  return (
    <main className={`reader ${isThinking ? "thinking" : ""} ${!book && !isThinking ? "invite" : ""}`} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="outerHalo" />
      <div className={`glowCore ${!book && !isThinking ? "invitePulse" : ""}`} />

      <nav className="topbar">
        <div className="brandMark">i阅</div>
        <button className="quotaPill" onClick={() => setModal("account")} type="button">
          {session.userApiKey ? "自带 API" : session.plan === "pro" ? "套餐用户" : `免费 ${session.trialRemaining}/${FREE_TRIAL_TURNS}`}
        </button>
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
        {isThinking ? "i阅 在想…" : !book ? "输入书名，按 Enter 开始" : "书在你手里 · 有想聊的随时发"}
      </div>

      {!book && !isThinking && <div className="breathCue" aria-hidden="true" />}

      <section className={`inputDock ${inputOpen ? "open" : ""}`} onClick={() => setInputOpen(true)}>
        <div className="inputLine" />
        <form onSubmit={sendMessage}>
          <div className="inputRow">
            <input
              ref={inputRef}
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              placeholder={book ? "触动、疑问、摘抄、随便什么想聊的…" : "今天想读什么书？"}
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
            <h2>i阅 帮你记着</h2>
            {memory.reader_profile.name && (
              <div className="memoryItem"><strong>称呼</strong><br />{memory.reader_profile.name}</div>
            )}
            {memory.reader_profile.work && (
              <div className="memoryItem"><strong>工作与状态</strong><br />{memory.reader_profile.work}</div>
            )}
            {memory.reader_profile.life_focus && (
              <div className="memoryItem"><strong>想解决的问题</strong><br />{memory.reader_profile.life_focus}</div>
            )}
            {memory.reader_profile.companion_preference && (
              <div className="memoryItem"><strong>希望的陪伴</strong><br />{memory.reader_profile.companion_preference}</div>
            )}
            <div className="memoryItem"><strong>正在读</strong><br />{book || "尚未开始"}{memory.reader_profile.currentChapter ? ` · ${memory.reader_profile.currentChapter}` : ""}</div>
            {memory.reader_profile.reading_history.length > 0 && (
              <div className="memoryItem"><strong>读过的书</strong><br />{memory.reader_profile.reading_history.slice(-12).join("、")}</div>
            )}
            {memory.reader_profile.preferences.length > 0 && (
              <div className="memoryItem"><strong>你的兴趣</strong><br />{memory.reader_profile.preferences.join("、")}</div>
            )}
            {memory.reading_notes.filter((note) => note.book === book).slice(-4).length > 0 && (
              <div className="memoryItem"><strong>这本书里聊过</strong><br />{memory.reading_notes.filter((note) => note.book === book).slice(-4).map((note) => note.content).join("\n")}</div>
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
