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

for (const [label, local, remoteName, conflict, extra] of [
  ['TP-Link', 'Roteador TP-Link Archer WiFi AX50 AX3000 Giga', 'TP-Link Archer EX1500 V1', 'MODEL',
    { catalog: { attributes: [{ id: 'MODEL', value_name: 'EX1500' }] } }],
  ['Hiksemi', 'SSD Hiksemi Wave 120GB 2,5 SATA 3', 'SSD Hiksemi Wave 1.92 TB', 'CAPACITY'],
  ['Santo Angelo', 'Rolo de cabo de microfone Santo Angelo 100 m', 'Cabo adaptador de áudio P2 P10 3 m', 'LENGTH'],
  ['Panasonic', '192 Pilhas Alcalinas AA Panasonic', '192 Pilhas Alcalinas AAA Panasonic', 'BATTERY_TYPE'],
  ['Leson', 'Microfone Leson MC-200', 'Globo de Microfone Le Son Reposição', 'PRODUCT_FAMILY'],
  ['Elgin', 'Bateria Alcalina A23 Elgin', 'Bateria Alcalina A27 Elgin', 'BATTERY_TYPE'],
]) test(`confirma incompatibilidade material ${label}`, () => {
  const result = assess(local, remoteName, { currentPrice: 1_000, priceToWin: 100, ...(extra || {}) });
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

test('normaliza modelo separado por espaço e ignora SKU como modelo', () => {
  const result = assess('Trombone New York TB 200VR', 'Trombone New York TB-200VR', {
    item: { seller_custom_field: 'VTK000001' },
  });
  assert.equal(result.comparisons.find(row => row.field === 'MODEL').status, 'match');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('prefixo de marca no modelo não fabrica conflito', () => {
  const result = assess('Alto-falante 15WP550', 'Alto-falante JBL15WP550');
  assert.equal(result.comparisons.find(row => row.field === 'MODEL').status, 'match');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('sufixo separado do modelo é normalizado', () => {
  const result = assess('Controle remoto STV-3000PLUS', 'Controle remoto STV-3000 Plus');
  assert.equal(result.comparisons.find(row => row.field === 'MODEL').status, 'match');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('divergência fraca de modelo vira pendência, não conflito confirmado', () => {
  const result = assess('Produto GV2', 'Produto DE2008');
  assert.equal(result.comparisons.find(row => row.field === 'MODEL').status, 'missing');
  assert.equal(result.identityState, 'PENDENCIA_VALIDACAO');
  assert.equal(result.reasonCode, 'DIVERGENCIA_MODELO_NAO_CONCLUSIVA');
});

test('descrição com código incidental não fabrica divergência de modelo', () => {
  const local = product('Telefone Intelbras CFA 4211', { descricao: 'Compatível com SUP2 e bateria 200H' });
  const item = remote('Telefone Intelbras CFA-4211');
  const result = identity.assessCatalogIdentity({ item, catalogProduct: item, localProduct: local,
    relatedListing: { sku: 'VTK000001' }, localOwners: [local.id], priceToWin: 90,
    currentPrice: 100, liveAvailable: true });
  assert.equal(result.comparisons.find(row => row.field === 'MODEL').status, 'match');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('quantidade e interface técnica não são tratadas como modelo', () => {
  const result = assess('Bateria A23 Elgin cartela com 05 unidades', 'Bateria A23 Elgin pack 5 unidades', {
    local: { marca: 'Elgin', gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'BRAND', value_name: 'Elgin' }, { id: 'GTIN', value_name: '7891234567895' }] },
  });
  assert.equal(result.comparisons.some(row => row.field === 'MODEL'), false);
  assert.equal(result.identityState, 'SEM_CONFLITO');
});

test('atributo MODEL genérico não contradiz títulos e âncoras coerentes', () => {
  const result = assess('Escaleta Melódica 27 Teclas Azul New York', 'Escaleta Melodica 27 Teclas Azul New York', {
    local: { marca: 'New York', gtin: '7898705601850' },
    catalog: { attributes: [
      { id: 'BRAND', value_name: 'New York' },
      { id: 'GTIN', value_name: '7898705601850' },
      { id: 'MODEL', value_name: '27 teclas' },
    ] },
  });
  assert.equal(result.comparisons.some(row => row.field === 'MODEL'), false);
  assert.equal(result.identityState, 'SEM_CONFLITO');
});

test('palavra comercial seguida de número não é inferida como modelo', () => {
  const result = assess('Cabo Technoise Vermelho 9 mm Rolo 50 Metros', 'Cabo Technoise Vermelho 9 mm 50 Metros', {
    local: { marca: 'Technoise', gtin: '7898530519368' },
    catalog: { attributes: [
      { id: 'BRAND', value_name: 'Technoise' },
      { id: 'GTIN', value_name: '7898530519368' },
      { id: 'MODEL', value_name: 'Diametro 9mm 50 metros' },
    ] },
  });
  assert.equal(result.comparisons.some(row => row.field === 'MODEL'), false);
  assert.equal(result.identityState, 'SEM_CONFLITO');
});

test('mesma família alfabética com número diferente confirma modelo incompatível', () => {
  const result = assess('Serra Multi FE046 127v', 'Serra Multi FE047 127v');
  assert.equal(result.comparisons.find(row => row.field === 'MODEL').status, 'conflict');
  assert.equal(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('127/220 V é normalizado como bivolt', () => {
  const result = assess('Ventilador bivolt', 'Ventilador 127/220 V', {
    local: { marca: 'Ventisol', gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'BRAND', value_name: 'Ventisol' }, { id: 'GTIN', value_name: '7891234567895' }] },
  });
  assert.equal(result.comparisons.find(row => row.field === 'VOLTAGE').status, 'match');
  assert.equal(result.identityState, 'SEM_CONFLITO');
});

test('110 V e 127 V são tratados como a mesma faixa nominal', () => {
  const result = assess('Mesa de som 110 V', 'Mesa de som 127 V');
  assert.equal(result.comparisons.find(row => row.field === 'VOLTAGE').status, 'match');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('cabo de microfone permanece na família de cabos', () => {
  const result = assess('Cabo para microfone XLR 3 metros', 'Cabo de microfone XLR 3m', {
    local: { marca: 'Santo Angelo', gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'BRAND', value_name: 'Santo Angelo' }, { id: 'GTIN', value_name: '7891234567895' }] },
  });
  assert.equal(result.comparisons.find(row => row.field === 'PRODUCT_FAMILY').status, 'match');
  assert.equal(result.identityState, 'SEM_CONFLITO');
});

test('microfone acompanhado de cabo permanece microfone', () => {
  const result = assess('Microfone profissional com cabo 3 metros', 'Microfone dinâmico com cabo', {
    local: { marca: 'MXT', gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'BRAND', value_name: 'MXT' }, { id: 'GTIN', value_name: '7891234567895' }] },
  });
  assert.equal(result.comparisons.find(row => row.field === 'PRODUCT_FAMILY').status, 'match');
  assert.equal(result.identityState, 'SEM_CONFLITO');
});

test('suporte citado como acessório de instrumento não fabrica família incompatível', () => {
  const result = assess('Suporte para microfone de bateria Ask B10', 'Microfone de bateria e percussão clamp Ask B10');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('comprimento tolera arredondamento e ignora bitola em milímetros', () => {
  const rounded = assess('Cabo XLR 91 cm', 'Cabo XLR 0,9 m', {
    local: { marca: 'Santo Angelo', gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'BRAND', value_name: 'Santo Angelo' }, { id: 'GTIN', value_name: '7891234567895' }] },
  });
  assert.equal(rounded.comparisons.find(row => row.field === 'LENGTH').status, 'match');
  const gauge = assess('Cabo 2x1,50 mm rolo 100 metros', 'Cabo 2x1,5mm rolo 100mt', {
    local: { marca: 'Technoise', gtin: '7891234567895' },
    catalog: { attributes: [{ id: 'BRAND', value_name: 'Technoise' }, { id: 'GTIN', value_name: '7891234567895' }] },
  });
  assert.equal(gauge.comparisons.find(row => row.field === 'LENGTH').status, 'match');
  assert.equal(gauge.identityState, 'SEM_CONFLITO');
});

test('dimensões de naturezas distintas não confirmam conflito', () => {
  const result = assess('Mini Rack 5 x 350 mm', 'Mini Rack 19 polegadas');
  assert.equal(result.comparisons.find(row => row.field === 'DIMENSION').status, 'missing');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('medida nominal em polegadas tolera diferença inferior a uma polegada', () => {
  const result = assess('Alto-falante 6-3/4"', 'Alto-falante 6 polegadas');
  assert.equal(result.comparisons.find(row => row.field === 'DIMENSION').status, 'match');
  assert.notEqual(result.identityState, 'CONFLITO_CONFIRMADO');
});

test('divergência do título do item não é ocultada por catálogo coerente', () => {
  const local = product('SSD Hiksemi Wave 120GB', { marca: 'Hiksemi' });
  const item = remote('Hiksemi Wave 1.92 TB', { seller_custom_field: 'VTK000001' });
  const catalogProduct = remote('SSD Hiksemi Wave 120GB', {
    attributes: [{ id: 'BRAND', value_name: 'Hiksemi' }],
  });
  const result = identity.assessCatalogIdentity({ item, catalogProduct, localProduct: local,
    relatedListing: { sku: 'VTK000001' }, localOwners: [local.id], priceToWin: 90,
    currentPrice: 100, liveAvailable: true });
  assert.equal(result.identityState, 'CONFLITO_CONFIRMADO');
  assert.match(result.conflictType, /CAPACITY/);
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
