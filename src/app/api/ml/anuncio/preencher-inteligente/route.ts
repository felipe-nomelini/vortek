import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getCategoryAttributes, predictCategory } from '@/services/mercadolibre';
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

  if (hasValue(attr)) return { ...attr, source: 'existing', confidence: 0.9 };

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
    const facts = extractMlProductFacts(produto);
    const predictionMap = await getPredictionMap(categoriaId, produto);
    const warnings: string[] = [];

    const fillList = (rows: AttributeInput[]) => rows.map((row) => {
      const merged = mergeCategoryDefinition(row, categoryAttrsById);
      const filled = fillAttribute(merged, facts, predictionMap, produto);
      if (filled.warning) warnings.push(`${filled.name}: ${filled.warning}`);
      return filled;
    });

    const required = fillList(required_attributes);
    const optional = fillList(optional_attributes);
    const allAttrs = [...required, ...optional];
    const filledCount = allAttrs.filter(hasValue).length;
    const correctedCount = allAttrs.filter((attr) => attr.source === 'product_facts_conflict_fix' || attr.source === 'consistency_review').length;
    const emptyCount = allAttrs.filter((attr) => !hasValue(attr)).length;
    const nextDescription = description && String(description).trim().length >= 600
      ? description
      : buildSmartDescription(produto, allAttrs, facts);

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
