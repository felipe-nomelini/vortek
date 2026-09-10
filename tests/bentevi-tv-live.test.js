const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const pagePath = path.join(__dirname, '../src/app/(app)/tv/page.tsx');
const stylePath = path.join(__dirname, '../src/app/(app)/tv/tv.module.css');
const panelsPath = path.join(__dirname, '../src/components/tv/TvDashboardPanels.tsx');
const metricsRoutePath = path.join(__dirname, '../src/app/api/tv/metrics/route.ts');
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

test('cada venda escolhe aleatoriamente um dos quatro sons e permite repetição', async () => {
  const { pickTvSaleSoundIndex } = await import(dashboardUrl);
  assert.equal(pickTvSaleSoundIndex(4, 0), 0);
  assert.equal(pickTvSaleSoundIndex(4, 0.2499), 0);
  assert.equal(pickTvSaleSoundIndex(4, 0.25), 1);
  assert.equal(pickTvSaleSoundIndex(4, 0.5), 2);
  assert.equal(pickTvSaleSoundIndex(4, 0.75), 3);
  assert.equal(pickTvSaleSoundIndex(4, 0.999999), 3);
  assert.equal(pickTvSaleSoundIndex(4, 0.75), pickTvSaleSoundIndex(4, 0.75));
  assert.equal(pickTvSaleSoundIndex(0, 0.5), null);
});

test('TV pré-carrega os quatro sons de venda sem alterar o som de pergunta', () => {
  const page = source(pagePath);
  const saleSounds = [
    'dreigue.mp3',
    'para-de-ser-doida.m4a',
    'rupaul1.m4a',
    'viaaaadoooo.m4a',
  ];

  for (const filename of saleSounds) {
    const assetPath = path.join(__dirname, '../public/sounds', filename);
    const contents = fs.readFileSync(assetPath);
    assert.ok(contents.length > 0, `${filename} deve conter áudio`);
    assert.match(page, new RegExp(`/sounds/${filename.replace('.', '\\.')}`));
  }

  assert.match(page, /SALE_SOUND_SOURCES\.map/);
  assert.match(page, /pickTvSaleSoundIndex\(SALE_SOUND_SOURCES\.length, Math\.random\(\)\)/);
  assert.match(page, /saleAudioRefs\.current\.forEach/);
  assert.match(page, /saleAudio\?\.pause\(\)/);
  assert.match(page, /QUESTION_SOUND_SRC = "\/sounds\/ala-nem-vou-ler-ines-brasil\.mp3"/);
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

test('contagem de anúncios usa totais exatos sem o limite de linhas do PostgREST', () => {
  const route = source(metricsRoutePath);
  assert.doesNotMatch(route, /\.select\("status,catalogo"\)/);
  assert.doesNotMatch(route, /for \(const row of adsStatsResult/);
  assert.match(route, /adsTotalResult\.count \?\? 0/);
  assert.match(route, /activeAdsResult\.count \?\? 0/);
  assert.match(route, /pausedAdsResult\.count \?\? 0/);
  assert.match(route, /activeCatalogResult\.count \?\? 0/);
  assert.match(route, /\.eq\("status", "pausado"\)/);
  assert.match(route, /\.eq\("catalogo", true\)/);
  assert.match(route, /Falha ao contar anúncios/);
});

test('rodapé formata contagens grandes para leitura em português', () => {
  const panels = source(panelsPath);
  assert.match(panels, /new Intl\.NumberFormat\("pt-BR"\)/);
  assert.match(panels, /integerFormatter\.format\(ads\.total\)/);
  assert.match(panels, /integerFormatter\.format\(ads\.activeCatalog\)/);
});

test('layout é Bentevi, responsivo e respeita movimento reduzido', () => {
  const styles = source(stylePath);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1\.65fr\)/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /@media \(min-width: 1451px\) and \(min-height: 900px\)/);
  assert.match(styles, /flex: 1 1 300px/);
  assert.match(styles, /grid-auto-rows: minmax\(0, 1fr\)/);
  assert.match(styles, /\.panelHeader h2 \{[\s\S]*?font-size: 22px/);
  assert.match(styles, /\.questionRow > :global\(\.ant-typography\) \{[\s\S]*?font-size: 14px/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /animation: none !important/);
});
