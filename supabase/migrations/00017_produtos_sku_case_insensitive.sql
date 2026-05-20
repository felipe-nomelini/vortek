-- Deduplicate SKU case-insensitive collisions in produtos and enforce normalized SKU

-- 1) Build canonical map for duplicated SKUs (case-insensitive)
create temporary table tmp_produto_sku_canon as
with ranked as (
  select
    id,
    sku,
    upper(trim(sku)) as sku_norm,
    ml_item_id,
    created_at,
    row_number() over (
      partition by upper(trim(sku))
      order by
        case when ml_item_id is not null and ml_item_id <> '' then 0 else 1 end,
        created_at asc,
        id asc
    ) as rn,
    count(*) over (partition by upper(trim(sku))) as cnt
  from public.produtos
)
select
  dup.id as duplicate_id,
  canon.id as canonical_id,
  canon.sku_norm
from ranked dup
join ranked canon
  on canon.sku_norm = dup.sku_norm
 and canon.rn = 1
where dup.cnt > 1
  and dup.rn > 1;

-- 2) Repoint related references to canonical product
update public.anuncios_ml a
set produto_id = m.canonical_id
from tmp_produto_sku_canon m
where a.produto_id = m.duplicate_id;

-- 3) Remove duplicate product rows
delete from public.produtos p
using tmp_produto_sku_canon m
where p.id = m.duplicate_id;

-- 4) Normalize remaining SKUs
update public.produtos
set sku = upper(trim(sku))
where sku is not null and sku <> upper(trim(sku));

-- 5) Enforce normalized SKU at DB level
create or replace function public.normalize_produto_sku()
returns trigger as $$
begin
  new.sku := upper(trim(new.sku));
  return new;
end;
$$ language plpgsql;

drop trigger if exists normalize_produto_sku_before_write on public.produtos;
create trigger normalize_produto_sku_before_write
before insert or update on public.produtos
for each row execute function public.normalize_produto_sku();

-- 6) Keep upsert compatibility on sku and add case-insensitive protection
create unique index if not exists produtos_sku_upper_unique on public.produtos ((upper(trim(sku))));
