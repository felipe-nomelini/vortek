-- Encerramento autorizado da trava temporária operacional do anúncio.
update public.ml_manual_blocklist
set
  ativo = false,
  motivo = 'bloqueio temporário encerrado após correção da sincronização de estoque'
where ml_item_id = 'MLB6573107112'
  and upper(coalesce(sku, '')) = 'HYX84825'
  and ativo = true
  and motivo = 'ajuste manual temporário';
