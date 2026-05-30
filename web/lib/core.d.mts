// i阅 共享内核的类型声明。运行时实现见同目录 core.mjs。
// 网页端从这里拿类型；桌面端只用 core.mjs 的运行时。

export type ModeKey = "fireplace" | "desk" | "starmap";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Conversation = {
  date: string;
  book: string;
  mode: ModeKey;
  summary: string;
  messages: ChatMessage[];
};

export type ReadingNote = {
  date: string;
  book: string;
  mode: ModeKey;
  type: string;
  content: string;
};

export type ThoughtNode = {
  date: string;
  book: string;
  mode: ModeKey;
  label: string;
};

export type DreamNote = { date: string; content: string };

export type ReaderProfile = {
  name: string;
  work: string;
  life_focus: string;
  companion_preference: string;
  preferences: string[];
  reading_history: string[];
  currentChapter: string;
  insights: string[];
  personality_notes: string;
  initialized: boolean;
};

export type Memory = {
  conversations: Conversation[];
  reader_profile: ReaderProfile;
  dream_notes: DreamNote[];
  reading_notes: ReadingNote[];
  thought_nodes: ThoughtNode[];
  last_consolidation: number;
};

export type ModeDef = {
  name: string;
  badge: string;
  placeholder: string;
  hint: string;
  prompt: string;
};

export const MODES: Record<ModeKey, ModeDef>;
export const SEARCH_TRIGGERS: string[];
export const CONSOLIDATION_INTERVAL_MS: number;

export function defaultMemory(): Memory;
export function normalizeMemory(raw: unknown): Memory;
export function compactText(text: string, max?: number): string;
export function extractNodeName(text: string): string;
export function classifyNote(text: string): string;
export function shouldSearch(text: string): boolean;
export function shouldTriggerLookback(text: string): boolean;
export function inferReadingPhase(
  memory: Memory,
  book: string,
  messages: ChatMessage[],
  userText: string
): "opening" | "reading" | "reflecting";
export function detectReplyStance(userText: string): "hold" | "explore" | "deepen";
export function buildBookTrajectory(memory: Memory, book: string, maxItems?: number): string;
export function buildTurnCompanionPrompt(input: {
  phase: "opening" | "reading" | "reflecting";
  stance: "hold" | "explore" | "deepen";
  searchUsed: boolean;
  trajectory?: string;
}): string;
export function sanitizeAssistantReply(text: string): string;
export function demoReply(book: string, userText: string): string;
export function buildSystemPrompt(memory: Memory, book: string, mode: ModeKey): string;
export function ensureReaderReady(memory: Memory, email?: string): Memory;
export function hasBookHistory(memory: Memory, book: string): boolean;
export function buildBookRecallContext(memory: Memory, book: string): string;
export function buildWelcomeBackHint(memory: Memory, now?: number): string;
export function buildNewBookGreetingUserMessage(memory: Memory, book: string): string;
export function buildReturnGreetingUserMessage(memory: Memory, book: string): string;
export function fallbackReturnGreeting(memory: Memory, book: string): string;
export function getLastConversationForBook(memory: Memory, book: string): Conversation | null;
export function commitTurn(
  memory: Memory,
  input: { book: string; mode: ModeKey; userText: string; assistantText: string; messages: ChatMessage[] }
): Memory;
export function getBookSessionMessages(memory: Memory, book: string): ChatMessage[];
export type TimelineEntry = {
  date: string;
  kind: "note" | "session" | "insight";
  book: string;
  label: string;
  content: string;
};
export function buildMemoryTimeline(memory: Memory, book?: string | null, maxItems?: number): TimelineEntry[];
export function formatTimelineEntry(entry: TimelineEntry): { prefix: string; content: string };
export function captureTurn(
  memory: Memory,
  input: { book: string; mode: ModeKey; userText: string; assistantText: string }
): Memory;
export function recordConversation(
  memory: Memory,
  input: { book: string; mode: ModeKey; messages: ChatMessage[] }
): Memory;
export function shouldConsolidate(memory: Memory, now?: number): boolean;
export function buildConsolidationMessages(memory: Memory): ChatMessage[];
export function applyConsolidation(memory: Memory, raw: string, now?: number): Memory;
