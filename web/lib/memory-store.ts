"use client";

import { getSupabaseBrowser } from "./supabase/client";
import { defaultMemory, normalizeMemory } from "@/lib/core.mjs";
import type { Memory } from "@/lib/core.mjs";

const LOCAL_KEY = "iyue_web_memory_v1";

function readLocal(): Memory | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return normalizeMemory(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(memory: Memory) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(memory));
  } catch {
    // localStorage 不可用（隐私模式等）时忽略。
  }
}

// 一份本地记忆是否“有内容”，用来决定首次登录要不要迁移上云。
function hasContent(memory: Memory): boolean {
  return (
    memory.conversations.length > 0 ||
    memory.dream_notes.length > 0 ||
    memory.reading_notes.length > 0 ||
    Boolean(memory.reader_profile.name) ||
    Boolean(memory.reader_profile.personality_notes)
  );
}

// 读取记忆：登录且配置了 Supabase → 云端；否则本地。
// 首次登录若云端为空而本地有积累，自动把本地记忆迁移上云，避免“登录后失忆”。
export async function loadMemory(userId: string | null): Promise<Memory> {
  const supabase = getSupabaseBrowser();
  if (supabase && userId) {
    const { data, error } = await supabase
      .from("memories")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data?.data) {
      return normalizeMemory(data.data);
    }

    const local = readLocal();
    if (local && hasContent(local)) {
      await saveMemory(local, userId);
      return local;
    }
    return defaultMemory();
  }

  return readLocal() ?? defaultMemory();
}

// 保存记忆：本地始终写一份当缓存；登录后再 upsert 到云端。
export async function saveMemory(memory: Memory, userId: string | null): Promise<void> {
  writeLocal(memory);
  const supabase = getSupabaseBrowser();
  if (supabase && userId) {
    await supabase.from("memories").upsert({ user_id: userId, data: memory }, { onConflict: "user_id" });
  }
}
