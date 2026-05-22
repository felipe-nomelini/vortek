import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type AllowedValue = { id: string; name: string };
type Suggestion = { value_id: string | null; value_name: string | null; reason: string; confidence: number };

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
}) {
  const { produto, categoriaId, field, currentForm } = payload;
  return [
    'Você é um assistente de catálogo para Mercado Livre.',
    'Sugira um valor para UM campo de anúncio com base no produto.',
    'Responda APENAS JSON válido no formato:',
    '{"value_id":"..."|null,"value_name":"..."|null,"reason":"...","confidence":0.0}',
    'Regras:',
    '- Se houver allowed_values, prefira value_id de um item existente.',
    '- Se houver "Não se aplica", use esse valor quando o campo não fizer sentido.',
    '- Se um campo pai indicar ausência (ex.: Com fecho = Não), não sugira subtipo.',
    '- Se não houver lista, use value_name conciso.',
    '- Nunca invente unidades fora do contexto.',
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

export async function POST(req: Request) {
  try {
    const { produtoId, categoriaId, field, currentForm } = await req.json();
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
    const warrantyDecision = evaluateWarrantyRule(field.id, allowed);
    if (warrantyDecision) {
      return NextResponse.json({
        success: true,
        suggestion: warrantyDecision,
      });
    }

    const dependencyDecision = evaluateDependencyRule(field.id, currentForm || {}, allowed);
    if (dependencyDecision) {
      return NextResponse.json({
        success: true,
        suggestion: dependencyDecision,
      });
    }

    const prompt = buildPrompt({
      produto,
      categoriaId,
      field,
      currentForm,
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

    if (allowed.length > 0) {
      if (parsed.value_id) {
        const hit = String(parsed.value_id) === NOT_APPLICABLE_ID
          ? ({ id: NOT_APPLICABLE_ID, name: 'Não se aplica' } as AllowedValue)
          : allowed.find((v: AllowedValue) => String(v.id) === String(parsed.value_id));
        if (!hit) {
          return NextResponse.json({ success: false, error: 'Sugestão IA inválida para valores permitidos' }, { status: 422 });
        }
        return NextResponse.json({
          success: true,
          suggestion: {
            value_id: hit.id,
            value_name: hit.name,
            reason: String(parsed.reason || ''),
            confidence: Number(parsed.confidence || 0),
          },
        });
      }

      if (parsed.value_name) {
        if (isNotApplicableLabel(parsed.value_name)) {
          return NextResponse.json({
            success: true,
            suggestion: buildNotApplicableSuggestion(allowed),
          });
        }

        const hitByName = allowed.find((v: AllowedValue) => String(v.name).toLowerCase() === String(parsed.value_name).toLowerCase());
        if (!hitByName) {
          return NextResponse.json({ success: false, error: 'Sugestão IA sem correspondência em allowed_values' }, { status: 422 });
        }
        return NextResponse.json({
          success: true,
          suggestion: {
            value_id: hitByName.id,
            value_name: hitByName.name,
            reason: String(parsed.reason || ''),
            confidence: Number(parsed.confidence || 0),
          },
        });
      }

      return NextResponse.json({ success: false, error: 'Sugestão IA vazia para campo enumerado' }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      suggestion: {
        value_id: parsed.value_id || null,
        value_name: parsed.value_name || null,
        reason: String(parsed.reason || ''),
        confidence: Number(parsed.confidence || 0),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Erro ao sugerir campo' }, { status: 500 });
  }
}
