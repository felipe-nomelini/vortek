/** PRC-03: a memória econômica não substitui governança, trilha e autorização. */
/** @returns {{ code: string; error: string } | null} */
export function getPricingExecutionBlock() {
  return {
    code: 'pricing_execution_not_ready',
    error: 'Criação e alteração de preço aguardam os contratos canônicos de execução e homologação. Nenhum preço foi alterado.',
  };
}

export function assertPricingExecutionReady() {
  const block = getPricingExecutionBlock();
  if (block) throw new Error(`${block.code}: ${block.error}`);
}
