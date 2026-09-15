-- Reparo idempotente da única venda de kit pendente identificada antes desta correção.
-- Em bases sem o pedido produtivo, a migration é deliberadamente um no-op.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $repair$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_item_ml_id text;
  v_kit_product_id uuid;
  v_component_product_id uuid;
  v_offer_id uuid;
  v_offer_observed_at timestamptz;
  v_updated integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('repair:kit-source:2000018469395176', 0));

  select pedido.id
    into v_order_id
  from public.pedidos pedido
  where pedido.ml_order_id = '2000018469395176'
  for update;

  if v_order_id is null then
    return;
  end if;

  if exists (
    select 1
    from public.pedidos pedido
    where pedido.id = v_order_id
      and nullif(trim(coalesce(pedido.dslite_id, '')), '') is not null
  ) then
    -- O CMV histórico deve permanecer coerente com a compra já criada. Cancelar ou
    -- recriar um pedido DSLite existente exige uma ação operacional separada.
    return;
  end if;

  select item.id, item.ml_item_id
    into v_item_id, v_item_ml_id
  from public.pedido_itens item
  where item.pedido_id = v_order_id
    and upper(trim(coalesce(item.seller_sku, ''))) = 'VTK016028'
    and item.quantidade = 2
  for update;

  if v_item_id is null then
    raise exception 'Item VTK016028 da venda 2000018469395176 não encontrado';
  end if;

  if exists (
    select 1
    from public.pedido_itens item
    where item.id = v_item_id
      and item.cmv_unitario_snapshot = 482.88
      and item.cmv_total_snapshot = 965.76
      and item.cmv_composicao @> '[{"fornecedor_id":"108","dslite_produto_id":"2295"}]'::jsonb
  ) then
    return;
  end if;

  if not exists (
    select 1
    from public.pedido_itens item
    join public.pedidos pedido on pedido.id = item.pedido_id
    where item.id = v_item_id
      and item.cmv_unitario_snapshot = 480.00
      and item.cmv_total_snapshot = 960.00
      and pedido.lucro = 167.54
  ) then
    raise exception 'Snapshot econômico da venda 2000018469395176 mudou; reparo interrompido';
  end if;

  select kit.produto_id, component.componente_produto_id, offer.id, offer.updated_at
    into v_kit_product_id, v_component_product_id, v_offer_id, v_offer_observed_at
  from public.produtos product
  join public.produto_kits kit
    on kit.produto_id = product.id
    and kit.ativo is true
    and kit.fornecedor_dslite_id = '108'
  join public.produto_kit_componentes component
    on component.kit_produto_id = kit.produto_id
    and component.quantidade = 48
  join public.produto_fornecedor_ofertas offer
    on offer.produto_id = component.componente_produto_id
    and offer.dslite_fornecedor_id = kit.fornecedor_dslite_id
    and offer.dslite_produto_id = '2295'
    and offer.ativo is true
    and offer.custo = 10.06
  where product.sku = 'VTK016028';

  if v_offer_id is null then
    raise exception 'Oferta BKR1 2295 usada na venda não pôde ser comprovada';
  end if;

  update public.pedido_itens
  set
    cmv_unitario_snapshot = 482.88,
    cmv_total_snapshot = 965.76,
    cmv_fonte = 'kit_product',
    cmv_evidencia_id = concat(
      '2000018469395176:', coalesce(nullif(trim(v_item_ml_id), ''), v_item_id::text),
      ':kit:', v_kit_product_id::text, ':offer:', v_offer_id::text, ':',
      to_char(v_offer_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    cmv_fonte_observada_em = v_offer_observed_at,
    cmv_capturado_em = now(),
    cmv_composicao = jsonb_build_array(jsonb_build_object(
      'produto_id', v_component_product_id::text,
      'oferta_id', v_offer_id::text,
      'fornecedor_id', '108',
      'dslite_produto_id', '2295',
      'quantidade', 48,
      'custo_unitario', 10.06,
      'observado_em', to_char(v_offer_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )),
    updated_at = now()
  where id = v_item_id;

  update public.pedidos
  set lucro = 161.78, updated_at = now()
  where id = v_order_id
    and lucro = 167.54;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Lucro da venda 2000018469395176 não foi atualizado exatamente uma vez';
  end if;

  insert into public.nf_auditoria_eventos (
    pedido_id,
    ml_order_id,
    evento,
    resposta_ml,
    status_resultante
  ) values (
    v_order_id,
    '2000018469395176',
    'kit_supplier_cmv_repair',
    jsonb_build_object(
      'seller_sku', 'VTK016028',
      'fornecedor_id', '108',
      'dslite_produto_id', '2295',
      'cmv_unitario_anterior', 480.00,
      'cmv_unitario_novo', 482.88,
      'cmv_total_anterior', 960.00,
      'cmv_total_novo', 965.76,
      'lucro_anterior', 167.54,
      'lucro_novo', 161.78
    ),
    'success'
  );
end;
$repair$;
