const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/reputacao/page.tsx');
const styles = read('src/app/(app)/reputacao/reputacao.module.css');
const route = read('src/app/api/ml/reputacao/route.ts');
const visualReview = read('src/lib/ml/reputation-visual-review.ts');
const reputationModuleUrl = pathToFileURL(path.join(root, 'src/lib/ml/seller-reputation.ts')).href;

test('usa os limites oficiais MLB e classifica todas as fronteiras', async () => {
  const {
    classifyReputationMetric,
    getReputationThresholds,
  } = await import(reputationModuleUrl);
  const thresholds = getReputationThresholds('MLB');

  assert.deepEqual(thresholds.metrics.claims, { leaders: 1, green: 2, yellow: 4.5, orange: 8 });
  assert.deepEqual(thresholds.metrics.cancellations, { leaders: 0.5, green: 1.5, yellow: 3.5, orange: 4 });
  assert.deepEqual(thresholds.metrics.delayed_handling_time, { leaders: 6, green: 10, yellow: 18, orange: 22 });
  assert.equal(getReputationThresholds('MLA'), null);

  assert.equal(classifyReputationMetric(1, thresholds.metrics.claims), 'leaders');
  assert.equal(classifyReputationMetric(2, thresholds.metrics.claims), 'green');
  assert.equal(classifyReputationMetric(4.5, thresholds.metrics.claims), 'yellow');
  assert.equal(classifyReputationMetric(8, thresholds.metrics.claims), 'orange');
  assert.equal(classifyReputationMetric(8.01, thresholds.metrics.claims), 'red');
  assert.equal(classifyReputationMetric(null, thresholds.metrics.claims), 'unknown');
});

test('normaliza taxas e preserva dados reais durante proteção', async () => {
  const { normalizeReputationMetric } = await import(reputationModuleUrl);

  assert.deepEqual(normalizeReputationMetric(null), {
    rate: null,
    percent: null,
    value: null,
    period: null,
    excluded: null,
  });
  assert.deepEqual(normalizeReputationMetric({
    rate: 0.0168,
    value: 4,
    period: '60 days',
    excluded: { real_value: 7, real_rate: 0.0294 },
  }), {
    rate: 0.0168,
    percent: 1.68,
    value: 4,
    period: '60 days',
    excluded: { real_value: 7, real_rate: 0.0294, real_percent: 2.94 },
  });
});

test('organiza a reputação do nível para os fatores e a prioridade', () => {
  for (const label of [
    'Termômetro Mercado Livre',
    'O que forma sua reputação',
    'Reclamações',
    'Despachos atrasados',
    'Cancelamentos',
    'O que exige atenção agora',
    'Transações e avaliações',
    'Como o Mercado Livre calcula estas métricas?',
  ]) {
    assert.match(page, new RegExp(label.replace(/[?]/g, '\\?')));
  }
  assert.doesNotMatch(page, /Selos & Conquistas|Vendas Concluídas|Total Transações/);
  assert.match(styles, /\.reputationHero[\s\S]*grid-template-columns/);
  assert.match(styles, /\.metricsGrid[\s\S]*grid-template-columns/);
});

test('não fabrica tendência e remove atualização automática', () => {
  assert.doesNotMatch(page, /setTimeout|setInterval|REPUTACAO_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(page, /LineChart|AreaChart|Tendência/);
  assert.match(page, /Atualizar/);
  assert.match(page, /O próprio Mercado Livre define a janela de avaliação/);
});

test('API exige permissão e consulta somente o recurso do vendedor', () => {
  assert.match(route, /authorizeApiRequest\(request, 'sales\.read'\)/);
  assert.match(route, /fetchMLResult<Record<string, any>>\('\/users\/me'\)/);
  assert.match(route, /`\/users\/\$\{encodeURIComponent/);
  assert.doesNotMatch(route, /orders\/search|orderSearchTotal|monthsAgoIso/);
  assert.doesNotMatch(route, /orders_summary|feedback:|reclamacoes:|positivas:/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});

test('amostra visual é sintética, temporária e não contém destino externo', () => {
  assert.match(visualReview, /EXPECTED_SOURCE = 'official-contract-synthetic'/);
  assert.match(visualReview, /Date\.parse\(payload\.expiresAt\) <= Date\.now\(\)/);
  assert.match(visualReview, /user\.id\.startsWith\('bnt-d18-'\)/);
  assert.match(visualReview, /user\.permalink === null/);
  assert.match(visualReview, /user\.site_id === 'MLB'/);
  assert.match(page, /Amostra visual protegida de homologação/);
});

test('mantém estados de conexão, falta de histórico, proteção e erro', () => {
  assert.match(page, /Mercado Livre desconectado/);
  assert.match(page, /Reputação ainda não disponível/);
  assert.match(page, /Histórico insuficiente/);
  assert.match(page, /Conta em período de proteção/);
  assert.match(page, /A atualização falhou/);
  assert.match(page, /Limites não exibidos porque a conta não pertence ao site brasileiro MLB/);
});
