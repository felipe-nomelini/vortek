import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { predictCategory } from '@/services/mercadolibre';
import { researchProductAttribute, type ProductAttributeResearchResult } from '@/services/product-attribute-research';
import { applyProductFactsToMlAttribute, extractMlProductFacts, type MlProductFacts } from '@/lib/ml-product-facts';

type AllowedValue = { id: string; name: string };
type Suggestion = {
  value_id: string | null;
  value_name: string | null;
  reason: string;
  confidence: number;
  source_urls?: string[];
  evidence?: string;
  searched_web?: boolean;
};

const NOT_APPLICABLE_ID = '-1';
const NO_IDS = new Set(['242084']);
const NO_NAMES = ['nao', 'não', 'false', 'no'];

function normalizeTxt(v: unknown) {
  return String(v ?? '').trim().toLowerCase();
}

function isInvalidLiteralValue(v: unknown) {
  const txt = normalizeTxt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return !txt || txt === 'null' || txt === 'undefined' || txt === 'n/a' || txt === 'na';
}

function isNotApplicableLabel(v: unknown) {
  const t = normalizeTxt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.includes('nao se aplica') || t.includes('nao aplicavel') || t === 'n/a';
}

function findNotApplicableValue(values: AllowedValue[]) {
  return values.find((v) => isNotApplicableLabel(v.name)) || null;
}

function readCurrentFieldValue(currentForm: any, id: string): { value_id?: string; value_name?: string } | null {
  const sections = [
    ...(Array.isArray(currentForm?.required_attributes) ? currentForm.required_attributes : []),
    ...(Array.isArray(currentForm?.optional_attributes) ? currentForm.optional_attributes : []),
    ...(Array.isArray(currentForm?.sale_terms) ? currentForm.sale_terms : []),
  ];
  const hit = sections.find((f: any) => String(f?.id || '') === id);
  return hit ? { value_id: hit.value_id ? String(hit.value_id) : undefined, value_name: hit.value_name ? String(hit.value_name) : undefined } : null;
}

function isNegativeSelection(value?: { value_id?: string; value_name?: string } | null) {
  if (!value) return false;
  const vid = String(value.value_id || '');
  const vname = normalizeTxt(value.value_name);
  return NO_IDS.has(vid) || NO_NAMES.some((n) => vname === n) || vname === 'não';
}

function buildNotApplicableSuggestion(allowed: AllowedValue[]): Suggestion {
  const explicit = findNotApplicableValue(allowed);
  if (explicit) {
    return {
      value_id: explicit.id,
      value_name: explicit.name,
      reason: 'rule_based_not_applicable',
      confidence: 1,
    };
  }
  return {
    value_id: null,
    value_name: null,
    reason: 'not_applicable_unavailable_in_api',
    confidence: 1,
  };
}

function buildClearedSuggestion(reason = 'rule_based_clear'): Suggestion {
  return { value_id: null, value_name: null, reason, confidence: 1 };
}

function normalizeSearchText(v: unknown) {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function selectAllowedByName(allowed: AllowedValue[], name: string) {
  const normalized = normalizeSearchText(name);
  return allowed.find((v) => normalizeSearchText(v.name) === normalized) || null;
}

function buildValueSuggestion(fieldId: string, valueName: string, allowed: AllowedValue[], reason: string): Suggestion {
  if (isInvalidLiteralValue(valueName)) return buildClearedSuggestion('invalid_literal_value');
  const hit = selectAllowedByName(allowed, valueName);
  return {
    value_id: hit?.id || null,
    value_name: hit?.name || valueName,
    reason,
    confidence: 1,
  };
}

function formatAllowedValue(valueName: string, allowed: AllowedValue[]) {
  const hit = selectAllowedByName(allowed, valueName);
  return {
    value_id: hit?.id || null,
    value_name: hit?.name || valueName,
  };
}

function isDangerousField(field: { id: string; name: string }) {
  const target = `${field.id || ''} ${field.name || ''}`.toUpperCase();
  return [
    'NOTES',
    'NOTAS',
    'SCALE',
    'ESCALA',
    'TENSION',
    'TENSAO',
    'TENSÃO',
    'VOLTAGE',
    'VOLTAGEM',
    'COMPATIBILITY',
    'COMPATIBILIDADE',
    'DIMENSION',
    'DIMENS',
  ].some((needle) => target.includes(needle));
}

function isSafeField(field: { id: string; name: string }) {
  const target = `${field.id || ''} ${field.name || ''}`.toUpperCase();
  return [
    'BRAND',
    'MARCA',
    'MODEL',
    'MODELO',
    'LINE',
    'LINHA',
    'SALE_FORMAT',
    'FORMATO',
    'UNITS_PER_PACK',
    'UNIDADES',
    'STRINGS_NUMBER',
    'QUANTIDADE DE CORDAS',
    'MATERIAL',
    'RECOMMENDED_INSTRUMENT',
    'INSTRUMENTO RECOMENDADO',
  ].some((needle) => target.includes(needle));
}

function hasClearEvidence(field: { id: string; name: string }, value: unknown, evidenceText: string) {
  const valueText = normalizeSearchText(value);
  if (!valueText || isInvalidLiteralValue(value)) return false;
  const evidence = normalizeSearchText(evidenceText);
  if (!evidence) return false;

  if (evidence.includes(valueText)) return true;
  const target = `${field.id || ''} ${field.name || ''}`.toUpperCase();
  if ((target.includes('TENSION') || target.includes('TENSAO') || target.includes('TENSÃO')) && valueText.includes('extra light')) {
    return evidence.includes('extra light') || evidence.includes('extra leve');
  }
  if ((target.includes('SCALE') || target.includes('ESCALA')) && /^1:\d+/.test(valueText)) {
    return evidence.includes(valueText);
  }
  if (target.includes('NOTES') || target.includes('NOTAS')) {
    const directNotes = [
      /notas?\s*[:=-]\s*[a-z,\s]+/i,
      /afina[cç][aã]o\s*[:=-]\s*[a-z,\s]+/i,
    ];
    return directNotes.some((pattern) => pattern.test(evidenceText));
  }
  return false;
}

function stripBasicMarkup(input: unknown): string {
  return String(input ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(input: unknown) {
  return stripBasicMarkup(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readFormAttributeValue(currentForm: any, id: string): string {
  const hit = readCurrentFieldValue(currentForm, id);
  return String(hit?.value_name || hit?.value_id || '').trim();
}

function hasUsefulDescription(description: string, produto: any, productFacts: MlProductFacts) {
  const normalized = normalizeForComparison(description);
  const title = normalizeForComparison(produto?.nome);
  if (!normalized || normalized === 'descricao final' || normalized.includes('descricao completa aqui')) return false;
  if (description.trim().length < 600) return false;
  if (title && (normalized === title || normalized.length < title.length + 120)) return false;

  const requiredSignals = [
    produto?.marca,
    productFacts.model,
    productFacts.batterySize,
    productFacts.nominalVoltage,
    productFacts.batteryComposition,
    productFacts.totalUnits ? String(productFacts.totalUnits) : '',
  ]
    .filter(Boolean)
    .map((value) => normalizeForComparison(value));

  const presentSignals = requiredSignals.filter((signal) => signal && normalized.includes(signal));
  return presentSignals.length >= Math.min(3, requiredSignals.length || 3);
}

function buildDeterministicDescription(produto: any, currentForm: any, productFacts: MlProductFacts) {
  const title = stripBasicMarkup(produto?.nome);
  const brand = stripBasicMarkup(produto?.marca);
  const model = productFacts.model || readFormAttributeValue(currentForm, 'MODEL');
  const size = productFacts.batterySize || readFormAttributeValue(currentForm, 'CELL_BATTERY_SIZE');
  const voltage = productFacts.nominalVoltage || readFormAttributeValue(currentForm, 'NOMINAL_VOLTAGE');
  const composition = productFacts.batteryComposition || readFormAttributeValue(currentForm, 'CELL_BATTERY_COMPOSITION');
  const rechargeable = readFormAttributeValue(currentForm, 'IS_RECHARGEABLE') || 'Não';
  const shape = readFormAttributeValue(currentForm, 'CELL_BATTERY_SHAPE');
  const totalUnits = productFacts.totalUnits || productFacts.unitsPerPack;
  const gtin = stripBasicMarkup(produto?.gtin);
  const ncm = stripBasicMarkup(produto?.ncm);
  const weight = produto?.peso_bruto ? `${Number(produto.peso_bruto).toLocaleString('pt-BR')} kg` : '';
  const dimensions = [produto?.altura, produto?.largura, produto?.profundidade].every(Boolean)
    ? `${produto.altura} x ${produto.largura} x ${produto.profundidade} cm`
    : '';

  const intro = `${title} é uma opção indicada para reposição e uso diário em equipamentos compatíveis com pilhas ${size || 'AA'}. ${brand ? `Produto da marca ${brand}` : 'Produto'}${model ? `, modelo ${model}` : ''}${voltage ? `, com voltagem nominal de ${voltage}` : ''}.`;

  const lines = [
    intro,
    '',
    'Principais características:',
    brand ? `- Marca: ${brand}.` : '',
    model ? `- Modelo: ${model}.` : '',
    size ? `- Tamanho da pilha: ${size}.` : '',
    composition ? `- Composição: ${composition}.` : '',
    voltage ? `- Voltagem nominal: ${voltage}.` : '',
    rechargeable ? `- Recarregável: ${rechargeable}.` : '',
    shape ? `- Formato: ${shape}.` : '',
    totalUnits ? `- Conteúdo da venda: kit com ${totalUnits} unidade${Number(totalUnits) > 1 ? 's' : ''}.` : '',
    '',
    'Aplicação e uso:',
    'Indicada para dispositivos eletrônicos compatíveis com pilhas do mesmo tamanho e voltagem, como controles remotos, brinquedos, lanternas, relógios, acessórios e outros equipamentos de uso cotidiano. Antes da compra, confira no aparelho o tamanho de pilha recomendado pelo fabricante.',
    '',
    'Especificações técnicas:',
    gtin ? `- Código universal do produto (GTIN): ${gtin}.` : '',
    ncm ? `- NCM: ${ncm}.` : '',
    dimensions ? `- Dimensões aproximadas da embalagem: ${dimensions}.` : '',
    weight ? `- Peso bruto aproximado: ${weight}.` : '',
    '',
    'Observações:',
    'As informações foram organizadas para facilitar a identificação do produto e sua aplicação. Verifique sempre a compatibilidade de tamanho e voltagem com o equipamento antes do uso.',
  ];

  return lines.filter(Boolean).join('\n').slice(0, 2200);
}

function evaluateProductRule(
  field: { id: string; name: string; value_type?: string },
  produto: any,
  allowed: AllowedValue[],
  currentForm?: any,
): Suggestion | null {
  const facts = extractMlProductFacts(produto);
  const factSuggestion = applyProductFactsToMlAttribute(field, facts);
  if (factSuggestion?.value_name) {
    return buildValueSuggestion(field.id, factSuggestion.value_name, allowed, 'rule_based_product_facts');
  }

  const target = `${field.id || ''} ${field.name || ''}`.toUpperCase();
  const text = normalizeSearchText(`${produto?.nome || ''} ${produto?.descricao || ''} ${produto?.categoria || ''}`);

  if (target.includes('RECOMMENDED_INSTRUMENT') || target.includes('INSTRUMENTO RECOMENDADO')) {
    if (text.includes('contrabaixo') || text.includes('contra baixo') || text.includes('contra-baixo')) {
      return buildValueSuggestion(field.id, 'Contrabaixo', allowed, 'rule_based_bass_instrument');
    }
  }

  if (target.includes('STRING_NUMBER') || target.includes('QUANTIDADE DE CORDAS')) {
    if (/\b4\s*cordas?\b/i.test(text)) return buildValueSuggestion(field.id, '4', allowed, 'rule_based_string_count');
  }

  if (target.includes('UNITS_PER_PACK') || target.includes('UNIDADES POR KIT')) {
    const saleFormat = readCurrentFieldValue(currentForm || {}, 'SALE_FORMAT');
    const saleFormatName = normalizeSearchText(saleFormat?.value_name);
    if (!saleFormat || saleFormatName.includes('unidade') || saleFormatName.includes('unit')) {
      return buildValueSuggestion(field.id, '1', allowed, 'rule_based_units_per_pack');
    }
  }

  if (target.includes('STRING_GAUGE') || target.includes('GAUGES') || target.includes('CALIBRE')) {
    const range = text.match(/\.?0?\d{2,3}\s*(?:[-–/]|a)\s*\.?0?\d{2,3}/i);
    if (range?.[0]) {
      const numbers = range[0].match(/0?\d{2,3}/g) || [];
      const firstGauge = numbers[0] || '';
      const lastGauge = numbers[1] || '';
      const normalized = numbers.length >= 2
        ? `.${firstGauge.replace(/^0+/, '').padStart(3, '0')} - .${lastGauge.replace(/^0+/, '').padStart(3, '0')}`
        : range[0].replace(/\s+/g, ' ');
      return buildValueSuggestion(field.id, normalized, allowed, 'rule_based_string_gauge');
    }
  }

  if (target.includes('LINE') || target.includes('LINHA')) {
    const lineValues = [
      { needle: ['extra light', 'extra leve'], value: 'Extra Light' },
      { needle: ['super light', 'super leve'], value: 'Super Light' },
      { needle: ['light', 'leve'], value: 'Light' },
      { needle: ['medium', 'media', 'média'], value: 'Medium' },
      { needle: ['heavy', 'pesada'], value: 'Heavy' },
    ];
    const hit = lineValues.find((item) => item.needle.some((needle) => text.includes(needle)));
    if (hit) return buildValueSuggestion(field.id, hit.value, allowed, 'rule_based_line');
  }

  if (target.includes('TENSION') || target.includes('TENSAO') || target.includes('TENSÃO')) {
    const tensionValues = [
      { needle: ['extra light', 'extra leve'], value: 'Extra Light' },
      { needle: ['light', 'leve'], value: 'Light' },
      { needle: ['media', 'média', 'medium'], value: 'Média' },
      { needle: ['alta', 'high'], value: 'Alta' },
    ];
    const hit = tensionValues.find((item) => item.needle.some((needle) => text.includes(needle)));
    if (hit) {
      const formatted = formatAllowedValue(hit.value, allowed);
      return { ...formatted, reason: 'rule_based_tension', confidence: 1 };
    }
  }

  if (target.includes('MATERIAL')) {
    if (text.includes('aco') || text.includes('niquel') || text.includes('metal')) {
      const metal = selectAllowedByName(allowed, 'Metal');
      return metal
        ? { value_id: metal.id, value_name: metal.name, reason: 'rule_based_material', confidence: 1 }
        : buildValueSuggestion(field.id, 'Aço niquelado', allowed, 'rule_based_material');
    }
  }

  return null;
}

async function evaluatePredictionRule(
  categoriaId: string,
  field: { id: string; name: string; value_type?: string },
  produto: any,
  allowed: AllowedValue[],
): Promise<Suggestion | null> {
  const facts = extractMlProductFacts(produto);
  const factSuggestion = applyProductFactsToMlAttribute(field, facts);
  if (factSuggestion?.value_name) return null;

  const title = produto?.marca ? `${produto.nome} ${produto.marca}` : produto?.nome;
  const predictions = await predictCategory(String(title || ''), 5).catch(() => null);
  const match = (predictions || []).find((p) => String(p.category_id) === String(categoriaId));
  const attr = match?.attributes?.find((a) => String(a.id).toUpperCase() === String(field.id).toUpperCase());
  if (!attr?.value_id && !attr?.value_name) return null;

  if (attr.value_id) {
    const hit = allowed.find((v) => String(v.id) === String(attr.value_id));
    if (hit) {
      return { value_id: hit.id, value_name: hit.name, reason: 'ml_domain_prediction', confidence: 0.95 };
    }
  }
  if (attr.value_name) {
    return buildValueSuggestion(field.id, String(attr.value_name), allowed, 'ml_domain_prediction');
  }
  return null;
}

function evaluateDependencyRule(fieldId: string, currentForm: any, allowed: AllowedValue[]): Suggestion | null {
  const target = String(fieldId || '').toUpperCase();
  const withClosing = readCurrentFieldValue(currentForm, 'WITH_CLOSING');
  if (target === 'CLASP_TYPE' && isNegativeSelection(withClosing)) {
      return allowed.length > 0 ? buildNotApplicableSuggestion(allowed) : buildClearedSuggestion('not_applicable_unavailable_in_api');
  }

  const withGemstone = readCurrentFieldValue(currentForm, 'WITH_GEMSTONE');
  if ((target === 'GEMSTONE_TYPE' || target === 'GEMSTONE_COLOR') && isNegativeSelection(withGemstone)) {
    return allowed.length > 0 ? buildNotApplicableSuggestion(allowed) : buildClearedSuggestion('not_applicable_unavailable_in_api');
  }

  return null;
}

function evaluateWarrantyRule(fieldId: string, allowed: AllowedValue[]): Suggestion | null {
  const target = String(fieldId || '').toUpperCase();
  if (target !== 'WARRANTY_TIME') return null;
  if (!allowed.length) return null;

  const by12 = allowed.find((v) => normalizeTxt(v.name).includes('12'));
  const selected = by12 || allowed[0];
  return {
    value_id: String(selected.id),
    value_name: String(selected.name),
    reason: 'rule_based_warranty_enumerated',
    confidence: 1,
  };
}

function buildPrompt(payload: {
  produto: any;
  categoriaId: string;
  field: { id: string; name: string; value_type?: string; allowed_values?: AllowedValue[] };
  currentForm?: any;
  research?: ProductAttributeResearchResult;
  dangerous?: boolean;
  safe?: boolean;
  supplierEvidence?: string;
  productFacts?: MlProductFacts;
}) {
  const { produto, categoriaId, field, currentForm, research, dangerous, safe, supplierEvidence, productFacts } = payload;
  if (String(field.id || '').toUpperCase() === 'DESCRIPTION') {
    return [
      'Você é um especialista em cadastro de produtos para Mercado Livre.',
      'Crie uma descrição comercial completa, técnica e confiável para o anúncio.',
      'Responda APENAS JSON válido no formato:',
      '{"value_id":null,"value_name":"<DESCRICAO_COMPLETA_AQUI>","reason":"clean_product_description","confidence":0.0,"evidence":"...","source_urls":[]}',
      'Regras obrigatórias:',
      '- Texto em português do Brasil.',
      '- Sem HTML, links, telefone, e-mail, redes sociais, emoji ou chamada para contato externo.',
      '- Sem prometer prazo, garantia extra, nota fiscal, originalidade ou benefícios não informados.',
      '- Não invente capacidade, compatibilidade, autonomia, material, voltagem ou qualquer dado técnico ausente.',
      '- Remova lixo de fornecedor como "Pesquisa:", palavras-chave separadas por |, repetições e texto colado.',
      '- Estrutura obrigatória: apresentação do produto; principais características; aplicação/uso; especificações técnicas; conteúdo/quantidade vendida; observações comerciais seguras.',
      '- Use parágrafos curtos e bullets simples quando melhorar a leitura.',
      '- A descrição precisa ter pelo menos 600 caracteres úteis.',
      '- Alvo: 1.200 a 2.000 caracteres. Não seja telegráfico.',
      `Categoria: ${categoriaId}`,
      `Fatos extraídos do produto: ${JSON.stringify(productFacts || {})}`,
      `Produto: ${JSON.stringify({
        sku: produto.sku,
        nome: produto.nome,
        marca: produto.marca,
        descricao_atual: produto.descricao,
        gtin: produto.gtin,
        ncm: produto.ncm,
        peso_bruto_kg: produto.peso_bruto,
        peso_liq_kg: produto.peso_liq,
        largura_cm: produto.largura,
        altura_cm: produto.altura,
        profundidade_cm: produto.profundidade,
        categoria: produto.categoria,
      })}`,
      `Evidência das ofertas de fornecedor: ${supplierEvidence || ''}`,
      `Atributos do formulário: ${JSON.stringify({
        required_attributes: currentForm?.required_attributes || [],
        optional_attributes: currentForm?.optional_attributes || [],
        fiscal: currentForm?.fiscal || {},
      })}`,
    ].join('\n');
  }

  return [
    'Você é um assistente de catálogo para Mercado Livre.',
    'Sugira um valor para UM campo de anúncio com base no produto.',
    'Responda APENAS JSON válido no formato:',
    '{"value_id":"..."|null,"value_name":"..."|null,"reason":"...","confidence":0.0,"evidence":"trecho usado","source_urls":["url"]}',
    'Regras:',
    '- Se houver allowed_values, prefira value_id de um item existente.',
    '- Use "Não se aplica" somente se ele estiver presente em allowed_values oficiais do campo.',
    '- Se um campo pai indicar ausência (ex.: Com fecho = Não), não sugira subtipo.',
    '- Se não houver lista, use value_name conciso.',
    '- Nunca invente unidades fora do contexto.',
    '- Nunca altere a quantidade total vendida inferida em productFacts.',
    '- Se productFacts indicar total_unidades, UNITS_PER_PACK deve ser esse total e PACKS_NUMBER deve ser 1, salvo evidência explícita de múltiplos kits.',
    '- Campos seguros podem ser inferidos por nome/descrição quando o produto deixa claro.',
    '- Campos perigosos só podem ser preenchidos se a evidência local ou web disser exatamente isso.',
    '- Se não houver evidência confiável, retorne value_id:null e value_name:null.',
    `Campo perigoso: ${dangerous ? 'sim' : 'não'}`,
    `Campo seguro: ${safe ? 'sim' : 'não'}`,
    `Categoria: ${categoriaId}`,
    `Campo alvo: ${JSON.stringify(field)}`,
    `Fatos extraídos do produto: ${JSON.stringify(productFacts || {})}`,
      `Produto: ${JSON.stringify({
      sku: produto.sku,
      nome: produto.nome,
      marca: produto.marca,
      descricao: produto.descricao,
      gtin: produto.gtin,
      ncm: produto.ncm,
      custo: produto.custo,
      peso_bruto: produto.peso_bruto,
      peso_liq: produto.peso_liq,
      largura: produto.largura,
      altura: produto.altura,
      profundidade: produto.profundidade,
      categoria: produto.categoria,
    })}`,
    `Evidência das ofertas de fornecedor: ${supplierEvidence || ''}`,
    `Pesquisa web verificável: ${JSON.stringify({
      searched: Boolean(research?.searched),
      confidence_hint: research?.confidenceHint || 0,
      source_urls: research?.sourceUrls || [],
      summary: research?.summary || '',
    })}`,
    `Form atual: ${JSON.stringify(currentForm || {})}`,
  ].join('\n');
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ignoredResponse(message = 'Sem evidência confiável para preencher este atributo', suggestion?: Partial<Suggestion>) {
  return NextResponse.json({
    success: false,
    ignored: true,
    error: message,
    suggestion: {
      value_id: null,
      value_name: null,
      reason: suggestion?.reason || 'no_reliable_evidence',
      confidence: Number(suggestion?.confidence || 0),
      source_urls: suggestion?.source_urls || [],
      evidence: suggestion?.evidence || '',
      searched_web: Boolean(suggestion?.searched_web),
    },
  });
}

function isOfficialNotApplicableSuggestion(suggestion: Suggestion) {
  return Boolean(suggestion.value_id || suggestion.value_name) && suggestion.reason === 'rule_based_not_applicable';
}

function successResponse(suggestion: Suggestion) {
  return NextResponse.json({
    success: true,
    searched_web: Boolean(suggestion.searched_web),
    suggestion,
  });
}

function withEvidence(suggestion: Suggestion, parsed: any, research: ProductAttributeResearchResult): Suggestion {
  return {
    ...suggestion,
    evidence: String(parsed?.evidence || suggestion.evidence || '').slice(0, 500),
    source_urls: Array.isArray(parsed?.source_urls) && parsed.source_urls.length
      ? parsed.source_urls.slice(0, 3).map((url: unknown) => String(url))
      : research.sourceUrls,
    searched_web: Boolean(research.searched),
  };
}

export async function POST(req: Request) {
  try {
    const { produtoId, categoriaId, field, currentForm, target } = await req.json();
    if (!produtoId || !categoriaId || !field?.id) {
      return NextResponse.json({ error: 'produtoId, categoriaId e field.id são obrigatórios' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', produtoId)
      .single();

    if (error || !produto) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    const allowed = Array.isArray(field.allowed_values) ? field.allowed_values : [];
    const supplierSkusResult = await supabase
      .from('produto_fornecedor_ofertas')
      .select('sku_oferta, sku_fornecedor, nome, descricao, marca')
      .eq('produto_id', produtoId)
      .limit(5);
    const supplierRows = supplierSkusResult.data || [];
    const supplierSkus = supplierRows
      .flatMap((row: any) => [row.sku_oferta, row.sku_fornecedor])
      .filter(Boolean)
      .map((v: unknown) => String(v));
    const supplierEvidence = supplierRows
      .map((row: any) => [row.nome, row.marca, row.descricao].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('\n')
      .slice(0, 2500);
    const produtoWithEvidence = {
      ...produto,
      descricao: [produto.descricao, supplierEvidence].filter(Boolean).join('\n'),
    };
    const productFacts = extractMlProductFacts(produtoWithEvidence);

    const productDecision = evaluateProductRule(field, produtoWithEvidence, allowed, currentForm || {});
    if (productDecision) {
      return productDecision.value_id || productDecision.value_name
        ? successResponse(productDecision)
        : ignoredResponse(
          productDecision.reason === 'not_applicable_unavailable_in_api'
            ? 'Não se aplica indisponível na API oficial para este atributo'
            : 'Sem evidência confiável para preencher este atributo',
          productDecision,
        );
    }

    const warrantyDecision = evaluateWarrantyRule(field.id, allowed);
    if (warrantyDecision) {
      return successResponse(warrantyDecision);
    }

    const dependencyDecision = evaluateDependencyRule(field.id, currentForm || {}, allowed);
    if (dependencyDecision) {
      return successResponse(dependencyDecision);
    }

    const predictionDecision = await evaluatePredictionRule(categoriaId, field, produtoWithEvidence, allowed);
    if (predictionDecision && (predictionDecision.value_id || predictionDecision.value_name)) {
      return successResponse(predictionDecision);
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

    if (!apiKey) {
      return ignoredResponse('Sem evidência local suficiente e OPENROUTER_API_KEY não configurada', {
        reason: 'openrouter_missing_after_local_rules',
        confidence: 0,
      });
    }

    const dangerous = isDangerousField(field);
    const safe = isSafeField(field);
    const research = await researchProductAttribute({
      produto: produtoWithEvidence,
      field,
      categoriaId,
      supplierSkus,
      supplierEvidence,
    });

    const prompt = buildPrompt({
      produto: produtoWithEvidence,
      categoriaId,
      field,
      currentForm,
      research,
      dangerous,
      safe,
      supplierEvidence,
      productFacts,
    });

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Responda somente JSON válido.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return NextResponse.json({ success: false, error: `OpenRouter HTTP ${resp.status}: ${txt.substring(0, 300)}` }, { status: 502 });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);

    if (!parsed) {
      return NextResponse.json({ success: false, error: 'Resposta IA inválida (JSON)' }, { status: 422 });
    }

    if (String(field.id || '').toUpperCase() === 'DESCRIPTION') {
      const generatedDescription = stripBasicMarkup(parsed.value_name);
      if (hasUsefulDescription(generatedDescription, produtoWithEvidence, productFacts)) {
        return successResponse(withEvidence({
          value_id: null,
          value_name: generatedDescription,
          reason: String(parsed.reason || 'clean_product_description'),
          confidence: Number(parsed.confidence || 0.85),
        }, parsed, research));
      }

      const fallbackDescription = buildDeterministicDescription(produtoWithEvidence, currentForm || {}, productFacts);
      return successResponse({
        value_id: null,
        value_name: fallbackDescription,
        reason: 'deterministic_description_fallback',
        confidence: 1,
        evidence: 'Descrição IA rejeitada por baixa qualidade; usado template determinístico com dados do produto.',
        source_urls: research.sourceUrls,
        searched_web: Boolean(research.searched),
      });
    }

    if (!parsed.value_id && !parsed.value_name) {
      return ignoredResponse('Sem evidência confiável para preencher este atributo', withEvidence({
        value_id: null,
        value_name: null,
        reason: String(parsed.reason || 'no_reliable_evidence'),
        confidence: Number(parsed.confidence || 0),
      }, parsed, research));
    }

    if (isInvalidLiteralValue(parsed.value_name) && !parsed.value_id) {
      return ignoredResponse('Valor inválido retornado pela IA', withEvidence({
        value_id: null,
        value_name: null,
        reason: 'invalid_literal_value',
        confidence: Number(parsed.confidence || 0),
      }, parsed, research));
    }

    if (dangerous) {
      const evidenceText = `${produtoWithEvidence.nome || ''} ${produtoWithEvidence.descricao || ''} ${research.summary || ''} ${parsed.evidence || ''}`;
      const value = parsed.value_name || allowed.find((v: AllowedValue) => String(v.id) === String(parsed.value_id))?.name || '';
      if (!hasClearEvidence(field, value, evidenceText)) {
        return ignoredResponse('Sem evidência confiável para preencher este atributo', withEvidence({
          value_id: null,
          value_name: null,
          reason: String(parsed.reason || 'dangerous_field_without_clear_evidence'),
          confidence: Number(parsed.confidence || 0),
        }, parsed, research));
      }
    }

    if (allowed.length > 0) {
      if (parsed.value_id) {
        if (String(parsed.value_id) === NOT_APPLICABLE_ID) {
          const na = findNotApplicableValue(allowed);
          if (!na) {
            return ignoredResponse('Não se aplica indisponível na API oficial para este atributo', withEvidence({
              value_id: null,
              value_name: null,
              reason: 'not_applicable_unavailable_in_api',
              confidence: Number(parsed.confidence || 0),
            }, parsed, research));
          }
        }
        const hit = allowed.find((v: AllowedValue) => String(v.id) === String(parsed.value_id));
        if (!hit && field.value_type === 'string' && parsed.value_name) {
          return successResponse(withEvidence({
              value_id: null,
              value_name: String(parsed.value_name),
              reason: String(parsed.reason || ''),
              confidence: Number(parsed.confidence || 0),
            }, parsed, research));
        }
        if (!hit) {
          return ignoredResponse('Sem correspondência confiável nos valores permitidos', withEvidence({
            value_id: null,
            value_name: null,
            reason: 'allowed_value_mismatch',
            confidence: Number(parsed.confidence || 0),
          }, parsed, research));
        }
        return successResponse(withEvidence({
            value_id: hit.id,
            value_name: hit.name,
            reason: String(parsed.reason || ''),
            confidence: Number(parsed.confidence || 0),
          }, parsed, research));
      }

      if (parsed.value_name) {
        if (isNotApplicableLabel(parsed.value_name)) {
          const notApplicable = buildNotApplicableSuggestion(allowed);
          if (!isOfficialNotApplicableSuggestion(notApplicable)) {
            return ignoredResponse('Não se aplica indisponível na API oficial para este atributo', withEvidence({
              value_id: null,
              value_name: null,
              reason: 'not_applicable_unavailable_in_api',
              confidence: Number(parsed.confidence || 0),
            }, parsed, research));
          }
          return successResponse({
            ...notApplicable,
            searched_web: research.searched,
            source_urls: research.sourceUrls,
            evidence: String(parsed.evidence || '').slice(0, 500),
          });
        }

        const hitByName = allowed.find((v: AllowedValue) => String(v.name).toLowerCase() === String(parsed.value_name).toLowerCase());
        if (!hitByName && field.value_type === 'string') {
          return successResponse(withEvidence({
              value_id: null,
              value_name: String(parsed.value_name),
              reason: String(parsed.reason || ''),
              confidence: Number(parsed.confidence || 0),
            }, parsed, research));
        }
        if (!hitByName) {
          return ignoredResponse('Sem correspondência confiável nos valores permitidos', withEvidence({
            value_id: null,
            value_name: null,
            reason: 'allowed_value_mismatch',
            confidence: Number(parsed.confidence || 0),
          }, parsed, research));
        }
        return successResponse(withEvidence({
            value_id: hitByName.id,
            value_name: hitByName.name,
            reason: String(parsed.reason || ''),
            confidence: Number(parsed.confidence || 0),
          }, parsed, research));
      }

      return ignoredResponse('Sem evidência confiável para preencher este atributo', withEvidence({
        value_id: null,
        value_name: null,
        reason: 'empty_enumerated_value',
        confidence: Number(parsed.confidence || 0),
      }, parsed, research));
    }

    return successResponse(withEvidence({
        value_id: parsed.value_id || null,
        value_name: parsed.value_name || null,
        reason: String(parsed.reason || ''),
        confidence: Number(parsed.confidence || 0),
      }, parsed, research));
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Erro ao sugerir campo' }, { status: 500 });
  }
}
