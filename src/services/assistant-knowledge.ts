import 'server-only';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { resolveSupabaseServiceUrl } from '@/lib/supabase-url';
import type { VortekPermission } from '@/lib/permissions';
import { assistantQuerySchema, type AssistantQuery, type AssistantState, type AssistantCoverage, type AssistantReference } from '@/lib/assistant-contract';
import { assertAssistantDestination, createAssistantReadTransport, AssistantReadError } from './assistant-read-transport';
import { loadAssistantDocuments } from './assistant-documents';
import { periodBounds, summarize, loadRowsInRange } from './dashboard-read-model';
import { enrichPedidosWithCompras, reconcileNotaFiscalEmitidaRow } from './order-read-projection';
import { enrichOrdersWithWhatsappStatus } from './order-operational-status';
import { getOrderSalesProgress, getOperationalUrgencyReasons } from '@/lib/orders/operational-view';
import { loadOperationRuntimeConfiguration } from './operation-configuration';
import { loadPricingRequestContext, loadProductPricing, evaluateProductPricing, type ProductPricing } from './pricing-context';
import type { EconomicInput } from '@/types/pricing';
import { loadPricingClearances } from './pricing-clearances';
import { loadPricingTaxProjection } from './pricing-tax-context';
import { loadProductMlListings } from '@/lib/ml/product-listings';
import { loadProductFulfillmentCapacity } from '@/lib/orders/fulfillment-capacity-loader';
import { reconcileLocalNfeSnapshotFromXml } from '@/lib/fiscal/nfe-local-reconciliation';
import { normalizeNfeTechnicalStatus } from '@/lib/fiscal/nfe-status';
import { isHomologationFixtureId, isHomologationFixtureSource } from '@/lib/homologation-fixture';

type Client = ReturnType<typeof createServiceClient>;
const PERMISSIONS: Record<AssistantQuery['kind'], VortekPermission> = {
  sales: 'sales.read', order: 'sales.read', purchase: 'purchases.read', product: 'pricing.read',
  inventory: 'inventory.read', pricing: 'pricing.read', invoice: 'fiscal.read', tax: 'fiscal.read', documentation: 'sales.read',
};
const QUERY_TIMEOUT_MS = 15000;
const RECORD_LIMIT = 20;
const PRODUCT_COLUMNS = 'id,sku,nome,ativo,oferta_preferencial_id,fornecedor_preferencial_manual,ml_item_id,custom_price,updated_at,dslite_ultima_sync';
const ORDER_COLUMNS = 'id,ml_order_id,ml_pack_id,data,data_venda,situacao,operational_total,operational_lucro,operational_profit_pending,operational_pedido_ids,operational_order_ids,operational_dslite_ids,operational_invoice_numbers,ml_bundle_type,dslite_id,dslite_status,dslite_etiqueta_enviada,dslite_label_source,envio_interno_at,ml_fiscal_release_at,ml_claim_id,nota_fiscal_emitida,nfe_status,nfe_xml,nfe_chave,nota_fiscal_numero,nfe_protocolo,nfe_cfop,nfe_danfe_url,ml_label_storage_path,ml_thermal_label_storage_path,snapshot_source,nfe_last_sync_at';
const numberOrNull = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const stringOrNull = (value: unknown) => value === null || value === undefined || value === '' ? null : String(value);
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const fixture = (row: { id?: unknown; snapshot_source?: unknown }) => isHomologationFixtureId(row.id) || isHomologationFixtureSource(row.snapshot_source);
const saleLink = (id: string) => `/pedidos?view=all&venda=${encodeURIComponent(id)}`;

type Metadata = {
  coverage: AssistantCoverage; state: AssistantState; references: AssistantReference[];
  warnings: string[]; sourceUpdatedAt: string | null; includesFixtures: boolean;
  period: { start: string; end: string; timezone: 'America/Sao_Paulo' } | null;
};
function reference(meta: Metadata, id: string, label: string, path: string, updatedAt: string | null = null) {
  meta.references.push({ id, label, path, updatedAt });
}
function noRows(meta: Metadata) { meta.state = 'sem_dados'; meta.coverage = 'sem_dados'; }
function ambiguity(meta: Metadata, count: number | null, shown: number) {
  meta.state = 'esclarecimento_necessario';
  meta.warnings.push('Há mais de um registro. Escolha o ID antes de consultar detalhes; nenhuma venda foi selecionada automaticamente.');
  if (count === null || count > shown) meta.coverage = 'parcial';
}

async function findOrders(db: Client, record: Extract<AssistantQuery, { kind: 'order' }>['record']) {
  // A view consolida kits/carrinhos; a venda componente é resolvida para sua unidade operacional.
  let query = (db as any).from('pedidos_operacionais').select(ORDER_COLUMNS, { count: 'exact' }).order('id');
  query = record.by === 'pack' ? query.eq('ml_pack_id', record.value)
    : record.by === 'sale' ? query.contains('operational_order_ids', [record.value])
      : query.contains('operational_pedido_ids', [record.value]);
  const result = await query.range(0, RECORD_LIMIT - 1);
  if (result.error) throw new Error('assistant_orders_read_failed');
  return { rows: (result.data || []) as any[], count: result.count as number | null };
}

async function readFacts(db: Client, input: AssistantQuery, now: Date, meta: Metadata) {
  if (input.kind === 'documentation') {
    const documents = await loadAssistantDocuments(input.topic);
    if (input.topic === 'pricing_history') {
      meta.coverage = 'desatualizada';
      meta.warnings.push('Auditoria histórica: não governa a regra atual. Consulte o tópico pricing para o cânon vigente.');
    }
    if (documents.some(doc => doc.authority === 'mista' || doc.implementation === 'parcial')) {
      meta.warnings.push('O documento contém fotografia datada ou capacidades planejadas. Não comprova disponibilidade atual de todas as funções.');
    }
    for (const doc of documents) reference(meta, doc.id, doc.heading, doc.path);
    return { kind: input.kind, documents } as const;
  }
  if (input.kind === 'sales') {
    const bounds = periodBounds(input.period, now);
    meta.period = { start: bounds.currentStart.toISOString(), end: bounds.currentEnd.toISOString(), timezone: 'America/Sao_Paulo' };
    const result = await loadRowsInRange(db, bounds.currentStart, bounds.currentEnd);
    if (result.error) throw new Error('assistant_sales_read_failed');
    let latestAvailableSaleAt: string | null = null;
    let suggestedPeriod: '30d' | null = null;
    if (!result.data.length) {
      noRows(meta);
      // Uma ausência no intervalo não significa banco vazio nem ausência de vendas reais.
      // Consulte somente a data mais recente; não altere o período nem some vendas de fora dele.
      const latest = await (db as any).from('pedidos_operacionais')
        .select('id,data_venda,snapshot_source').lte('data_venda', bounds.currentEnd.toISOString())
        .order('data_venda', { ascending: false }).order('id').range(0, 0);
      if (latest.error) throw new Error('assistant_sales_read_failed');
      latestAvailableSaleAt = timestamp(latest.data?.[0]?.data_venda);
      meta.includesFixtures = (latest.data || []).some(fixture);
      if (latestAvailableSaleAt && input.period !== '30d'
        && Date.parse(latestAvailableSaleAt) >= periodBounds('30d', now).currentStart.getTime()) suggestedPeriod = '30d';
    }
    const summary = summarize(result.data);
    // A soma preserva exatamente o Dashboard, inclusive amostras já presentes no DEV.
    meta.includesFixtures ||= result.data.some(row => fixture(row));
    if (summary.profitPending) {
      meta.coverage = 'parcial';
      meta.warnings.push('Lucro e margem calculados somente sobre o lucro conhecido; existem vendas com apuração pendente.');
    }
    if (result.data.some(row => row.operational_total == null)) {
      meta.coverage = 'parcial';
      meta.warnings.push('Há vendas sem valor informado; o resumo segue a convenção atual do Dashboard.');
    }
    reference(meta, 'dashboard', 'Resumo do Dashboard', `/dashboard`, null);
    return { kind: input.kind, currency: 'BRL', summary, countedRows: result.data.length, latestAvailableSaleAt, suggestedPeriod } as const;
  }
  if (input.kind === 'tax') {
    const projection = await loadPricingTaxProjection(db, now);
    meta.coverage = 'parcial';
    meta.warnings.push('Projeção operacional, não valor de PGDAS a pagar. A confirmação da alíquota não confirma a apuração do imposto.');
    reference(meta, 'tax', 'Empresa e fiscal', '/configuracoes');
    return { kind: input.kind, currency: 'BRL', projection } as const;
  }
  if (input.kind === 'order' || input.kind === 'invoice') {
    const found = await findOrders(db, input.record);
    meta.includesFixtures = found.rows.some(fixture);
    if (!found.rows.length) { noRows(meta); return null; }
    const candidates = found.rows.map(row => ({ id: String(row.id), saleId: stringOrNull(row.ml_order_id), packId: stringOrNull(row.ml_pack_id) }));
    for (const row of candidates) reference(meta, row.id, `Venda ${row.saleId || row.id}`, saleLink(row.id));
    if (found.rows.length > 1 || (found.count !== null && found.count > 1)) {
      ambiguity(meta, found.count, candidates.length);
      return { kind: 'candidates', candidates } as const;
    }
    const row = found.rows[0];
    if (input.kind === 'invoice') {
      // Cada componente pode ter sua NF. Nunca apresentar apenas a NF primária como sendo todas do pack.
      const { data, error } = await db.from('pedidos')
        .select('id,ml_order_id,nota_fiscal_numero,nfe_status,nfe_xml,nfe_chave,nfe_protocolo,nfe_cfop,nfe_last_sync_at,snapshot_source')
        .in('id', row.operational_pedido_ids?.length ? row.operational_pedido_ids : [row.id]).order('id');
      if (error) throw new Error('assistant_fiscal_read_failed');
      const invoices = (data || []).map(invoice => {
        const reconciliation = reconcileLocalNfeSnapshotFromXml(invoice);
        const projected = { ...invoice, ...reconciliation.updates };
        return { orderId: invoice.id, saleId: stringOrNull(invoice.ml_order_id), number: stringOrNull(projected.nota_fiscal_numero),
          storedStatus: invoice.nfe_status, status: normalizeNfeTechnicalStatus(projected.nfe_status),
          reconciledInMemory: reconciliation.shouldUpdate, updatedAt: timestamp(invoice.nfe_last_sync_at),
          hasXml: Boolean(invoice.nfe_xml), isFixture: fixture(invoice) };
      });
      if (!invoices.length) noRows(meta);
      meta.includesFixtures ||= invoices.some(invoice => invoice.isFixture);
      meta.warnings.push('Estado fiscal local; Brasil NFe não foi consultado e nenhuma correção foi persistida.');
      reference(meta, `invoices:${row.id}`, 'Notas fiscais', '/notas-fiscais');
      return { kind: input.kind, invoices } as const;
    }
    const [enriched, configuration] = await Promise.all([
      enrichPedidosWithCompras([reconcileNotaFiscalEmitidaRow(row).row], db).then(rows => enrichOrdersWithWhatsappStatus(rows, db)),
      loadOperationRuntimeConfiguration(db),
    ]);
    const order = enriched[0];
    if (!order) throw new Error('assistant_order_projection_failed');
    return { kind: input.kind, ...candidates[0], currency: 'BRL', date: timestamp(order.data_venda || order.data),
      status: stringOrNull(order.situacao), total: numberOrNull(row.operational_total), profit: numberOrNull(row.operational_lucro),
      profitPending: Boolean(row.operational_profit_pending),
      progress: getOrderSalesProgress(order, now.getTime()),
      blockers: getOperationalUrgencyReasons(order, configuration.delayedAfterMinutes, now.getTime()),
      dsliteId: stringOrNull(order.dslite_id),
      paymentStatus: stringOrNull(order.supplier_payment_status), fulfillment: stringOrNull(order.fulfillment_source),
      items: (order.pedido_itens || []).map((item: any) => ({ title: stringOrNull(item.titulo), sku: stringOrNull(item.seller_sku), quantity: numberOrNull(item.quantidade) })),
    } as const;
  }
  if (input.kind === 'purchase') {
    const { data, error, count } = await db.from('compras')
      .select('id,dsid,status,status_dslite,fornecedor_id,fornecedor_nome,valor_total,valor_frete,data_criacao,produto_sku,produto_descricao,quantidade,supplier_payment_mode,supplier_payment_status,supplier_payment_amount', { count: 'exact' })
      .eq('dsid', input.dsliteId).order('id').range(0, RECORD_LIMIT - 1);
    if (error) throw new Error('assistant_purchase_read_failed');
    if (!data?.length) { noRows(meta); return null; }
    if (data.length > 1 || (count !== null && count > 1)) {
      ambiguity(meta, count, data.length);
      return { kind: 'candidates', candidates: data.map(row => ({ id: row.id, dsliteId: row.dsid })) } as const;
    }
    const row = data[0];
    const linked = await db.from('pedidos').select('id,ml_order_id,ml_pack_id,snapshot_source').eq('dslite_id', row.dsid).order('id');
    if (linked.error) throw new Error('assistant_purchase_links_failed');
    meta.includesFixtures = fixture(row) || (linked.data || []).some(fixture);
    reference(meta, row.id, `Compra DSLite ${row.dsid}`, `/compras?search=${encodeURIComponent(row.dsid)}`);
    return { kind: input.kind, id: row.id, dsliteId: row.dsid, status: row.status, supplierStatus: row.status_dslite,
      supplierId: row.fornecedor_id, supplierName: row.fornecedor_nome, currency: 'BRL', cost: numberOrNull(row.valor_total), freight: numberOrNull(row.valor_frete),
      date: timestamp(row.data_criacao), supplierSku: row.produto_sku, product: row.produto_descricao, quantity: numberOrNull(row.quantidade),
      payment: { mode: row.supplier_payment_mode, status: row.supplier_payment_status, amount: numberOrNull(row.supplier_payment_amount) },
      sales: (linked.data || []).map(sale => ({ id: sale.id, saleId: stringOrNull(sale.ml_order_id), packId: stringOrNull(sale.ml_pack_id) })),
    } as const;
  }

  const result = await db.from('produtos').select(PRODUCT_COLUMNS, { count: 'exact' })
    .eq(input.record.by === 'id' ? 'id' : 'sku', input.record.value).order('id').range(0, RECORD_LIMIT - 1);
  if (result.error) throw new Error('assistant_product_read_failed');
  if (!result.data?.length) { noRows(meta); return null; }
  if (result.data.length > 1 || (result.count !== null && result.count > 1)) {
    ambiguity(meta, result.count, result.data.length);
    return { kind: 'candidates', candidates: result.data.map(row => ({ id: row.id, sku: row.sku, name: row.nome })) } as const;
  }
  const product = result.data[0];
  meta.includesFixtures = fixture(product);
  reference(meta, product.id, `Produto ${product.sku}`, `/produtos/${encodeURIComponent(product.id)}`, timestamp(product.updated_at));
  if (input.kind === 'inventory') {
    const [capacity, position, mockMovements] = await Promise.all([
      loadProductFulfillmentCapacity(db, product.id),
      (db as any).from('estoque_interno_posicoes').select('fisico_util,reservado,disponivel,em_revisao,nao_aproveitavel,ultima_movimentacao_em').eq('produto_id', product.id).maybeSingle(),
      (db as any).from('estoque_interno_movimentacoes').select('id,snapshot_source').eq('produto_id', product.id).eq('snapshot_source', 'bnt_d05_inventory_mock').limit(1),
    ]);
    if (position.error || mockMovements.error) throw new Error('assistant_stock_read_failed');
    meta.includesFixtures ||= Boolean(mockMovements.data?.length);
    const p = position.data;
    meta.sourceUpdatedAt = timestamp(p?.ultima_movimentacao_em);
    meta.warnings.push('Posição física canônica. As posições exclusivamente visuais/estornadas da tela não são somadas ao saldo operacional.');
    reference(meta, `stock:${product.id}`, 'Estoque', '/estoque', meta.sourceUpdatedAt);
    return { kind: input.kind, productId: product.id, sku: product.sku, name: product.nome, unit: 'unidades', capacity,
      position: p ? { physical: numberOrNull(p.fisico_util), reserved: numberOrNull(p.reservado), available: numberOrNull(p.disponivel),
        inReview: numberOrNull(p.em_revisao), unusable: numberOrNull(p.nao_aproveitavel) } : null } as const;
  }

  const context = await loadPricingRequestContext(db, now.toISOString());
  const listings = (await loadProductMlListings(db, [product.id])).get(product.id) || [];
  const listing = listings[0];
  const costSources: { offerId: string | null; supplierId: string | null; cost: EconomicInput['cost']; eligible: boolean }[] = [];
  const pricing = (await loadProductPricing(db, [product], { requestContext: context,
    evidence: listing ? new Map([[product.id, { mlItemId: listing.itemId,
      currentPriceCents: listing.price == null ? null : Math.round(listing.price * 100),
      marketContextKey: `listing:${listing.itemId}:unquoted` }]]) : undefined,
    evaluate: (base, price, feeRate, observedFee) => {
      costSources.push({ offerId: base.context.offerId, supplierId: base.context.supplierId, cost: base.cost, eligible: base.offerEligible });
      return evaluateProductPricing(base, price, feeRate, observedFee);
    },
  })).get(product.id);
  if (!pricing) throw new Error('assistant_pricing_read_failed');
  const incomplete = pricing.current.status === 'inconclusive' || [pricing.target, pricing.floor, pricing.breakEven].some(e => !e.ok);
  meta.coverage = incomplete ? 'parcial' : 'completa';
  if (incomplete) meta.warnings.push('Memória econômica incompleta: valores ausentes não foram estimados pelo Assistente.');
  const issues = [
    ...(pricing.current.status === 'inconclusive' ? pricing.current.reasons : []),
    ...[pricing.target, pricing.floor, pricing.breakEven].flatMap(p => p.ok ? [] : p.reasons),
  ];
  if (issues.some(issue => issue.code === 'DADO_VENCIDO')) meta.coverage = 'desatualizada';
  meta.warnings.push('Projeção do produto, sem cotação ML viva. Não autoriza publicação, pausa ou alteração de preço.');
  const productFacts = { id: product.id, sku: product.sku, name: product.nome, active: product.ativo,
    updatedAt: timestamp(product.updated_at), supplierSynchronizedAt: timestamp(product.dslite_ultima_sync),
    costSource: costSources[0] ?? null,
    // Projeção canônica é allowlisted: sem permalink externo, descrições brutas ou dados de conta.
    pricing: pricingFacts(pricing),
  };
  if (input.kind === 'product') {
    const capacity = await loadProductFulfillmentCapacity(db, product.id);
    return { kind: input.kind, product: productFacts, capacity } as const;
  }
  const governance = await loadPricingClearances(db, product, pricing);
  return { kind: input.kind, product: productFacts,
    groups: governance.groups.map(group => ({ id: group.id, version: group.version, state: group.state, members: group.members, inFlight: group.inFlight,
      override: group.protection ? { id: group.protection.id, origin: group.protection.origin, createdAt: group.protection.createdAt } : null })),
    clearances: governance.clearances.map(row => ({ id: row.id, state: row.state, startsAt: row.startsAt, endsAt: row.endsAt,
      quantity: row.quantity, maxLossCents: row.maxLossCents, available: row.available, economicDecision: row.economicDecision })),
    executionBlocked: true,
  } as const;
}

function pricingFacts(pricing: ProductPricing) {
  return { costCents: pricing.costCents, currentPriceCents: pricing.currentPriceCents, current: pricing.current,
    target: pricing.target, floor: pricing.floor, breakEven: pricing.breakEven };
}

export type AssistantKnowledgeFacts = Awaited<ReturnType<typeof readFacts>>;
export type AssistantKnowledgeResult = Metadata & {
  facts: AssistantKnowledgeFacts; environment: 'dev'; queriedAt: string; filters: AssistantQuery | null;
  contentIsUntrusted: true;
};

/** Única entrada. Não recebe principal, cargo, SQL, client Supabase ou caminhos vindos do chamador. */
export async function queryAssistantKnowledge(request: Request, input: unknown): Promise<AssistantKnowledgeResult> {
  const now = new Date();
  const meta: Metadata = { state: 'concluido', coverage: 'completa', references: [], warnings: [], sourceUpdatedAt: null, includesFixtures: false, period: null };
  const result = (facts: AssistantKnowledgeFacts = null, filters: AssistantQuery | null = null): AssistantKnowledgeResult => {
    console.info('[assistant_knowledge]', { kind: filters?.kind ?? null, state: meta.state, coverage: meta.coverage,
      elapsedMs: Date.now() - now.getTime(), sourceCount: meta.references.length });
    return structuredClone({ ...meta, facts, environment: 'dev', queriedAt: now.toISOString(), filters, contentIsUntrusted: true });
  };
  const parsed = assistantQuerySchema.safeParse(input);
  if (!parsed.success) { meta.state = 'entrada_invalida'; meta.coverage = 'sem_dados'; return result(); }
  const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeout]);
  let transport: ReturnType<typeof createAssistantReadTransport> | undefined;
  function clearEvidence() {
    meta.references = []; meta.warnings = []; meta.period = null; meta.sourceUpdatedAt = null; meta.includesFixtures = false;
  }
  async function abortable<T>(operation: Promise<T>): Promise<T> {
    if (signal.aborted) throw new AssistantReadError('cancelado');
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        onAbort = () => reject(new AssistantReadError('cancelado'));
        signal.addEventListener('abort', onAbort, { once: true });
      })]);
    } finally { signal.removeEventListener('abort', onAbort); }
  }
  try {
    if (signal.aborted) throw new AssistantReadError('cancelado');
    try { assertAssistantDestination(resolveSupabaseServiceUrl()); }
    catch { meta.state = 'ambiente_bloqueado'; meta.coverage = 'sem_dados'; return result(); }
    const allowed = process.env.BENTEVI_ASSISTANT_PILOT_USER_ID;
    if (!allowed || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(allowed)) {
      meta.state = 'acesso_negado'; meta.coverage = 'sem_dados'; return result();
    }
    const permission = PERMISSIONS[parsed.data.kind];
    const auth = await abortable(authorizeApiRequest(request, permission));
    if (!auth.ok || auth.userId !== allowed) { meta.state = 'acesso_negado'; meta.coverage = 'sem_dados'; return result(); }
    transport = createAssistantReadTransport(resolveSupabaseServiceUrl(), signal);
    const db = createServiceClient({ fetch: transport.fetch });
    async function isAdmin() {
      const profile = await db.from('profiles').select('cargo').eq('id', allowed!).maybeSingle();
      return !profile.error && profile.data?.cargo === 'admin';
    }
    if (!await abortable(isAdmin())) { meta.state = 'acesso_negado'; meta.coverage = 'sem_dados'; return result(); }
    const facts = await abortable(readFacts(db, parsed.data, now, meta));
    transport.assertHealthy();
    // Não devolver o resultado se a sessão/permissão foi revogada durante a consulta.
    const finalAuth = await abortable(authorizeApiRequest(request, permission));
    if (!finalAuth.ok || finalAuth.userId !== allowed || process.env.BENTEVI_ASSISTANT_PILOT_USER_ID !== allowed || !await abortable(isAdmin())) {
      meta.state = 'acesso_negado'; meta.coverage = 'sem_dados'; clearEvidence(); return result();
    }
    transport.assertHealthy();
    if (meta.includesFixtures) meta.warnings.push('Contém amostra protegida/demonstrativa de homologação; não representa operação real atual.');
    if (!meta.sourceUpdatedAt) meta.warnings.push('Não há timestamp único que comprove a atualização de todas as fontes. Horário da consulta não é horário da sincronização.');
    return result(facts, parsed.data);
  } catch (error) {
    try { transport?.assertHealthy(); } catch (transportError) { error = transportError; }
    clearEvidence();
    meta.coverage = error instanceof AssistantReadError && error.code === 'fonte_parcial' ? 'parcial' : 'sem_dados';
    meta.state = request.signal.aborted ? 'cancelado' : timeout.aborted ? 'tempo_esgotado' : 'fonte_indisponivel';
    if (meta.coverage === 'parcial') meta.warnings.push('Fonte excedeu o limite de consulta; nenhum total parcial foi apresentado como completo.');
    return result();
  }
}
