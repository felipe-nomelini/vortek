const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildBrasilNfeIdentifierLookupPayload,
  classifyBrasilNfeIdentifierLookupResponse,
  resolveBrasilNfeInternalIdentifier,
  selectBrasilNfeNoteByInternalIdentifier,
} = require('../src/lib/fiscal/brasil-nfe-identifier.ts');
const {
  isBrasilNfeAutomaticReconciliationEligible,
} = require('../src/lib/fiscal/nfe-status.ts');

test('ignora nota mais recente de outro pedido', () => {
  const selected = selectBrasilNfeNoteByInternalIdentifier([
    { IdentificadorInterno: 'VORTEK-200', Chave: 'chave-errada', DtEmissao: '2026-08-03T12:00:00Z' },
    { IdentificadorInterno: 'VORTEK-100', Chave: 'chave-certa', DtEmissao: '2026-08-01T12:00:00Z' },
  ], 'VORTEK-100');
  assert.equal(selected?.Chave, 'chave-certa');
});

test('não aceita resposta sem identificador exato', () => {
  const selected = selectBrasilNfeNoteByInternalIdentifier([
    { IdentificadorInterno: 'VORTEK-200', Chave: 'chave-errada' },
  ], 'VORTEK-100');
  assert.equal(selected, null);
});

test('usa identificador do pack para carrinho com múltiplas orders', () => {
  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '2000017675239822',
    mlPackId: '2000014280061837',
    mlBundleType: 'cart',
  }), 'VORTEK-PACK-2000014280061837');
});

test('usa identificador do kit virtual e preserva override explícito', () => {
  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '200',
    mlPackId: '300',
    mlBundleType: 'virtual_kit',
  }), 'VORTEK-KIT-300');

  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '200',
    mlPackId: '300',
    mlBundleType: 'cart',
    identifierOverride: 'VORTEK-CUSTOM-1',
  }), 'VORTEK-CUSTOM-1');
});

test('mantém identificador por order fora de grupo operacional', () => {
  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '200001',
    mlPackId: '300001',
    mlBundleType: null,
  }), 'VORTEK-200001');
});

test('consulta usa o contrato oficial ObterNotasFiscais e IdentificadorInterno', () => {
  const payload = buildBrasilNfeIdentifierLookupPayload({
    identificadorInterno: 'VORTEK-100',
    dtInicio: '2026-08-01T00:00:00Z',
    dtFim: '2026-08-30T00:00:00Z',
  });
  assert.equal(payload.IdentificadorInterno, 'VORTEK-100');
  assert.equal('IndentificadorInterno' in payload, false);

  const providerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/services/fiscal-provider.ts'),
    'utf8',
  );
  const lookupStart = providerSource.indexOf(
    'export async function buscarNotaBrasilNfePorIdentificadorInterno',
  );
  const lookupEnd = providerSource.indexOf(
    'export async function obterXmlBrasilNfePorChave',
    lookupStart,
  );
  const lookupSource = providerSource.slice(lookupStart, lookupEnd);
  assert.match(lookupSource, /consultas\.obterNotasFiscais/);
  assert.doesNotMatch(lookupSource, /consultas\.buscarNotaFiscal/);
  assert.doesNotMatch(lookupSource, /IndentificadorInterno/);
});

test('resposta válida vazia ou sem correspondência exata é terminal', () => {
  assert.equal(classifyBrasilNfeIdentifierLookupResponse({
    response: { Notas: [], Error: null },
    identificadorInterno: 'VORTEK-100',
  }).kind, 'not_found');

  assert.equal(classifyBrasilNfeIdentifierLookupResponse({
    response: {
      Notas: [{ IdentificadorInterno: 'VORTEK-200', Chave: 'chave-200' }],
      Error: null,
    },
    identificadorInterno: 'VORTEK-100',
  }).kind, 'not_found');
});

test('erro do provedor ou nota exata sem chave permanece transitório', () => {
  assert.equal(classifyBrasilNfeIdentifierLookupResponse({
    response: { Notas: [], Error: 'Serviço indisponível' },
    identificadorInterno: 'VORTEK-100',
  }).kind, 'transient_error');

  assert.equal(classifyBrasilNfeIdentifierLookupResponse({
    response: {
      Notas: [{ IdentificadorInterno: 'VORTEK-100', Chave: '' }],
      Error: null,
    },
    identificadorInterno: 'VORTEK-100',
  }).kind, 'transient_error');
});

test('not_found terminal sai do ciclo e mudança real reabre elegibilidade', () => {
  assert.equal(isBrasilNfeAutomaticReconciliationEligible('not_found'), false);
  assert.equal(isBrasilNfeAutomaticReconciliationEligible('processing'), true);
  assert.equal(isBrasilNfeAutomaticReconciliationEligible(null), true);

  const routeSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../src/app/api/sync/nf/reconciliar-brasilnfe/route.ts',
    ),
    'utf8',
  );
  assert.match(
    routeSource,
    /nfe_status\.is\.null,nfe_status\.neq\.\$\{BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS\}/,
  );
  assert.match(routeSource, /terminalNotFound/);
});

test('correspondência exata preserva a chave encontrada', () => {
  const result = classifyBrasilNfeIdentifierLookupResponse({
    response: {
      Notas: [{
        IdentificadorInterno: 'VORTEK-100',
        Chave: 'chave-ja-vinculada',
        Status: 1,
      }],
      Error: null,
    },
    identificadorInterno: 'VORTEK-100',
  });
  assert.equal(result.kind, 'found');
  assert.equal(result.nota.Chave, 'chave-ja-vinculada');
});
