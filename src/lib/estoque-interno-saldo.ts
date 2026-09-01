export type MovimentoSaldoEstoqueInterno = {
  tipo: string | null;
  quantidade: number | string | null;
  situacao_estoque?: string | null;
  estornada_em?: string | null;
};

export type EntradaVisivelEstoqueInterno = {
  id: string;
  produto_id: string;
  quantidade: number;
  situacao_estoque: string;
  created_at: string;
};

export type SaidaAtivaEstoqueInterno = {
  produto_id: string;
  quantidade: number;
};

export type ItemReservaEstoqueInterno = {
  produtoId: string;
  sku: string;
  quantidade: number;
};

export type ComposicaoKitEstoqueInterno = {
  ativo: boolean;
  componentes: Array<{
    produtoId: string;
    sku: string;
    ativo: boolean;
    quantidade: number;
  }>;
};

/** Kits nunca possuem saldo físico próprio: a reserva usa seus componentes diretos. */
export function expandirItensReservaEstoqueInterno(
  itens: ItemReservaEstoqueInterno[],
  composicoesPorProduto: Map<string, ComposicaoKitEstoqueInterno>,
): ItemReservaEstoqueInterno[] {
  const expandidos = new Map<string, ItemReservaEstoqueInterno>();
  for (const item of itens) {
    const composicao = composicoesPorProduto.get(item.produtoId);
    if (composicao && !composicao.ativo) {
      throw new Error(`Kit inativo no pedido: ${item.sku}.`);
    }
    if (composicao && composicao.componentes.length === 0) {
      throw new Error(`Kit sem componentes no pedido: ${item.sku}.`);
    }

    const movimentos = composicao
      ? composicao.componentes.map((componente) => {
          if (!componente.ativo || !componente.sku || componente.quantidade <= 0) {
            throw new Error(`Componente indisponível no kit ${item.sku}.`);
          }
          return {
            produtoId: componente.produtoId,
            sku: componente.sku,
            quantidade: item.quantidade * componente.quantidade,
          };
        })
      : [item];

    for (const movimento of movimentos) {
      if (!Number.isInteger(movimento.quantidade) || movimento.quantidade <= 0) {
        throw new Error(`Quantidade inválida para ${movimento.sku || item.sku}.`);
      }
      const atual = expandidos.get(movimento.produtoId);
      expandidos.set(movimento.produtoId, {
        produtoId: movimento.produtoId,
        sku: movimento.sku,
        quantidade: (atual?.quantidade || 0) + movimento.quantidade,
      });
    }
  }
  return [...expandidos.values()];
}

/** Calcula o saldo disponível canônico: entradas utilizáveis menos baixas e compromissos ativos. */
export function calcularSaldoEstoqueInterno(
  movimentos: MovimentoSaldoEstoqueInterno[],
): number {
  return movimentos.reduce((saldo, movimento) => (
    saldo
      + (
        ['entrada_devolucao', 'entrada_compra', 'ajuste_positivo'].includes(String(movimento.tipo))
        && movimento.situacao_estoque === 'liberado'
          ? Number(movimento.quantidade)
          : 0
      )
      - (
        ['saida_envio_interno', 'ajuste_negativo'].includes(String(movimento.tipo))
        && !movimento.estornada_em
          ? Number(movimento.quantidade)
          : 0
      )
  ), 0);
}

/**
 * Consome saídas nas entradas liberadas mais antigas (FIFO).
 * Entradas sem saldo deixam de aparecer em "Liberado"; demais situações
 * permanecem intactas para revisão e auditoria.
 */
export function calcularEntradasVisiveisEstoqueInterno<
  T extends EntradaVisivelEstoqueInterno,
>(entradas: T[], saidas: SaidaAtivaEstoqueInterno[]): T[] {
  const saidasPendentes = new Map<string, number>();
  for (const saida of saidas) {
    const produtoId = String(saida.produto_id || '');
    saidasPendentes.set(
      produtoId,
      (saidasPendentes.get(produtoId) || 0) + Math.max(0, Number(saida.quantidade || 0)),
    );
  }

  const quantidadesVisiveis = new Map<string, number>();
  const liberadasFifo = entradas
    .filter((entrada) => entrada.situacao_estoque === 'liberado')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  for (const entrada of liberadasFifo) {
    const quantidade = Math.max(0, Number(entrada.quantidade || 0));
    const pendente = saidasPendentes.get(entrada.produto_id) || 0;
    const consumida = Math.min(quantidade, pendente);
    quantidadesVisiveis.set(entrada.id, quantidade - consumida);
    saidasPendentes.set(entrada.produto_id, pendente - consumida);
  }

  return entradas.flatMap((entrada) => {
    if (entrada.situacao_estoque !== 'liberado') return [entrada];
    const quantidade = quantidadesVisiveis.get(entrada.id)
      ?? Math.max(0, Number(entrada.quantidade || 0));
    return quantidade > 0 ? [{ ...entrada, quantidade }] : [];
  });
}
