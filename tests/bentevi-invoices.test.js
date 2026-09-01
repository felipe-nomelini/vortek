const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/notas-fiscais/page.tsx');
const styles = read('src/app/(app)/notas-fiscais/notas-fiscais.module.css');
const drawer = read('src/components/fiscal/NotaFiscalDetailsDrawer.tsx');
const listRoute = read('src/app/api/notas-fiscais/route.ts');
const summaryRoute = read('src/app/api/notas-fiscais/resumo/route.ts');
const emailRoute = read('src/app/api/notas-fiscais/[id]/enviar-email/route.ts');
const emailService = read('src/services/email.ts');

test('organiza o cockpit fiscal sem coluna de emissão ou identificadores duplicados', () => {
  for (const title of ['NF-e', 'Venda ML', 'Cliente', 'Valor', 'Estado fiscal', 'Ações']) {
    assert.match(page, new RegExp(`title: '${title}'`));
  }
  assert.doesNotMatch(page, /title: 'Emissão'/);
  assert.match(page, /note\.ml_pack_id \|\| note\.ml_order_id/);
  assert.match(page, /note\.ml_pack_id !== note\.ml_order_id/);
  const saleColumn = page.slice(page.indexOf("title: 'Venda ML'"), page.indexOf("title: 'Cliente'"));
  assert.doesNotMatch(saleColumn, /note\.cliente/);
  assert.match(page, /Série \$\{note\.serie\}.*emitted\.date/);
  assert.match(page, /nextActionLabel\(note\)/);
  assert.doesNotMatch(page, /rowSelection=/);
});

test('substitui métricas antigas por indicadores fiscais reais', () => {
  for (const label of ['Pendentes', 'Emitidas', 'Com erro', 'Valor autorizado']) {
    assert.match(page, new RegExp(`'${label}'`));
  }
  assert.match(summaryRoute, /mapped === "interrompida" \|\| mapped === "rejeitada" \|\| mapped === "outro"/);
  assert.match(summaryRoute, /valorAutorizado \+= Number\(row\.total \|\| 0\)/);
  assert.match(summaryRoute, /com_erro: comErro/);
  assert.match(summaryRoute, /valor_autorizado: valorAutorizado/);
  assert.match(page, /Imposto estimado do mês/);
  assert.match(summaryRoute, /loadPricingTaxProjection/);
  assert.match(summaryRoute, /imposto_estimado_mes: impostoEstimadoMes/);
  assert.doesNotMatch(page, /Imposto Total|imposto_total/);
  assert.doesNotMatch(summaryRoute, /\* 0\.04|imposto_total/);
});

test('expõe dados fiscais já selecionados sem criar nova fonte de verdade', () => {
  assert.match(listRoute, /nfe_provider, nfe_external_id, snapshot_source/);
  assert.match(listRoute, /extractXmlTag\(row\.nfe_xml, "dhEmi"\)/);
  assert.match(listRoute, /extractXmlTag\(row\.nfe_xml, "dEmi"\)/);
  assert.match(listRoute, /nfe_protocolo: row\.nfe_protocolo/);
  assert.match(listRoute, /nfe_cfop: row\.nfe_cfop/);
  assert.match(listRoute, /xml_available:/);
  assert.match(listRoute, /is_homologation_fixture: isHomologationFixtureSource/);
  assert.doesNotMatch(listRoute, /from\("nf_auditoria_eventos"\)/);
});

test('usa Drawer contextual com visão geral, documentos e histórico fiscal', () => {
  for (const label of ['Visão geral', 'Documentos e eventos', 'Histórico fiscal']) {
    assert.match(drawer, new RegExp(`label: '${label}'`));
  }
  for (const field of ['Chave de acesso', 'Protocolo', 'CFOP', 'ID no provedor', 'Pack ML', 'Venda / Order ML']) {
    assert.match(drawer, new RegExp(field));
  }
  assert.match(page, /fetch\(`\/api\/pedidos\/\$\{note\.id\}`/);
  assert.match(drawer, /nota_fiscal\|fiscal\|invoice\|brasilnfe\|danfe\|xml/);
  assert.match(drawer, /<Timeline/);
});

test('distingue not_found e cancelamento fora do prazo', () => {
  assert.match(drawer, /BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS/);
  assert.match(drawer, /label: 'Não encontrada'/);
  assert.match(drawer, /isNfeCancelRejectedDeadlineStatus/);
  assert.match(drawer, /Prazo de cancelamento excedido/);
  assert.match(page, /Revisar a emissão antes de reconciliar/);
  assert.match(page, /Seguir o procedimento fiscal fora do prazo/);
});

test('mantém ações externas explícitas, separadas e protegidas', () => {
  assert.match(page, /Enviar NF-e \$\{emailTarget\.numero\} por e-mail/);
  assert.match(page, /Cancelar NF-e \$\{cancelTarget\.numero\}/);
  assert.match(page, /Emitir CC-e da NF-e \$\{cceTarget\.numero\}/);
  assert.match(page, /Digite CANCELAR somente quando tiver certeza/);
  assert.match(page, /cceText\.trim\(\)\.length < 15/);
  assert.match(page, /note\.is_homologation_fixture/);
  assert.match(drawer, /Amostra real protegida para homologação/);
  assert.match(page, /hasPermission\(role, 'fiscal\.manage'\)/);
  assert.match(page, /Criar devolução\/retorno/);
});

test('mostra ações fiscais bloqueadas nas amostras sem permitir execução', () => {
  assert.match(page, /Amostra protegida — ações apenas para demonstração/);
  assert.match(page, /disabled: Boolean\(fixtureReason/);
  assert.match(page, /note\.is_homologation_fixture && key !== 'details'/);
  assert.match(page, /Amostra protegida: ações fiscais estão disponíveis apenas para demonstração/);
  for (const label of [
    'Abrir DANFE',
    'Baixar DANFE',
    'Baixar XML',
    'Enviar por e-mail',
    'Emitir CC-e',
    'Cancelar NF-e',
    'Criar devolução/retorno',
  ]) {
    assert.match(page, new RegExp(label.replace('/', '\\/')));
  }
  assert.match(drawer, /showManagedEvents/);
  assert.match(drawer, /As ações aparecem para avaliação do layout/);
  assert.match(drawer, /disabled=\{!canCancel\}/);
  assert.match(drawer, /disabled=\{!canCce\}/);
  assert.match(drawer, /disabled=\{!canReturn\}/);
  assert.match(drawer, /onReturn\(note\)/);
});

test('separa vendas de devoluções sem criar uma segunda página fiscal', () => {
  assert.match(page, /label: `NF-e de vendas/);
  assert.match(page, /label: 'Devoluções e retornos'/);
  assert.match(page, /<FiscalReturnsPanel/);
  assert.match(page, /<FiscalReturnModal/);
});

test('deixa a reconciliação externa sob ação manual e preserva apenas o polling de leitura', () => {
  assert.match(page, />Reconciliar agora<\/Button>/);
  assert.match(page, /const reconcileNow = useCallback/);
  assert.match(page, /fetch\('\/api\/sync\/nf\/reconciliar-brasilnfe\/job'/);
  assert.match(page, /POLLING_INTERVAL_MS = 5000/);
  assert.doesNotMatch(page, /BACKGROUND_SYNC_INTERVAL_MS|scheduleNextBackgroundSync|triggerBackgroundSync/);
});

test('aplica identidade visual Bentevi e filtros persistidos na URL', () => {
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /var\(--bentevi-surface/);
  assert.match(styles, /\.summaryBand/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(page, /window\.history\.replaceState/);
  for (const filter of ['search', 'status', 'dateFrom', 'dateTo', 'valorMin', 'valorMax']) {
    assert.match(page, new RegExp(`params\\.set\\('${filter}'`));
  }
  assert.match(page, /Mensagem automática Bentevi/);
  assert.match(emailRoute, /Mensagem automática Bentevi/);
  assert.match(emailService, /const from = `Bentevi </);
  assert.doesNotMatch(page, /Mensagem automática Vortek/);
  assert.doesNotMatch(emailRoute, /Mensagem automática Vortek/);
  assert.doesNotMatch(`${page}\n${drawer}`, /disponível no Vortek|desfeita pelo Vortek/);
});
