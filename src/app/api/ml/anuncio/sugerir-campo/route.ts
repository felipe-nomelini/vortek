import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { predictCategory } from '@/services/mercadolibre';
import { researchProductAttribute, type ProductAttributeResearchResult } from '@/services/product-attribute-research';

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

function isNotApplicableLabel(v: unknown) {
  const t = normalizeTxt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.includes('nao se aplica') || t.includes('nao aplicavel') || t === 'n/a';
}

function findNotApplicableValue(values: AllowedValue[]) {
  return values.find((v) => isNotApplicableLabel(v.name) || String(v.id) === NOT_APPLICABLE_ID) || null;
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
    value_id: NOT_APPLICABLE_ID,
    value_name: null,
    reason: 'rule_based_not_applicable',
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
  const hit = selectAllowedByName(allowed, valueName);
  return {
    value_id: hit?.id || null,
    value_name: hit?.name || valueName,
    reason,
    confidence: 1,
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
  if (!valueText) return false;
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
  return false;
}

function evaluateProductRule(field: { id: string; name: string; value_type?: string }, produto: any, allowed: AllowedValue[]): Suggestion | null {
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

  if (target.includes('STRING_GAUGE') || target.includes('CALIBRE')) {
    const range = text.match(/\.0?\d{2,3}\s*[-–]\s*\.0?\d{2,3}/i);
    if (range?.[0]) return buildValueSuggestion(field.id, range[0].replace(/\s+/g, ' '), allowed, 'rule_based_string_gauge');
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
    return allowed.length > 0 ? buildNotApplicableSuggestion(allowed) : buildClearedSuggestion();
  }

  const withGemstone = readCurrentFieldValue(currentForm, 'WITH_GEMSTONE');
  if ((target === 'GEMSTONE_TYPE' || target === 'GEMSTONE_COLOR') && isNegativeSelection(withGemstone)) {
    return allowed.length > 0 ? buildNotApplicableSuggestion(allowed) : buildClearedSuggestion();
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
}) {
  const { produto, categoriaId, field, currentForm, research, dangerous, safe } = payload;
  if (String(field.id || '').toUpperCase() === 'DESCRIPTION') {
    return [
      'Você é um especialista em cadastro de produtos para Mercado Livre.',
      'Crie uma descrição comercial limpa para o anúncio.',
      'Responda APENAS JSON válido no formato:',
      '{"value_id":null,"value_name":"descrição final","reason":"clean_product_description","confidence":0.0,"evidence":"...","source_urls":[]}',
      'Regras obrigatórias:',
      '- Texto em português do Brasil.',
      '- Sem HTML, links, telefone, e-mail, redes sociais, emoji ou chamada para contato externo.',
      '- Sem prometer prazo, garantia extra, nota fiscal, originalidade ou benefícios não informados.',
      '- Remova lixo de fornecedor como "Pesquisa:", palavras-chave separadas por |, repetições e texto colado.',
      '- Estrutura: resumo claro; principais características; aplicação/uso; dados técnicos relevantes.',
      '- Seja objetivo, natural e confiável. Máximo 900 caracteres.',
      `Categoria: ${categoriaId}`,
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
      `Atributos do formulário: ${JSON.stringify({
        required_attributes: currentForm?.required_attributes || [],
        optional_attributes: currentForm?.optional_attributes || [],
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
    '- Se houver "Não se aplica", use esse valor quando o campo não fizer sentido.',
    '- Se um campo pai indicar ausência (ex.: Com fecho = Não), não sugira subtipo.',
    '- Se não houver lista, use value_name conciso.',
    '- Nunca invente unidades fora do contexto.',
    '- Campos seguros podem ser inferidos por nome/descrição quando o produto deixa claro.',
    '- Campos perigosos só podem ser preenchidos se a evidência local ou web disser exatamente isso.',
    '- Se não houver evidência confiável, retorne value_id:null e value_name:null.',
    `Campo perigoso: ${dangerous ? 'sim' : 'não'}`,
    `Campo seguro: ${safe ? 'sim' : 'não'}`,
    `Categoria: ${categoriaId}`,
    `Campo alvo: ${JSON.stringify(field)}`,
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

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'OPENROUTER_API_KEY não configurada' }, { status: 500 });
    }

    const allowed = Array.isArray(field.allowed_values) ? field.allowed_values : [];
    const supplierSkusResult = await supabase
      .from('produto_fornecedor_ofertas')
      .select('sku_oferta, sku_fornecedor')
      .eq('produto_id', produtoId)
      .limit(5);
    const supplierSkus = (supplierSkusResult.data || [])
      .flatMap((row: any) => [row.sku_oferta, row.sku_fornecedor])
      .filter(Boolean)
      .map((v: unknown) => String(v));

    const productDecision = evaluateProductRule(field, produto, allowed);
    if (productDecision) {
      return productDecision.value_id || productDecision.value_name
        ? successResponse(productDecision)
        : ignoredResponse('Sem evidência confiável para preencher este atributo', productDecision);
    }

    const warrantyDecision = evaluateWarrantyRule(field.id, allowed);
    if (warrantyDecision) {
      return successResponse(warrantyDecision);
    }

    const dependencyDecision = evaluateDependencyRule(field.id, currentForm || {}, allowed);
    if (dependencyDecision) {
      return successResponse(dependencyDecision);
    }

    const predictionDecision = await evaluatePredictionRule(categoriaId, field, produto, allowed);
    if (predictionDecision && (predictionDecision.value_id || predictionDecision.value_name)) {
      return successResponse(predictionDecision);
    }

    const dangerous = isDangerousField(field);
    const safe = isSafeField(field);
    const research = await researchProductAttribute({
      produto,
      field,
      categoriaId,
      supplierSkus,
    });

    const prompt = buildPrompt({
      produto,
      categoriaId,
      field,
      currentForm,
      research,
      dangerous,
      safe,
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

    if (!parsed.value_id && !parsed.value_name) {
      return ignoredResponse('Sem evidência confiável para preencher este atributo', withEvidence({
        value_id: null,
        value_name: null,
        reason: String(parsed.reason || 'no_reliable_evidence'),
        confidence: Number(parsed.confidence || 0),
      }, parsed, research));
    }

    if (dangerous) {
      const evidenceText = `${produto.nome || ''} ${produto.descricao || ''} ${research.summary || ''} ${parsed.evidence || ''}`;
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
        const hit = String(parsed.value_id) === NOT_APPLICABLE_ID
          ? ({ id: NOT_APPLICABLE_ID, name: 'Não se aplica' } as AllowedValue)
          : allowed.find((v: AllowedValue) => String(v.id) === String(parsed.value_id));
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
          return successResponse({
            ...buildNotApplicableSuggestion(allowed),
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
