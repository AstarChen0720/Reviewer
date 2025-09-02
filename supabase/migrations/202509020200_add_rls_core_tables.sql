-- Purpose: Enforce per-account (per-user) isolation for existing core tables.
-- This migration is idempotent and can be safely re-run.
-- It enables Row Level Security (RLS) and adds policies restricting access
-- to rows where user_id = auth.uid().

-- ITEMS ------------------------------------------------------------
alter table public.items enable row level security;
create index if not exists items_user_id_idx on public.items(user_id);
drop policy if exists items_self on public.items;
create policy items_self on public.items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ARTICLES ---------------------------------------------------------
alter table public.articles enable row level security;
create index if not exists articles_user_id_idx on public.articles(user_id);
drop policy if exists articles_self on public.articles;
create policy articles_self on public.articles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- USER AI KEYS -----------------------------------------------------
alter table public.user_ai_keys enable row level security;
create index if not exists user_ai_keys_user_id_idx on public.user_ai_keys(user_id);
drop policy if exists user_ai_keys_self on public.user_ai_keys;
create policy user_ai_keys_self on public.user_ai_keys
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- AI USAGE LOGS ----------------------------------------------------
-- Allow users to insert and select ONLY their own logs.
-- (We intentionally do NOT allow update/delete for normal users.)
alter table public.ai_usage_logs enable row level security;
create index if not exists ai_usage_logs_user_id_idx on public.ai_usage_logs(user_id);
drop policy if exists ai_usage_logs_select_self on public.ai_usage_logs;
drop policy if exists ai_usage_logs_insert_self on public.ai_usage_logs;
create policy ai_usage_logs_select_self on public.ai_usage_logs
  for select using (auth.uid() = user_id);
create policy ai_usage_logs_insert_self on public.ai_usage_logs
  for insert with check (auth.uid() = user_id);

-- (Optional) If you later need admin/reporting access, create a separate
-- policy scoped to a service role using: (auth.role() = 'service_role').

-- NOTE: Ensure every affected table actually has a user_id column referencing auth.users(id).
-- If any table is missing that column, add it first before enabling RLS.
