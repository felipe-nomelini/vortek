import { createServiceClient } from '@/lib/supabase';

type AuditEvent =
  | 'webhook_received'
  | 'webhook_acked'
  | 'webhook_deferred_processing_started'
  | 'webhook_deferred_processing_success'
  | 'webhook_deferred_processing_failed'
  | 'pre_validacao'
  | 'envio'
  | 'retorno_ml'
  | 'download_xml'
  | 'download_danfe'
  | 'pack_id_pendente'
  | 'pack_id_backfill'
  | 'payload_validacao_bloqueio'
  | 'sync_snapshot_start'
  | 'sync_snapshot_success'
  | 'sync_snapshot_partial'
  | 'sync_snapshot_failed'
  | 'ml_invoice_upload_start'
  | 'ml_invoice_upload_success'
  | 'ml_invoice_upload_failed'
  | 'ml_fiscal_document_attach_start'
  | 'ml_fiscal_document_attach_success'
  | 'ml_fiscal_document_attach_failed'
  | 'ml_label_download_attempt'
  | 'ml_label_download_retry'
  | 'ml_label_download_timeout'
  | 'ml_label_download_success'
  | 'ml_label_send_success'
  | 'ml_label_send_failed'
  | 'ml_label_download_blocked_by_invoice'
  | 'dslite_desvinculo_manual'
  | 'dslite_purchase_created_with_brasilnfe_xml'
  | 'dslite_blocked_same_nfe'
  | 'dslite_product_lookup_result'
  | 'dslite_create_order_failed'
  | 'dslite_create_with_supplier_success'
  | 'dslite_create_with_supplier_failed'
  | 'dslite_create_without_supplier_fallback_success'
  | 'dslite_create_without_supplier_fallback_failed'
  | 'supplier_payment_confirmed_manual'
  | 'nfe_homologacao_bloqueada'
  | 'nfe_homologacao_auto_remediada'
  | 'nfe_local_consistencia_check'
  | 'nfe_local_consistencia_check_start'
  | 'nfe_local_consistencia_check_result'
  | 'nfe_local_status_reconciliado'
  | 'nfe_local_autocorrecao_status'
  | 'nfe_local_cleanup_ghost_xml'
  | 'nfe_local_cleanup_ghost_before_reissue'
  | 'brasilnfe_emit_failed_detailed'
  | 'brasilnfe_duplicate_identifier_detected'
  | 'brasilnfe_duplicate_note_found'
  | 'brasilnfe_duplicate_user_decision_use_existing'
  | 'brasilnfe_duplicate_user_decision_reissue'
  | 'brasilnfe_duplicate_cancel_start'
  | 'brasilnfe_duplicate_cancel_success'
  | 'brasilnfe_duplicate_cancel_failed'
  | 'brasilnfe_duplicate_reissue_success'
  | 'empresa_fiscal_config_missing'
  | 'empresa_uf_fallback_endereco'
  | 'ml_invoice_xml_check_start'
  | 'ml_invoice_xml_check_success'
  | 'ml_invoice_xml_check_failed'
  | 'brasilnfe_invoice_ensure_start'
  | 'brasilnfe_invoice_ensure_success'
  | 'brasilnfe_invoice_ensure_failed'
  | 'ml_invoice_data_upload_start'
  | 'ml_invoice_data_upload_attempt'
  | 'ml_invoice_data_upload_success'
  | 'ml_invoice_data_upload_failed'
  | 'ml_fiscal_emission_blocked'
  | 'ml_fiscal_emission_skipped_policy'
  | 'ml_fiscal_sync_ignored'
  | 'ml_fiscal_webhook_ignored'
  | 'ml_fiscal_endpoint_blocked'
  | 'ml_fiscal_runtime_call_denied'
  | 'ml_fiscal_legacy_script_blocked'
  | 'ml_fiscal_release_window_detected'
  | 'ml_fiscal_release_window_updated'
  | 'ml_fiscal_release_window_cleared'
  | 'ml_fiscal_release_window_blocked'
  | 'sync_order_snapshot_start'
  | 'sync_order_snapshot_success'
  | 'sync_order_snapshot_failed'
  | 'ml_shipment_wait_start'
  | 'ml_shipment_wait_attempt'
  | 'ml_shipment_wait_resolved'
  | 'ml_shipment_wait_timeout'
  | 'db_schema_migration_missing_detected'
  | 'etiqueta_auto_pedido_lookup_failed'
  | 'brasilnfe_source_enforced'
  | 'fiscal_provider_backfill_source'
  | 'dslite_carrier_skipped_existing'
  | 'brasilnfe_tipo_ambiente_invalido'
  | 'nota_fiscal_cancelamento_start'
  | 'nota_fiscal_cancelamento_success'
  | 'nota_fiscal_cancelamento_failed'
  | 'nota_fiscal_carta_correcao_start'
  | 'nota_fiscal_carta_correcao_success'
  | 'nota_fiscal_carta_correcao_failed'
  | 'nfe_danfe_persistencia'
  | 'step_auto_close';

export async function registrarEventoNfAuditoria(input: {
  pedidoId?: string | null;
  mlOrderId?: string | null;
  mlPackId?: string | null;
  evento: AuditEvent;
  payloadEnviado?: Record<string, any> | null;
  respostaMl?: Record<string, any> | null;
  statusResultante?: string | null;
}) {
  try {
    const client = createServiceClient();
    await client.from('nf_auditoria_eventos').insert({
      pedido_id: input.pedidoId || null,
      ml_order_id: input.mlOrderId || null,
      ml_pack_id: input.mlPackId || null,
      evento: input.evento,
      payload_enviado: input.payloadEnviado || null,
      resposta_ml: input.respostaMl || null,
      status_resultante: input.statusResultante || null,
    } as any);
  } catch (err: any) {
    console.error('[nf_auditoria] Falha ao registrar evento:', err?.message || err);
  }
}
