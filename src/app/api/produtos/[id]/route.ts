import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku, normalizeSku, stripKnownSkuPrefix, getFornecedorSkuPrefix } from '@/lib/sku';

function coerceDsliteIdentity(updateData: Record<string, any>): { ok: true; payload: Record<string, any> } | { ok: false; error: string } {
  const fornecedorId = updateData.dslite_fornecedor_id != null ? String(updateData.dslite_fornecedor_id).trim() : '';
  const produtoId = updateData.dslite_produto_id != null ? String(updateData.dslite_produto_id).trim() : '';
  const hasFornecedor = Boolean(fornecedorId);
  const hasProdutoId = Boolean(produtoId);
  const hasSku = 'sku' in updateData && Boolean(normalizeSku(updateData.sku));

  if (!hasFornecedor && !hasProdutoId && !hasSku) return { ok: true, payload: updateData };
  if (hasFornecedor && !getFornecedorSkuPrefix(fornecedorId)) {
    return { ok: false, error: `Fornecedor DSLite ${fornecedorId} não possui prefixo SKU configurado.` };
  }

  const skuProvided = hasSku ? normalizeSku(updateData.sku) : '';
  const baseFromSku = skuProvided ? stripKnownSkuPrefix(skuProvided) : '';
  const baseId = produtoId || baseFromSku;

  if (hasFornecedor && !baseId) {
    return { ok: false, error: 'Para produto DSLite, informe dslite_produto_id ou SKU válido.' };
  }

  if (hasFornecedor && baseId) {
    const canonicalSku = buildCanonicalDsliteSku(fornecedorId, baseId, baseId);
    if (skuProvided && skuProvided !== canonicalSku) {
      return { ok: false, error: `SKU incompatível com fornecedor DSLite. Esperado: ${canonicalSku}` };
    }
    return {
      ok: true,
      payload: {
        ...updateData,
        sku: canonicalSku,
        dslite_fornecedor_id: fornecedorId,
        dslite_produto_id: produtoId || baseId,
      },
    };
  }

  return { ok: true, payload: { ...updateData, sku: skuProvided || updateData.sku } };
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || 'Produto não encontrado' },
        { status: error ? 500 : 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const supabase = createServiceClient();

    // Mapear campos do frontend (camelCase) para o banco (snake_case)
    const updateData: Record<string, any> = {};

    if ('sku' in body) updateData.sku = normalizeSku(body.sku);
    if ('nome' in body) updateData.nome = body.nome;
    if ('marca' in body) updateData.marca = body.marca;
    if ('gtin' in body) updateData.gtin = body.gtin;
    if ('estoque' in body) updateData.estoque = body.estoque;
    if ('custo' in body) updateData.custo = body.custo;
    if ('ml_shipping' in body) updateData.ml_shipping = body.ml_shipping;
    if ('ml_fee' in body) updateData.ml_fee = body.ml_fee;
    if ('custom_price' in body) updateData.custom_price = body.custom_price;
    if ('peso_liq' in body) updateData.peso_liq = body.peso_liq;
    if ('peso_bruto' in body) updateData.peso_bruto = body.peso_bruto;
    if ('largura' in body) updateData.largura = body.largura;
    if ('altura' in body) updateData.altura = body.altura;
    if ('profundidade' in body) updateData.profundidade = body.profundidade;
    if ('descricao' in body) updateData.descricao = body.descricao;
    if ('ncm' in body) updateData.ncm = body.ncm;
    if ('cest' in body) updateData.cest = body.cest;
    if ('origem_fiscal' in body) updateData.origem_fiscal = body.origem_fiscal;
    if ('csosn' in body) updateData.csosn = body.csosn;
    if ('dslite_fornecedor_id' in body) updateData.dslite_fornecedor_id = body.dslite_fornecedor_id;
    if ('dslite_produto_id' in body) updateData.dslite_produto_id = body.dslite_produto_id;

    const normalized = coerceDsliteIdentity(updateData);
    if (!normalized.ok) {
      return NextResponse.json(
        { error: normalized.error },
        { status: 422 }
      );
    }
    Object.assign(updateData, normalized.payload);

    const { data, error } = await supabase
      .from('produtos')
      .update(updateData as any)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      const msg = error.message || '';
      const details = String((error as any).details || '');
      if (
        msg.includes('produtos_sku_upper_unique') ||
        msg.includes('produtos_sku_key') ||
        details.includes('produtos_sku_upper_unique') ||
        details.includes('produtos_sku_key')
      ) {
        return NextResponse.json(
          { error: 'SKU já cadastrado' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: msg },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
