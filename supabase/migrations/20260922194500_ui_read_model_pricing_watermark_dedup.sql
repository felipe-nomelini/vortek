begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.ui_read_model_direct_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare new_key text; old_key text; key text; parent uuid;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','last_sync_at','synced_at','observed_at','pricing_observed_at']) =
     (to_jsonb(old) - array['updated_at','last_sync_at','synced_at','observed_at','pricing_observed_at']) then
    return new;
  end if;
  if tg_table_name='produtos' then
    if tg_op <> 'DELETE' then new_key:=new.id::text; end if;
    if tg_op <> 'INSERT' then old_key:=old.id::text; end if;
  elsif tg_table_name in ('produto_fornecedor_ofertas','estoque_interno_movimentacoes','produto_kits') then
    if tg_op <> 'DELETE' then new_key:=new.produto_id::text; end if;
    if tg_op <> 'INSERT' then old_key:=old.produto_id::text; end if;
  end if;
  for key in select distinct value from unnest(array[new_key,old_key]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',key,tg_table_name);
    for parent in select component.kit_produto_id from public.produto_kit_componentes component where component.componente_produto_id=key::uuid loop
      perform public.enqueue_ui_read_model('product',parent::text,tg_table_name||'_kit_parent');
    end loop;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_listing_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare product_key uuid; item_key text;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','last_sync_at','synced_at','observed_at','pricing_observed_at']) =
     (to_jsonb(old) - array['updated_at','last_sync_at','synced_at','observed_at','pricing_observed_at']) then
    return new;
  end if;
  for product_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.produto_id end,
    case when tg_op <> 'INSERT' then old.produto_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',product_key::text,tg_table_name);
  end loop;
  for item_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.ml_item_id end,
    case when tg_op <> 'INSERT' then old.ml_item_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('listing',item_key,tg_table_name);
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

commit;
