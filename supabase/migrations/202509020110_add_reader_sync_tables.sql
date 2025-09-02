-- Ensure existing core tables have deleted column (idempotent)
alter table public.items add column if not exists deleted boolean default false;
alter table public.articles add column if not exists deleted boolean default false;

-- Unread AI generated articles per user
create table if not exists public.unread_articles (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lang text,
  raw text,
  html text,
  used_block_ids text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false
);
create index if not exists unread_articles_user_id_idx on public.unread_articles(user_id);
create index if not exists unread_articles_updated_at_idx on public.unread_articles(updated_at);

-- Magic bag vocabulary items
create table if not exists public.magic_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_block_id text,
  text text,
  lang text,
  box text,
  added_at timestamptz default now(),
  copied boolean default false,
  updated_at timestamptz default now(),
  deleted boolean default false
);
create index if not exists magic_items_user_id_idx on public.magic_items(user_id);
create index if not exists magic_items_updated_at_idx on public.magic_items(updated_at);

-- User settings (single row per user)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.unread_articles enable row level security;
alter table public.magic_items enable row level security;
alter table public.user_settings enable row level security;

-- Drop existing conflicting policies (idempotent) then recreate
drop policy if exists unread_articles_self on public.unread_articles;
create policy unread_articles_self on public.unread_articles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists magic_items_self on public.magic_items;
create policy magic_items_self on public.magic_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_settings_self on public.user_settings;
create policy user_settings_self on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Updated_at trigger function
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

-- Attach triggers (idempotent)
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_unread_articles_updated_at') then
    create trigger trg_unread_articles_updated_at before update on public.unread_articles
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_magic_items_updated_at') then
    create trigger trg_magic_items_updated_at before update on public.magic_items
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_user_settings_updated_at') then
    create trigger trg_user_settings_updated_at before update on public.user_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;