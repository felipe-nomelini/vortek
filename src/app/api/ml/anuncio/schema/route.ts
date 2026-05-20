import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';
import { getCategoryAttributes } from '@/services/mercadolibre';
import { calculateSuggestedPrice } from '@/services/pricing';

function normalizeStr(v: unknown): string {
  return String(v ?? '').trim();
}

function buildDescription(produto: any): string {
  if (normalizeStr(produto.descricao)) return produto.descricao;
  const title = normalizeStr(produto.nome);
  const marca = normalizeStr(produto.marca);
  const gtin = normalizeStr(produto.gtin);
  return [
    `${title}${marca ? ` - ${marca}` : ''}`,
    'Produto original com envio rápido.',
    gtin ? `GTIN: ${gtin}` : '',
  ].filter(Boolean).join('\n');
}

function initialAttributeValue(attr: any, produto: any): { value_id?: string; value_name?: string } {
  const attrId = String(attr.id || '').toUpperCase();
  if (attrId === 'BRAND' && normalizeStr(produto.marca)) return { value_name: produto.marca };
  if (attrId === 'MODEL' && normalizeStr(produto.nome)) return { value_name: produto.nome.slice(0, 60) };
  if (attrId === 'ITEM_CONDITION') return { value_id: '2230284', value_name: 'Novo' };
  if (attrId === 'GTIN' && normalizeStr(produto.gtin)) return { value_name: produto.gtin };
  if (attrId === 'SELLER_SKU' && normalizeStr(produto.sku)) return { value_name: produto.sku };
  if (attrId === 'SELLER_PACKAGE_HEIGHT' && produto.altura) return { value_name: `${produto.altura} cm` };
  if (attrId === 'SELLER_PACKAGE_WIDTH' && produto.largura) return { value_name: `${produto.largura} cm` };
  if (attrId === 'SELLER_PACKAGE_LENGTH' && produto.profundidade) return { value_name: `${produto.profundidade} cm` };
  if (attrId === 'SELLER_PACKAGE_WEIGHT' && produto.peso_bruto) return { value_name: `${produto.peso_bruto} g` };
  return {};
}

export async function POST(req: Request) {
  try {
    const { produtoId, categoriaId, listingType = 'gold_pro' } = await req.json();
    if (!produtoId || !categoriaId) {
      return NextResponse.json({ error: 'produtoId e categoriaId são obrigatórios' }, { status: 400 });
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

    const attrs = (await getCategoryAttributes(categoriaId)) || [];
    const requiredAttributes = attrs.filter((a: any) => (a.tags?.required || a.tags?.catalog_required) && !a.tags?.fixed);
    const optionalAttributes = attrs.filter((a: any) => !(a.tags?.required || a.tags?.catalog_required) && !a.tags?.hidden);

    const me = await fetchML<any>('/users/me');
    const categoryInfo = await fetchML<any>(`/categories/${categoriaId}`);
    const saleTermsRaw = (categoryInfo?.sale_terms || []) as any[];

    let suggestedPrice = 0;
    try {
      const pricing = calculateSuggestedPrice({
        cost: Number(produto.custo || 0),
        shipping: Number(produto.ml_shipping || 0),
        mlFee: Number(produto.ml_fee || 0.15),
      });
      suggestedPrice = Number(produto.custom_price ?? pricing.suggestedPrice);
    } catch {
      suggestedPrice = Number(produto.custom_price ?? produto.custo ?? 0);
    }

    const prefillAttributes = attrs.map((attr: any) => {
      const pre = initialAttributeValue(attr, produto);
      return {
        id: attr.id,
        name: attr.name,
        value_type: attr.value_type,
        required: Boolean(attr.tags?.required || attr.tags?.catalog_required),
        values: (attr.values || []).slice(0, 100).map((v: any) => ({ id: v.id, name: v.name })),
        ...pre,
      };
    });

    const saleTerms = saleTermsRaw.map((term: any) => ({
      id: term.id,
      name: term.name,
      value_type: term.value_type || 'string',
      required: Boolean(term.tags?.required),
      values: (term.values || []).slice(0, 100).map((v: any) => ({ id: v.id, name: v.name })),
      value_name: term.id === 'WARRANTY_TIME' ? '12 meses de fábrica' : undefined,
    }));

    const hasWarranty = saleTerms.some((t) => t.id === 'WARRANTY_TIME');
    if (!hasWarranty) {
      saleTerms.push({
        id: 'WARRANTY_TIME',
        name: 'Garantia',
        value_type: 'string',
        required: false,
        values: [],
        value_name: '12 meses de fábrica',
      });
    }

    return NextResponse.json({
      success: true,
      schema: {
        required_attributes: prefillAttributes.filter((a) => a.required),
        optional_attributes: prefillAttributes.filter((a) => !a.required),
        sale_terms: saleTerms,
        fiscal_fields: {
          ncm: produto.ncm || '',
          cest: produto.cest || '',
          gtin: produto.gtin || '',
          origem_fiscal: produto.origem_fiscal || '0',
          csosn: produto.csosn || '',
        },
        prefill: {
          description: buildDescription(produto),
          base_price: Math.round(suggestedPrice * 100) / 100,
          listing_type: listingType,
          seller_id: me?.id || null,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao montar schema' }, { status: 500 });
  }
}
