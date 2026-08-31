const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildMlPublishSteps,
  parseMlPublishOperationLabel,
} = require('../src/lib/ml/price-publish-tracking.ts');

test('traduz somente as operações conhecidas do outbox de publicação', () => {
  assert.equal(parseMlPublishOperationLabel(null), 'Aguardando worker');
  assert.equal(parseMlPublishOperationLabel('processing_start'), 'Iniciando publicação');
  assert.equal(parseMlPublishOperationLabel('validate'), 'Validando item no outbox');
  assert.equal(parseMlPublishOperationLabel('price'), 'Publicando preço base');
  assert.equal(parseMlPublishOperationLabel('quantity_pricing'), 'Publicando preços de atacado');
  assert.equal(parseMlPublishOperationLabel('quantity'), 'Publicando estoque');
  assert.equal(parseMlPublishOperationLabel('status'), 'Publicando status do anúncio');
  assert.equal(parseMlPublishOperationLabel(' NEW_OPERATION '), 'new_operation');
});

test('representa publicação pendente e em processamento sem antecipar conclusão', () => {
  const pending = buildMlPublishSteps(null);
  assert.deepEqual(pending.map((step) => step.status), ['loading', 'loading', 'pending', 'pending']);
  assert.match(pending[0].detail, /Aguardando início/);

  const processing = buildMlPublishSteps({
    success: true,
    status: 'retry',
    phase: 'processando',
    progress: { last_operation: 'quantity_pricing' },
  });
  assert.deepEqual(processing.map((step) => step.status), ['success', 'loading', 'pending', 'pending']);
  assert.equal(processing[1].detail, 'Publicando preços de atacado');
});

test('exibe preço e faixas confirmadas quando a publicação termina', () => {
  const steps = buildMlPublishSteps({
    success: true,
    status: 'done',
    phase: 'concluido',
    result: {
      item_price: 125.5,
      has_quantity_pricing: true,
      quantity_pricing_state: 'active',
      quantity_pricing: [{
        min_purchase_unit: 3,
        discount_percent: 4,
        amount: 120.48,
        currency_id: 'BRL',
        pricing_model: 'percentage',
      }],
      suggested_quantity_pricing: [],
      warnings: [],
    },
  });

  assert.deepEqual(steps.map((step) => step.status), ['success', 'success', 'success', 'success']);
  assert.match(steps[2].detail, /125,50/);
  assert.match(steps[3].detail, /3\+ \(-4%\)/);
});

test('mantém diagnóstico, sugestão e aviso quando atacado não fica ativo', () => {
  const steps = buildMlPublishSteps({
    success: true,
    status: 'done',
    phase: 'concluido',
    result: {
      item_price: 100,
      has_quantity_pricing: false,
      quantity_pricing_state: 'provider_rejected',
      quantity_pricing_last_error: 'item_not_eligible',
      quantity_pricing: [],
      suggested_quantity_pricing: [{
        min_purchase_unit: 3,
        discount_percent: 3,
        amount: 97,
        currency_id: 'BRL',
        pricing_model: 'percentage',
      }],
      warnings: ['consulta parcial'],
    },
  });

  assert.equal(steps[3].status, 'warning');
  assert.match(steps[3].detail, /ML rejeitou/);
  assert.match(steps[3].detail, /item_not_eligible/);
  assert.match(steps[3].detail, /Sugestão: 3\+/);
  assert.match(steps[3].detail, /consulta parcial/);
});

test('expõe a falha do outbox sem marcar preço ou atacado como concluídos', () => {
  const steps = buildMlPublishSteps({
    success: false,
    status: 'failed',
    phase: 'erro',
    last_error: 'Falha controlada',
    result: null,
  });

  assert.deepEqual(steps.map((step) => step.status), ['success', 'error', 'warning', 'warning']);
  assert.equal(steps[1].error, 'Falha controlada');
});

test('Produtos e Catálogo consomem um único tracking específico', () => {
  const root = path.resolve(__dirname, '..');
  const products = fs.readFileSync(path.join(root, 'src/app/(app)/produtos/page.tsx'), 'utf8');
  const catalog = fs.readFileSync(path.join(root, 'src/components/catalogo/CatalogoView.tsx'), 'utf8');
  const hook = fs.readFileSync(path.join(root, 'src/hooks/useMlPricePublishTracking.ts'), 'utf8');

  for (const consumer of [products, catalog]) {
    assert.match(consumer, /useMlPricePublishTracking/);
    assert.doesNotMatch(consumer, /function buildMlPublishSteps/);
    assert.doesNotMatch(consumer, /atualizar-preco\/status\?outboxId/);
    assert.doesNotMatch(consumer, /api\/ml\/anuncio\/aplicar-atacado/);
  }

  assert.match(hook, /atualizar-preco\/status\?outboxId/);
  assert.match(hook, /api\/ml\/anuncio\/aplicar-atacado/);
  assert.match(hook, /clearTimeout\(timeout\)/);
  assert.match(hook, /if \(cancelled\) return/);
});
