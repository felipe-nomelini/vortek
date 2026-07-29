export type MovimentoSaldoEstoqueInterno = {
  tipo: string | null;
  quantidade: number | string | null;
  situacao_estoque?: string | null;
  estornada_em?: string | null;
};

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
