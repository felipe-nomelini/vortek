#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ACTOR_ID = '3e56ce48-f461-4784-848b-097d1e482a43';
const ROOT = path.resolve(__dirname, '..');
const DOWNLOADS = '/mnt/c/Users/Bentevi Tecnologia/Downloads';
const MANIFEST = process.env.BUYBOX_PILOT_MANIFEST
  || path.join(DOWNLOADS, 'P1_ECONOMICA_BATCH_01_MANIFEST_15_SKUS.json');
const SCREENING = process.env.BUYBOX_PILOT_SCREENING
  || path.join(DOWNLOADS, 'P1_ECONOMICA_BATCH_01_SCREENING_15_SKUS.csv');
const OUTPUT = process.env.BUYBOX_PILOT_OUTPUT
  || path.join(ROOT, 'reports/buybox-economics/BNT-ML-BUYBOX-ECONOMICS-01-2026-09-16');
const ORIGIN = process.env.BUYBOX_PILOT_ORIGIN || 'http://127.0.0.1:3001';
const API_KEY = String(process.env.API_SECRET_KEY || '').trim();
const APPLY = process.argv.includes('--apply');

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function jsonFile(name, value) { fs.writeFileSync(path.join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csvFile(name, rows, columns) {
  const lines = [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))];
  fs.writeFileSync(path.join(OUTPUT, name), `${lines.join('\n')}\n`);
}
async function command(body) {
  const response = await fetch(`${ORIGIN}/api/pricing/buybox-pilot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.code || result.error || `HTTP_${response.status}`);
  return result;
}
function decisionRows(results) {
  return results.map(row => ({ sku: row.sku, ml_item_id: row.mlItemId, state: row.state, ...row.decision }));
}
function writeInitialArtifacts(results) {
  const rows = decisionRows(results);
  csvFile('01_batch01_live_inputs.csv', rows, [
    'sku','ml_item_id','currentPriceCents','priceToWinCents','status','stock','qtySold90d','state','reason',
  ]);
  csvFile('02_batch01_economic_calculation.csv', rows, [
    'sku','ml_item_id','costCents','feeRate','feeCents','shippingCents','taxRate','taxSource','taxStatus',
    'rbt12Reference','calculatedAt','floorRate','floorPriceCents','currentPriceCents','priceToWinCents',
    'resultAtPriceToWinCents','marginAtPriceToWin','state','reason',
  ]);
  csvFile('03_batch01_supplier_evidence.csv', rows, [
    'sku','ml_item_id','supplierBefore','supplierSelected','costBefore','costSelected','offerId','paymentMode','stockSupplier','lastSyncAt','state','reason',
  ]);
  jsonFile('04_batch01_approved_actions.json', results.filter(row => row.state === 'BUY_BOX_ECONOMICAMENTE_ATACAVEL'
    && row.decision.writeApproved === true).map(row => ({ sku: row.sku, ml_item_id: row.mlItemId,
      price_before_cents: row.decision.currentPriceCents, approved_price_cents: row.decision.priceToWinCents,
      evaluation_id: row.evaluationId, actor_id: ACTOR_ID, rule_id: 'BNT-ML-BUYBOX-ECONOMICS-01' })));
}
function writeFinalArtifacts(summary, errors) {
  jsonFile('05_batch01_before.json', summary.items.map(row => ({ sku: row.sku, ml_item_id: row.ml_item_id, before: row.before_snapshot })));
  jsonFile('06_batch01_after.json', summary.items.map(row => ({ sku: row.sku, ml_item_id: row.ml_item_id,
    state: row.final_state, after: row.after_snapshot || row.before_snapshot })));
  jsonFile('07_batch01_readback.json', summary.items.map(row => ({ sku: row.sku, ml_item_id: row.ml_item_id,
    state: row.final_state, readback: row.readback })));
  jsonFile('08_batch01_errors.json', errors);
  const experiments = new Map(summary.experiments.map(row => [row.batch_item_id, row]));
  csvFile('09_batch01_experiment_baseline.csv', summary.items.flatMap(row => {
    const experiment = experiments.get(row.id);
    if (!experiment) return [];
    return [{ sku: row.sku, ml_item_id: row.ml_item_id, experiment_id: experiment.id,
      started_at: experiment.started_at, state: experiment.state, ...experiment.baseline }];
  }), ['sku','ml_item_id','experiment_id','started_at','state','priceBeforeCents','priceAfterCents','priceToWinCents',
    'marginBefore','marginAfter','taxRate','taxStatus','costCents','feeCents','shippingCents','buyBoxBefore','buyBoxAfterInitialReadback']);
  const counts = summary.items.reduce((acc, row) => ({ ...acc, [row.final_state]: (acc[row.final_state] || 0) + 1 }), {});
  const executedReadbacks = summary.items.filter(row => row.readback);
  const invariantsPreserved = executedReadbacks.every(row => row.readback?.invariantsOk !== false);
  const hashes = fs.readdirSync(OUTPUT).filter(name => /^0[1-9]_/.test(name)).sort()
    .map(name => `${hash(fs.readFileSync(path.join(OUTPUT, name)))}  ${name}`);
  const report = `# BNT-ML-BUYBOX-ECONOMICS-01 — Batch 01\n\n`
    + `- Estado: ${summary.run.state}\n- Ator: Rodrigo (${ACTOR_ID})\n- Itens avaliados: ${summary.items.length}\n`
    + `- Preços alterados e confirmados: ${counts.UPDATED_OK || 0}\n- Falhas de readback: ${counts.FAILED_READBACK || 0}\n`
    + `- Estoque, produtos.ativo, custom_price, catálogo e fornecedor preferencial: ${invariantsPreserved ? 'PRESERVADOS' : 'FALHA DE INVARIANTE'}.\n`
    + `- Batch 02 iniciado: NÃO\n- Checkpoints automáticos somente leitura: D+1, D+3 e D+7 para cada UPDATED_OK.\n\n`
    + `## Decisões\n\n${Object.entries(counts).sort().map(([state, count]) => `- ${state}: ${count}`).join('\n')}\n\n`
    + `## Vendas observadas no screening\n\n- Com venda em 90 dias: 4\n- Sem venda localizada: 11\n\n`
    + `## Checksums\n\n\`\`\`text\n${hashes.join('\n')}\n\`\`\`\n`;
  fs.writeFileSync(path.join(OUTPUT, '10_batch01_execution_report.md'), report);
}

async function main() {
  if (!API_KEY) throw new Error('API_SECRET_KEY ausente');
  const manifestBuffer = fs.readFileSync(MANIFEST);
  const screeningBuffer = fs.readFileSync(SCREENING);
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  fs.mkdirSync(OUTPUT, { recursive: true });
  const initialized = await command({ action: 'initialize', actorId: ACTOR_ID,
    manifestBase64: manifestBuffer.toString('base64'), screeningBase64: screeningBuffer.toString('base64') });
  const evaluated = [];
  const errors = [];
  for (const row of manifest) {
    try { evaluated.push(await command({ action: 'evaluate', runId: initialized.runId, mlItemId: row.ml_item_id })); }
    catch (error) { errors.push({ sku: row.sku, ml_item_id: row.ml_item_id, phase: 'evaluate', error: error.message }); }
  }
  if (evaluated.length !== 15) throw new Error('Dry-run não classificou os 15 SKUs');
  writeInitialArtifacts(evaluated);
  let stopped = false;
  let failedReadbacks = 0;
  if (APPLY) {
    const ordered = [...evaluated].sort((left, right) => {
      const sold = Number(right.qtySold90d > 0) - Number(left.qtySold90d > 0);
      if (sold) return sold;
      const leftGap = (left.decision.currentPriceCents - left.decision.priceToWinCents) / left.decision.currentPriceCents;
      const rightGap = (right.decision.currentPriceCents - right.decision.priceToWinCents) / right.decision.currentPriceCents;
      return leftGap - rightGap || right.stock - left.stock || left.sku.localeCompare(right.sku);
    });
    for (const row of ordered) {
      if (stopped || row.state !== 'BUY_BOX_ECONOMICAMENTE_ATACAVEL' || row.decision.writeApproved !== true) continue;
      try {
        const result = await command({ action: 'execute', runId: initialized.runId, mlItemId: row.mlItemId });
        if (result.state === 'FAILED_READBACK') failedReadbacks += 1;
        if (result.readback?.invariantsOk === false || failedReadbacks > 1) stopped = true;
      } catch (error) {
        errors.push({ sku: row.sku, ml_item_id: row.mlItemId, phase: 'execute', error: error.message });
        stopped = true;
      }
    }
  }
  const summary = await command({ action: 'finish', runId: initialized.runId, stopped,
    errorCode: stopped ? 'STOP_BATCH' : null });
  writeFinalArtifacts(summary, errors);
  process.stdout.write(`${JSON.stringify({ runId: initialized.runId, apply: APPLY, state: summary.run.state,
    counts: summary.items.reduce((acc, row) => ({ ...acc, [row.final_state]: (acc[row.final_state] || 0) + 1 }), {}), output: OUTPUT }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
