-- O bloqueio foi criado como temporário antes da migração HYX -> VTK.
-- Mantê-lo ativo impede a baixa de segurança quando a DSLite confirma estoque zero.
update public.ml_manual_blocklist
set
  ativo = false,
  motivo = 'bloqueio temporário encerrado após correção da sincronização de estoque'
where ml_item_id = 'MLB6573107112'
  and upper(coalesce(sku, '')) = 'HYX84825'
  and ativo = true
  and created_by = 'migration_00021';
