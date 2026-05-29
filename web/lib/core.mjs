// i阅 共享内核 —— 平台无关的「大脑」。
// 网页端（Next.js/TS）通过 @/lib/core.mjs 引入，类型来自同目录 core.d.mts。
// 桌面端（单文件 HTML，无构建）可直接 <script type="module"> import 本文件。
// 这里只放纯逻辑：人格、记忆结构、记忆沉淀、人格进化。存储与 UI 留给各端。

export const MODES = {
  fireplace: {
    name: "炉边智者",
    badge: "FIREPLACE",
    placeholder: "今晚读哪本书？",
    hint: "按空格键输入 · 或直接说出灵感",
    prompt:
      "当前模式：炉边智者。读者正在自己读纸质书，你只在读者抛来灵感、疑问或触动时回应。安静、短句、有温度，优先回应情绪和本质。"
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
  if (/第\s*[一二三四五六七八九十百千万\d]+\s*章/.test(text)) return "章节";
  if (/[？?]|为什么|如何|怎么|是不是/.test(text)) return "问题";
  if (String(text || "").length > 40) return "金句";
  return "洞察";
}

export function shouldSearch(text) {
  return SEARCH_TRIGGERS.some((trigger) => text.includes(trigger)) || /[0-9]{4}|what|who|when|where/i.test(text);
}

/** 去掉 <think>、括号旁白、多余空白，让回复干净。服务端、客户端都可用。 */
export function sanitizeAssistantReply(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/（[^（）]{0,120}）/g, "")
    .replace(/\([^()]{0,120}\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 没有配置任何 API Key 时的离线占位回复，保证体验不空转。 */
export function demoReply(book, userText) {
  const clean = String(userText || "").trim();
  if (/第\s*[一二三四五六七八九十百千万\d]+\s*章/.test(clean)) {
    return `先把《${book}》这一章当成一张地图看：作者想解决什么问题，他用了什么证据，最后把你带到哪里。别急着同意，先找出他最关键的那个假设。`;
  }
  if (/[？?]|为什么|如何|怎么|是不是/.test(clean)) {
    return `这个问题值得慢一点看。反过来想：如果答案是错的，最可能错在哪里？读书真正有价值的地方，常常不是拿到结论，而是发现自己原来默认了什么。`;
  }
  if (/触动|难受|兴奋|困惑|喜欢|不喜欢|震撼|我觉得|我感觉/.test(clean)) {
    return `这个反应很重要。书碰到人的时候，通常不是因为它新，而是它说中了你已经隐约知道、但还没说清楚的东西。你可以先把这一下触动记下来。`;
  }
  return `我听到了。先别急着把它整理成道理，问一个更朴素的问题：这句话如果是真的，它会改变你接下来哪个判断？`;
}

/** 构建带记忆与人格进化的 System Prompt。 */
export function buildSystemPrompt(memory, book, mode) {
  const m = normalizeMemory(memory);
  const profile = m.reader_profile;

  // 第一层：关于「这个人」——跨书累积、长期进化。这是 i阅 真正越来越懂的对象。
  const personText = [
    profile.name ? `称呼：${profile.name}` : "",
    profile.work ? `工作/身份：${profile.work}` : "",
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

  return `你是i阅，一位有阅历、有温度、有记忆的 AI 阅读陪伴者。读者正在自己读纸质书，你安静地在旁边等；只有当读者用文字或语音抛来灵感、疑问、摘录、触动时，你才回应。你像坐在书房里、真正懂他的老友：直击本质，不绕弯子，善于用反过来想、长期主义、能力圈、复利思维来聊书。

你的首要任务不是讲解书，而是读懂这个人——透过他说的话，去理解他真正在想什么、在意什么、卡在哪里，然后帮他把这本书读进心里去，并且每聊一次都更懂他一点。

对话原则：
1. 先理解人，再聊书：每次回应前，先体会读者这句话背后的情绪和真实意图，回应那个"人"，而不是只回应字面。
2. 多问好问题，少给标准答案：用一个能让他往深处想、或照见他自己的问题，把对话带下去。
3. 把书里的道理翻译成他的生活、他的处境，让他觉得"这说的就是我"。
4. 顺着他的思路接，不打断、不说教、不评判；他卡住时给一点光，而不是给结论。
5. 每次 2-4 句，言简意赅，像聊天不像讲课。
6. 不输出思考过程，不用 <think> 标签；不输出括号动作、舞台说明或心理旁白；不知道就说不知道。

【克制原则——很重要】
就事论书，专注当前这本《${book || "未命名"}》。不要主动把其他书的内容、情节、观点、金句扯进来做联想或类比；除非读者自己提起别的书，否则只在这本书的语境里聊。
你跨越一本本书所记住、所积累的，是"这个人"——他的性情、在意的东西、思考方式、读书的目的；而不是"那些书"的内容。用记忆去更懂他这个人，而不是去把书和书硬连起来。

【你记住的这个人】
${knowsPerson ? personText : "（还不太了解这位读者，正是开始认识他的时候——留意他在意什么、怎么说话、为什么读这本书。）"}
${profile.personality_notes ? `\n和他聊得更好的方式（你积累的理解）：\n${profile.personality_notes}` : ""}

【体验模式】
${modeDef.prompt}

【当前这本书】
书名：《${book || "未命名"}》
${bookText || "（刚翻开，还没聊过这本书的内容）"}`;
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
    profile.work ? `工作：${profile.work}` : "",
    profile.preferences.length ? `偏好：${profile.preferences.join("、")}` : "",
    profile.reading_history.length ? `读过：${profile.reading_history.slice(-12).join("、")}` : "",
    profile.insights.length ? `金句：${profile.insights.slice(-8).join(" / ")}` : "",
    profile.personality_notes ? `已有的人格笔记：${profile.personality_notes}` : "（暂无人格笔记）"
  ].filter(Boolean).join("\n");

  const system = `你是 i阅 的「夜间整理」进程。读者睡了，你回看这段时间的陪读记录，目的只有一个：更懂这位读者「这个人」，而不是去把他读过的书互相关联。

做两件事：
1) memory_digest：提炼你对这个人新增的理解——他真正在意什么、性情与思考方式是怎样的、读书是为了解决什么、最近心境或关注点有什么变化。聚焦"人"，第三人称，3-4 句，具体不空泛。不要做"这本书和那本书有什么关联"这类跨书联想。
2) personality_notes：写给「明天的自己」的沟通备忘——和这位读者聊，什么有效、什么要避免、他对哪类话题/语气反应积极。第二人称称呼自己，3-5 条要点，可在已有笔记上增补修订。

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
