import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';
import { getCategoryAttributes } from '@/services/mercadolibre';
import { calculateSuggestedPrice } from '@/services/pricing';

function normalizeStr(v: unknown): string {
  return String(v ?? '').trim();
}

function stripHtmlToText(input: unknown): string {
  return String(input ?? '')
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\s*\/p\s*>/gi, ' ')
    .replace(/<\s*\/li\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDescription(produto: any): string {
  const descricao = stripHtmlToText(produto?.descricao);
  if (descricao) return descricao;
  const title = stripHtmlToText(produto?.nome);
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

function normalizeBase(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function pickWarrantyDefaultValueId(values: Array<{ id: string; name: string }>): string | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const by12 = values.find((v) => normalizeBase(v.name).includes('12'));
  if (by12) return String(by12.id);
  return String(values[0].id);
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

    const saleTerms = saleTermsRaw.map((term: any) => {
      const values = (term.values || []).slice(0, 100).map((v: any) => ({ id: v.id, name: v.name }));
      if (term.id === 'WARRANTY_TIME') {
        const defaultId = pickWarrantyDefaultValueId(values);
        if (defaultId) {
          const selected = values.find((v: { id: string; name: string }) => String(v.id) === defaultId);
          return {
            id: term.id,
            name: term.name,
            value_type: term.value_type || 'string',
            required: Boolean(term.tags?.required),
            values,
            value_id: defaultId,
            value_name: selected?.name || undefined,
          };
        }
        return {
          id: term.id,
          name: term.name,
          value_type: term.value_type || 'string',
          required: Boolean(term.tags?.required),
          values,
          value_name: '12 meses de fábrica',
        };
      }
      return {
        id: term.id,
        name: term.name,
        value_type: term.value_type || 'string',
        required: Boolean(term.tags?.required),
        values,
      };
    });

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
