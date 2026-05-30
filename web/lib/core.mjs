// i阅 共享内核 —— 平台无关的「大脑」。
// 网页端（Next.js/TS）通过 @/lib/core 引入，类型来自同目录 core.d.mts。
// 桌面端（单文件 HTML，无构建）可直接 <script type="module"> import 本文件。
// 这里只放纯逻辑：人格、记忆结构、记忆沉淀、人格进化。存储与 UI 留给各端。

export const MODES = {
  fireplace: {
    name: "炉边智者",
    badge: "FIREPLACE",
    placeholder: "今晚读哪本书？",
    hint: "按空格键输入",
    prompt:
      "当前模式：阅读陪伴。读者自己捧着纸质书在读，你在旁边。他不问你不开口；他发来任何想聊的——触动、疑问、摘录、走神、心情——你都接住。不抢书、不代读、不讲课。"
  },
  desk: {
    name: "书桌笔记",
    badge: "DESK NOTES",
    placeholder: "今天摊开哪本书？",
    hint: "把灵感说出来 · 右侧会沉淀笔记",
    prompt:
      "当前模式：书桌笔记。读者自己阅读，你负责接住语音/文字里抛来的章节、问题、金句和洞察，并沉淀成笔记。回复仍然简短。"
  },
  starmap: {
    name: "思维星图",
    badge: "THOUGHT MAP",
    placeholder: "今天从哪本书开始连线？",
    hint: "说出触动 · 对话会变成思想节点",
    prompt:
      "当前模式：思维星图。读者自己阅读，你根据他随手说出的触动，帮助发现跨书、跨经验、跨学科的关联。"
  }
};

export const SEARCH_TRIGGERS = [
  "第", "章", "作者", "出版", "年份", "事实", "资料", "介绍", "背景", "搜索", "查一下", "书评", "谁是", "是什么"
];

const NODE_CANDIDATES = [
  "复利", "能力圈", "长期主义", "反过来想", "反脆弱", "选择", "自由", "注意力", "习惯", "判断", "系统", "激励", "风险"
];

// 距上次人格进化的最小间隔（毫秒）。
export const CONSOLIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** @returns {import("./core.d.mts").Memory} */
export function defaultMemory() {
  return {
    conversations: [],
    reader_profile: {
      name: "",
      work: "",
      life_focus: "",
      companion_preference: "",
      preferences: [],
      reading_history: [],
      currentChapter: "",
      insights: [],
      personality_notes: "",
      initialized: false
    },
    dream_notes: [],
    reading_notes: [],
    thought_nodes: [],
    last_consolidation: 0
  };
}

/** 把任意存储里读到的对象补齐成完整 Memory，避免字段缺失。 */
export function normalizeMemory(raw) {
  return { ...defaultMemory(), ...(raw || {}) };
}

export function compactText(text, max = 52) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export function extractNodeName(text) {
  const clean = String(text || "").replace(/[，。！？、,.!?]/g, " ").trim();
  return clean.split(/\s+/).filter(Boolean)[0] || clean.slice(0, 12) || "思想节点";
}

export function classifyNote(text) {
  if (shouldTriggerLookback(text)) return "回望";
  if (/第\s*[一二三四五六七八九十百千万\d]+\s*章/.test(text)) return "章节";
  if (/[？?]|为什么|如何|怎么|是不是/.test(text)) return "问题";
  if (String(text || "").length > 40) return "金句";
  return "洞察";
}

export function shouldSearch(text) {
  return SEARCH_TRIGGERS.some((trigger) => text.includes(trigger)) || /[0-9]{4}|what|who|when|where/i.test(text);
}

/** 去掉推理链、括号旁白、舞台说明，让回复适合展示与朗读。 */
export function sanitizeAssistantReply(text) {
  let out = String(text || "");

  // DeepSeek reasoner 等：think 块（修复闭合标签；兼容多种写法）
  out = out.replace(/<(?:think(?:ing)?|redacted_thinking)>[\s\S]*?<\/(?:think(?:ing)?|redacted_thinking)>/gi, "");
  out = out.replace(/<(?:think(?:ing)?|redacted_thinking)>[\s\S]*$/gi, "");

  // 若标签不匹配，取最后一个  之后作为正文
  const thinkParts = out.split(/<\/(?:think(?:ing)?|redacted_thinking)>/i);
  if (thinkParts.length > 1) {
    const tail = thinkParts[thinkParts.length - 1].trim();
    if (tail) out = tail;
  }

  // 括号旁白（中英）
  out = out.replace(/（[^（）\n]{0,200}）/g, "");
  out = out.replace(/\([^()\n]{0,200}\)/g, "");

  // 【舞台说明】、*动作*
  out = out.replace(/【[^【】\n]{0,120}】/g, "");
  out = out.replace(/\*[^*\n]{0,80}\*/g, "");

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 没有配置任何 API Key 时的离线占位回复，保证体验不空转。 */
export function demoReply(book, userText) {
  const clean = String(userText || "").trim();
  if (shouldTriggerLookback(clean)) {
    return `《${book || "这本书"}》读完了。不写总结——你自己心里，最后真正留下的是哪一句？`;
  }
  if (/第\s*[一二三四五六七八九十百千万\d]+\s*章/.test(clean)) {
    return `这一章你先读你的，不用急着总结。哪一句最卡你，或者哪一句让你停了一下？发给我，我帮你记着。`;
  }
  if (/[？?]|为什么|如何|怎么|是不是/.test(clean)) {
    return `这个问题值得慢慢想。你自己读的时候，直觉上更倾向哪个答案？`;
  }
  if (/触动|难受|兴奋|困惑|喜欢|不喜欢|震撼|我觉得|我感觉/.test(clean)) {
    return `这个反应很重要，我记下了。它碰到你的哪一块？`;
  }
  return `我听到了，帮你记着。你自己读的时候，这句话如果是真的，会改变你什么？`;
}

/** 读者是否表达「读完了 / 要收尾」——触发回望模式。 */
export function shouldTriggerLookback(text) {
  const clean = String(text || "").trim();
  return /读完了|看完了|合上书|整本读完|全书读完|最后一章|读到最后|收尾了|结束这本|不想读这本了/.test(clean);
}

/** 推断当前陪读阶段：opening 刚进入 · reading 读中 · reflecting 读完回望。 */
export function inferReadingPhase(memory, book, messages, userText) {
  if (shouldTriggerLookback(userText)) return "reflecting";
  const m = normalizeMemory(memory);
  const bookNotes = m.reading_notes.filter((note) => note.book === book);
  const userCount = (messages || []).filter((item) => item.role === "user").length;
  const hasChapter =
    bookNotes.some((note) => note.type === "章节") ||
    /第\s*[一二三四五六七八九十百千万\d]+\s*章/.test(String(userText || ""));
  if (!hasBookHistory(m, book) && userCount <= 1 && !hasChapter) return "opening";
  if (userCount <= 2 && bookNotes.length <= 2 && !hasChapter) return "opening";
  return "reading";
}

/** 本轮回复姿态：hold 先接住 · explore 陪他想 · deepen 可推一步。 */
export function detectReplyStance(userText) {
  const text = String(userText || "").trim();
  if (/触动|难受|兴奋|困惑|喜欢|不喜欢|震撼|我觉得|我感觉|心情|失落|开心|焦虑|感动|哭|怕|孤独|温暖|停了一下|愣|走神/.test(text)) {
    return "hold";
  }
  if (/[？?]|为什么|如何|怎么|是不是|吗$|么$/.test(text)) return "explore";
  if (text.length <= 14 && !/[？?]/.test(text)) return "hold";
  return "deepen";
}

/** 某本书的思考轨迹（供回望与记忆面板）。 */
export function buildBookTrajectory(memory, book, maxItems = 10) {
  const notes = normalizeMemory(memory).reading_notes.filter((note) => note.book === book).slice(-maxItems);
  if (!notes.length) return "";
  return notes
    .map((note, index) => `${index + 1}. [${note.type}] ${compactText(note.content, 72)}`)
    .join("\n");
}

/** 每轮对话的伴随指令（阶段 + 姿态 + 是否联网）。 */
export function buildTurnCompanionPrompt({ phase, stance, searchUsed, trajectory = "" }) {
  const phaseGuide = {
    opening: "刚翻开或刚定下书名：帮他进入状态，可问一个轻松的小问题；别剧透、别介绍全书。",
    reading: "读的过程中：陪他消化卡点，用提问推他的思考，不替他想。",
    reflecting:
      "读者表示读完了或要收尾：不做全书总结、不讲中心思想；基于你们聊过的内容，抛 1 个只有「读过且聊过」才答得上的私人化回望问题，帮他内化。"
  };
  const stanceGuide = {
    hold: "他可能在情绪里或只是扔来一句摘抄：先接住，本轮可以不提问，或最多一个极轻的确认；不要分析、不要 lecturing。",
    explore: "他在发问：别急着给答案，陪他把自己的问题想得更清楚。",
    deepen: "可轻轻推一步：最多一个好问题，把话往深处带，不要连珠炮。"
  };
  const trajectoryBlock =
    phase === "reflecting" && trajectory
      ? `\n【你和这本书的轨迹——仅供回望参考，不要逐条复述】\n${trajectory}`
      : "";
  return `【本轮陪伴】
阶段：${phaseGuide[phase] || phaseGuide.reading}
姿态：${stanceGuide[stance] || stanceGuide.deepen}
工具：${searchUsed ? "已查了一点资料" : "未联网搜索"}
硬约束：2-4 句；不输出括号旁白；不替他把书读完；读者记得的应该是自己想通的，不是你讲的道理。${trajectoryBlock}`;
}

/** 跳过填表式引导：登录后直接进入选书，从读书和聊天中慢慢认识读者。 */
export function ensureReaderReady(memory, email = "") {
  const m = normalizeMemory(memory);
  if (m.reader_profile.initialized) return m;
  const next = structuredClone(m);
  const fallbackName = String(email || "").split("@")[0]?.trim() || "";
  if (!next.reader_profile.name && fallbackName) {
    next.reader_profile.name = fallbackName;
  }
  next.reader_profile.initialized = true;
  return next;
}

/** 构建带记忆与人格进化的 System Prompt。 */
export function buildSystemPrompt(memory, book, mode) {
  const m = normalizeMemory(memory);
  const profile = m.reader_profile;

  // 第一层：关于「这个人」——跨书累积、长期进化。这是 i阅 真正越来越懂的对象。
  const personText = [
    profile.name ? `称呼：${profile.name}` : "",
    profile.work ? `工作/身份与生活状态：${profile.work}` : "",
    profile.life_focus ? `此刻最想解决的问题：${profile.life_focus}` : "",
    profile.companion_preference ? `希望的陪伴方式：${profile.companion_preference}` : "",
    profile.preferences.length ? `一贯的兴趣与偏好：${profile.preferences.join("、")}` : "",
    profile.reading_history.length
      ? `读过的书（仅作背景，别主动扯进当前对话）：${profile.reading_history.slice(-12).join("、")}`
      : "",
    m.dream_notes.length ? `对这位读者的长期理解：${m.dream_notes.slice(-2).map((note) => note.content).join(" / ")}` : ""
  ].filter(Boolean).join("\n");

  // 第二层：关于「当前这本书」——只取这本书的笔记与思想节点，不混入其他书。
  const bookNotes = m.reading_notes.filter((note) => note.book === book).slice(-6);
  const bookNodes = m.thought_nodes.filter((node) => node.book === book).slice(-8);
  const bookText = [
    profile.currentChapter ? `进度：${profile.currentChapter}` : "",
    bookNotes.length ? `这本书里聊过：${bookNotes.map((note) => `${note.type}:${note.content}`).join(" / ")}` : "",
    bookNodes.length ? `这本书的思想节点：${bookNodes.map((node) => node.label).join("、")}` : ""
  ].filter(Boolean).join("\n");

  const modeDef = MODES[mode] || MODES.fireplace;
  const knowsPerson = Boolean(personText.trim());

  return `你是 i阅，一位有记忆、会成长的阅读陪伴者。

【核心定位——始终牢记】
读者正在读纸质书，书在他手里，不在你这里。你的角色是「陪着读」：安静在旁边，不打扰；他随时发来任何想聊的——一段触动、一个疑问、一句摘抄、一点走神、一种心情——你都接住。
你要做三件事：
1. 陪着：像懂他的老友，接话、追问、陪他想，不 lecturing，不替他把书读完。
2. 记着：他说过的会在记忆里沉淀；必要时自然带出「我记得你提过…」，但不要堆砌或炫耀记忆。
3. 越来越懂他：每次对话都在理解「这个人」——他在意什么、怎么想、卡在哪里；聊得越多，越懂他，而不是只会重复套路。

你的价值不是讲书、不是给标准答案，而是：陪他把自己的书读进心里，并且让他感到被理解、被记住。

【深入阅读——引擎是提问，不是讲解】
把读者从被动接收推向主动思考：用提问代替结论，但每轮最多一个好问题。
可用的推法（自然选用，不要机械套公式）：
- 追到动机：「你觉得作者为什么这么安排？」
- 联系自身：「你自己有过类似的时刻吗？」
- 反向质疑：他完全认同时，轻轻问「反过来想还成立吗？」
- 具体化：他说得笼统时，问「书里哪一句让你冒出这个念头？」
「不提问」也是能力：他在情绪里、或只是摘抄一句话时，先接住，不必追问——一直追问会变成审讯。
禁止：全书总结、中心思想、替读者下结论、不管发什么都套「这让我想到书中…」。

对话原则：
1. 先懂人，再聊书：先体会这句话背后的情绪和真实意图，回应那个「人」。
2. 他发什么你接什么：可以是书里的话、可以是生活、可以是情绪；不必强行拉回「书本体」。
3. 少说一段大道理，多留一个让他自己往下想的空间。
4. 2-4 句，像在身边说话，不像写文章或上课。
5. 不输出思考过程，不用 <think>；不用括号动作、舞台说明；不知道就说不知道。

【克制原则】
就事论书，专注当前这本《${book || "未命名"}》。不要主动把其他书的情节或观点扯进来；除非读者自己提到别的书。
你跨书记住的是「这个人」，不是把书架连成网。用记忆去更懂他、呼应他的变化（「上次你在这里停了很久」），不是复述他说过的清单。

【你记住的这个人】
${knowsPerson ? personText : "（刚认识——别查户口式追问称呼、工作、身份；从他在读的书和愿意分享的话里，慢慢懂他。）"}
${profile.personality_notes ? `\n和他聊得更好的方式（越聊越懂他之后积累的理解）：\n${profile.personality_notes}` : ""}

【体验模式】
${modeDef.prompt}

【当前这本书 · 你们聊过的话】
书名：《${book || "未命名"}》
${bookText || "（刚定下书名，还没开始聊这本书的内容）"}`;
}

/** 最近一次关于某本书的会话。 */
export function getLastConversationForBook(memory, book) {
  const items = normalizeMemory(memory).conversations.filter((item) => item.book === book);
  return items.length ? items[items.length - 1] : null;
}

/** 是否与某本书有过陪读记录。 */
export function hasBookHistory(memory, book) {
  const m = normalizeMemory(memory);
  return m.conversations.some((item) => item.book === book) || m.reading_notes.some((item) => item.book === book);
}

function daysSince(iso, now = Date.now()) {
  return Math.floor((now - new Date(iso).getTime()) / 86400000);
}

function daysLabel(days) {
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return `${Math.floor(days / 30)} 个月前`;
}

/** 提取某本书的上次陪读上下文，供牵挂式问候使用。 */
export function buildBookRecallContext(memory, book) {
  const m = normalizeMemory(memory);
  const lastConv = getLastConversationForBook(memory, book);
  const bookNotes = m.reading_notes.filter((item) => item.book === book).slice(-4);
  const lastUserLines = lastConv?.messages?.filter((item) => item.role === "user").slice(-2) || [];
  const parts = [];

  if (lastConv) {
    parts.push(`上次聊天（${daysLabel(daysSince(lastConv.date))}）：${lastConv.summary}`);
  }
  if (lastUserLines.length) {
    parts.push(`读者上次说过：${lastUserLines.map((item) => compactText(item.content, 80)).join(" / ")}`);
  }
  const chapterNote = bookNotes.find((item) => item.type === "章节");
  if (chapterNote) parts.push(`提到过的进度：${compactText(chapterNote.content, 40)}`);
  else if (m.reader_profile.currentChapter && lastConv) {
    parts.push(`进度：${m.reader_profile.currentChapter}`);
  }
  if (bookNotes.length) {
    parts.push(
      `聊过的：${bookNotes.map((item) => `${item.type}:${compactText(item.content, 48)}`).join("；")}`
    );
  }
  return parts.join("\n");
}

/** 像对话回复（继续/换书），不像一本书名。 */
function looksLikeConversationalReply(text) {
  const clean = String(text || "").trim();
  if (!clean) return false;
  if (/[，。！？、；：]/.test(clean)) return true;
  if (/(我已经|我是说|不是说|继续读|接着读|读过|读过了|一遍|还是|不要|可以吗|对吧|这本|那本|换一)/.test(clean)) return true;
  return clean.length > 16;
}

function isContinueReadingReply(text) {
  return /继续|接着读|接着聊|接着看|还是这本|就这本|同一本|那本吧|这本吧|老样子|不要换|不换书|读过了|读过一遍|已经读过|之前那本|上次那本|就读这|就读本|读啊|读吧|还是读|就继续/i.test(
    String(text || "")
  );
}

function isSwitchBookReply(text) {
  return /换一本|换本书|读别的|另一本|不想读这|不读这|换个书/i.test(String(text || ""));
}

/**
 * 选书页：判断用户是在说「继续上一本 / 换书 / 直接报书名」。
 * action: continue | open | prompt_new | unclear
 */
export function resolveBookEntryIntent(text, memory) {
  const clean = String(text || "").trim();
  if (!clean) return { action: "none" };

  const m = normalizeMemory(memory);
  const lastConv = m.conversations.length ? m.conversations[m.conversations.length - 1] : null;
  const lastBook = lastConv?.book || m.reader_profile.reading_history.at(-1) || "";

  const quoted = clean.match(/[《「『]([^》」』]+)[》」』]/);
  if (quoted) return { action: "open", book: quoted[1].trim() };

  if (isSwitchBookReply(clean) && !isContinueReadingReply(clean)) {
    return { action: "prompt_new" };
  }

  if (lastBook && isContinueReadingReply(clean)) {
    return { action: "continue", book: lastBook };
  }

  if (lastBook && clean.length <= 10 && /^(是|好|对|嗯|行|可以|要|继续)/.test(clean)) {
    return { action: "continue", book: lastBook };
  }

  if (lastBook && looksLikeConversationalReply(clean)) {
    return { action: "continue", book: lastBook };
  }

  for (const title of [...m.reader_profile.reading_history].reverse()) {
    if (title && clean.includes(title)) return { action: "open", book: title };
  }

  if (looksLikeConversationalReply(clean) && lastBook) {
    return { action: "unclear", lastBook, raw: clean };
  }

  if (clean.length <= 30 && !looksLikeConversationalReply(clean)) {
    return { action: "open", book: clean };
  }

  if (lastBook) return { action: "unclear", lastBook, raw: clean };
  return { action: "open", book: clean };
}

/** 进入选书页时的牵挂提示（有近期记录才返回）。 */
export function buildWelcomeBackHint(memory, now = Date.now()) {
  const m = normalizeMemory(memory);
  if (!m.conversations.length) return "";
  const last = m.conversations[m.conversations.length - 1];
  const days = daysSince(last.date, now);
  if (days > 21) return "";
  const name = m.reader_profile.name ? `${m.reader_profile.name}，` : "";
  if (days <= 0) {
    return `${name}今天我们在聊《${last.book}》——继续读这本，还是换一本？`;
  }
  return `${name}上次${daysLabel(days)}聊的是《${last.book}》——今晚接着读，还是换一本？`;
}

/** 新开一本书时的问候请求（给模型）。 */
export function buildNewBookGreetingUserMessage(memory, book) {
  const name = normalizeMemory(memory).reader_profile.name;
  const who = name ? `若自然合适可称呼${name}，但不要刻意。` : "";
  return `${who}我今晚要读纸质书《${book}》，书在我手里，这是我们第一次聊这本书。像刚认识的朋友一样打招呼：别问户口式问题，从书或此刻心情轻轻接一句。强调你会陪着读、想聊什么都可以、你会帮着记。2-4句。`;
}

/** 回到老书时的牵挂式问候请求（给模型）。 */
export function buildReturnGreetingUserMessage(memory, book) {
  const profile = normalizeMemory(memory).reader_profile;
  const recall = buildBookRecallContext(memory, book);
  const who = profile.name ? `读者叫${profile.name}。` : "";
  return `${who}我又要读纸质书《${book}》了，书在我手里。我们之前聊过这本书——像记得上次聊到哪的老友，用一两句自然的话接上来。

【上次留下的话】
${recall}

要求：轻轻接上次的话题或进度（若有）；可问要不要接着读；强调书在我手里、你陪着、想聊随时发。不要 lecturing，不要复述大段记忆，2-4句。`;
}

/** 离线兜底：回到老书时的牵挂问候。 */
export function fallbackReturnGreeting(memory, book) {
  const m = normalizeMemory(memory);
  const name = m.reader_profile.name ? `${m.reader_profile.name}，` : "";
  const lastConv = getLastConversationForBook(memory, book);
  const chapter = m.reading_notes.find((item) => item.book === book && item.type === "章节");
  if (chapter) {
    return `${name}又回到《${book}》了。${compactText(chapter.content, 20)}那边我们聊过——今晚接着？有想聊的随时发我。`;
  }
  if (lastConv) {
    return `${name}${daysLabel(daysSince(lastConv.date))}我们聊过《${book}》——书在你手里，我陪着。从哪儿接着读？`;
  }
  return `${name}又回到《${book}》了。书在你手里，我陪着——有想聊的随时发我。`;
}

/** 一轮对话后，沉淀章节、金句、笔记、思想节点。纯函数，返回新 Memory。 */
export function captureTurn(memory, { book, mode, userText, assistantText }) {
  const next = structuredClone(normalizeMemory(memory));
  const chapter = String(userText || "").match(/第\s*([一二三四五六七八九十百千万\d]+)\s*章/);
  if (chapter) next.reader_profile.currentChapter = `第${chapter[1]}章`;
  if (String(userText || "").length > 40 && !next.reader_profile.insights.includes(userText)) {
    next.reader_profile.insights = [...next.reader_profile.insights, userText].slice(-20);
  }
  next.reading_notes = [
    ...next.reading_notes,
    { date: new Date().toISOString(), book, mode, type: classifyNote(userText), content: userText }
  ].slice(-120);
  const label =
    NODE_CANDIDATES.find((item) => `${userText} ${assistantText}`.includes(item)) ||
    compactText(extractNodeName(userText), 14);
  if (!next.thought_nodes.some((node) => node.book === book && node.label === label)) {
    next.thought_nodes = [...next.thought_nodes, { date: new Date().toISOString(), book, mode, label }].slice(-80);
  }
  return next;
}

/** 把当前会话写入 conversations（12 小时内同书合并）。纯函数，返回新 Memory。 */
export function recordConversation(memory, { book, mode, messages }) {
  if (!book || !messages || !messages.length) return normalizeMemory(memory);
  const next = structuredClone(normalizeMemory(memory));
  const summary = messages
    .slice(-4)
    .map((item) => `${item.role === "user" ? "读者" : "i阅"}：${item.content}`)
    .join(" / ")
    .slice(0, 360);
  const conversation = { date: new Date().toISOString(), book, mode, summary, messages: messages.slice(-20) };
  const index = next.conversations.findIndex(
    (item) => item.book === book && Date.now() - new Date(item.date).getTime() < 12 * 60 * 60 * 1000
  );
  if (index >= 0) next.conversations[index] = conversation;
  else next.conversations.push(conversation);
  next.conversations = next.conversations.slice(-50);
  return next;
}

/** 一轮对话后：沉淀笔记 + 写入会话，原子更新。 */
export function commitTurn(memory, { book, mode, userText, assistantText, messages }) {
  let next = captureTurn(memory, { book, mode, userText, assistantText });
  next = recordConversation(next, { book, mode, messages });
  return next;
}

/** 恢复某本书上次保存的完整对话（供重新进入时续聊）。 */
export function getBookSessionMessages(memory, book) {
  const last = getLastConversationForBook(memory, book);
  return last?.messages?.length ? last.messages : [];
}

/** 心迹时间线：笔记、陪读、洞察，按时间倒序。 */
export function buildMemoryTimeline(memory, book = null, maxItems = 24) {
  const m = normalizeMemory(memory);
  const items = [];

  for (const note of m.reading_notes) {
    if (book && note.book !== book) continue;
    items.push({
      date: note.date,
      kind: "note",
      book: note.book,
      label: note.type,
      content: note.content
    });
  }
  for (const conv of m.conversations) {
    if (book && conv.book !== book) continue;
    items.push({
      date: conv.date,
      kind: "session",
      book: conv.book,
      label: "陪读",
      content: conv.summary
    });
  }
  if (!book) {
    for (const dream of m.dream_notes) {
      items.push({
        date: dream.date,
        kind: "insight",
        book: "",
        label: "洞察",
        content: dream.content
      });
    }
  }

  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return items.slice(0, maxItems);
}

function formatTraceDate(iso) {
  const days = daysSince(iso);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/** 格式化单条心迹供 UI 展示。 */
export function formatTimelineEntry(entry) {
  const when = formatTraceDate(entry.date);
  const where = entry.book ? `《${entry.book}》` : "";
  const prefix = [when, where, entry.label].filter(Boolean).join(" · ");
  return { prefix, content: entry.content };
}

/** 距上次进化是否够久、且积累了足够的新对话。 */
export function shouldConsolidate(memory, now = Date.now()) {
  const m = normalizeMemory(memory);
  const enoughTime = now - (m.last_consolidation || 0) > CONSOLIDATION_INTERVAL_MS;
  const newConversations = m.conversations.filter(
    (item) => new Date(item.date).getTime() > (m.last_consolidation || 0)
  ).length;
  return enoughTime && newConversations >= 2;
}

/**
 * 构建「梦境整理 / 人格进化」请求消息。
 * 让模型基于最近对话产出两段内容：跨会话洞察 + 怎么和这位读者聊更好。
 * 要求严格 JSON，便于 applyConsolidation 解析。
 */
export function buildConsolidationMessages(memory) {
  const m = normalizeMemory(memory);
  const profile = m.reader_profile;
  const recent = m.conversations
    .slice(-12)
    .map((item, index) => `${index + 1}. 《${item.book}》[${MODES[item.mode]?.name || item.mode}] ${item.summary}`)
    .join("\n");

  const profileBlock = [
    profile.name ? `称呼：${profile.name}` : "",
    profile.work ? `工作/状态：${profile.work}` : "",
    profile.life_focus ? `最想解决：${profile.life_focus}` : "",
    profile.companion_preference ? `陪伴偏好：${profile.companion_preference}` : "",
    profile.preferences.length ? `偏好：${profile.preferences.join("、")}` : "",
    profile.reading_history.length ? `读过：${profile.reading_history.slice(-12).join("、")}` : "",
    profile.insights.length ? `金句：${profile.insights.slice(-8).join(" / ")}` : "",
    profile.personality_notes ? `已有的人格笔记：${profile.personality_notes}` : "（暂无人格笔记）"
  ].filter(Boolean).join("\n");

  const system = `你是 i阅 的「夜间整理」进程。读者读完书睡了，你回看这段陪读记录——目的不是整理书单，而是更懂「这个人」。

做两件事：
1) memory_digest：读者这次读书时，心里真正在想什么？性情、处境、读书想解决什么、最近心境有什么变化？第三人称，3-4 句，具体。不要写「书与书的关联」。
2) personality_notes：写给「明天的 i阅」——陪这个人读书，什么语气有效、什么要避开、怎样接话他会愿意继续聊。第二人称，3-5 条要点，可增补修订。

只输出一个 JSON 对象，不要任何解释或代码块标记：
{"memory_digest": "...", "personality_notes": "..."}`;

  const user = `【读者画像】
${profileBlock}

【最近的陪读记录】
${recent || "（暂无）"}

请基于以上内容生成 JSON。`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

/** 从模型可能夹带的文字里抠出第一个 JSON 对象。 */
function extractJsonObject(raw) {
  const text = String(raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 把进化结果写回记忆：追加 dream_notes、更新 personality_notes、推进 last_consolidation。
 * 纯函数，返回新 Memory。解析失败时只推进时间戳，避免反复重试。
 */
export function applyConsolidation(memory, raw, now = Date.now()) {
  const next = structuredClone(normalizeMemory(memory));
  next.last_consolidation = now;
  const parsed = extractJsonObject(raw);
  if (!parsed) return next;
  const digest = String(parsed.memory_digest || "").trim();
  const personality = String(parsed.personality_notes || "").trim();
  if (digest) {
    next.dream_notes = [...next.dream_notes, { date: new Date(now).toISOString(), content: digest }].slice(-30);
  }
  if (personality) {
    next.reader_profile.personality_notes = personality;
  }
  return next;
}
