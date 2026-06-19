create table if not exists public.whatsapp_alert_settings (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  phone text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(alert_type, phone)
);

create table if not exists public.whatsapp_alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  dedupe_key text not null,
  phone text not null,
  status text not null default 'sent',
  payload jsonb,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(alert_type, dedupe_key, phone)
);

create index if not exists whatsapp_alert_events_type_created_idx
on public.whatsapp_alert_events (alert_type, created_at desc);

insert into public.whatsapp_alert_settings (alert_type, phone, enabled)
values
  ('all', '21981172939', true),
  ('all', '21970066090', true)
on conflict (alert_type, phone) do update
set enabled = excluded.enabled,
    updated_at = now();
