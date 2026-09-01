begin;

set local lock_timeout = '5s';

delete from public.estoque_manifestacoes_nfe
where recebimento_id in (
  select id from public.estoque_recebimentos_nfe
  where snapshot_source = 'bnt_d05_inventory_mock'
);
delete from public.estoque_interno_movimentacoes
where snapshot_source = 'bnt_d05_inventory_mock';
delete from public.estoque_recebimentos_nfe
where snapshot_source = 'bnt_d05_inventory_mock';
delete from public.produtos
where sku like 'BNT-MOCK-D05-%';

insert into public.produtos (sku, nome, marca, custo, gtin, descricao, ativo)
values
  ('BNT-MOCK-D05-001', 'Air Fryer Digital 5 litros', 'Bentevi Demo', 289.90, '7890000000001', 'Produto de demonstração para homologação', true),
  ('BNT-MOCK-D05-002', 'Kit de ferramentas profissional 110 peças', 'Bentevi Demo', 879.50, '7890000000002', 'Produto de demonstração para homologação', true),
  ('BNT-MOCK-D05-003', 'Caixa de som Bluetooth portátil', 'Bentevi Demo', 459.00, '7890000000003', 'Produto de demonstração para homologação', true),
  ('BNT-MOCK-D05-004', 'Fone de ouvido sem fio com cancelamento de ruído', 'Bentevi Demo', 318.40, '7890000000004', 'Produto de demonstração para homologação', true),
  ('BNT-MOCK-D05-005', 'Smartwatch esportivo com GPS', 'Bentevi Demo', 530.00, '7890000000005', 'Produto de demonstração para homologação', true);

do $$
declare
  v_recipient text;
  v_products uuid[];
  v_receipts uuid[] := array[]::uuid[];
  v_names text[] := array[
    'Fornecedor Aurora', 'Distribuidora Horizonte', 'Atacado Ipe',
    'Comercial Serra', 'Produtos Nascente', 'Fornecedor Cancelado',
    'Fornecedor Denegado', 'Emitente Desconhecido', 'Operacao Nao Realizada'
  ];
  v_cnpjs text[] := array[
    '11111111000111', '22222222000122', '33333333000133',
    '44444444000144', '55555555000155', '66666666000166',
    '77777777000177', '88888888000188', '99999999000199'
  ];
  v_provider_status smallint[] := array[1,1,1,1,1,2,3,1,1]::smallint[];
  v_receipt_status text[] := array[
    'identificada', 'identificada', 'aguardando_conferencia',
    'parcial', 'conferido', 'identificada', 'identificada',
    'identificada', 'identificada'
  ];
  v_values numeric[] := array[289.90,879.50,459.00,1240.75,679.80,318.40,530.00,199.99,925.30];
  v_id uuid;
  v_item_id uuid;
  v_key text;
  v_product record;
  v_expected integer;
  v_good integer;
  v_damaged integer;
  i integer;
begin
  select regexp_replace(empresa.cnpj, '\D', '', 'g')
  into v_recipient
  from public.empresa empresa
  limit 1;
  v_recipient := coalesce(v_recipient, '00000000000191');
  if v_recipient !~ '^[0-9]{14}$' then
    raise exception 'CNPJ da empresa DEV nao configurado';
  end if;

  select array_agg(product.id order by product.updated_at desc nulls last, product.nome)
  into v_products
  from (
    select id, nome, updated_at
    from public.produtos
    where sku like 'BNT-MOCK-D05-%'
    order by updated_at desc nulls last, nome
    limit 5
  ) product;
  if coalesce(array_length(v_products, 1), 0) < 5 then
    raise exception 'Sao necessarios cinco produtos DEV para a amostra';
  end if;

  for i in 1..9 loop
    v_key := rpad('352609000000000000005500100000' || lpad((7000 + i)::text, 9, '0') || '1', 44, '0');
    insert into public.estoque_recebimentos_nfe (
      chave_nfe, tipo_ambiente, numero, serie, emitente_cnpj, emitente_nome,
      destinatario_cnpj, emitida_em, recebida_em, valor_total, valor_icms,
      xml_nfe, origem_xml, status, modelo_documento, provider_status,
      numero_protocolo, cfops, snapshot_source, confirmado_em
    ) values (
      v_key, 2, (7000 + i)::text, '1', v_cnpjs[i], v_names[i],
      v_recipient, now() - (i::text || ' days')::interval,
      now() - (i::text || ' days')::interval + interval '2 hours',
      v_values[i], round(v_values[i] * 0.12, 2),
      case when v_receipt_status[i] in ('aguardando_conferencia', 'parcial', 'conferido') then '<nfeProc fixture="true" />' else null end,
      case when v_receipt_status[i] in ('aguardando_conferencia', 'parcial', 'conferido') then 'upload' else null end,
      v_receipt_status[i], 55, v_provider_status[i], '135260000000001',
      '1102,2102', 'bnt_d05_inventory_mock',
      case when v_receipt_status[i] = 'conferido' then now() - interval '1 day' else null end
    ) returning id into v_id;
    v_receipts := array_append(v_receipts, v_id);
  end loop;

  for i in 3..5 loop
    select product.id, product.sku, product.nome
    into v_product
    from public.produtos product
    where product.id = v_products[i - 2];
    v_expected := case i when 4 then 8 when 5 then 6 else 5 end;
    v_good := case i when 4 then 3 when 5 then 5 else 0 end;
    v_damaged := case i when 5 then 1 else 0 end;
    insert into public.estoque_recebimento_itens (
      recebimento_id, numero_item, produto_id, codigo_fornecedor, descricao,
      quantidade_esperada, quantidade_liberada, quantidade_nao_aproveitavel
    ) values (
      v_receipts[i], 1, v_product.id, 'FORN-' || v_product.sku, v_product.nome,
      v_expected, v_good, v_damaged
    ) returning id into v_item_id;
  end loop;

  insert into public.estoque_manifestacoes_nfe (
    recebimento_id, chave_nfe, tipo_ambiente, tipo_manifestacao, status,
    protocolo, motivo, justificativa, numero_sequencial, codigo_sefaz,
    idempotency_key, provider_evento, requested_at, completed_at
  ) values
    (v_receipts[2], (select chave_nfe from public.estoque_recebimentos_nfe where id = v_receipts[2]), 2, 2, 'processada', '135260000000099', 'Evento processado na amostra', null, 1, 135, 'fixture:science', 'Ciencia da operacao', now() - interval '1 day', now() - interval '1 day'),
    (v_receipts[8], (select chave_nfe from public.estoque_recebimentos_nfe where id = v_receipts[8]), 2, 3, 'processada', '135260000000099', 'Evento processado na amostra', null, 1, 135, 'fixture:unknown', 'Desconhecimento da operacao', now() - interval '1 day', now() - interval '1 day'),
    (v_receipts[9], (select chave_nfe from public.estoque_recebimentos_nfe where id = v_receipts[9]), 2, 4, 'processada', '135260000000099', 'Evento processado na amostra', 'Mercadoria nao solicitada e operacao comercial nao realizada.', 1, 135, 'fixture:not-realized', 'Operacao nao realizada', now() - interval '1 day', now() - interval '1 day');

  insert into public.estoque_interno_movimentacoes (
    produto_id, tipo, quantidade, motivo, disponivel_venda, situacao_estoque,
    status_devolucao, estado_envio_interno, estornada_em, estorno_motivo,
    snapshot_source, idempotency_key
  ) values
    (v_products[1], 'entrada_compra', 14, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', null, now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:1'),
    (v_products[1], 'saida_envio_interno', 4, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', 'reservado', now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:2'),
    (v_products[2], 'entrada_compra', 8, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', null, now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:3'),
    (v_products[2], 'saida_envio_interno', 3, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', 'reservado', now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:4'),
    (v_products[3], 'entrada_compra', 4, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', null, now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:5'),
    (v_products[3], 'saida_envio_interno', 4, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', 'reservado', now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:6'),
    (v_products[4], 'entrada_compra', 6, 'Amostra protegida BNT-D05', false, 'nao_aproveitavel', 'amostra_homologacao', null, now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:7'),
    (v_products[5], 'ajuste_positivo', 10, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', null, now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:8'),
    (v_products[5], 'ajuste_negativo', 2, 'Amostra protegida BNT-D05', true, 'liberado', 'amostra_homologacao', null, now(), 'Movimento inerte de homologacao', 'bnt_d05_inventory_mock', 'fixture-movement:9');
end;
$$;

commit;
