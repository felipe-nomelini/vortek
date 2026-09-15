import { createServiceClient } from '@/lib/supabase';
import type { CatalogIdentityExportName } from '@/lib/catalog-identity-exports';

const CSV_COLUMNS = [
  'sku','produto_id','ml_item_id','catalog_product_id','pricing_group_id',
  'identity_state_before','identity_state_after','conflict_type','evidence','action','action_result',
  'old_relation','new_relation','old_price','new_price','pricing_source','rule_id','job_id','actor',
  'started_at','finished_at','ml_readback','error','risk_tier','gap_pct','reason_code','source_origin',
];

function csvCell(value: unknown) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows: Record<string, unknown>[]) {
  return [CSV_COLUMNS.map(csvCell).join(','), ...rows.map(row => CSV_COLUMNS.map(column => csvCell(row[column])).join(','))].join('\r\n');
}

function exportRow(row: any, run: any) {
  return {
    sku: row.sku,
    produto_id: row.produto_id,
    ml_item_id: row.ml_item_id,
    catalog_product_id: row.catalog_product_id,
    pricing_group_id: row.pricing_group_id,
    identity_state_before: row.input_row?.identity_state || null,
    identity_state_after: row.identity_state,
    conflict_type: row.conflict_type,
    evidence: row.evidence,
    action: row.action,
    action_result: row.action_result,
    old_relation: row.old_relation,
    new_relation: row.proposed_relation,
    old_price: row.old_price,
    new_price: row.new_price,
    pricing_source: row.pricing_source,
    rule_id: row.rule_id,
    job_id: run.job_id,
    actor: run.created_by,
    started_at: row.started_at,
    finished_at: row.finished_at,
    ml_readback: row.ml_readback,
    error: row.error,
    risk_tier: row.risk_tier,
    gap_pct: row.gap_pct,
    reason_code: row.reason_code,
    source_origin: row.source_origin,
  };
}

export async function generateCatalogIdentityExport(runId: string, name: CatalogIdentityExportName) {
  const client = createServiceClient();
  const [runResult, auditResult, actionResult] = await Promise.all([
    (client.from('ml_catalog_identity_runs' as any) as any).select('*').eq('id', runId).single(),
    (client.from('ml_catalog_identity_audits' as any) as any).select('*').eq('run_id', runId)
      .order('ordinal', { ascending: true }).limit(10_000),
    (client.from('ml_catalog_identity_actions' as any) as any)
      .select('*,audit:ml_catalog_identity_audits!inner(run_id,ml_item_id)').eq('audit.run_id', runId)
      .order('created_at', { ascending: true }).limit(10_000),
  ]);
  if (runResult.error || !runResult.data || auditResult.error || actionResult.error)
    throw new Error('catalog_identity_export_read_failed');
  const run = runResult.data;
  const audits = auditResult.data || [];
  const rows = audits.map((row: any) => exportRow(row, run));
  if (name === '09_before_after_summary.md') {
    const summary = run.summary || {};
    const lines = [
      '# Saneamento de identidade do catálogo Mercado Livre', '',
      `- Run: \`${run.id}\``,
      `- Manifesto: \`${run.manifest_hash || 'ainda não concluído'}\``,
      `- Baseline original: ${run.baseline_count}`,
      `- Delta vivo: ${run.delta_count}`,
      `- Total analisado: ${summary.total ?? run.total_count}`,
      `- Conflitos confirmados: ${summary.conflito_confirmado ?? 0}`,
      `- Conflitos corrigidos: ${audits.filter((row: any) => row.action_result === 'CONFIRMED').length}`,
      `- Pendências manuais: ${audits.filter((row: any) => row.action_result === 'REQUIRES_CONFIRMATION').length}`,
      `- Estados inconclusivos: ${summary.inconclusivo ?? 0}`,
      `- Anúncios liberados para pricing: ${summary.liberados_pricing ?? 0}`,
      `- Anúncios bloqueados para pricing: ${summary.bloqueados_pricing ?? 0}`,
      `- Erros de API: ${summary.errors ?? 0}`,
      `- Alterações efetivas de vínculo: ${audits.filter((row: any) => row.action_result === 'CONFIRMED').length}`,
      `- Alterações em produtos.ativo: ${summary.produtos_ativo_changes ?? 0}`,
      `- Alterações de preço nesta missão: ${summary.price_changes ?? 0}`, '',
      'A missão não executa repricing. `price_to_win` é somente evidência de priorização.', '',
    ];
    return { body: lines.join('\n'), contentType: 'text/markdown; charset=utf-8' };
  }
  if (name === '10_rollback_manifest.json') {
    return { body: JSON.stringify({
      run_id: run.id, manifest_hash: run.manifest_hash, generated_at: new Date().toISOString(),
      price_changes: 0, produtos_ativo_changes: 0,
      actions: (actionResult.data || []).map((action: any) => ({
        id: action.id, ml_item_id: action.audit?.ml_item_id, action_type: action.action_type,
        state: action.state, before: action.before_state, after: action.after_state,
        rollback_plan: action.rollback_plan, readback: action.readback,
      })),
    }, null, 2), contentType: 'application/json; charset=utf-8' };
  }
  let selected = rows;
  if (name === '02_conflicts_confirmed.csv') selected = rows.filter((row: any) => row.identity_state_after === 'CONFLITO_CONFIRMADO');
  if (name === '03_pending_validation.csv') selected = rows.filter((row: any) => ['PENDENCIA_VALIDACAO','INCONCLUSIVO'].includes(String(row.identity_state_after)));
  if (name === '04_ml_state_anomalies.csv') selected = rows.filter((row: any) => {
    const audit = audits.find((candidate: any) => candidate.ml_item_id === row.ml_item_id);
    const status = String(audit?.evidence?.competition?.status || audit?.evidence?.competition?.buy_box_status || '');
    return !status || ['listed','not_listed'].includes(status);
  });
  if (name === '05_corrected_relations.csv') selected = rows.filter((row: any) => row.action_result === 'CONFIRMED');
  if (name === '06_buy_box_economic_conflicts.csv') selected = [];
  if (name === '07_buy_box_attackable_after_cleanup.csv') selected = [];
  if (name === '08_execution_errors.csv') selected = rows.filter((row: any) => Boolean(row.error));
  if (name === '11_buy_box_premium_validated.csv') selected = rows.filter((row: any) => {
    const audit = audits.find((candidate: any) => candidate.ml_item_id === row.ml_item_id);
    const status = String(audit?.evidence?.competition?.status || audit?.evidence?.competition?.buy_box_status || '');
    return row.identity_state_after === 'SEM_CONFLITO' && ['winning','sharing_first_place'].includes(status);
  });
  return { body: `\uFEFF${csv(selected)}`, contentType: 'text/csv; charset=utf-8' };
}
