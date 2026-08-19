#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { categorySemanticAssessment } = require('./lib/ml-p0-phase6e');

const projectRoot = path.resolve(__dirname, '..');
const reportDir = path.join(projectRoot, 'reports', 'ml-p0-phase6e');
const skuDir = path.join(reportDir, 'VTK012864');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const baseline = readJson(path.join(skuDir, 'local-baseline.json'));
const identity = readJson(path.join(skuDir, 'identity.json'));
const category = readJson(path.join(skuDir, 'category.json'));
const post = readJson(path.join(skuDir, 'post-response.json'));
const perSkuSummary = readJson(path.join(skuDir, 'summary.json'));
const catalog = identity.catalog_results.find((row) => row.id === 'MLB32450801');
const assessment = categorySemanticAssessment({
  product: baseline.current,
  dslite: identity.dslite,
  catalog,
  category: category.category,
});

if (assessment.passed) throw new Error('POST_RUN_AUDIT_EXPECTED_CATEGORY_CONFLICT');
if (post.http_status !== 201 || post.body?.id !== 'MLB7437196478') throw new Error('POST_RUN_AUDIT_ITEM_EVIDENCE_DRIFT');

const audit = {
  generated_at: new Date().toISOString(),
  classification: 'STOP_LOSS_IDENTITY_PUBLICATION_DETECTED_POST_RUN',
  phase_approved: false,
  sku: 'VTK012864',
  item_id: 'MLB7437196478',
  ordinal: 85,
  evidence: {
    local_identity: {
      name: baseline.current.nome,
      gtin: baseline.current.gtin,
      category: baseline.current.categoria,
      dimensions_cm: [baseline.current.altura, baseline.current.largura, baseline.current.profundidade],
      gross_weight_kg: baseline.current.peso_bruto,
    },
    remote: {
      category_id: post.body.category_id,
      domain_id: post.body.domain_id,
      category_path: category.category.path_from_root,
      status: post.body.status,
      sub_status: post.body.sub_status,
    },
    semantic_assessment: assessment,
  },
  impact: {
    item_created: true,
    local_persistence: false,
    price_update: false,
    description_write: false,
    subsequent_corrective_write: false,
    runtime_stop_loss_failed_to_trigger: true,
    skus_after_incident_were_read_only_or_blocked: true,
  },
  root_cause: 'Category confidence relied on internal agreement between a community catalog domain and domain discovery; it did not compare the resulting category path with supplier/local product semantics before POST.',
  correction: 'The Phase 6E resolver now fetches the selected category contract and blocks strongly incompatible semantic verticals before payload construction.',
  next_action: 'Operator-controlled containment and reconciliation of MLB7437196478 in a future authorized phase; no automatic write executed.',
};
writeJson(path.join(reportDir, 'post-run-stop-loss-audit.json'), audit);

perSkuSummary.post_run_classification = 'MATERIAL_CATEGORY_DRIFT';
perSkuSummary.post_run_audit = 'post-run-stop-loss-audit.json';
perSkuSummary.phase_approved = false;
writeJson(path.join(skuDir, 'summary.json'), perSkuSummary);

for (const filename of ['summary.json', 'full-report.json']) {
  const report = readJson(path.join(reportDir, filename));
  report.phase_approved = false;
  report.post_run_audit = audit;
  report.stop_loss = {
    ...report.stop_loss,
    triggered: true,
    reason: audit.classification,
    wrong_identity_publications: Math.max(1, Number(report.stop_loss?.wrong_identity_publications || 0)),
    wrong_category_publications: 1,
    detected_post_run: true,
    runtime_enforcement_failed: true,
  };
  const result = report.results.find((row) => row.sku === audit.sku);
  if (result) {
    result.post_run_classification = 'MATERIAL_CATEGORY_DRIFT';
    result.post_run_audit = 'post-run-stop-loss-audit.json';
  }
  writeJson(path.join(reportDir, filename), report);
}

process.stdout.write(`${JSON.stringify({ ok: true, audit: path.join(reportDir, 'post-run-stop-loss-audit.json') })}\n`);
