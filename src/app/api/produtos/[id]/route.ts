import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { assertVortekSku } from '@/lib/product-master-sku';

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

    const { data: current, error: currentError } = await supabase
      .from('produtos')
      .select('id, ml_item_id, custom_price, estoque, ml_status, ativo')
      .eq('id', params.id)
      .maybeSingle();

    if (currentError) {
      return NextResponse.json({ error: currentError.message }, { status: 500 });
    }
    if (!current?.id) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    // Mapear campos do frontend (camelCase) para o banco (snake_case)
    const updateData: Record<string, any> = {};

    if ('sku' in body) {
      try {
        updateData.sku = assertVortekSku(body.sku);
      } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'SKU mestre inválido' }, { status: 422 });
      }
    }
    if ('ativo' in body) updateData.ativo = Boolean(body.ativo);
    if ('nome' in body) updateData.nome = body.nome;
    if ('marca' in body) updateData.marca = body.marca;
    if ('gtin' in body) updateData.gtin = body.gtin;
    if ('estoque' in body) updateData.estoque = body.estoque;
    if ('custo' in body) updateData.custo = body.custo;
    if ('ml_shipping' in body) updateData.ml_shipping = body.ml_shipping;
    if ('ml_fee' in body) updateData.ml_fee = body.ml_fee;
    if ('ml_status' in body) updateData.ml_status = body.ml_status;
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

    if ('dslite_fornecedor_id' in updateData) updateData.dslite_fornecedor_id = String(updateData.dslite_fornecedor_id || '').trim();
    if ('dslite_produto_id' in updateData) updateData.dslite_produto_id = String(updateData.dslite_produto_id || '').trim();

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

    const shouldPauseByProductInactive = body.ativo === false
      && current.ativo !== false
      && String(data?.ml_item_id || '').trim();
    const shouldEnqueueMlPublish = ['custom_price', 'estoque', 'ml_status'].some((field) => field in body) || shouldPauseByProductInactive;
    let outboxWarning: string | null = null;

    if (shouldEnqueueMlPublish && String(data?.ml_item_id || '').trim()) {
      const outbox = await enqueueMlPublishOutbox(supabase, {
        produtoId: String(data.id),
        mlItemId: String(data.ml_item_id),
        desiredStatus: shouldPauseByProductInactive ? 'pausado' : (data.ml_status || null) as any,
        desiredPrice: typeof data.custom_price === 'number' ? data.custom_price : null,
        desiredQuantity: typeof data.estoque === 'number' ? data.estoque : null,
        source: shouldPauseByProductInactive ? 'produto_inativo' : 'produto_patch',
        payload: {
          previous: {
            custom_price: current.custom_price,
            estoque: current.estoque,
            ml_status: current.ml_status,
            ativo: current.ativo,
          },
          next: {
            custom_price: data.custom_price,
            estoque: data.estoque,
            ml_status: shouldPauseByProductInactive ? 'pausado' : data.ml_status,
            ativo: data.ativo,
          },
        },
      });

      if (!outbox.ok) {
        outboxWarning = outbox.error;
      }
    }

    return NextResponse.json({
      data,
      ...(outboxWarning ? { warning: `Produto atualizado, mas falhou ao enfileirar publicação ML: ${outboxWarning}` } : {}),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
