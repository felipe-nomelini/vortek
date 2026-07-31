-- Carrinhos comuns do Mercado Livre possuem uma order por anúncio, mas
-- representam uma única venda operacional quando pertencem ao mesmo seller.
with cart_groups as (
  select p.ml_pack_id
  from public.pedidos p
  where nullif(trim(coalesce(p.ml_pack_id, '')), '') is not null
  group by p.ml_pack_id
  having count(*) > 1
    and count(*) filter (where p.ml_bundle_type = 'virtual_kit') = 0
),
ranked_cart_orders as (
  select
    p.id,
    row_number() over (
      partition by p.ml_pack_id
      order by p.ml_order_id nulls last, p.created_at, p.id
    ) = 1 as is_primary
  from public.pedidos p
  join cart_groups group_row on group_row.ml_pack_id = p.ml_pack_id
)
update public.pedidos p
set
  ml_bundle_type = 'cart',
  ml_bundle_parent_item_id = null,
  ml_bundle_primary = ranked.is_primary
from ranked_cart_orders ranked
where ranked.id = p.id;

create index if not exists idx_pedidos_ml_operational_group
  on public.pedidos (ml_bundle_type, ml_pack_id, ml_bundle_parent_item_id, ml_bundle_primary);

create or replace view public.pedidos_operacionais
with (security_invoker = true)
as
select
  p.*,
  case
    when p.ml_bundle_type in ('virtual_kit', 'cart') and p.ml_bundle_primary = true then (
      select coalesce(sum(component.total), p.total)
      from public.pedidos component
      where component.ml_bundle_type = p.ml_bundle_type
        and component.ml_pack_id = p.ml_pack_id
        and component.ml_bundle_parent_item_id is not distinct from p.ml_bundle_parent_item_id
    )
    else p.total
  end as operational_total,
  case
    when p.ml_bundle_type in ('virtual_kit', 'cart') and p.ml_bundle_primary = true then (
      select case
        when count(*) filter (where component.lucro is null) > 0 then null
        else coalesce(sum(component.lucro), p.lucro)
      end
      from public.pedidos component
      where component.ml_bundle_type = p.ml_bundle_type
        and component.ml_pack_id = p.ml_pack_id
        and component.ml_bundle_parent_item_id is not distinct from p.ml_bundle_parent_item_id
    )
    else p.lucro
  end as operational_lucro,
  case
    when p.ml_bundle_type in ('virtual_kit', 'cart') and p.ml_bundle_primary = true then (
      select array_agg(component.id order by component.ml_order_id)
      from public.pedidos component
      where component.ml_bundle_type = p.ml_bundle_type
        and component.ml_pack_id = p.ml_pack_id
        and component.ml_bundle_parent_item_id is not distinct from p.ml_bundle_parent_item_id
    )
    else array[p.id]
  end as operational_pedido_ids,
  case
    when p.ml_bundle_type in ('virtual_kit', 'cart') and p.ml_bundle_primary = true then (
      select array_agg(component.ml_order_id order by component.ml_order_id)
      from public.pedidos component
      where component.ml_bundle_type = p.ml_bundle_type
        and component.ml_pack_id = p.ml_pack_id
        and component.ml_bundle_parent_item_id is not distinct from p.ml_bundle_parent_item_id
    )
    else array[p.ml_order_id]
  end as operational_order_ids,
  case
    when p.ml_bundle_type in ('virtual_kit', 'cart') and p.ml_bundle_primary = true then (
      select coalesce(
        array_agg(distinct component.dslite_id)
          filter (where nullif(trim(coalesce(component.dslite_id, '')), '') is not null),
        array[]::text[]
      )
      from public.pedidos component
      where component.ml_bundle_type = p.ml_bundle_type
        and component.ml_pack_id = p.ml_pack_id
        and component.ml_bundle_parent_item_id is not distinct from p.ml_bundle_parent_item_id
    )
    else array_remove(array[p.dslite_id], null)
  end as operational_dslite_ids,
  case
    when p.ml_bundle_type in ('virtual_kit', 'cart') and p.ml_bundle_primary = true then (
      select coalesce(
        array_agg(distinct component.nota_fiscal_numero)
          filter (where nullif(trim(coalesce(component.nota_fiscal_numero, '')), '') is not null),
        array[]::text[]
      )
      from public.pedidos component
      where component.ml_bundle_type = p.ml_bundle_type
        and component.ml_pack_id = p.ml_pack_id
        and component.ml_bundle_parent_item_id is not distinct from p.ml_bundle_parent_item_id
    )
    else array_remove(array[p.nota_fiscal_numero], null)
  end as operational_invoice_numbers,
  case
    when p.ml_bundle_type in ('virtual_kit', 'cart') and p.ml_bundle_primary = true then (
      select count(*) filter (
        where component.lucro is null
          or coalesce(component.snapshot_pendencias, '[]'::jsonb) ? 'lucro_pendente_frete'
          or coalesce(component.snapshot_pendencias, '[]'::jsonb) ? 'lucro_pendente_produto'
      ) > 0
      from public.pedidos component
      where component.ml_bundle_type = p.ml_bundle_type
        and component.ml_pack_id = p.ml_pack_id
        and component.ml_bundle_parent_item_id is not distinct from p.ml_bundle_parent_item_id
    )
    else (
      p.lucro is null
      or coalesce(p.snapshot_pendencias, '[]'::jsonb) ? 'lucro_pendente_frete'
      or coalesce(p.snapshot_pendencias, '[]'::jsonb) ? 'lucro_pendente_produto'
    )
  end as operational_profit_pending
from public.pedidos p
where p.ml_bundle_primary is distinct from false;

grant select on public.pedidos_operacionais to authenticated, service_role;

notify pgrst, 'reload schema';
