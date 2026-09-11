const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/reclamacoes/page.tsx');
const styles = read('src/app/(app)/reclamacoes/reclamacoes.module.css');
const listRoute = read('src/app/api/ml/reclamacoes/route.ts');
const detailRoute = read('src/app/api/ml/reclamacoes/[id]/route.ts');
const claims = read('src/lib/ml/claims.ts');
const visualReview = read('src/lib/ml/claims-visual-review.ts');

const claimDomain = load('src/lib/ml/claims.ts', {
  '@/lib/timezone': { BUSINESS_TIME_ZONE: 'America/Sao_Paulo' },
});

function claimsRouteHarness(options = {}) {
  const searchPaths = [];
  const claim = {
    id: 5000000001,
    resource_id: 2000000000000001,
    resource: 'order',
    status: 'opened',
    type: 'mediations',
    stage: 'claim',
    reason_id: 'PDD1',
    players: [{ role: 'respondent', type: 'seller', user_id: 123456789, available_actions: [] }],
    date_created: '2026-09-11T10:00:00.000-03:00',
    last_updated: '2026-09-11T11:00:00.000-03:00',
  };
  const failure = {
    ok: false,
    status: 400,
    data: null,
    error: { status: 400, code: 'bad_request_error', message: 'invalid parameters', category: 'error', traceId: null },
  };
  const route = load('src/app/api/ml/reclamacoes/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: 'test-user' }) },
    '@/lib/ml/claims': claimDomain,
    '@/lib/ml/claims-visual-review': { loadClaimsVisualReview: async () => null, visualReviewMeta: () => null },
    '@/lib/supabase': {
      createServiceClient: () => ({
        from: (table) => ({
          select: () => ({
            in: async () => ({
              data: table === 'pedidos'
                ? [{ ml_order_id: String(claim.resource_id), contato_nome: 'Cliente', buyer_ml_id: '1' }]
                : [{ ml_order_id: String(claim.resource_id), ml_item_id: 'MLB1', titulo: 'Produto', quantidade: 1 }],
              error: null,
            }),
          }),
        }),
      }),
    },
    '@/lib/timezone': {
      saoPauloDayBounds: () => ({
        start: new Date('2026-09-11T03:00:00.000Z'),
        end: new Date('2026-09-12T02:59:59.999Z'),
      }),
    },
    '@/services/integration': {
      getMLConnectionStatus: async () => ({ conectado: true, precisaReconectar: false }),
      fetchMLResult: async (requestPath) => {
        if (requestPath === '/users/me') return { ok: true, status: 200, data: { id: 123456789 }, error: null };
        if (requestPath.endsWith('/detail')) {
          return { ok: true, status: 200, data: { action_responsible: 'seller', due_date: null }, error: null };
        }
        if (requestPath.startsWith('/post-purchase/v1/claims/search?')) {
          searchPaths.push(requestPath);
          if (options.searchFailure) return failure;
          const params = new URL(requestPath, 'https://api.mercadolibre.com').searchParams;
          const isMainList = params.get('limit') === '30';
          const isEmpty = Boolean(options.empty);
          return {
            ok: true,
            status: 200,
            data: {
              paging: { total: isEmpty ? 0 : 1, offset: 0, limit: Number(params.get('limit')) },
              data: isMainList && !isEmpty ? [claim] : [],
            },
            error: null,
          };
        }
        throw new Error(`Unexpected ML request: ${requestPath}`);
      },
    },
  });
  return {
    searchPaths,
    get: (query = '') => route.GET(new Request(`http://test/api/ml/reclamacoes${query}`)),
  };
}

test('BNT-D19 apresenta uma fila orientada por prioridade e prazo', () => {
  for (const column of [
    'Prioridade',
    'Reclamação / venda',
    'Contexto',
    'Motivo',
    'Andamento',
    'Responsável / prazo',
    'Atualização',
    'Ações',
  ]) {
    assert.match(page, new RegExp(column.replace('/', '\\/')));
  }
  for (const priority of ['Prazo vencido', 'Vence hoje', 'Sua ação', 'Aguardando', 'Concluída']) {
    assert.match(page, new RegExp(priority));
  }
  assert.match(listRoute, /sort\(compareClaimPriority\)/);
  assert.match(styles, /\.summaryBand[\s\S]*grid-template-columns/);
});

test('BNT-D19 mantém filtros operacionais sem polling automático', () => {
  assert.match(page, /ID da reclamação ou da venda/);
  assert.match(page, /Todas as situações/);
  assert.match(page, /Todos os tipos/);
  assert.match(page, /Todas as etapas/);
  assert.match(page, /Atualizar/);
  assert.doesNotMatch(page, /setInterval|setTimeout/);
});

test('detalhe usa carregamento progressivo e separa visão, conversa e histórico', () => {
  assert.match(page, /\/api\/ml\/reclamacoes\/\$\{encodeURIComponent\(claim\.id\)\}/);
  assert.match(page, /Visão geral/);
  assert.match(page, /Conversa \(\$\{detail\.messages\.length\}\)/);
  assert.match(page, /Histórico/);
  assert.match(page, /Ações disponíveis no Mercado Livre/);
  assert.match(page, /A execução permanece no Mercado Livre/);
  assert.doesNotMatch(page, /fetch\([^\n]+method:\s*'POST'/);
});

test('lista consulta claims do vendedor respondente e não deriva de pedidos recentes', () => {
  assert.match(listRoute, /authorizeApiRequest\(request, 'sales\.read'\)/);
  assert.match(listRoute, /\/post-purchase\/v1\/claims\/search/);
  assert.match(listRoute, /player_user_id: sellerId/);
  assert.match(listRoute, /player_role: 'respondent'/);
  assert.doesNotMatch(listRoute, /['"]players\.(?:user_id|role)['"]/);
  assert.match(listRoute, /resource: 'order'/);
  assert.match(listRoute, /limit: filters\.pageSize/);
  assert.match(listRoute, /runPool\(pageClaims, 5/);
  assert.doesNotMatch(listRoute, /orders\/search/);
  assert.match(listRoute, /'Cache-Control': 'no-store'/);
});

test('rota envia o contrato aceito pela busca produtiva de reclamações', async () => {
  const harness = claimsRouteHarness();
  const response = await harness.get();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.paging.total, 1);
  assert.ok(harness.searchPaths.length >= 4);
  for (const requestPath of harness.searchPaths) {
    const params = new URL(requestPath, 'https://api.mercadolibre.com').searchParams;
    assert.equal(params.get('player_user_id'), '123456789');
    assert.equal(params.get('player_role'), 'respondent');
    assert.equal(params.get('resource'), 'order');
    assert.equal(params.has('players.user_id'), false);
    assert.equal(params.has('players.role'), false);
  }
});

test('rota preserva filtros, paginação e buscas por reclamação ou venda', async () => {
  const filtered = claimsRouteHarness();
  assert.equal((await filtered.get('?page=2&pageSize=50&status=closed&type=return&stage=dispute')).status, 200);
  const filteredPath = filtered.searchPaths.find((requestPath) => {
    const params = new URL(requestPath, 'https://api.mercadolibre.com').searchParams;
    return params.get('offset') === '50' && params.get('limit') === '50';
  });
  assert.ok(filteredPath);
  const filteredParams = new URL(filteredPath, 'https://api.mercadolibre.com').searchParams;
  assert.equal(filteredParams.get('status'), 'closed');
  assert.equal(filteredParams.get('type'), 'return');
  assert.equal(filteredParams.get('stage'), 'dispute');

  const searched = claimsRouteHarness();
  assert.equal((await searched.get('?status=all&search=5000000001')).status, 200);
  const searchParams = searched.searchPaths.map((requestPath) => (
    new URL(requestPath, 'https://api.mercadolibre.com').searchParams
  ));
  assert.ok(searchParams.some((params) => params.get('id') === '5000000001'));
  assert.ok(searchParams.some((params) => params.get('order_id') === '5000000001'));
  for (const params of searchParams.filter((candidate) => candidate.has('id') || candidate.has('order_id'))) {
    assert.equal(params.has('status'), false);
    assert.equal(params.get('player_user_id'), '123456789');
    assert.equal(params.get('player_role'), 'respondent');
  }
});

test('rota diferencia fila vazia de falha na consulta externa', async () => {
  const emptyResponse = await claimsRouteHarness({ empty: true }).get();
  const emptyPayload = await emptyResponse.json();
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(emptyPayload.items, []);
  assert.equal(emptyPayload.erro, undefined);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const failedResponse = await claimsRouteHarness({ searchFailure: true }).get();
    const failedPayload = await failedResponse.json();
    assert.equal(failedResponse.status, 502);
    assert.equal(failedPayload.items.length, 0);
    assert.equal(failedPayload.erro, 'Não foi possível consultar as reclamações no Mercado Livre.');
  } finally {
    console.warn = originalWarn;
  }
});

test('busca numérica cobre id da reclamação e id da venda', () => {
  assert.match(listRoute, /id: filters\.search/);
  assert.match(listRoute, /orderId: filters\.search/);
  assert.match(listRoute, /uniqueClaims = new Map/);
  assert.match(listRoute, /Busque usando somente o número/);
});

test('detalhe valida pertencimento antes de expor o caso', () => {
  assert.match(detailRoute, /authorizeApiRequest\(request, 'sales\.read'\)/);
  assert.match(detailRoute, /fetchMLResult<Record<string, unknown>>\('\/users\/me'\)/);
  assert.match(detailRoute, /player\.role === 'respondent'/);
  assert.match(detailRoute, /rawClaim\.resource !== 'order'/);
  assert.match(detailRoute, /não pertence às vendas do vendedor conectado/);
});

test('detalhe consulta as seções oficiais somente quando o usuário abre o caso', () => {
  for (const resource of [
    '/detail',
    '/messages',
    '/actions-history',
    '/status-history',
    '/affects-reputation',
  ]) {
    assert.match(detailRoute, new RegExp(resource.replace('/', '\\/')));
  }
  assert.match(detailRoute, /\/post-purchase\/v1\/claims\/reasons/);
  assert.match(detailRoute, /unavailable_sections/);
});

test('prioridade considera estado, responsável, prazo e fuso do negócio', () => {
  assert.match(claims, /BUSINESS_TIME_ZONE/);
  assert.match(claims, /status === 'closed'[\s\S]*return 'closed'/);
  assert.match(claims, /responsible !== 'seller'[\s\S]*return 'waiting'/);
  assert.match(claims, /due\.getTime\(\) < now\.getTime\(\)[\s\S]*return 'overdue'/);
  assert.match(claims, /dateKey\(due\) === dateKey\(now\)[\s\S]*return 'due_today'/);
  assert.match(claims, /PRIORITY_WEIGHT/);
});

test('amostra visual é sintética, temporária e bloqueia identificadores reais', () => {
  assert.match(visualReview, /EXPECTED_SOURCE = 'official-contract-synthetic'/);
  assert.match(visualReview, /Date\.parse\(payload\.expiresAt\) <= Date\.now\(\)/);
  assert.match(visualReview, /\/\^9900\\d/);
  assert.match(visualReview, /\/\^2900\\d/);
  assert.match(visualReview, /customer_name\.startsWith\('Cliente homologação'\)/);
  assert.match(page, /Dados de demonstração protegidos/);
  assert.doesNotMatch(page, /Amostra sintética protegida para homologação/);
  assert.match(page, /disabled=\{activeClaim\.is_homologation_fixture\}/);
});
