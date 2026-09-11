const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('alerta hidrata o pedido canônico e não reaproveita campos incompletos do produtor', () => {
  const alerts = read('src/services/whatsapp-alerts.ts');
  const start = alerts.indexOf('export async function alertMlLabelReleased');
  const end = alerts.indexOf('export async function scanAndAlertReleasedLabels', start);
  const implementation = alerts.slice(start, end);

  assert.match(implementation, /\.from\("pedidos"\)[\s\S]*\.select\("id,numero,ml_order_id,ml_shipment_id,contato_nome,billing_nome,total,dslite_id,situacao"\)/);
  assert.match(implementation, /order_hydration_failed/);
  assert.match(implementation, /buildMlLabelReleasedFields/);
  assert.match(implementation, /label: "Liberada em"|releasedAt/);
  assert.doesNotMatch(implementation, /formatCurrency\(Number\(order\.total \|\| 0\)\)/);
  assert.doesNotMatch(implementation, /label: "Previsão"/);
});

test('somente observadores automáticos solicitam o alerta e usam a mesma referência', () => {
  for (const [file, source] of [
    ['src/app/api/webhooks/ml/notifications/route.ts', 'shipments_topic'],
    ['src/app/api/sync/pedidos/route.ts', 'sync_pedidos'],
    ['src/services/whatsapp-alerts.ts', 'label_release_scanner'],
  ]) {
    const content = read(file);
    assert.match(content, new RegExp(`alertMlLabelReleased\\(\\{[\\s\\S]*pedidoId:[\\s\\S]*source: ['\"]${source}['\"]`));
  }

  for (const file of [
    'src/app/api/dslite/pedido/route.ts',
    'src/app/api/dslite/etiqueta-auto/route.ts',
    'src/services/whatsapp-label-job.ts',
  ]) {
    const content = read(file);
    assert.doesNotMatch(content, /alertMlLabelReleased/);
    assert.match(content, /cleared_without_alert_manual_flow/);
  }
});

test('scanner e fluxos manuais reconhecem disponibilidade operacional, não apenas PDF pronto', () => {
  assert.match(read('src/services/whatsapp-alerts.ts'), /if \(!availability\.workflowReady\) continue/);
  assert.match(read('src/app/api/dslite/pedido/route.ts'), /if \(availability\.workflowReady\)/);
  assert.match(read('src/app/api/dslite/etiqueta-auto/route.ts'), /if \(availability\.workflowReady\)/);
  assert.match(read('src/services/whatsapp-label-job.ts'), /!availability\.checked \|\| !availability\.workflowReady/);
});
