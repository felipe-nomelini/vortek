import { createServiceClient } from '@/lib/supabase';
import { getSkuLookupVariants } from '@/lib/sku';

type ItemEstoquePedido = {
  produtoId: string;
  sku: string;
  quantidade: number;
};

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

async function saldoDisponivelProduto(produtoId: string): Promise<number> {
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

/** Confere saldo liberado antes de emitir NF ou baixar etiqueta de envio interno. */
export async function validarEstoqueEnvioInterno(pedidoId: string) {
  const itens = await carregarItensEstoquePedido(pedidoId);
  for (const item of itens) {
    const saldo = await saldoDisponivelProduto(item.produtoId);
    if (saldo < item.quantidade) {
      throw new Error(`Estoque interno insuficiente para ${item.sku}. Disponível: ${saldo}.`);
    }
  }
  return itens;
}

/** Registra baixa somente após etiqueta estar salva no sistema. */
export async function reservarEnvioInterno(pedidoId: string) {
  const itens = await validarEstoqueEnvioInterno(pedidoId);
  const db = createServiceClient();

  for (const item of itens) {
    const { error } = await (db as any)
      .from('estoque_interno_movimentacoes')
      .insert({
        produto_id: item.produtoId,
        pedido_id: pedidoId,
        tipo: 'saida_envio_interno',
        quantidade: item.quantidade,
        motivo: 'Envio interno',
      });
    if (error) throw new Error(error.message);
  }
}

/** Toda devolução entra bloqueada; operador libera somente após conferência física. */
export async function registrarDevolucaoInterna(pedidoId: string, motivo: string, statusDevolucao: string) {
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
