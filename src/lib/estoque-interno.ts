import { createServiceClient } from '@/lib/supabase';
import { getSkuLookupVariants } from '@/lib/sku';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

type ItemEstoquePedido = {
  produtoId: string;
  sku: string;
  quantidade: number;
};

const ESTOQUE_INTERNO_RETURN_ADDRESS_ID = '1634853936';
const ESTOQUE_INTERNO_RETURN_ZIP_CODE = '21011550';

function somenteDigitos(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Confirma o endereço físico da Vortek no Rio de Janeiro.
 * `seller_address` sozinho não basta: fornecedores também usam esse tipo no ML.
 */
export function isEnderecoEstoqueInternoMl(address: any): boolean {
  const addressId = String(address?.address_id || '').trim();
  const zipCode = somenteDigitos(address?.zip_code);
  return addressId === ESTOQUE_INTERNO_RETURN_ADDRESS_ID
    || zipCode === ESTOQUE_INTERNO_RETURN_ZIP_CODE;
}

async function carregarItensEstoquePedido(pedidoId: string): Promise<ItemEstoquePedido[]> {
  const db = createServiceClient();
  const { data: itens, error } = await db
    .from('pedido_itens')
    .select('seller_sku,quantidade')
    .eq('pedido_id', pedidoId);

  if (error) throw new Error(error.message);
  if (!itens?.length) throw new Error('Pedido sem itens para movimentar no estoque interno.');

  const agrupados = new Map<string, ItemEstoquePedido>();
  for (const item of itens) {
    const sku = String(item.seller_sku || '').trim();
    const quantidade = Number(item.quantidade || 0);
    if (!sku || quantidade <= 0) throw new Error('Pedido possui item sem SKU ou quantidade válida.');

    const variantesSku = getSkuLookupVariants(sku);
    const { data: produtoDireto, error: produtoError } = await db
      .from('produtos')
      .select('id')
      .in('sku', variantesSku)
      .maybeSingle();
    if (produtoError) throw new Error(produtoError.message);

    let produtoId = produtoDireto?.id ? String(produtoDireto.id) : null;
    if (!produtoId) {
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
    if (!produtoId) throw new Error(`Produto interno não encontrado: ${sku}`);

    const atual = agrupados.get(produtoId);
    agrupados.set(produtoId, {
      produtoId,
      sku,
      quantidade: (atual?.quantidade || 0) + quantidade,
    });
  }
  return [...agrupados.values()];
}

/** Saldo físico já conferido e liberado para um novo envio próprio. */
export async function obterSaldoEstoqueInternoProduto(produtoId: string): Promise<number> {
  const db = createServiceClient();
  const { data: movimentos, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('tipo,quantidade,situacao_estoque')
    .eq('produto_id', produtoId);
  if (error) throw new Error(error.message);

  return (movimentos || []).reduce((saldo: number, movimento: any) => (
    saldo
      + (movimento.tipo === 'entrada_devolucao' && movimento.situacao_estoque === 'liberado' ? Number(movimento.quantidade) : 0)
      - (movimento.tipo === 'saida_envio_interno' ? Number(movimento.quantidade) : 0)
  ), 0);
}

export type MlObservedStock = {
  mlItemId: string;
  availableQuantity: number | null;
  status: string | null;
};

/**
 * Publica o maior saldo disponível: fornecedor selecionado ou estoque próprio.
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
    .select('id,sku,estoque,ml_item_id')
    .eq('id', produtoId)
    .maybeSingle();
  if (produtoError) throw new Error(produtoError.message);
  if (!produto) return { enfileirados: 0, bloqueadosManualmente: 0, semAlteracao: 0, emProcessamento: 0 };

  const saldoInterno = await obterSaldoEstoqueInternoProduto(String(produto.id));
  const estoqueDisponivel = Math.max(Number(produto.estoque || 0), saldoInterno);
  const { data: anuncios, error: anunciosError } = await db
    .from('anuncios_ml')
    .select('ml_item_id')
    .eq('produto_id', produto.id);
  if (anunciosError) throw new Error(anunciosError.message);

  let mlItemIds = Array.from(new Set([
    String(produto.ml_item_id || '').trim(),
    ...(anuncios || []).map((anuncio: any) => String(anuncio.ml_item_id || '').trim()),
  ].filter(Boolean)));
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
  const desiredStatus = estoqueDisponivel <= 0
    ? 'paused'
    : observedStatusNormalized === 'paused'
      ? 'paused'
      : 'active';
  for (const mlItemId of mlItemIds) {
    if (skuBloqueado || bloqueados.has(mlItemId)) {
      bloqueadosManualmente += 1;
      continue;
    }
    const observedQuantity = Number(observed?.availableQuantity);
    const observedStatus = observedStatusNormalized;
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
    if (observed?.mlItemId === mlItemId) {
      const { data: processing, error: processingError } = await (db as any)
        .from('anuncios_ml_outbox')
        .select('id')
        .eq('ml_item_id', mlItemId)
        .eq('status', 'processing')
        .limit(1)
        .maybeSingle();
      if (processingError) throw new Error(processingError.message);
      if (processing?.id) {
        emProcessamento += 1;
        continue;
      }
    }
    const result = await enqueueMlPublishOutbox(db, {
      produtoId: String(produto.id),
      mlItemId,
      desiredStatus: desiredStatus === 'active' ? 'ativo' : 'pausado',
      desiredQuantity: estoqueDisponivel,
      source: 'internal_stock_automation',
      dedupePending: true,
      payload: {
        apply_price: false,
        apply_quantity_pricing: false,
        apply_quantity: true,
        apply_status: true,
        sku: produto.sku,
        estoque_fornecedor: Number(produto.estoque || 0),
        estoque_interno: saldoInterno,
        estoque_disponivel: estoqueDisponivel,
      },
    });
    if (!result.ok) throw new Error(result.error);
    enfileirados += 1;
  }
  return { enfileirados, bloqueadosManualmente, semAlteracao, emProcessamento };
}

async function obterReservasDoPedido(pedidoId: string): Promise<Map<string, number>> {
  const db = createServiceClient();
  const { data, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('produto_id,quantidade')
    .eq('pedido_id', pedidoId)
    .eq('tipo', 'saida_envio_interno');
  if (error) throw new Error(error.message);

  return new Map((data || []).map((row: any) => [
    String(row.produto_id),
    Number(row.quantidade || 0),
  ]));
}

/** Confere saldo liberado antes de emitir NF ou baixar etiqueta de envio interno. */
export async function validarEstoqueEnvioInterno(pedidoId: string) {
  const itens = await carregarItensEstoquePedido(pedidoId);
  const reservasAtuais = await obterReservasDoPedido(pedidoId);
  for (const item of itens) {
    const quantidadePendente = Math.max(0, item.quantidade - (reservasAtuais.get(item.produtoId) || 0));
    if (quantidadePendente <= 0) continue;
    const saldo = await obterSaldoEstoqueInternoProduto(item.produtoId);
    if (saldo < quantidadePendente) {
      throw new Error(`Estoque interno insuficiente para ${item.sku}. Disponível: ${saldo}.`);
    }
  }
  return itens;
}

/** Registra baixa somente após etiqueta estar salva no sistema. */
export async function reservarEnvioInterno(pedidoId: string) {
  const itens = await validarEstoqueEnvioInterno(pedidoId);
  const db = createServiceClient();
  const reservasAtuais = await obterReservasDoPedido(pedidoId);

  for (const item of itens) {
    if ((reservasAtuais.get(item.produtoId) || 0) >= item.quantidade) continue;
    const { error } = await (db as any)
      .from('estoque_interno_movimentacoes')
      .insert({
        produto_id: item.produtoId,
        pedido_id: pedidoId,
        tipo: 'saida_envio_interno',
        quantidade: item.quantidade,
        motivo: 'Envio interno',
      });
    // A restrição única (pedido, produto, tipo) torna nova tentativa da mesma
    // etiqueta segura: não pode baixar o estoque pela segunda vez.
    if (error && String((error as any).code || '') !== '23505') throw new Error(error.message);
  }

  await Promise.all(itens.map(async (item) => {
    try {
      await enfileirarSyncMlEstoqueInterno(item.produtoId);
    } catch (error: any) {
      // A etiqueta já foi salva e a baixa é válida; a fila ML será refeita no
      // próximo sync externo, sem transformar um envio concluído em erro.
      console.error('[internal_stock_ml_sync_failed]', { pedidoId, produtoId: item.produtoId, error: error?.message || error });
    }
  }));
}

/** Toda devolução entra bloqueada; operador libera somente após conferência física. */
export async function registrarDevolucaoInterna(
  pedidoId: string,
  motivo: string,
  statusDevolucao: string,
  destinoEstoqueInterno: boolean,
) {
  if (!destinoEstoqueInterno) return;

  const itens = await carregarItensEstoquePedido(pedidoId);
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
