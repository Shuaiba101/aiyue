-- i阅 云端记忆 schema。
-- 在 Supabase 控制台 → SQL Editor 里整段执行即可。
-- 设计：一份完整记忆（conversations / reader_profile / dream_notes ...）以 jsonb 存一行，
-- 按 user_id 主键 + RLS 行级隔离，保证每个读者只能读写自己的记忆。

create table if not exists public.memories (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.memories enable row level security;

drop policy if exists "memories_select_own" on public.memories;
create policy "memories_select_own"
  on public.memories for select
  using (auth.uid() = user_id);

drop policy if exists "memories_insert_own" on public.memories;
create policy "memories_insert_own"
  on public.memories for insert
  with check (auth.uid() = user_id);

drop policy if exists "memories_update_own" on public.memories;
create policy "memories_update_own"
  on public.memories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 自动维护 updated_at。
create or replace function public.touch_memories_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_memories_updated_at on public.memories;
create trigger trg_memories_updated_at
  before update on public.memories
  for each row execute function public.touch_memories_updated_at();

-- 内测申请：用户登记邮箱，管理员在 Supabase 控制台查看后手动发邀请码。
create table if not exists public.beta_applications (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  note       text not null default '',
  created_at timestamptz not null default now(),
  unique (email)
);

alter table public.beta_applications enable row level security;
-- 不开放 anon/authenticated 策略；仅 service role（API 路由）可读写。
