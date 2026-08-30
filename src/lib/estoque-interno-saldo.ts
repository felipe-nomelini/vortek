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

export function resolverStatusMlEstoqueInterno(input: {
  estoqueDisponivel: number;
  statusObservado: string | null | undefined;
  pausadoPelaInativacaoDoFornecedor: boolean;
}): 'active' | 'paused' {
  if (input.estoqueDisponivel <= 0) return 'paused';
  if (input.pausadoPelaInativacaoDoFornecedor) return 'active';
  return String(input.statusObservado || '').trim().toLowerCase() === 'paused'
    ? 'paused'
    : 'active';
}

/** Calcula somente entradas liberadas e saídas ainda ativas. */
export function calcularSaldoEstoqueInterno(
  movimentos: MovimentoSaldoEstoqueInterno[],
): number {
  return movimentos.reduce((saldo, movimento) => (
    saldo
      + (
        movimento.tipo === 'entrada_devolucao'
        && movimento.situacao_estoque === 'liberado'
          ? Number(movimento.quantidade)
          : 0
      )
      - (
        movimento.tipo === 'saida_envio_interno'
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
