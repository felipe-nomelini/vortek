const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const executor = require('../scripts/catalog-identity-p0-production-closeout.js');

const root = path.join(__dirname, '..');
const priorDir = path.join(root, 'reports', 'catalog-identity-p0', 'BNT-ML-CATALOG-IDENTITY-01-2026-09-15-readonly-final');
const executiveDir = path.join(root, 'reports', 'catalog-identity-p0', 'BNT-ML-CATALOG-IDENTITY-01-2026-09-15-executive-179');
const orderFile = '/mnt/c/Users/Bentevi Tecnologia/Downloads/ORDEM_ORACULO_P0_MICROAUDITORIA_3_E_FECHAMENTO_FINAL_2026-09-15.md';

const canonicalInputsAvailable = [orderFile, priorDir, executiveDir].every(candidate => fs.existsSync(candidate));

test('composição canônica fecha 1.550 = 1.526 + 22 + 2 sem deduplicar SKU', { skip: !canonicalInputsAvailable }, () => {
  const input = executor.loadCanonicalInputs({ priorDir, executiveDir, orderFile });
  assert.equal(input.audit.length, 1550);
  assert.equal(new Set(input.audit.map(row => row.ml_item_id)).size, 1550);
  assert.equal(new Set(input.audit.map(row => row.sku)).size, 1549);
  assert.deepEqual(executor.stateCounts(input.audit, 'audited_state'), {
    SEM_CONFLITO: 1526,
    CONFLITO_CONFIRMADO: 22,
    PENDENCIA_VALIDACAO: 2,
  });
  assert.equal(input.audit.filter(row => row.population_source === 'P0_AUDITORIA_EXECUTIVA_179' && row.audited_state === 'SEM_CONFLITO').length, 155);
  assert.equal(input.audit.filter(row => row.population_source === 'P0_DRY_RUN_1550_ORIGINAL').length, 1371);
  assert.equal(input.audit.filter(row => row.sku === 'VTK009697').length, 2);
});

test('ator e locks são os autorizados pela ordem executiva', () => {
  assert.equal(executor.ACTOR_ID, '3e56ce48-f461-4784-848b-097d1e482a43');
  assert.deepEqual(executor.LOCK_DOMAINS, [
    'produtos:dslite_catalogo',
    'produtos:dslite_preco',
    'anuncios:ml_pull',
    'anuncios:ml_push',
  ]);
});

test('microauditoria autoriza apenas os três pares exatos de SKU, MLB e catálogo', () => {
  assert.deepEqual(Object.keys(executor.APPROVED_TITLE_DRIFTS).sort(), [
    'MLB5196468229',
    'MLB5196875175',
    'MLB7598571454',
  ]);
  assert.equal(executor.APPROVED_TITLE_DRIFTS.MLB5196875175.content_quality_flag, 'TITLE_REVIEW_REQUIRED');
});

test('title drift aprovado exige igualdade material fora dos títulos e âncoras vivas', () => {
  const row = { sku: 'VTK020218', ml_item_id: 'MLB7598571454', catalog_product_id: 'MLB7980691', audited_state: 'SEM_CONFLITO' };
  const prior = {
    evidence: JSON.stringify({ ml_item: { status: 'active' } }),
    local_listing: JSON.stringify({ status: 'ativo' }),
    catalog_snapshot: JSON.stringify({ status: 'active' }),
  };
  const base = {
    item_id: row.ml_item_id, seller_id: 3294514937, title: 'Intelbras Ts 5150 Preto 127/220v',
    catalog_listing: true, catalog_product_id: row.catalog_product_id, category_id: 'A', domain_id: 'B',
    seller_custom_field: row.sku, relations: [], item_attributes: {}, product_id: row.catalog_product_id,
    product_status: 'active', product_name: 'Telefone Sem Fio TS 5150 Intelbras',
    product_attributes: { BRAND: ['Intelbras'], MODEL: ['TS 5150'] },
    local_product: { id: 'p', sku: row.sku, name: 'Telefone Intelbras', brand: 'INTELBRAS', gtin: '789' },
    local_listing: { ml_item_id: row.ml_item_id, produto_id: 'p', sku: row.sku, title: 'Intelbras Ts 5150 Preto 127/220v', catalog_listing: true },
    catalog_snapshot: { ml_item_id: row.ml_item_id, seller_id: 3294514937, produto_id: 'p', sku_local: row.sku,
      seller_sku: row.sku, related_item_id: '', catalog_product_id: row.catalog_product_id, title: 'Intelbras Ts 5150 Preto 127/220v' },
  };
  const after = { ...base, title: 'Telefone sem fio Intelbras TS 5150',
    local_listing: { ...base.local_listing, title: 'Telefone sem fio Intelbras TS 5150' },
    catalog_snapshot: { ...base.catalog_snapshot, title: 'Telefone sem fio Intelbras TS 5150' } };
  const common = { row, prior, item: { id: row.ml_item_id, seller_id: 3294514937, title: after.title,
    status: 'active', catalog_product_id: row.catalog_product_id },
    listing: { sku: row.sku, status: 'ativo' }, snapshot: { seller_id: 3294514937, seller_sku: row.sku,
      status: 'active', catalog_product_id: row.catalog_product_id }, beforeMaterial: base, afterMaterial: after,
    sellerValid: true, catalogChanged: false };
  assert.equal(executor.approvedTitleDriftFor(common).approved, true);
  assert.equal(executor.approvedTitleDriftFor({ ...common, snapshot: { ...common.snapshot, seller_sku: 'OUTRO' } }).approved, false);
  assert.equal(executor.approvedTitleDriftFor({ ...common, afterMaterial: { ...after, local_product: { ...after.local_product, gtin: '000' } } }).approved, false);
  assert.equal(executor.approvedTitleDriftFor({ ...common, item: { ...common.item, title: 'Produto sem família 5150' } }).approved, false);
});

test('snapshot operacional ignora apenas a projeção de identidade esperada', () => {
  const source = {
    captured_at: 'a',
    products: { sha256: '1' },
    listings: { sha256: '2' },
    target_relations: { sha256: '3' },
    outbox: { sha256: '4' },
    identity: { sha256: 'before' },
  };
  const after = { ...source, captured_at: 'b', identity: { sha256: 'after' } };
  assert.deepEqual(executor.operationalSnapshot(source), executor.operationalSnapshot(after));
});

test('CLI exige SHAs e composição explícita', () => {
  const sha = 'a'.repeat(40);
  assert.equal(executor.parseArgs(['prepare', '--prior-dir', 'a', '--executive-dir', 'b', '--order', 'c', '--output-dir', 'd', '--release-sha', sha, '--release-base', sha]).mode, 'prepare');
  assert.throws(() => executor.parseArgs(['apply']), /usage:/);
  assert.throws(() => executor.parseArgs(['prepare', '--prior-dir', 'a', '--executive-dir', 'b', '--order', 'c', '--output-dir', 'd', '--release-sha', 'main', '--release-base', sha]), /release_sha_invalid/);
});

test('executor exige credencial PostgreSQL e não contém mutações Mercado Livre', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'catalog-identity-p0-production-closeout.js'), 'utf8');
  assert.match(source, /assertDatabaseCredentialGate/);
  assert.match(source, /BatchMode=yes/);
  assert.match(source, /hostname !== 'supabase-dev'/);
  assert.doesNotMatch(source, /fetch\([^\n]+method:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
  assert.match(source, /apply_ml_catalog_identity_projection_batch/);
  assert.match(source, /ml_catalog_identity_safety_snapshot/);
  assert.match(source, /READBACK_TITLE_DRIFT_EXECUTIVE_APPROVED/);
  assert.match(source, /price_changes:\s*0/);
  assert.match(source, /relinks:\s*0/);
  const sharedSource = fs.readFileSync(path.join(root, 'scripts', 'catalog-identity-p0-executive-179.js'), 'utf8');
  assert.match(sharedSource, /acquire_integracao_refresh_lock/);
  assert.match(sharedSource, /Number\(payload\?\.id\) !== SELLER_ID/);
  assert.doesNotMatch(sharedSource, /console\.(?:log|error)\([^\n]*(?:access_token|refresh_token)/);
});

test('migration de fechamento é transacional, limitada e sem escrita operacional', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260915110000_bnt_ml_catalog_identity_p0_closeout.sql'), 'utf8');
  assert.match(sql, /payload_count < 1 or payload_count > 25/);
  assert.match(sql, /order by value->>'ml_item_id'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /item_count <> 1550 or distinct_count <> 1550/);
  assert.match(sql, /grant execute[\s\S]+to service_role/);
  assert.doesNotMatch(sql, /update\s+public\.(?:produtos|anuncios_ml|catalogo_ml_snapshot)/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(?:produtos|anuncios_ml|catalogo_ml_snapshot)/i);
});
