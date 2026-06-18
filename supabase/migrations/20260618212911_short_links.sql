create table if not exists public.short_links (
  code text primary key,
  target_url text not null,
  purpose text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  hit_count integer not null default 0,
  last_accessed_at timestamptz
);

alter table public.short_links enable row level security;

create index if not exists short_links_expires_at_idx
  on public.short_links (expires_at);

create index if not exists short_links_created_at_idx
  on public.short_links (created_at desc);
