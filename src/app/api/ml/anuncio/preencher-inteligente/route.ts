import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getCategoryAttributes, predictCategory } from '@/services/mercadolibre';
import { researchProductAttribute } from '@/services/product-attribute-research';
import { applyProductFactsToMlAttribute, extractMlProductFacts, type MlProductFacts } from '@/lib/ml-product-facts';

type AttributeInput = {
  id: string;
  name: string;
  value_type?: string;
  values?: Array<{ id: string; name: string }>;
  value_id?: string;
  value_name?: string;
};

type SmartAttribute = AttributeInput & {
  source?: string;
  evidence?: string;
  confidence?: number;
  warning?: string;
  reason?: string;
};

function normalize(input: unknown) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hasValue(attr: AttributeInput) {
  return Boolean(String(attr.value_id || '').trim() || String(attr.value_name || '').trim());
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function selectAllowed(values: Array<{ id: string; name: string }> = [], valueName: string) {
  const target = normalize(valueName);
  return values.find((value) => normalize(value.name) === target) || null;
}

function applyValue(attr: AttributeInput, valueName: string, source: string, evidence: string): SmartAttribute {
  const hit = selectAllowed(attr.values || [], valueName);
  return {
    ...attr,
    value_id: hit?.id || '',
    value_name: hit?.name || valueName,
    source,
    evidence,
    confidence: 1,
  };
}

function clearValue(attr: AttributeInput, warning: string): SmartAttribute {
  return {
    ...attr,
    value_id: '',
    value_name: '',
    source: 'consistency_review',
    evidence: warning,
    confidence: 1,
    warning,
  };
}

function invalidLiteral(value: unknown) {
  const text = normalize(value);
  return !text || text === 'null' || text === 'undefined' || text === 'n/a' || text === 'na';
}

function isGoldPlatedText(input: unknown) {
  const text = normalize(input);
  return text.includes('ouro') && (
    text.includes('banhado')
    || text.includes('banhada')
    || text.includes('folheado')
    || text.includes('folheada')
    || text.includes('banho de ouro')
  );
}

function mergeCategoryDefinition(attr: AttributeInput, categoryAttrsById: Map<string, any>) {
  const def = categoryAttrsById.get(String(attr.id).toUpperCase());
  return {
    ...attr,
    value_type: attr.value_type || def?.value_type || 'string',
    values: attr.values?.length ? attr.values : (def?.values || []).slice(0, 100).map((v: any) => ({ id: String(v.id), name: String(v.name) })),
    tags: def?.tags || {},
  };
}

function factForAttribute(attr: AttributeInput, facts: MlProductFacts) {
  return applyProductFactsToMlAttribute(attr as any, facts)?.value_name || '';
}

function isBadPredictionConflict(attr: AttributeInput, factValue: string) {
  if (!factValue || !hasValue(attr)) return false;
  const current = normalize(attr.value_name || attr.value_id);
  const fact = normalize(factValue);
  if (!current || !fact) return false;
  return current !== fact;
}

async function getPredictionMap(categoriaId: string, produto: any) {
  const title = produto?.marca ? `${produto.nome} ${produto.marca}` : produto?.nome;
  const predictions = await predictCategory(String(title || ''), 5).catch(() => null);
  const match = (predictions || []).find((prediction) => String(prediction.category_id) === String(categoriaId));
  const map = new Map<string, { value_id?: string; value_name?: string }>();
  for (const attr of match?.attributes || []) {
    map.set(String(attr.id).toUpperCase(), {
      value_id: attr.value_id ? String(attr.value_id) : undefined,
      value_name: attr.value_name ? String(attr.value_name) : undefined,
    });
  }
  return map;
}

function fillAttribute(attr: AttributeInput, facts: MlProductFacts, predictionMap: Map<string, { value_id?: string; value_name?: string }>, produto: any): SmartAttribute {
  const id = String(attr.id || '').toUpperCase();
  const factValue = factForAttribute(attr, facts);

  if (factValue) {
    if (isBadPredictionConflict(attr, factValue)) {
      return applyValue(attr, factValue, 'product_facts_conflict_fix', `Corrigido pelo cadastro/título do produto: ${produto.nome}`);
    }
    return applyValue(attr, factValue, 'product_facts', `Extraído do cadastro/título do produto: ${produto.nome}`);
  }

  if (id === 'COMPATIBLE_DEVICES' && normalize(attr.value_name) === 'mp3' && normalize(produto?.nome).includes('guitarra')) {
    return clearValue(attr, 'MP3 removido: conflito com produto de guitarra/instrumento.');
  }

  if (hasValue(attr)) return validateObviousErrors({ ...attr, source: 'existing', confidence: 0.9 }, [], produto);

  const prediction = predictionMap.get(id);
  if (prediction?.value_id || prediction?.value_name) {
    const predictedById = (attr.values || []).find((value) => String(value.id) === String(prediction.value_id));
    const predictedName = prediction.value_name || predictedById?.name || '';
    if (predictedName) return applyValue(attr, predictedName, 'ml_domain_prediction', 'Sugestão do Mercado Livre sem conflito local detectado.');
  }

  return { ...attr, source: 'empty_no_evidence', confidence: 0 };
}

function buildSmartDescription(produto: any, attrs: SmartAttribute[], facts: MlProductFacts) {
  const get = (id: string) => attrs.find((attr) => String(attr.id).toUpperCase() === id)?.value_name || '';
  const title = String(produto?.nome || '').trim();
  const brand = String(produto?.marca || get('BRAND') || '').trim();
  const model = String(facts.model || get('MODEL') || '').trim();
  const gtin = String(produto?.gtin || get('GTIN') || '').trim();
  const length = facts.cableLength || get('CABLE_LENGTH');
  const voltage = facts.nominalVoltage || get('NOMINAL_VOLTAGE');
  const composition = facts.batteryComposition || get('CELL_BATTERY_COMPOSITION');
  const quantity = facts.totalUnits || facts.unitsPerPack || get('UNITS_PER_PACK');

  const specs = [
    brand ? `Marca: ${brand}` : '',
    model ? `Modelo: ${model}` : '',
    length ? `Comprimento: ${length}` : '',
    voltage ? `Voltagem nominal: ${voltage}` : '',
    composition ? `Composição: ${composition}` : '',
    quantity ? `Quantidade vendida: ${quantity} unidade(s)` : '',
    gtin ? `GTIN: ${gtin}` : '',
    produto?.ncm ? `NCM: ${produto.ncm}` : '',
  ].filter(Boolean);

  return [
    `${title} é uma opção indicada para quem busca um produto com especificações claras e compatíveis com o uso descrito no cadastro.`,
    '',
    'Principais características:',
    ...specs.map((spec) => `- ${spec}.`),
    '',
    'Aplicação e uso:',
    String(produto?.descricao || '').trim() || 'Utilize conforme a compatibilidade indicada pelo fabricante do equipamento.',
    '',
    'Observações:',
    'Confira as especificações do produto antes da compra para confirmar compatibilidade com o equipamento desejado.',
  ].join('\n').slice(0, 2200);
}

function buildPrompt(params: {
  produto: any;
  categoriaId: string;
  categoryAttrs: any[];
  required: AttributeInput[];
  optional: AttributeInput[];
  facts: MlProductFacts;
  supplierEvidence: string;
  webEvidence: string;
}) {
  const { produto, categoriaId, categoryAttrs, required, optional, facts, supplierEvidence, webEvidence } = params;
  const attributeContract = categoryAttrs.map((attr: any) => ({
    id: attr.id,
    name: attr.name,
    value_type: attr.value_type,
    tags: attr.tags || {},
    values: (attr.values || []).slice(0, 40).map((value: any) => ({ id: value.id, name: value.name })),
    allowed_units: attr.allowed_units || [],
  }));

  return [
    'Você é um especialista em cadastro de anúncios no Mercado Livre.',
    'Preencha o anúncio inteiro com base nas evidências abaixo.',
    'Use primeiro os dados internos do Vortek e fornecedor. Use pesquisa web apenas como apoio.',
    'Não invente. Se não houver evidência para um atributo, deixe value_id e value_name vazios.',
    'Respeite exatamente os ids dos atributos e valores permitidos da categoria ML.',
    'Dados internos claros vencem sugestão/predição do Mercado Livre.',
    'Retorne APENAS JSON válido neste formato:',
    '{"attributes":[{"id":"ATTR_ID","value_id":"","value_name":"","reason":"","confidence":0.0,"evidence":""}],"description":"descrição completa","warnings":[]}',
    'Validações importantes:',
    '- Gênero de conector deve ser Macho ou Fêmea; nunca Jack.',
    '- Conector pode ser Jack/P10; gênero é separado.',
    '- Se título disser 7,62m, não use outro comprimento.',
    '- Em joias, Ouro significa material principal/maciço; produto banhado/folheado deve usar Banhado em ouro 18k ou ficar vazio.',
    '- Em joias, gere Modelo curto: tipo + elemento visual + acabamento. Não copie título truncado.',
    '- Se não souber, deixe vazio.',
    `Categoria ML: ${categoriaId}`,
    `Produto Vortek: ${JSON.stringify({
      sku: produto.sku,
      nome: produto.nome,
      marca: produto.marca,
      descricao: produto.descricao,
      gtin: produto.gtin,
      ncm: produto.ncm,
      peso_bruto: produto.peso_bruto,
      largura: produto.largura,
      altura: produto.altura,
      profundidade: produto.profundidade,
      categoria: produto.categoria,
    })}`,
    `Fatos óbvios extraídos: ${JSON.stringify(facts)}`,
    `Atributos oficiais ML: ${JSON.stringify(attributeContract)}`,
    `Atributos atuais: ${JSON.stringify([...required, ...optional])}`,
    `Evidência dos fornecedores: ${supplierEvidence}`,
    `Pesquisa web: ${webEvidence}`,
  ].join('\n');
}

function applyAiAttributes(attrs: SmartAttribute[], aiAttributes: any[], warnings: string[], produto: any) {
  const aiById = new Map((Array.isArray(aiAttributes) ? aiAttributes : []).map((attr: any) => [String(attr?.id || '').toUpperCase(), attr]));
  return attrs.map((attr) => {
    const ai = aiById.get(String(attr.id).toUpperCase());
    if (!ai) return attr;
    const valueName = String(ai.value_name || '').trim();
    const valueId = String(ai.value_id || '').trim();
    if (invalidLiteral(valueName) && !valueId) return attr;
    const next = valueName ? applyValue(attr, valueName, 'ai_full_context', String(ai.evidence || ai.reason || 'IA com contexto completo')) : { ...attr };
    if (valueId && !next.value_id) next.value_id = valueId;
    next.reason = String(ai.reason || '');
    next.confidence = Number(ai.confidence || 0.75);
    return validateObviousErrors(next, warnings, produto);
  });
}

function validateObviousErrors(attr: SmartAttribute, warnings: string[], produto?: any) {
  const id = String(attr.id || '').toUpperCase();
  const value = normalize(attr.value_name);
  if ((id === 'INPUT_CONNECTOR_GENDER' || id === 'OUTPUT_CONNECTOR_GENDER') && value === 'jack') {
    warnings.push(`${attr.name}: gênero não pode ser Jack; corrigido para Macho.`);
    return { ...attr, value_id: '', value_name: 'Macho', source: 'obvious_error_fix', confidence: 1 };
  }
  if (id === 'CONNECTOR_COATING_MATERIAL' && value.includes('aco')) {
    warnings.push(`${attr.name}: aço/ZAMAC não é valor oficial confiável para revestimento; campo limpo.`);
    return clearValue(attr, 'Material de revestimento sem valor oficial confiável.');
  }
  if (id === 'MATERIAL' && value === 'ouro' && isGoldPlatedText(`${produto?.nome || ''} ${produto?.descricao || ''}`)) {
    warnings.push('Material corrigido: produto banhado não é ouro maciço.');
    return { ...attr, value_id: '', value_name: 'Banhado em ouro 18k', source: 'obvious_error_fix', confidence: 1 };
  }
  return attr;
}

export async function POST(req: Request) {
  try {
    const { produtoId, categoriaId, required_attributes = [], optional_attributes = [], description = '' } = await req.json();
    if (!produtoId || !categoriaId) {
      return NextResponse.json({ error: 'produtoId e categoriaId são obrigatórios' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase.from('produtos').select('*').eq('id', produtoId).single();
    if (error || !produto) return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });

    const categoryAttrs = (await getCategoryAttributes(categoriaId)) || [];
    const categoryAttrsById = new Map(categoryAttrs.map((attr: any) => [String(attr.id).toUpperCase(), attr]));
    const supplierRows = (await supabase
      .from('produto_fornecedor_ofertas')
      .select('sku_oferta, sku_fornecedor, nome, descricao, marca')
      .eq('produto_id', produtoId)
      .limit(5)).data || [];
    const supplierEvidence = supplierRows
      .map((row: any) => [row.nome, row.marca, row.descricao].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('\n')
      .slice(0, 2500);
    const produtoWithEvidence = { ...produto, descricao: [produto.descricao, supplierEvidence].filter(Boolean).join('\n') };
    const facts = extractMlProductFacts(produtoWithEvidence);
    const predictionMap = await getPredictionMap(categoriaId, produto);
    const warnings: string[] = [];

    const fillList = (rows: AttributeInput[]) => rows.map((row) => {
      const merged = mergeCategoryDefinition(row, categoryAttrsById);
      const filled = fillAttribute(merged, facts, predictionMap, produto);
      if (filled.warning) warnings.push(`${filled.name}: ${filled.warning}`);
      return filled;
    });

    let required = fillList(required_attributes);
    let optional = fillList(optional_attributes);
    let aiDescription = '';

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey) {
      const research = await researchProductAttribute({
        produto: produtoWithEvidence,
        field: { id: 'ALL_ATTRIBUTES', name: 'Todos os atributos do anúncio' },
        categoriaId,
        supplierEvidence,
      });
      const prompt = buildPrompt({
        produto: produtoWithEvidence,
        categoriaId,
        categoryAttrs,
        required,
        optional,
        facts,
        supplierEvidence,
        webEvidence: research.summary,
      });
      const openRouterBaseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
      const resp = await fetch(`${openRouterBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
          temperature: 0.1,
          messages: [
            { role: 'system', content: 'Responda somente JSON válido.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (resp.ok) {
        const payload = await resp.json();
        const parsed = safeJsonParse(payload?.choices?.[0]?.message?.content || '');
        if (parsed?.attributes) {
          required = applyAiAttributes(required, parsed.attributes, warnings, produtoWithEvidence);
          optional = applyAiAttributes(optional, parsed.attributes, warnings, produtoWithEvidence);
        }
        if (parsed?.description && String(parsed.description).trim().length >= 600) {
          aiDescription = String(parsed.description).trim();
        }
        if (Array.isArray(parsed?.warnings)) warnings.push(...parsed.warnings.map((w: unknown) => String(w)));
      } else {
        warnings.push(`IA indisponível: OpenRouter HTTP ${resp.status}. Usado preenchimento por dados internos.`);
      }
    }

    required = required.map((attr) => validateObviousErrors(attr, warnings, produtoWithEvidence));
    optional = optional.map((attr) => validateObviousErrors(attr, warnings, produtoWithEvidence));
    const allAttrs = [...required, ...optional];
    const filledCount = allAttrs.filter(hasValue).length;
    const correctedCount = allAttrs.filter((attr) => (
      attr.source === 'product_facts_conflict_fix'
      || attr.source === 'consistency_review'
      || attr.source === 'obvious_error_fix'
    )).length;
    const emptyCount = allAttrs.filter((attr) => !hasValue(attr)).length;
    const nextDescription = aiDescription || (
      description && String(description).trim().length >= 600
        ? description
        : buildSmartDescription(produto, allAttrs, facts)
    );

    return NextResponse.json({
      success: true,
      required_attributes: required,
      optional_attributes: optional,
      description: nextDescription,
      warnings,
      summary: {
        filled: filledCount,
        corrected: correctedCount,
        empty: emptyCount,
        quality_score: Math.round((filledCount / Math.max(allAttrs.length, 1)) * 100),
      },
      facts,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao preencher anúncio com IA' }, { status: 500 });
  }
}
