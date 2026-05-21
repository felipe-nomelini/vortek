import { NextResponse } from 'next/server';
import { createListing, getCategoryAttributes, setItemQuantityPricing, updateListingFiscalData } from '@/services/mercadolibre';
import { fetchML } from '@/services/integration';
import { calculateSuggestedPrice } from '@/services/pricing';
import { createServiceClient } from '@/lib/supabase';

type StepResult = { ok: boolean; error?: string };
type AttrInput = { id: string; value_name?: string; value_id?: string };
type SaleTermInput = { id: string; value_name?: string; value_id?: string };

function normalizeAttr(attr: AttrInput) {
  return {
    id: String(attr.id),
    value_id: attr.value_id ? String(attr.value_id) : undefined,
    value_name: attr.value_name ? String(attr.value_name) : undefined,
  };
}

function hasValue(attr: { value_name?: string; value_id?: string }) {
  return Boolean((attr.value_id && String(attr.value_id).trim()) || (attr.value_name && String(attr.value_name).trim()));
}

function normalizeText(input: unknown) {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

function buildDescription(produto: any, input?: string) {
  const manual = normalizeText(input);
  if (manual) return manual.slice(0, 5000);

  const descricao = normalizeText(produto?.descricao);
  if (descricao) return descricao.slice(0, 5000);

  const caracteristicas = normalizeText(produto?.caracteristicas);
  if (caracteristicas) return caracteristicas.slice(0, 5000);

  const informacoes = normalizeText(produto?.informacoes);
  if (informacoes) return informacoes.slice(0, 5000);

  return [normalizeText(produto?.nome), normalizeText(produto?.marca)].filter(Boolean).join(' - ').slice(0, 5000);
}

export async function POST(req: Request) {
  try {
    const {
      produtoId,
      categoriaId,
      listingType,
      basePrice,
      fiscal,
      description,
      attributes: editedAttributes,
      sale_terms: editedSaleTerms,
    } = await req.json();

    if (!produtoId) {
      return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 400 });
    }
    if (!categoriaId) {
      return NextResponse.json({ error: 'categoriaId é obrigatório' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: produto } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', produtoId)
      .single();

    if (!produto) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    if (!produto.sku?.trim()) {
      return NextResponse.json({ error: 'Produto sem SKU. Preencha o SKU antes de criar anúncio.' }, { status: 422 });
    }
    if (!produto.nome?.trim()) {
      return NextResponse.json({ error: 'Produto sem nome. Preencha o nome antes de criar anúncio.' }, { status: 422 });
    }
    if (!Number.isFinite(Number(produto.custo)) || Number(produto.custo) <= 0) {
      return NextResponse.json({ error: 'Produto com custo inválido. Ajuste o custo antes de criar anúncio.' }, { status: 422 });
    }

    const steps: Record<'categoria' | 'atributos' | 'anuncio' | 'atacado' | 'fiscal', StepResult> = {
      categoria: { ok: false },
      atributos: { ok: false },
      anuncio: { ok: false },
      atacado: { ok: false },
      fiscal: { ok: false },
    };

    const warnings: string[] = [];
    const missingRequiredAttributes: Array<{ id: string; name: string }> = [];

    let displayPrice: number;
    if (typeof basePrice === 'number' && Number.isFinite(basePrice) && basePrice > 0) {
      displayPrice = basePrice;
    } else {
      try {
        const pricing = calculateSuggestedPrice({
          cost: produto.custo || 0,
          shipping: produto.ml_shipping || 0,
          mlFee: produto.ml_fee || 0.15,
        });
        displayPrice = produto.custom_price ?? pricing.suggestedPrice;
      } catch {
        displayPrice = produto.custom_price ?? produto.custo ?? 0;
      }
    }
    displayPrice = Math.round(displayPrice * 100) / 100;

    const attrs = await getCategoryAttributes(categoriaId);
    if (!attrs || attrs.length === 0) {
      return NextResponse.json({ error: 'Não foi possível carregar atributos da categoria' }, { status: 422 });
    }
    steps.categoria.ok = true;

    const attributesMap = new Map<string, { id: string; value_name?: string; value_id?: string }>();
    if (Array.isArray(editedAttributes)) {
      for (const attr of editedAttributes as AttrInput[]) {
        if (attr?.id) attributesMap.set(String(attr.id), normalizeAttr(attr));
      }
    }

    const required = attrs.filter((a: any) => (a.tags?.required || a.tags?.catalog_required) && !a.tags?.fixed);
    for (const attr of required) {
      const existing = attributesMap.get(attr.id);
      if (!existing || !hasValue(existing)) {
        missingRequiredAttributes.push({ id: attr.id, name: attr.name });
      }
    }

    // Validate list values if value_id is provided
    for (const attr of attrs) {
      const current = attributesMap.get(attr.id);
      if (!current) continue;
      if (current.value_id && Array.isArray(attr.values) && attr.values.length > 0) {
        const valid = attr.values.some((v: any) => String(v.id) === String(current.value_id));
        if (!valid) {
          return NextResponse.json({
            success: false,
            steps: { ...steps, atributos: { ok: false, error: `Valor inválido para atributo ${attr.name}` } },
            warnings,
            missing_required_attributes: missingRequiredAttributes,
            error: `Valor inválido para atributo ${attr.name}`,
          }, { status: 422 });
        }
      }
    }

    if (missingRequiredAttributes.length > 0) {
      steps.atributos = { ok: false, error: 'Existem atributos obrigatórios sem preenchimento.' };
      return NextResponse.json({
        success: false,
        steps,
        warnings,
        missing_required_attributes: missingRequiredAttributes,
        error: 'Atributos obrigatórios pendentes. Revise antes de criar o anúncio.',
      }, { status: 422 });
    }

    // Enforce SKU + package defaults
    attributesMap.set('SELLER_SKU', { id: 'SELLER_SKU', value_id: undefined, value_name: produto.sku });
    if (produto.altura) attributesMap.set('SELLER_PACKAGE_HEIGHT', { id: 'SELLER_PACKAGE_HEIGHT', value_id: undefined, value_name: `${produto.altura} cm` });
    if (produto.largura) attributesMap.set('SELLER_PACKAGE_WIDTH', { id: 'SELLER_PACKAGE_WIDTH', value_id: undefined, value_name: `${produto.largura} cm` });
    if (produto.profundidade) attributesMap.set('SELLER_PACKAGE_LENGTH', { id: 'SELLER_PACKAGE_LENGTH', value_id: undefined, value_name: `${produto.profundidade} cm` });
    if (produto.peso_bruto) attributesMap.set('SELLER_PACKAGE_WEIGHT', { id: 'SELLER_PACKAGE_WEIGHT', value_id: undefined, value_name: `${produto.peso_bruto} g` });
    steps.atributos.ok = true;

    const saleTerms = Array.isArray(editedSaleTerms)
      ? (editedSaleTerms as SaleTermInput[])
        .filter((term) => term?.id)
        .map((term) => ({ id: String(term.id), value_id: term.value_id ? String(term.value_id) : undefined, value_name: term.value_name ? String(term.value_name) : undefined }))
      : [];

    if (!saleTerms.find((t) => t.id === 'WARRANTY_TIME')) {
      saleTerms.push({ id: 'WARRANTY_TIME', value_id: undefined, value_name: '12 meses de fábrica' });
    }

    const imagens = produto.imagens || [];
    const pictures = imagens.length > 0 ? imagens : ['https://via.placeholder.com/400'];
    if (imagens.length === 0) warnings.push('Produto sem imagens locais. Será usada imagem placeholder.');

    const titulo = (produto.marca ? `${produto.nome} ${produto.marca}` : produto.nome).substring(0, 60);
    const familyName = produto.nome.substring(0, 60);

    let useFamilyName = false;
    try {
      const me = await fetchML<any>('/users/me?attributes=tags');
      useFamilyName = me?.tags?.includes('user_product_seller') ?? false;
    } catch {}

    const result = await createListing({
      title: useFamilyName ? undefined : titulo,
      familyName: useFamilyName ? familyName : undefined,
      categoryId: categoriaId,
      price: displayPrice,
      availableQuantity: Math.max(1, Number(produto.estoque || 0)),
      condition: 'new',
      listingTypeId: listingType || 'gold_pro',
      description: buildDescription(produto, description),
      pictures,
      attributes: Array.from(attributesMap.values()),
      saleTerms,
      sellerCustomField: produto.sku,
      fiscalData: {
        gtin: fiscal?.gtin || produto.gtin || undefined,
      },
    });

    if (!result) {
      steps.anuncio = { ok: false, error: 'Falha ao criar anúncio no ML' };
      return NextResponse.json({ success: false, steps, warnings, missing_required_attributes: missingRequiredAttributes, error: 'Falha ao criar anúncio no ML' }, { status: 502 });
    }
    steps.anuncio.ok = true;

    const quantityPricingOk = await setItemQuantityPricing(result.id, displayPrice);
    if (quantityPricingOk) steps.atacado.ok = true;
    else {
      steps.atacado = { ok: false, error: 'Falha ao atualizar preços de atacado' };
      warnings.push('Não foi possível configurar os preços de atacado neste momento.');
    }

    let mlFee = produto.ml_fee || 0.15;
    let mlShipping = produto.ml_shipping || 0;

    try {
      const listingPrices = await fetchML<any>(`/sites/MLB/listing_prices?price=${displayPrice}&category_id=${categoriaId}&listing_type_id=${listingType || 'gold_pro'}`);
      if (listingPrices?.sale_fee_details?.percentage_fee) mlFee = listingPrices.sale_fee_details.percentage_fee / 100;
      else if (listingPrices?.sale_fee_details?.meli_percentage_fee) mlFee = listingPrices.sale_fee_details.meli_percentage_fee / 100;
    } catch {}

    try {
      const me = await fetchML<any>('/users/me');
      const sellerZip = me?.address?.zip_code || '';
      if (sellerZip) {
        const shipping = await fetchML<any>(`/items/${result.id}/shipping_options?zip_code=${sellerZip}`);
        const options = shipping?.options || [];
        const freeOption = options.find((o: any) => o.cost === 0);
        if (freeOption?.list_cost) mlShipping = freeOption.list_cost;
        else {
          const firstOption = options.find((o: any) => typeof o.list_cost === 'number');
          if (firstOption?.list_cost) mlShipping = firstOption.list_cost;
        }
      }
    } catch {}

    await supabase.from('produtos').update({ ml_item_id: result.id, ml_status: 'ativo', ml_fee: mlFee, ml_shipping: mlShipping }).eq('id', produtoId);

    await supabase.from('anuncios_ml').upsert({
      ml_item_id: result.id,
      sku: produto.sku,
      produto_id: produto.id,
      titulo: result.title,
      preco_ml: result.price,
      vendidos: 0,
      status: 'ativo',
      thumbnail: result.thumbnail || null,
      permalink: result.permalink,
    }, { onConflict: 'ml_item_id' });

    const fiscalErrors: string[] = [];
    const ncmFinal = fiscal?.ncm || produto.ncm;
    const gtinFinal = fiscal?.gtin || produto.gtin;
    const cestFinal = fiscal?.cest || produto.cest;
    const csosnFinal = fiscal?.csosn || produto.csosn;
    const origemFinal = fiscal?.origem_fiscal || produto.origem_fiscal || '0';

    if (ncmFinal) {
      const originType = origemFinal === '3' || origemFinal === '5' || origemFinal === '8' ? 'imported' : origemFinal === '1' ? 'manufacturer' : 'reseller';
      const csosn = (csosnFinal === '101' || !csosnFinal) ? '102' : csosnFinal;

      const fiscalResult = await updateListingFiscalData({
        itemId: result.id,
        sku: produto.sku,
        title: produto.nome,
        ncm: ncmFinal,
        origin_type: originType,
        origin_detail: origemFinal,
        gtin: gtinFinal || undefined,
        cest: cestFinal || undefined,
        csosn,
        net_weight: produto.peso_liq || undefined,
        gross_weight: produto.peso_bruto || undefined,
        measurement_unit: 'UN',
        cost: produto.custo,
      });

      if (!fiscalResult.success) fiscalErrors.push(`${fiscalResult.step}: ${fiscalResult.error}`);
    } else {
      warnings.push('Produto sem NCM cadastrado. Dados fiscais não enviados.');
    }

    if (fiscalErrors.length === 0) {
      steps.fiscal.ok = Boolean(ncmFinal);
      if (!ncmFinal) steps.fiscal = { ok: false, error: 'Fiscal não enviado por ausência de NCM' };
    } else {
      steps.fiscal = { ok: false, error: fiscalErrors.join(' | ') };
    }

    return NextResponse.json({
      success: steps.anuncio.ok,
      steps,
      warnings,
      missing_required_attributes: missingRequiredAttributes,
      categoria: { id: categoriaId, descoberta: false },
      anuncio: {
        id: result.id,
        title: result.title,
        price: result.price,
        permalink: result.permalink,
        status: result.status,
      },
      quantity_pricing: quantityPricingOk,
      fiscal: fiscalErrors.length === 0 ? 'ok' : fiscalErrors,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
