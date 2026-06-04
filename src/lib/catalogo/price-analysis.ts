export type ClasseAnalise =
  | 'ajustar_para_ganhar_sem_prejuizo'
  | 'nao_viavel_ganhar_sem_prejuizo'
  | 'dados_insuficientes';

export interface CatalogPriceAnalysisInput {
  ml_item_id: string;
  permalink?: string | null;
  titulo: string;
  sku_local?: string | null;
  produto_id?: string | null;
  preco_atual: number;
  price_to_win: number | null;
  produto_nome?: string | null;
  custo?: number | null;
  ml_fee?: number | null;
  ml_shipping?: number | null;
}

export interface CatalogPriceAnalysisResult {
  ml_item_id: string;
  permalink: string | null;
  titulo: string;
  sku_local: string | null;
  produto_id: string | null;
  preco_atual: number;
  price_to_win: number | null;
  preco_piso_sem_prejuizo: number | null;
  preco_recomendado: number | null;
  delta_preco: number | null;
  lucro_unitario_estimado: number | null;
  classe: ClasseAnalise;
  motivo: string;
}

const TAXA_IMPOSTO = 0.04;
const TAXA_ML_DEFAULT = 0.15;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classPriority(classe: ClasseAnalise): number {
  if (classe === 'ajustar_para_ganhar_sem_prejuizo') return 0;
  if (classe === 'nao_viavel_ganhar_sem_prejuizo') return 1;
  return 2;
}

export function buildCatalogPriceAnalysis(input: CatalogPriceAnalysisInput): CatalogPriceAnalysisResult {
  const precoAtual = round2(toFiniteNumber(input.preco_atual) || 0);
  const priceToWin = toFiniteNumber(input.price_to_win);
  const produtoId = input.produto_id || null;
  const skuLocal = input.sku_local || null;
  const titulo = input.titulo || input.produto_nome || '';

  if (!produtoId) {
    return {
      ml_item_id: input.ml_item_id,
      permalink: input.permalink || null,
      titulo,
      sku_local: skuLocal,
      produto_id: null,
      preco_atual: precoAtual,
      price_to_win: priceToWin !== null ? round2(priceToWin) : null,
      preco_piso_sem_prejuizo: null,
      preco_recomendado: null,
      delta_preco: null,
      lucro_unitario_estimado: null,
      classe: 'dados_insuficientes',
      motivo: 'produto_id_ausente_ou_sem_vinculo_local',
    };
  }

  const taxaMl = toFiniteNumber(input.ml_fee);
  const frete = toFiniteNumber(input.ml_shipping);
  const custo = toFiniteNumber(input.custo);

  const taxaMlAplicada = taxaMl !== null ? taxaMl : TAXA_ML_DEFAULT;
  const freteAplicado = frete !== null ? frete : 0;
  const custoAplicado = custo !== null ? custo : 0;
  const denominador = 1 - (TAXA_IMPOSTO + taxaMlAplicada);

  if (!(denominador > 0) || priceToWin === null || priceToWin <= 0) {
    return {
      ml_item_id: input.ml_item_id,
      permalink: input.permalink || null,
      titulo,
      sku_local: skuLocal,
      produto_id: produtoId,
      preco_atual: precoAtual,
      price_to_win: priceToWin !== null ? round2(priceToWin) : null,
      preco_piso_sem_prejuizo: denominador > 0 ? round2((custoAplicado + freteAplicado) / denominador) : null,
      preco_recomendado: null,
      delta_preco: null,
      lucro_unitario_estimado: null,
      classe: 'dados_insuficientes',
      motivo: priceToWin === null || priceToWin <= 0 ? 'sem_preco_alvo_ml' : 'taxas_invalidas_para_calculo',
    };
  }

  const pisoSemPrejuizo = round2((custoAplicado + freteAplicado) / denominador);
  const priceToWinRounded = round2(priceToWin);
  const lucroNoPriceToWin = round2((priceToWinRounded * denominador) - custoAplicado - freteAplicado);

  if (priceToWinRounded >= pisoSemPrejuizo) {
    const recomendado = priceToWinRounded;
    const delta = round2(recomendado - precoAtual);
    return {
      ml_item_id: input.ml_item_id,
      permalink: input.permalink || null,
      titulo,
      sku_local: skuLocal,
      produto_id: produtoId,
      preco_atual: precoAtual,
      price_to_win: priceToWinRounded,
      preco_piso_sem_prejuizo: pisoSemPrejuizo,
      preco_recomendado: recomendado,
      delta_preco: delta,
      lucro_unitario_estimado: lucroNoPriceToWin,
      classe: 'ajustar_para_ganhar_sem_prejuizo',
      motivo: 'price_to_win_maior_ou_igual_ao_piso',
    };
  }

  const recomendado = pisoSemPrejuizo;
  const delta = round2(recomendado - precoAtual);
  return {
    ml_item_id: input.ml_item_id,
    permalink: input.permalink || null,
    titulo,
    sku_local: skuLocal,
    produto_id: produtoId,
    preco_atual: precoAtual,
    price_to_win: priceToWinRounded,
    preco_piso_sem_prejuizo: pisoSemPrejuizo,
    preco_recomendado: recomendado,
    delta_preco: delta,
    lucro_unitario_estimado: lucroNoPriceToWin,
    classe: 'nao_viavel_ganhar_sem_prejuizo',
    motivo: 'price_to_win_abaixo_do_piso',
  };
}
