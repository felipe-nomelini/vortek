const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const pagePath = path.join(__dirname, '../src/app/(app)/tv/page.tsx');
const stylePath = path.join(__dirname, '../src/app/(app)/tv/tv.module.css');
const panelsPath = path.join(__dirname, '../src/components/tv/TvDashboardPanels.tsx');
const dashboardUrl = pathToFileURL(
  path.join(__dirname, '../src/lib/tv/dashboard.ts'),
).href;

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

test('TV preserva os contratos e intervalos existentes sem polling concorrente', () => {
  const page = source(pagePath);
  assert.match(page, /fetch\("\/api\/tv\/live"/);
  assert.match(page, /fetch\("\/api\/tv\/metrics"/);
  assert.match(page, /TV_LIVE_REFRESH_MS/);
  assert.match(page, /TV_FULL_REFRESH_MS/);
  assert.match(page, /liveRefreshInFlightRef\.current/);
  assert.match(page, /fullRefreshInFlightRef\.current/);
  assert.match(page, /setHealthClock\(Date\.now\(\)\)/);
  assert.doesNotMatch(page, /<style jsx/);
});

test('saúde ao vivo distingue atraso e interrupção em limites estáveis', async () => {
  const dashboard = await import(dashboardUrl);
  assert.equal(dashboard.TV_LIVE_REFRESH_MS, 1_000);
  assert.equal(dashboard.TV_FULL_REFRESH_MS, 15_000);
  assert.equal(dashboard.tvConnectionState(null, 50_000), 'loading');
  assert.equal(dashboard.tvConnectionState(10_000, 15_000), 'live');
  assert.equal(dashboard.tvConnectionState(10_000, 15_001), 'delayed');
  assert.equal(dashboard.tvConnectionState(10_000, 40_000), 'delayed');
  assert.equal(dashboard.tvConnectionState(10_000, 40_001), 'offline');
});

test('atualização leve não apaga projeção, perguntas ou anúncios válidos', async () => {
  const { mergeTvLiveMetrics } = await import(dashboardUrl);
  const summary = { orders: 1, revenue: 10, profit: 2, averageTicket: 10, statusCounts: {} };
  const current = {
    generatedAt: '2026-09-10T10:00:00Z',
    today: summary,
    week: summary,
    month: summary,
    trends: { revenueVsYesterday: 1, ordersVsYesterday: 1, profitVsYesterday: 1 },
    hourlySales: [{ hour: 10, label: '10h', revenue: 10, orders: 1 }],
    recentOrders: [],
    recentQuestions: [{ id: 'q1' }],
    projection: { basis: { dailyPace: { revenue: 10 } } },
    ads: { total: 2, active: 2, paused: 0, activeCatalog: 1, winningCatalog: 1 },
    goals: { marker: true },
  };
  const nextSummary = { ...summary, orders: 2, revenue: 20 };
  const merged = mergeTvLiveMetrics(current, {
    generatedAt: '2026-09-10T10:00:01Z',
    today: nextSummary,
    week: nextSummary,
    month: nextSummary,
    trends: { revenueVsYesterday: 2, ordersVsYesterday: 2, profitVsYesterday: 2 },
    recentOrders: [{ id: 'o1' }],
  });
  assert.equal(merged.today.orders, 2);
  assert.deepEqual(merged.recentQuestions, current.recentQuestions);
  assert.deepEqual(merged.hourlySales, current.hourlySales);
  assert.deepEqual(merged.projection, current.projection);
  assert.deepEqual(merged.ads, current.ads);
  assert.equal(mergeTvLiveMetrics(null, {}), null);
});

test('hierarquia destaca resultado, metas, tendências e atividade recente', () => {
  const page = source(pagePath);
  const panels = source(panelsPath);
  for (const label of [
    'Faturamento hoje',
    'Lucro hoje',
    'Metas',
    'Vendas por hora',
    'Projeção',
    'Vendas',
    'Perguntas',
  ]) {
    assert.match(`${page}\n${panels}`, new RegExp(label));
  }
  assert.match(page, /fullscreenchange/);
  assert.match(page, /últimos dados válidos/);
  assert.match(page, /Som \{soundEnabled \? "ligado" : "desligado"\}/);
});

test('layout é Bentevi, responsivo e respeita movimento reduzido', () => {
  const styles = source(stylePath);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1\.65fr\)/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /animation: none !important/);
});
