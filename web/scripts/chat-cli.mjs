#!/usr/bin/env node
/**
 * 本地命令行陪读 —— 与网页同一套 core.mjs prompt，方便在 Cursor 终端里试对话。
 *
 * 用法：
 *   cd web && npm run chat:cli
 *   cd web && npm run chat:cli -- 沉思录
 *
 * 需要 web/.env.local 里配置 DEEPSEEK_API_KEY（或 export DEEPSEEK_API_KEY=...）
 */

import { createInterface } from "readline";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  buildSystemPrompt,
  buildTurnCompanionPrompt,
  commitTurn,
  defaultMemory,
  detectReplyStance,
  inferReadingPhase,
  sanitizeAssistantReply,
  shouldSearch
} from "../lib/core.mjs";
import { isBookBackgroundRequest, tavilySearch } from "../lib/tavily.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODE = "fireplace";

function loadEnvLocal() {
  const envPath = resolve(__dirname, "../.env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function askDeepSeek(apiKey, messages) {
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      max_tokens: 900
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek ${response.status}: ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  return sanitizeAssistantReply(data.choices?.[0]?.message?.content || "");
}

function promptLine(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    console.error("未找到 DEEPSEEK_API_KEY，请在 web/.env.local 配置或 export。");
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const bookArg = process.argv.slice(2).join(" ").trim();

  let book = bookArg;
  if (!book) {
    book = (await promptLine(rl, "今晚读哪本书？ ")).trim();
  }
  if (!book) {
    console.error("需要书名。");
    rl.close();
    process.exit(1);
  }

  let memory = defaultMemory();
  let messages = [];

  console.log(`\n── i阅 CLI · 《${book}》 · 文字模式 ──`);
  const hasTavily = Boolean(process.env.TAVILY_API_KEY?.trim());
  console.log(`联网搜索：${hasTavily ? "已配置 TAVILY_API_KEY" : "未配置（仅模型知识，说「介绍/背景/查一下」也不会搜）"}`);
  console.log("输入消息陪读；/quit 退出 · /mem 看记忆摘要\n");

  while (true) {
    const userText = (await promptLine(rl, "\n你 › ")).trim();
    if (!userText) continue;
    if (userText === "/quit" || userText === "/exit") break;
    if (userText === "/mem") {
      const notes = memory.reading_notes.filter((n) => n.book === book).slice(-5);
      console.log(
        notes.length
          ? notes.map((n) => `  [${n.type}] ${n.content}`).join("\n")
          : "  （这本书还没有沉淀笔记）"
      );
      continue;
    }

    messages.push({ role: "user", content: userText });
    const phase = inferReadingPhase(memory, book, messages, userText);
    const stance = detectReplyStance(userText);
    const needsSearch = shouldSearch(userText);
    const backgroundRequest = isBookBackgroundRequest(userText);
    const turnCompanionPrompt = buildTurnCompanionPrompt({
      phase,
      stance,
      searchUsed: needsSearch,
      backgroundRequest
    });

    let searchContext = "";
    if (needsSearch) {
      process.stdout.write("  [搜索中…] ");
      const { context, configured } = await tavilySearch(book, userText);
      searchContext = context;
      if (!configured) process.stdout.write("未配置 TAVILY_API_KEY · ");
      else if (context) process.stdout.write("已查资料 · ");
      else process.stdout.write("无结果 · ");
    }

    process.stdout.write("\ni阅 › ");
    try {
      const apiMessages = [
        { role: "system", content: buildSystemPrompt(memory, book, MODE) },
        { role: "system", content: turnCompanionPrompt },
        ...(searchContext
          ? [{ role: "system", content: `以下是按需联网搜索结果，只在可靠时使用，不要机械复述：\n${searchContext}` }]
          : []),
        ...messages.slice(-10)
      ];
      const reply = await askDeepSeek(apiKey, apiMessages);
      messages.push({ role: "assistant", content: reply });
      memory = commitTurn(memory, { book, mode: MODE, userText, assistantText: reply, messages });
      console.log(`${reply}\n  （${phase}/${stance}${needsSearch ? "/搜索" : ""}）`);
    } catch (error) {
      messages.pop();
      console.log(`\n[错误] ${error instanceof Error ? error.message : error}`);
    }
  }

  rl.close();
  console.log("\n再见。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
