const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const identity = require('../src/lib/catalog-identity.ts');
const catalog = require('../src/lib/catalogo/no-catalogo.ts');
const load = require('./helpers/load-integration-module');
const baselineParser = require('../src/lib/catalog-identity-import.ts');

function product(nome, extra = {}) {
  return { id: '00000000-0000-4000-8000-000000000001', sku: 'VTK000001', nome,
    descricao: '', marca: extra.marca || '', gtin: extra.gtin || '', ativo: true, ...extra };
}
function remote(title, extra = {}) {
  return { id: 'MLB100', title, name: title, seller_id: 1, seller_custom_field: 'VTK000001',
    catalog_product_id: 'MLB200', attributes: extra.attributes || [], price: extra.price || 100, ...extra };
}
function assess(localName, remoteName, extra = {}) {
  const local = product(localName, extra.local || {});
  const item = remote(remoteName, extra.item || {});
  const catalogProduct = remote(remoteName, extra.catalog || {});
  return identity.assessCatalogIdentity({ item, catalogProduct, localProduct: local,
    relatedListing: { sku: extra.relatedSku === undefined ? 'VTK000001' : extra.relatedSku },
    localOwners: [local.id], priceToWin: extra.priceToWin ?? 40, currentPrice: extra.currentPrice ?? 100,
    liveAvailable: extra.liveAvailable !== false });
}

for (const [label, local, remoteName, conflict] of [
  ['TP-Link', 'Roteador TP-Link Archer WiFi AX50 AX3000 Giga', 'TP-Link Archer EX1500 V1', 'MODEL'],
  ['Hiksemi', 'SSD Hiksemi Wave 120GB 2,5 SATA 3', 'SSD Hiksemi Wave 1.92 TB', 'CAPACITY'],
  ['Santo Angelo', 'Rolo de cabo de microfone Santo Angelo 100 m', 'Cabo adaptador de áudio P2 P10 3 m', 'LENGTH'],
  ['Panasonic', '192 Pilhas Alcalinas AA Panasonic', '192 Pilhas Alcalinas AAA Panasonic', 'BATTERY_TYPE'],
  ['Leson', 'Microfone Leson MC-200', 'Globo de Microfone Le Son Reposição', 'PRODUCT_FAMILY'],
  ['Elgin', 'Bateria Alcalina A23 Elgin', 'Bateria Alcalina A27 Elgin', 'BATTERY_TYPE'],
]) test(`confirma incompatibilidade material ${label}`, () => {
  const result = assess(local, remoteName, { currentPrice: 1_000, priceToWin: 100 });
  assert.equal(result.identityState, 'CONFLITO_CONFIRMADO', JSON.stringify(result.comparisons));
  assert.match(result.conflictType, new RegExp(conflict));
  assert.equal(result.blockPriceWrite, true);
  assert.equal(result.riskTier, 'CRITICO');
});

test('normaliza modelo com pontuação sem fabricar conflito', () => {
  const result = assess('Microfone Leson MC-200', 'Microfone Leson MC200');
  assert.equal(result.comparisons.find(row => row.field === 'MODEL').status, 'match');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('compara dimensão estruturada e registra variante de cor sem usá-la isoladamente como prova', () => {
  const dimensionResult = assess('SSD SATA 2,5" VTK000001', 'SSD SATA 3,5" VTK000001');
  assert.equal(dimensionResult.identityState, 'CONFLITO_CONFIRMADO');
  assert.match(dimensionResult.conflictType, /DIMENSION/);

  const colorResult = assess('Cabo HDMI preto VTK000001', 'Cabo HDMI branco VTK000001');
  assert.equal(colorResult.comparisons.find(row => row.field === 'COLOR_VARIANT').status, 'conflict');
  assert.notEqual(colorResult.identityState, 'CONFLITO_CONFIRMADO');
});

test('gap econômico isolado somente prioriza e não confirma conflito', () => {
  const result = assess('SSD Hiksemi Wave 120GB', 'SSD Hiksemi Wave 120 GB', {
    local: { marca: 'Hiksemi', gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'BRAND', value_name: 'Hiksemi' }, { id: 'GTIN', value_name: '7891234567895' }] },
    currentPrice: 1_000, priceToWin: 50,
  });
  assert.equal(result.identityState, 'SEM_CONFLITO', JSON.stringify(result.comparisons));
  assert.equal(result.riskTier, 'ALTO');
});

test('GTIN sem SKU ou segunda âncora não encerra identidade', () => {
  const result = assess('Produto genérico', 'Produto genérico', {
    local: { gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'GTIN', value_name: '7891234567895' }] },
    relatedSku: null,
    item: { seller_custom_field: null },
  });
  assert.equal(result.identityState, 'PENDENCIA_VALIDACAO');
  assert.equal(result.blockBuyBoxChase, true);
});

test('fonte ML indisponível gera motivo específico e bloqueia preço', () => {
  const result = assess('SSD 120GB', 'SSD 120GB', { liveAvailable: false });
  assert.equal(result.identityState, 'INCONCLUSIVO');
  assert.equal(result.reasonCode, 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
  assert.equal(result.blockPriceWrite, true);
});

test('resolver de catálogo nunca cria vínculo usando somente GTIN', () => {
  assert.deepEqual(catalog.resolveCatalogLocalProduct({
    gtinProduct: { id: 'p1', sku: 'VTK000001' }, fallbackSku: 'VTK000001',
  }), { produtoId: null, sku: 'VTK000001', source: 'none' });
});

test('guard preserva entrada manual e consulta banco para price_to_win', async () => {
  let calls = 0;
  const guard = load('src/services/catalog-identity-guard.ts');
  const client = { rpc: async () => { calls += 1; return { error: null }; } };
  await guard.assertCatalogIdentityPriceGuard(client, { sellerId: 1, itemId: 'MLB1', targetOrigin: 'manual_input' });
  assert.equal(calls, 0);
  await guard.assertCatalogIdentityPriceGuard(client, { sellerId: 1, itemId: 'MLB1', targetOrigin: 'price_to_win' });
  assert.equal(calls, 1);
  await assert.rejects(guard.assertCatalogIdentityPriceGuard({ rpc: async () => ({ error: {} }) },
    { sellerId: 1, itemId: 'MLB1', targetOrigin: 'rule' }), /ml_identity_price_write_blocked/);
});

test('migration contém ledger, RLS, invalidação e guard final da outbox', () => {
  const sql = fs.readFileSync('supabase/migrations/20260914180000_bnt_ml_catalog_identity_01.sql', 'utf8');
  for (const table of ['ml_catalog_identity_runs','ml_catalog_identity_audits','ml_catalog_identity_current','ml_catalog_identity_actions']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /trg_ml_catalog_identity_outbox_guard/);
  assert.match(sql, /trg_invalidate_ml_catalog_identity/);
  assert.match(sql, /claim_ml_catalog_identity_audit_batch/);
  assert.match(sql, /for update skip locked/i);
  assert.doesNotMatch(sql, /update\s+public\.produtos/i);
  assert.doesNotMatch(sql, /grant all on table/i);
});

test('interface e APIs deixam correção separada do dry-run', () => {
  const ui = fs.readFileSync('src/components/catalogo/CatalogIdentityAuditView.tsx', 'utf8');
  assert.match(ui, /Saneamento de identidade do catálogo/);
  assert.match(ui, /Aprovar manifesto/);
  assert.match(ui, /Nenhuma correção foi executada automaticamente/);
  assert.doesNotMatch(ui, /Aplicar correções/);
  const exports = fs.readFileSync('src/lib/catalog-identity-exports.ts', 'utf8');
  for (let index = 1; index <= 10; index += 1) assert.match(exports, new RegExp(`'${String(index).padStart(2, '0')}_`));
});

test('importador aceita CSV de 1.550 IDs, preserva vírgula decimal e rejeita duplicidade', async () => {
  const lines = ['ml_item_id;sku;preco'];
  for (let index = 1; index <= 1_550; index += 1) lines.push(`MLB${index};VTK${String(index).padStart(6, '0')};1,99`);
  const parsed = await baselineParser.parseCatalogIdentityBaseline('catalogo.csv', Buffer.from(lines.join('\n')));
  assert.equal(parsed.length, 1_550);
  assert.equal(parsed[0].inputRow.preco, '1,99');
  lines[lines.length - 1] = lines[1];
  await assert.rejects(baselineParser.parseCatalogIdentityBaseline('catalogo.csv', Buffer.from(lines.join('\n'))),
    /baseline_requires_1550_unique_items/);
});

test('importador aceita a primeira planilha XLSX e exige coluna de item', async () => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catálogo');
  sheet.addRow(['ML Item ID', 'SKU']);
  for (let index = 1; index <= 1_550; index += 1) sheet.addRow([`MLB${index}`, `VTK${String(index).padStart(6, '0')}`]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await baselineParser.parseCatalogIdentityBaseline('catalogo.xlsx', buffer);
  assert.equal(parsed.at(-1).mlItemId, 'MLB1550');
});
