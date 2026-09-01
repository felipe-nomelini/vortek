const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('webhook Brasil NFe valida corpo bruto, assinatura, replay e destino', () => {
  const route = read('src/app/api/webhooks/brasilnfe/route.ts');
  const migration = read('supabase/migrations/20260901213000_bnt_d05_incoming_invoices.sql');
  assert.match(route, /request\.text\(\)/);
  assert.match(route, /createHmac\('sha256'/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /2 \* 60 \* 60 \* 1000/);
  assert.match(route, /p_expected_recipient_cnpj/);
  assert.match(migration, /delivery_id text primary key/);
  assert.match(migration, /return 'duplicado'/);
  assert.match(migration, /v_model <> 55/);
  assert.doesNotMatch(migration, /raw_payload|payload_raw|body_raw/);
});

test('NF-e de entrada oferece quatro manifestações com confirmação e proteção da amostra', () => {
  const route = read('src/app/api/notas-fiscais/entradas/[id]/manifestacoes/route.ts');
  const service = read('src/lib/fiscal/incoming-nfe.ts');
  const panel = read('src/components/fiscal/IncomingInvoicesPanel.tsx');
  assert.match(route, /z\.literal\(1\)/);
  assert.match(route, /z\.literal\(4\)/);
  assert.match(route, /confirmar: z\.literal\(true\)/);
  assert.match(route, /justificativa\.length < 15/);
  assert.match(service, /homologation_fixture_read_only/);
  assert.match(service, /idempotency_key/);
  assert.match(service, /status: 'desconhecido'/);
  assert.match(panel, /Confirmação da operação/);
  assert.match(panel, /Operação não realizada/);
});

test('amostras BNT-D05 são persistidas e inertes no ledger operacional', () => {
  const migration = read('supabase/migrations/20260901213000_bnt_d05_incoming_invoices.sql');
  const seed = read('scripts/seed-bnt-d05-inventory-fixtures.js');
  const stockApi = read('src/app/api/estoque/route.ts');
  assert.match(migration, /snapshot_source <> 'bnt_d05_inventory_mock'[\s\S]*estornada_em is not null/);
  assert.match(migration, /homologation_fixture_read_only/);
  assert.match(seed, /192\.168\.1\.162/);
  assert.doesNotMatch(seed, /192\.168\.1\.160/);
  assert.match(seed, /Criadas 9 NF-e de entrada e 5 posições visuais protegidas/);
  assert.match(stockApi, /is_homologation_fixture: true/);
});

test('Notas Fiscais inclui aba de entrada com resumo, documentos e recebimento', () => {
  const page = read('src/app/(app)/notas-fiscais/page.tsx');
  const panel = read('src/components/fiscal/IncomingInvoicesPanel.tsx');
  assert.match(page, /key: 'incoming'/);
  assert.match(page, /NF-e de entrada/);
  assert.match(panel, /Valor total/);
  assert.match(panel, /Aguardando XML\/recebimento/);
  assert.match(panel, /ReceiveNfeModal/);
  assert.match(panel, /Baixar XML/);
  assert.match(panel, /Abrir DANFE/);
});
