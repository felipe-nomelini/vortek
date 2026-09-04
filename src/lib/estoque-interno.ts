import { createServiceClient } from '@/lib/supabase';
import { getSkuLookupVariants } from '@/lib/sku';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import {
  calcularSaldoEstoqueInterno,
  expandirItensReservaEstoqueInterno,
  type ComposicaoKitEstoqueInterno,
} from '@/lib/estoque-interno-saldo';
import { fetchMLResult } from '@/services/integration';
import { z } from 'zod';
import { isModifiableMlListingStatus } from '@/lib/ml/operational-listing';
import {
  selectOrderFulfillment,
  type OrderFulfillmentStockItem,
} from '@/lib/orders/fulfillment-selection';
import {
  loadInternalStockBalances,
  loadProductFulfillmentCapacity,
} from '@/lib/orders/fulfillment-capacity-loader';

export type ItemEstoquePedido = OrderFulfillmentStockItem;

export async function expandirComponentesKitEstoqueInterno(
  db: ReturnType<typeof createServiceClient>,
  itens: ItemEstoquePedido[],
): Promise<ItemEstoquePedido[]> {
  const produtoIds = Array.from(new Set(itens.map((item) => item.produtoId)));
  const { data: kits, error: kitsError } = await (db as any)
    .from('produto_kits')
    .select('produto_id,ativo')
    .in('produto_id', produtoIds);
  if (kitsError) throw new Error(kitsError.message);
  if (!kits?.length) return itens;

  const kitByProductId = new Map<string, any>((kits || []).map((kit: any) => [String(kit.produto_id), kit]));
  const kitIds = Array.from(kitByProductId.keys());
  const { data: componentes, error: componentesError } = await (db as any)
    .from('produto_kit_componentes')
    .select('kit_produto_id,componente_produto_id,quantidade')
    .in('kit_produto_id', kitIds);
  if (componentesError) throw new Error(componentesError.message);

  const componentesPorKit = new Map<string, any[]>();
  for (const componente of componentes || []) {
    const kitId = String(componente.kit_produto_id || '');
    const atuais = componentesPorKit.get(kitId) || [];
    atuais.push(componente);
    componentesPorKit.set(kitId, atuais);
  }

  const componenteIds = Array.from(new Set<string>(
    (componentes || []).map((componente: any) => String(componente.componente_produto_id || '')).filter(Boolean),
  ));
  const { data: produtosComponentes, error: produtosComponentesError } = componenteIds.length > 0
    ? await db
        .from('produtos')
        .select('id,sku,ativo')
        .in('id', componenteIds)
    : { data: [], error: null };
  if (produtosComponentesError) throw new Error(produtosComponentesError.message);
  const produtoComponenteById = new Map<string, any>(
    (produtosComponentes || []).map((produto: any) => [String(produto.id), produto]),
  );

  const composicoes = new Map<string, ComposicaoKitEstoqueInterno>();
  for (const [kitId, kit] of kitByProductId) {
    composicoes.set(kitId, {
      ativo: kit.ativo !== false,
      componentes: (componentesPorKit.get(kitId) || []).map((linha: any) => {
        const produto = produtoComponenteById.get(String(linha.componente_produto_id || ''));
        return {
          produtoId: String(linha.componente_produto_id || ''),
          sku: String(produto?.sku || ''),
          ativo: produto?.ativo !== false && Boolean(produto?.sku),
          quantidade: Number(linha.quantidade || 0),
        };
      }),
    });
  }

  return expandirItensReservaEstoqueInterno(itens, composicoes);
}

const ML_RETURN_ADDRESS_CACHE_MS = 5 * 60 * 1000;

const mlUserIdSchema = z.object({
  id: z.union([z.string(), z.number()]),
}).passthrough();

const mlUserAddressSchema = z.object({
  id: z.union([z.string(), z.number()]),
  zip_code: z.string().nullable().optional(),
  types: z.array(z.string()).optional().catch([]),
}).passthrough();

const mlUserAddressesSchema = z.array(mlUserAddressSchema);
export type MlUserAddress = z.infer<typeof mlUserAddressSchema>;
export type InternalStockAddressIdentity = {
  addressId: string | null;
  zipCode: string | null;
};

let mlReturnAddressCache: {
  expiresAt: number;
  addresses: MlUserAddress[];
} | null = null;

function somenteDigitos(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Confirma o endereço físico da Vortek no Rio de Janeiro.
 * `seller_address` sozinho não basta: fornecedores também usam esse tipo no ML.
 */
export function isEnderecoEstoqueInternoMl(
  address: any,
  configured: InternalStockAddressIdentity,
): boolean {
  const addressId = String(address?.address_id || address?.id || '').trim();
  const zipCode = somenteDigitos(address?.zip_code);
  const configuredAddressId = String(configured.addressId || '').trim();
  const configuredZipCode = somenteDigitos(configured.zipCode);
  return Boolean(
    (configuredAddressId && addressId === configuredAddressId)
    || (configuredZipCode && zipCode === configuredZipCode),
  );
}

/**
 * Obtém o endereço de devolução configurado na conta do Mercado Livre.
 * Em envios sem claim, `shipment.origin` é a origem da ida e não pode ser
 * usado como destino da logística reversa.
 */
export async function listarEnderecosUsuarioMl(): Promise<MlUserAddress[]> {
  if (mlReturnAddressCache && mlReturnAddressCache.expiresAt > Date.now()) {
    return mlReturnAddressCache.addresses;
  }

  const meResult = await fetchMLResult<unknown>('/users/me?attributes=id');
  const meParsed = meResult.ok ? mlUserIdSchema.safeParse(meResult.data) : null;
  if (!meParsed?.success) {
    console.error('[internal_stock_return_address_lookup_failed]', {
      step: 'users_me',
      status: meResult.status,
      code: meResult.error?.code || 'invalid_response',
    });
    throw new Error('Não foi possível identificar a conta Mercado Livre conectada');
  }

  const addressesResult = await fetchMLResult<unknown>(
    `/users/${encodeURIComponent(String(meParsed.data.id))}/addresses`,
  );
  const addressesParsed = addressesResult.ok
    ? mlUserAddressesSchema.safeParse(addressesResult.data)
    : null;
  if (!addressesParsed?.success) {
    console.error('[internal_stock_return_address_lookup_failed]', {
      step: 'user_addresses',
      status: addressesResult.status,
      code: addressesResult.error?.code || 'invalid_response',
    });
    throw new Error('Não foi possível consultar os endereços da conta Mercado Livre');
  }

  mlReturnAddressCache = {
    addresses: addressesParsed.data,
    expiresAt: Date.now() + ML_RETURN_ADDRESS_CACHE_MS,
  };
  return addressesParsed.data;
}

export async function obterEnderecoRetornoPadraoMl(): Promise<MlUserAddress | null> {
  const addresses = await listarEnderecosUsuarioMl().catch(() => []);
  return addresses.find((candidate) => (
    (candidate.types || []).includes('default_return_address')
  )) || null;
}

export async function resolverItensEstoqueEnvioInterno(pedidoId: string): Promise<ItemEstoquePedido[]> {
  const db = createServiceClient();
  const { data: itens, error } = await db
    .from('pedido_itens')
    .select('ml_item_id,seller_sku,quantidade')
    .eq('pedido_id', pedidoId);

  if (error) throw new Error(error.message);
  if (!itens?.length) throw new Error('Pedido sem itens para movimentar no estoque interno.');

  const agrupados = new Map<string, ItemEstoquePedido>();
  for (const item of itens) {
    let sku = String(item.seller_sku || '').trim();
    const mlItemId = String(item.ml_item_id || '').trim();
    const quantidade = Number(item.quantidade || 0);
    if (quantidade <= 0) throw new Error('Pedido possui item sem quantidade válida.');

    const variantesSku = getSkuLookupVariants(sku);
    const { data: produtoDireto, error: produtoError } = variantesSku.length > 0
      ? await db
          .from('produtos')
          .select('id,sku')
          .in('sku', variantesSku)
          .maybeSingle()
      : mlItemId
        ? await db
            .from('produtos')
            .select('id,sku')
            .eq('ml_item_id', mlItemId)
            .maybeSingle()
        : { data: null, error: null };
    if (produtoError) throw new Error(produtoError.message);

    let produtoId = produtoDireto?.id ? String(produtoDireto.id) : null;
    if (!sku && produtoDireto?.sku) sku = String(produtoDireto.sku).trim();
    if (!produtoId && variantesSku.length > 0) {
      const [ofertasPorSku, ofertasPorSkuFornecedor] = await Promise.all([
        db
          .from('produto_fornecedor_ofertas')
          .select('produto_id')
          .in('sku_oferta', variantesSku),
        db
          .from('produto_fornecedor_ofertas')
          .select('produto_id')
          .in('sku_fornecedor', variantesSku),
      ]);
      if (ofertasPorSku.error) throw new Error(ofertasPorSku.error.message);
      if (ofertasPorSkuFornecedor.error) throw new Error(ofertasPorSkuFornecedor.error.message);
      produtoId = String(ofertasPorSku.data?.[0]?.produto_id || ofertasPorSkuFornecedor.data?.[0]?.produto_id || '').trim() || null;
    }
    if (!produtoId && mlItemId) {
      const { data: catalogLink, error: catalogError } = await db
        .from('catalogo_ml_snapshot')
        .select('produto_id,sku_local')
        .eq('ml_item_id', mlItemId)
        .maybeSingle();
      if (catalogError) throw new Error(catalogError.message);
      produtoId = String(catalogLink?.produto_id || '').trim() || null;
      if (!sku && catalogLink?.sku_local) sku = String(catalogLink.sku_local).trim();
    }
    if (!produtoId) throw new Error(`Produto interno não encontrado: ${sku || mlItemId || 'sem identificação'}`);
    if (!sku) {
      const { data: produto } = await db
        .from('produtos')
        .select('sku')
        .eq('id', produtoId)
        .maybeSingle();
      sku = String(produto?.sku || '').trim();
    }
    if (!sku) throw new Error(`Produto interno sem SKU: ${produtoId}`);

    const atual = agrupados.get(produtoId);
    agrupados.set(produtoId, {
      produtoId,
      sku,
      quantidade: (atual?.quantidade || 0) + quantidade,
    });
  }
  return expandirComponentesKitEstoqueInterno(db, [...agrupados.values()]);
}

/** Saldo físico já conferido e liberado para um novo envio próprio. */
export async function obterSaldoEstoqueInternoProduto(produtoId: string): Promise<number> {
  const db = createServiceClient();
  const { data: movimentos, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('tipo,quantidade,situacao_estoque,estornada_em')
    .eq('produto_id', produtoId);
  if (error) throw new Error(error.message);

  return calcularSaldoEstoqueInterno(movimentos || []);
}

export type MlObservedStock = {
  mlItemId: string;
  availableQuantity: number | null;
  status: string | null;
};

/**
 * Publica o maior saldo disponível: qualquer fornecedor operacional ou estoque próprio.
 * Estoques de fornecedores não são somados, para não anunciar quantidade que
 * não pode ser atendida simultaneamente por uma única origem.
 */
export async function enfileirarSyncMlEstoqueInterno(
  produtoId: string,
  observed?: MlObservedStock,
) {
  const db = createServiceClient();
  const { data: produto, error: produtoError } = await db
    .from('produtos')
    .select('id,sku,ml_item_id,ativo')
    .eq('id', produtoId)
    .maybeSingle();
  if (produtoError) throw new Error(produtoError.message);
  if (!produto) return { enfileirados: 0, bloqueadosManualmente: 0, semAlteracao: 0, emProcessamento: 0 };
  if (produto.ativo === false) {
    return { enfileirados: 0, bloqueadosManualmente: 0, semAlteracao: 0, emProcessamento: 0 };
  }

  const capacity = await loadProductFulfillmentCapacity(db, String(produto.id));
  const estoqueDisponivel = capacity.safe;
  const { data: anuncios, error: anunciosError } = await db
    .from('anuncios_ml')
    .select('ml_item_id,status')
    .eq('produto_id', produto.id);
  if (anunciosError) throw new Error(anunciosError.message);

  const candidateItemIds = Array.from(new Set([
    String(produto.ml_item_id || '').trim(),
    ...(anuncios || []).map((anuncio: any) => String(anuncio.ml_item_id || '').trim()),
  ].filter(Boolean)));
  const { data: observedListings, error: observedListingsError } = candidateItemIds.length > 0
    ? await db
        .from('catalogo_ml_snapshot')
        .select('ml_item_id,status')
        .in('ml_item_id', candidateItemIds)
    : { data: [], error: null };
  if (observedListingsError) throw new Error(observedListingsError.message);

  const observedStatusById = new Map<string, string>(
    (observedListings || []).map((listing: any) => [
      String(listing.ml_item_id || '').trim(),
      String(listing.status || '').trim().toLowerCase(),
    ]),
  );
  const localStatusById = new Map<string, string>(
    (anuncios || []).map((listing: any) => [
      String(listing.ml_item_id || '').trim(),
      String(listing.status || '').trim().toLowerCase() === 'ativo' ? 'active' : 'paused',
    ]),
  );

  let mlItemIds = candidateItemIds.filter((mlItemId) => {
    const observedStatus = observedStatusById.get(mlItemId);
    return observedStatus
      ? isModifiableMlListingStatus(observedStatus)
      : isModifiableMlListingStatus(localStatusById.get(mlItemId));
  });
  if (observed?.mlItemId) {
    const targetItemId = String(observed.mlItemId).trim();
    mlItemIds = mlItemIds.filter((mlItemId) => mlItemId === targetItemId);
  }
  if (!mlItemIds.length) return { enfileirados: 0, bloqueadosManualmente: 0, semAlteracao: 0, emProcessamento: 0 };

  const sku = String(produto.sku || '').trim().toUpperCase();
  const [manualByItem, manualBySku] = await Promise.all([
    (db as any).from('ml_manual_blocklist').select('ml_item_id').eq('ativo', true).in('ml_item_id', mlItemIds),
    sku ? (db as any).from('ml_manual_blocklist').select('sku').eq('ativo', true).in('sku', [sku]) : Promise.resolve({ data: [], error: null }),
  ]);
  if (manualByItem.error) throw new Error(manualByItem.error.message);
  if (manualBySku.error) throw new Error(manualBySku.error.message);
  const bloqueados = new Set((manualByItem.data || []).map((row: any) => String(row.ml_item_id || '').trim()));
  const skuBloqueado = (manualBySku.data || []).length > 0;

  let enfileirados = 0;
  let bloqueadosManualmente = 0;
  let semAlteracao = 0;
  let emProcessamento = 0;
  const observedStatusNormalized = String(observed?.status || '').trim().toLowerCase();
  for (const mlItemId of mlItemIds) {
    if (skuBloqueado || bloqueados.has(mlItemId)) {
      bloqueadosManualmente += 1;
      continue;
    }
    const observedQuantity = Number(observed?.availableQuantity);
    const observedStatus = observed?.mlItemId === mlItemId
      ? observedStatusNormalized
      : observedStatusById.get(mlItemId) || localStatusById.get(mlItemId) || '';
    const desiredStatus = estoqueDisponivel <= 0
      ? 'paused'
      : observedStatus === 'paused'
        ? 'paused'
        : 'active';
    if (
      observed?.mlItemId === mlItemId
      && observed.availableQuantity !== null
      && Number.isFinite(observedQuantity)
      && Math.max(0, Math.trunc(observedQuantity)) === estoqueDisponivel
      && observedStatus === desiredStatus
    ) {
      semAlteracao += 1;
      continue;
    }
    const observedTarget = observed?.mlItemId === mlItemId;
    const observedQuantityDiffers = observedTarget
      && observed?.availableQuantity !== null
      && Number.isFinite(observedQuantity)
      && Math.max(0, Math.trunc(observedQuantity)) !== estoqueDisponivel;
    const observedStatusDiffers = observedTarget
      && Boolean(observedStatus)
      && observedStatus !== desiredStatus;
    const result = await enqueueMlPublishOutbox(db, {
      produtoId: String(produto.id),
      mlItemId,
      desiredStatus: desiredStatus === 'active' ? 'ativo' : 'pausado',
      desiredQuantity: estoqueDisponivel,
      source: 'internal_stock_automation',
      dedupePending: true,
      forceQuantityPublish: observedQuantityDiffers,
      forceStatusPublish: observedStatusDiffers,
      payload: {
        apply_price: false,
        apply_quantity_pricing: false,
        apply_quantity: true,
        apply_status: true,
        sku: produto.sku,
        estoque_fornecedor: capacity.supplier,
        estoque_interno: capacity.internal,
        estoque_disponivel: estoqueDisponivel,
      },
    });
    if (!result.ok) throw new Error(result.error);
    if (result.action === 'unchanged' || result.action === 'skipped_ineligible') semAlteracao += 1;
    else enfileirados += 1;
  }
  return { enfileirados, bloqueadosManualmente, semAlteracao, emProcessamento };
}

async function obterReservasDoPedido(pedidoId: string): Promise<Map<string, number>> {
  const db = createServiceClient();
  const { data, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('produto_id,quantidade')
    .eq('pedido_id', pedidoId)
    .eq('tipo', 'saida_envio_interno')
    .is('estornada_em', null);
  if (error) throw new Error(error.message);

  return new Map((data || []).map((row: any) => [
    String(row.produto_id),
    Number(row.quantidade || 0),
  ]));
}

/** Confere saldo liberado antes de emitir NF ou baixar etiqueta de envio interno. */
export async function validarEstoqueEnvioInterno(pedidoId: string) {
  const itens = await resolverItensEstoqueEnvioInterno(pedidoId);
  const reservasAtuais = await obterReservasDoPedido(pedidoId);
  const db = createServiceClient();
  const saldos = await loadInternalStockBalances(
    db,
    itens.map((item) => item.produtoId),
  );
  for (const item of itens) {
    const quantidadePendente = Math.max(0, item.quantidade - (reservasAtuais.get(item.produtoId) || 0));
    if (quantidadePendente <= 0) continue;
    const saldo = saldos.get(item.produtoId) || 0;
    if (saldo < quantidadePendente) {
      throw new Error(`Estoque interno insuficiente para ${item.sku}. Disponível: ${saldo}.`);
    }
  }
  return itens;
}

/** Seleciona internal e reserva todos os componentes na mesma transação. */
export async function reservarEnvioInterno(pedidoId: string) {
  const itens = await resolverItensEstoqueEnvioInterno(pedidoId);
  const db = createServiceClient();
  const selection = await selectOrderFulfillment(db, pedidoId, 'internal', itens);

  await Promise.all(itens.map(async (item) => {
    try {
      await enfileirarSyncMlEstoqueInterno(item.produtoId);
    } catch (error: any) {
      console.error('[internal_stock_reservation_ml_sync_failed]', { pedidoId, produtoId: item.produtoId, error: error?.message || error });
    }
  }));

  return { selection, itens };
}

/** Converte a reserva em saída física de forma idempotente. */
export async function despacharReservaEnvioInterno(pedidoId: string) {
  const db = createServiceClient();
  const { data, error } = await (db as any).rpc('dispatch_internal_stock_reservation', {
    p_pedido_id: pedidoId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const produtoIds: string[] = Array.isArray(row?.produto_ids)
    ? row.produto_ids.map(String).filter(Boolean)
    : [];

  await Promise.all(produtoIds.map(async (produtoId: string) => {
    try {
      await enfileirarSyncMlEstoqueInterno(produtoId);
    } catch (syncError: any) {
      console.error('[internal_stock_dispatch_ml_sync_failed]', {
        pedidoId,
        produtoId,
        error: syncError?.message || syncError,
      });
    }
  }));

  return {
    despachadas: Number(row?.movimentos_atualizados || 0),
    produtoIds,
  };
}

/**
 * Estorna de forma idempotente as reservas de um pedido cancelado.
 * A movimentação permanece no banco para auditoria.
 */
export async function estornarReservaEnvioInternoCancelado(
  pedidoId: string,
  motivo: string,
) {
  const db = createServiceClient();
  const { data, error } = await (db as any).rpc('reverse_internal_stock_commitment', {
    p_pedido_id: pedidoId,
    p_motivo: motivo,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const produtoIds: string[] = Array.isArray(row?.produto_ids)
    ? row.produto_ids.map(String).filter(Boolean)
    : [];

  await Promise.all(produtoIds.map(async (produtoId) => {
    try {
      await enfileirarSyncMlEstoqueInterno(produtoId);
    } catch (syncError: any) {
      console.error('[internal_stock_cancel_reversal_ml_sync_failed]', {
        pedidoId,
        produtoId,
        error: syncError?.message || syncError,
      });
    }
  }));

  return {
    estornadas: Number(row?.movimentos_atualizados || 0),
    produtoIds,
  };
}

/** Toda devolução entra bloqueada; operador libera somente após conferência física. */
export async function registrarDevolucaoInterna(
  pedidoId: string,
  motivo: string,
  statusDevolucao: string,
  destinoEstoqueInterno: boolean,
) {
  if (!destinoEstoqueInterno) return;

  const itens = await resolverItensEstoqueEnvioInterno(pedidoId);
  const db = createServiceClient();

  for (const item of itens) {
    const movimentos = (db as any).from('estoque_interno_movimentacoes');
    const { data: existente, error: consultaError } = await movimentos
      .select('id')
      .eq('produto_id', item.produtoId)
      .eq('pedido_id', pedidoId)
      .eq('tipo', 'entrada_devolucao')
      .maybeSingle();
    if (consultaError) throw new Error(consultaError.message);

    const { error } = existente
      ? await movimentos
        .update({ quantidade: item.quantidade, motivo, status_devolucao: statusDevolucao })
        .eq('id', existente.id)
      : await movimentos.insert({
        produto_id: item.produtoId,
        pedido_id: pedidoId,
        tipo: 'entrada_devolucao',
        quantidade: item.quantidade,
        motivo,
        status_devolucao: statusDevolucao,
        situacao_estoque: 'revisao',
        disponivel_venda: false,
      });
    if (error) throw new Error(error.message);
  }
}
