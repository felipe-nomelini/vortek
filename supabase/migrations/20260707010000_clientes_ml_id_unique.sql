-- Deduplicate Mercado Livre clients and enforce one client per ML buyer id.
-- Keeps the oldest row for each non-empty ml_id, then blocks future duplicates.

with ranked as (
  select
    id,
    row_number() over (
      partition by ml_id
      order by
        created_at asc,
        id asc
    ) as rn
  from public.clientes
  where nullif(btrim(coalesce(ml_id, '')), '') is not null
)
delete from public.clientes c
using ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists clientes_ml_id_unique_idx
  on public.clientes (ml_id)
  where nullif(btrim(coalesce(ml_id, '')), '') is not null;
