const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20260901160000_bnt_d04_fiscal_returns.sql');
const core = read('src/lib/fiscal/nfe-return.ts');
const service = read('src/services/fiscal-return.ts');
const route = read('src/app/api/notas-fiscais/retornos/route.ts');
const reconcileRoute = read('src/app/api/notas-fiscais/retornos/[id]/reconciliar/route.ts');
const modal = read('src/components/fiscal/FiscalReturnModal.tsx');
const panel = read('src/components/fiscal/FiscalReturnsPanel.tsx');
const permissions = read('src/lib/permissions.ts');

test('persiste retornos como documentos próprios e preserva a NF-e única da venda', () => {
  assert.match(migration, /create table if not exists public\.notas_fiscais_retorno/);
  assert.match(migration, /pedido_id uuid not null references public\.pedidos/);
  assert.match(migration, /identificador_interno text not null/);
  assert.match(migration, /constraint notas_fiscais_retorno_identificador_unique unique/);
  assert.match(migration, /itens_snapshot jsonb not null/);
  assert.match(migration, /nota_retorno_id uuid/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.notas_fiscais_retorno from anon, authenticated/);
});

test('reserva quantidades atomicamente sem manter transação durante chamada externa', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('nfe_retorno:'/);
  assert.ok(migration.indexOf('where identificador_interno = p_identificador_interno') < migration.indexOf("status in ('pending', 'processing', 'authorized')"));
  assert.match(migration, /A chave de idempotência já foi usada com dados diferentes/);
  assert.match(migration, /status in \('pending', 'processing', 'authorized'\)/);
  assert.match(migration, /quantidade solicitada excede o saldo disponível/);
  assert.match(migration, /on conflict \(identificador_interno\) do update/);
  assert.doesNotMatch(migration, /https?:\/\/|fetch\s*\(/i);
  assert.ok(service.indexOf("'reserve_nota_fiscal_retorno'") < service.indexOf('const preview = await preVisualizarNotaBrasilNfe'));
  assert.match(reconcileRoute, /normalizeNfePersistedStatus/);
  assert.match(reconcileRoute, /observedStatus === 'rejected' \|\| observedStatus === 'denied'/);
});

test('mapeia os quatro cenários fiscais e as referências total ou por item', () => {
  for (const type of ['devolucao_pos_recebimento', 'recusa_total', 'recusa_parcial', 'nao_localizado']) {
    assert.match(core, new RegExp(type));
  }
  assert.match(core, /Finalidade: isDeliveryFailure \? 5 : 4/);
  assert.match(core, /TpNFCredito: retorno\.tipo_retorno === 'recusa_parcial' \? 6 : 3/);
  assert.match(core, /NFReferencia: \[retorno\.nfe_original_chave\]/);
  assert.match(core, /product\.ChaveAcessoReferenciada = retorno\.nfe_original_chave/);
  assert.match(core, /product\.NItemReferenciado = Number\(item\.nitem_original\)/);
  assert.match(core, /if \(normalized === '5102'\) return 1202/);
  assert.match(core, /if \(normalized === '6102'\) return 2202/);
  assert.match(core, /não possui regra de retorno homologada/);
});

test('bloqueia emissão fiscal de produção no worktree de homologação', () => {
  assert.match(core, /BRASILNFE_RETURN_TIPO_AMBIENTE/);
  assert.ok(core.includes('app\\.bentevi\\.shop'));
  assert.ok(core.includes('BRASILNFE_RETURN_TIPO_AMBIENTE=2 em desenvolvimento/homologação'));
  assert.match(service, /isHomologationFixtureSource/);
  assert.match(service, /Pré-visualização fiscal rejeitada/);
  assert.ok(service.indexOf('preVisualizarNotaBrasilNfe') < service.indexOf("getFiscalProvider('brasilnfe').emitirNota"));
});

test('expõe as abas, o modal em três etapas e somente ações fiscais aplicáveis', () => {
  for (const step of ["{ title: 'Venda' }", "{ title: 'Itens e motivo' }", "{ title: 'Revisão' }"]) {
    assert.match(modal, new RegExp(step.replace(/[{}]/g, '\\$&')));
  }
  assert.match(modal, /Pré-validar e emitir/);
  assert.match(panel, /Devoluções e retornos|devoluções fiscais/i);
  for (const action of ['Abrir DANFE', 'Baixar XML', 'Enviar por e-mail', 'Emitir CC-e', 'Cancelar NF-e', 'Atualizar status']) {
    assert.match(panel, new RegExp(action));
  }
  assert.match(panel, /canManage && authorized/);
});

test('protege as APIs fiscais com permissões de leitura e gestão', () => {
  assert.match(permissions, /"fiscal\.read"/);
  assert.match(permissions, /"fiscal\.manage"/);
  assert.match(route, /authorizeApiRequest\(request, 'fiscal\.read'\)/);
  assert.match(route, /authorizeApiRequest\(request, 'fiscal\.manage'\)/);
});
