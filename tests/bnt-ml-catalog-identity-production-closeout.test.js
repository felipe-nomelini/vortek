const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const executor = require('../scripts/catalog-identity-p0-production-closeout.js');

const root = path.join(__dirname, '..');
const priorDir = path.join(root, 'reports', 'catalog-identity-p0', 'BNT-ML-CATALOG-IDENTITY-01-2026-09-15-readonly-final');
const executiveDir = path.join(root, 'reports', 'catalog-identity-p0', 'BNT-ML-CATALOG-IDENTITY-01-2026-09-15-executive-179');
const orderFile = '/mnt/c/Users/Bentevi Tecnologia/Downloads/ORDEM_ORACULO_BNT_ML_CATALOG_IDENTITY_P0_FECHAMENTO_PRODUTIVO_2026-09-15.md';

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
  assert.match(source, /if \(!process\.env\.SUPABASE_DB_URL\) throw new Error\('BLOCKED_CREDENTIAL'\)/);
  assert.doesNotMatch(source, /fetch\([^\n]+method:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
  assert.match(source, /apply_ml_catalog_identity_projection_batch/);
  assert.match(source, /ml_catalog_identity_safety_snapshot/);
  assert.match(source, /price_changes:\s*0/);
  assert.match(source, /relinks:\s*0/);
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
