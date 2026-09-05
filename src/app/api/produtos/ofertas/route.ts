import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { loadPricingProjections, type ProductPricingProjection } from '@/services/pricing-projection';
import { loadProdutoOfertaRows, type ProdutoOfertaListRow } from '@/lib/produto-ofertas';
import { calcularSaldoEstoqueInterno } from '@/lib/estoque-interno-saldo';
import {
  fetchAllRowsPaginated,
  includesInternalSupplierFilter,
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  type SupplierFilterOption,
} from '@/lib/produto-filtering';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const search = searchParams.get('search') || '';
  const pageSize = 100;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const fornecedorFilterIds = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const mlStatus = searchParams.get('ml_status') || '';
  const estoque = searchParams.get('estoque') || '';
  const rawSortBy = searchParams.get('sortBy') || 'sku';
  const rawSortOrder = searchParams.get('sortOrder') || 'asc';
  const sortBy = new Set(['sku', 'nome', 'fornecedor', 'estoque', 'custo', 'ml_status']).has(rawSortBy)
    ? rawSortBy
    : 'sku';
  const sortOrder = rawSortOrder === 'desc' ? 'desc' : 'asc';
  let internalStockProductIds = new Set<string>();

  let projections = new Map<string, ProductPricingProjection>();
  function computeDerived(item: ProdutoOfertaListRow): { displayPrice: number; profit: number | null } {
    const p = projections.get(item.productId);
    const current = p && p.current?.offerId === item.offerId ? p.current : null;
    const target = p && p.target?.offerId === item.offerId ? p.target : null;
    return { displayPrice: item.product.custom_price ?? target?.price ?? Number.NaN, profit: current?.result ?? null };
  }

  function matchesFilters(item: ProdutoOfertaListRow): boolean {
    if (search) {
      const term = search.toLowerCase();
      const haystack = [
        item.nome,
        item.skuOferta,
        item.skuFornecedor,
        item.fornecedor,
        item.product.nome,
        item.product.sku,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      if (!haystack.includes(term)) return false;
    }
    if (fornecedorFilterIds.length > 0) {
      const matchesExternal = supplierFilterDsliteIds.includes(String(item.dsliteFornecedorId || '').trim());
      const matchesInternal = includeInternal && internalStockProductIds.has(item.productId);
      if (!matchesExternal && !matchesInternal) return false;
    }
    if (mlStatus && item.product.ml_status !== mlStatus) {
      return false;
    }
    if (estoque === 'com_estoque' && Number(item.estoque || 0) <= 0) {
      return false;
    }
    if (estoque === 'sem_estoque' && Number(item.estoque || 0) !== 0) {
      return false;
    }
    return true;
  }

  function sortRows(rows: ProdutoOfertaListRow[]) {
    const direction = sortOrder === 'asc' ? 1 : -1;
    rows.sort((left, right) => {
      let comparison = 0;

      switch (sortBy) {
        case 'sku':
          comparison = String(left.skuOferta || '').localeCompare(String(right.skuOferta || ''), 'pt-BR');
          break;
        case 'nome':
          comparison = String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR');
          break;
        case 'fornecedor':
          comparison = String(left.fornecedor || '').localeCompare(String(right.fornecedor || ''), 'pt-BR');
          break;
        case 'estoque':
          comparison = Number(left.estoque || 0) - Number(right.estoque || 0);
          break;
        case 'custo':
          comparison = Number(left.custo || 0) - Number(right.custo || 0);
          break;
        case 'ml_status':
          comparison = String(left.product.ml_status || '').localeCompare(String(right.product.ml_status || ''), 'pt-BR');
          break;
        default:
          comparison = String(left.skuOferta || '').localeCompare(String(right.skuOferta || ''), 'pt-BR');
          break;
      }

      if (comparison !== 0) return comparison * direction;
      return String(left.skuOferta || '').localeCompare(String(right.skuOferta || ''), 'pt-BR');
    });
  }

  let rows: ProdutoOfertaListRow[] = [];
  let supplierOptions: SupplierFilterOption[] = [];
  try {
    [rows, supplierOptions] = await Promise.all([
      loadProdutoOfertaRows(serviceClient),
      listActiveSupplierOptions(serviceClient),
    ]);
  } catch (error: any) {
    console.error('[api/produtos/ofertas] Falha ao carregar produto_fornecedor_ofertas:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao carregar ofertas de produto' }, { status: 500 });
  }

  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);
  const includeInternal = includesInternalSupplierFilter(fornecedorFilterIds);
  if (includeInternal) {
    try {
      const movements = await fetchAllRowsPaginated<any>((from, to) => (
        (serviceClient as any)
          .from('estoque_interno_movimentacoes')
          .select('produto_id,tipo,quantidade,situacao_estoque,estornada_em')
          .order('produto_id', { ascending: true })
          .range(from, to)
      ));
      const movementsByProduct = new Map<string, any[]>();
      for (const movement of movements) {
        const productId = String(movement?.produto_id || '').trim();
        if (!productId) continue;
        const list = movementsByProduct.get(productId) || [];
        list.push(movement);
        movementsByProduct.set(productId, list);
      }
      internalStockProductIds = new Set(
        Array.from(movementsByProduct.entries())
          .filter(([, productMovements]) => calcularSaldoEstoqueInterno(productMovements) > 0)
          .map(([productId]) => productId),
      );
    } catch (error: any) {
      console.error('[api/produtos/ofertas] Falha ao carregar estoque interno:', error?.message || error);
      return NextResponse.json({ erro: error?.message || 'Falha ao carregar estoque interno' }, { status: 500 });
    }
  }
  projections = await loadPricingProjections(serviceClient, rows.map(row => row.productId));
  const filteredRows = rows.filter(matchesFilters);
  sortRows(filteredRows);

  return NextResponse.json({
    data: filteredRows.slice(from, to + 1),
    total: filteredRows.length,
    page,
    pageSize,
    fornecedores: supplierOptions,
    metrics: filteredRows.reduce((acc, item) => {
      const derived = computeDerived(item);
      acc.comEstoque += Number(item.estoque || 0) > 0 ? 1 : 0;
      acc.semAnuncio += item.product.ml_status === 'sem_anuncio' ? 1 : 0;
      if (Number.isFinite(derived.displayPrice)) acc.receitaPotencial += derived.displayPrice * Number(item.estoque || 0);
      if (derived.profit !== null) {
        acc.lucroSomado += derived.profit;
        acc.lucroCount += 1;
      }
      return acc;
    }, {
      comEstoque: 0,
      semAnuncio: 0,
      receitaPotencial: 0,
      lucroSomado: 0,
      lucroCount: 0,
    }),
  });
}
