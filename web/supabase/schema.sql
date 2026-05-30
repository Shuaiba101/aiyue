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

-- 平台额度：按 user_id 绑定，服务端校验；免费 trial 默认 30 轮平台推理。
create table if not exists public.user_quotas (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  plan        text not null default 'trial' check (plan in ('trial', 'pro')),
  turns_used  integer not null default 0 check (turns_used >= 0),
  turns_limit integer not null default 30 check (turns_limit > 0),
  updated_at  timestamptz not null default now()
);

alter table public.user_quotas enable row level security;

drop policy if exists "user_quotas_select_own" on public.user_quotas;
create policy "user_quotas_select_own"
  on public.user_quotas for select
  using (auth.uid() = user_id);

-- 写操作仅 service role（API 路由）执行。

create or replace function public.touch_user_quotas_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_quotas_updated_at on public.user_quotas;
create trigger trg_user_quotas_updated_at
  before update on public.user_quotas
  for each row execute function public.touch_user_quotas_updated_at();

-- 原子扣次：trial 在额度内 +1；pro 不扣次；超额返回 ok=false。
create or replace function public.consume_platform_turn(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.user_quotas%rowtype;
begin
  insert into public.user_quotas (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select * into q from public.user_quotas where user_id = p_user_id for update;

  if q.plan = 'pro' then
    return jsonb_build_object(
      'ok', true,
      'plan', q.plan,
      'turns_used', q.turns_used,
      'turns_limit', q.turns_limit,
      'turns_remaining', greatest(q.turns_limit - q.turns_used, 0)
    );
  end if;

  if q.turns_used >= q.turns_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'quota_exhausted',
      'plan', q.plan,
      'turns_used', q.turns_used,
      'turns_limit', q.turns_limit,
      'turns_remaining', 0
    );
  end if;

  update public.user_quotas
  set turns_used = turns_used + 1
  where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'plan', q.plan,
    'turns_used', q.turns_used + 1,
    'turns_limit', q.turns_limit,
    'turns_remaining', greatest(q.turns_limit - q.turns_used - 1, 0)
  );
end;
$$;
