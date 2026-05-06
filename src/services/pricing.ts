import type { PricingParams, PricingResult } from '@/types/pricing';

const TAX_RATE = 0.04;
const DEFAULT_MARGIN = 0.30;

/**
 * Calcula o preço sugerido de venda baseado na fórmula Vortek.
 *
 * Fórmula:
 *   Preço Sugerido = (Custo + Frete) / (1 - (Imposto + Taxa ML + Margem))
 *
 * Onde:
 *   - Imposto: 4% fixo (0.04)
 *   - Taxa ML: variável conforme categoria/tipo de anúncio no Mercado Livre
 *   - Margem: padrão 30% (0.30), ajustável pelo usuário
 *
 * @param params - Parâmetros de precificação
 * @param params.cost - Custo do produto
 * @param params.shipping - Valor do frete
 * @param params.mlFee - Taxa do Mercado Livre em decimal (ex: 0.15 para 15%)
 * @param params.margin - Margem de lucro desejada em decimal (padrão: 0.30)
 * @returns Resultado da precificação com valores detalhados
 * @throws {Error} Se a soma de impostos + taxas + margem for >= 1
 */
export function calculateSuggestedPrice(params: PricingParams): PricingResult {
  const { cost, shipping, mlFee, margin = DEFAULT_MARGIN } = params;
  const denominator = 1 - (TAX_RATE + mlFee + margin);

  if (denominator <= 0) {
    throw new Error(
      'A soma de imposto (4%), taxa ML e margem não pode ser igual ou superior a 100%'
    );
  }

  const suggestedPrice = (cost + shipping) / denominator;
  const tax = suggestedPrice * TAX_RATE;
  const mlFeeAmount = suggestedPrice * mlFee;
  const marginAmount = suggestedPrice * margin;
  const netProfit = suggestedPrice - cost - shipping - tax - mlFeeAmount;

  return {
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    mlFeeAmount: Math.round(mlFeeAmount * 100) / 100,
    marginAmount: Math.round(marginAmount * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
  };
}
