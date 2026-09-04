const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/reclamacoes/page.tsx');
const styles = read('src/app/(app)/reclamacoes/reclamacoes.module.css');
const listRoute = read('src/app/api/ml/reclamacoes/route.ts');
const detailRoute = read('src/app/api/ml/reclamacoes/[id]/route.ts');
const claims = read('src/lib/ml/claims.ts');
const visualReview = read('src/lib/ml/claims-visual-review.ts');

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
  assert.match(listRoute, /'players\.user_id': sellerId/);
  assert.match(listRoute, /'players\.role': 'respondent'/);
  assert.match(listRoute, /resource: 'order'/);
  assert.match(listRoute, /limit: filters\.pageSize/);
  assert.match(listRoute, /runPool\(pageClaims, 5/);
  assert.doesNotMatch(listRoute, /orders\/search/);
  assert.match(listRoute, /'Cache-Control': 'no-store'/);
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
  assert.match(page, /Amostra sintética protegida para homologação/);
  assert.match(page, /disabled=\{activeClaim\.is_homologation_fixture\}/);
});
