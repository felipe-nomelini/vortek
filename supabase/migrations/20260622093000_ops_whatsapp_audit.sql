create table if not exists public.ops_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  phone text,
  direction text not null,
  command text,
  action text,
  issue_number integer,
  status text not null,
  message text,
  payload jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists ops_whatsapp_events_created_idx
on public.ops_whatsapp_events (created_at desc);

create index if not exists ops_whatsapp_events_issue_idx
on public.ops_whatsapp_events (issue_number, created_at desc);
