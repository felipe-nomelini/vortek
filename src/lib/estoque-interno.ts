import { createServiceClient } from '@/lib/supabase';

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

    const { data: produto, error: produtoError } = await db
      .from('produtos')
      .select('id')
      .eq('sku', sku)
      .maybeSingle();
    if (produtoError) throw new Error(produtoError.message);
    if (!produto) throw new Error(`Produto interno não encontrado: ${sku}`);

    const atual = agrupados.get(String(produto.id));
    agrupados.set(String(produto.id), {
      produtoId: String(produto.id),
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
    .select('tipo,quantidade,disponivel_venda')
    .eq('produto_id', produtoId);
  if (error) throw new Error(error.message);

  return (movimentos || []).reduce((saldo: number, movimento: any) => (
    saldo
      + (movimento.tipo === 'entrada_devolucao' && movimento.disponivel_venda ? Number(movimento.quantidade) : 0)
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
export async function registrarDevolucaoInterna(pedidoId: string, motivo: string) {
  const itens = await carregarItensEstoquePedido(pedidoId);
  const db = createServiceClient();

  for (const item of itens) {
    const { error } = await (db as any)
      .from('estoque_interno_movimentacoes')
      .upsert({
        produto_id: item.produtoId,
        pedido_id: pedidoId,
        tipo: 'entrada_devolucao',
        quantidade: item.quantidade,
        motivo,
        disponivel_venda: false,
      }, { onConflict: 'pedido_id,produto_id,tipo' });
    if (error) throw new Error(error.message);
  }
}
