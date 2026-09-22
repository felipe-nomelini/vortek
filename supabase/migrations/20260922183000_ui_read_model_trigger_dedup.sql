begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.ui_read_model_direct_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare new_key text; old_key text; key text; parent uuid;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','last_sync_at','synced_at','observed_at']) =
     (to_jsonb(old) - array['updated_at','last_sync_at','synced_at','observed_at']) then
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

create or replace function public.ui_read_model_kit_component_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare key uuid;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then return new; end if;
  for key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.kit_produto_id end,
    case when tg_op <> 'INSERT' then old.kit_produto_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',key::text,'produto_kit_componentes');
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_listing_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare product_key uuid; item_key text;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','last_sync_at','synced_at','observed_at']) =
     (to_jsonb(old) - array['updated_at','last_sync_at','synced_at','observed_at']) then
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

create or replace function public.ui_read_model_outbox_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare product_key uuid; item_key text;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','last_sync_at','synced_at','observed_at']) =
     (to_jsonb(old) - array['updated_at','last_sync_at','synced_at','observed_at']) then
    return new;
  end if;
  for product_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.produto_id end,
    case when tg_op <> 'INSERT' then old.produto_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',product_key::text,'anuncios_ml_outbox');
  end loop;
  for item_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.ml_item_id end,
    case when tg_op <> 'INSERT' then old.ml_item_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('listing',item_key,'anuncios_ml_outbox');
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_global_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','last_sync_at','synced_at','observed_at']) =
     (to_jsonb(old) - array['updated_at','last_sync_at','synced_at','observed_at']) then
    return new;
  end if;
  perform public.request_ui_read_model_rebuild(tg_table_name||'_global_change');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_pricing_group_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare product_key uuid; group_key uuid;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','last_sync_at','synced_at','observed_at']) =
     (to_jsonb(old) - array['updated_at','last_sync_at','synced_at','observed_at']) then
    return new;
  end if;
  if tg_table_name = 'ml_pricing_groups' then
    for product_key in select distinct value from unnest(array[
      case when tg_op <> 'DELETE' then new.produto_id end,
      case when tg_op <> 'INSERT' then old.produto_id end
    ]) as candidate(value) where value is not null loop
      perform public.enqueue_ui_read_model('product',product_key::text,tg_table_name);
    end loop;
  else
    for group_key in select distinct value from unnest(array[
      case when tg_op <> 'DELETE' then new.group_id end,
      case when tg_op <> 'INSERT' then old.group_id end
    ]) as candidate(value) where value is not null loop
      select groups.produto_id into product_key from public.ml_pricing_groups groups where groups.id=group_key;
      if product_key is not null then
        perform public.enqueue_ui_read_model('product',product_key::text,tg_table_name);
      end if;
    end loop;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

commit;
