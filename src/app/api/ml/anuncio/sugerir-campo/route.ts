import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type AllowedValue = { id: string; name: string };

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

    const allowed = Array.isArray(field.allowed_values) ? field.allowed_values : [];

    if (allowed.length > 0) {
      if (parsed.value_id) {
        const hit = allowed.find((v: AllowedValue) => String(v.id) === String(parsed.value_id));
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
