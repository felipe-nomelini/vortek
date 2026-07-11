alter table public.configuracoes
  drop column if exists notificacoes_email;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions(user_id);

create table if not exists public.push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null,
  url text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'retry', 'failed', 'skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, dedupe_key)
);

create index if not exists idx_push_notification_outbox_dispatch
  on public.push_notification_outbox(status, available_at);

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_outbox enable row level security;

create policy "Usuário gerencia próprias inscrições push"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Usuário lê próprias notificações push"
  on public.push_notification_outbox for select
  using (auth.uid() = user_id);
