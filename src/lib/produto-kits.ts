import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

type ServiceClientLike = { from: (table: string) => any };

export type SimpleKitOrderPlan = {
  componentSku: string;
  componentTitle: string;
  componentQuantity: number;
  componentNcm: string | null;
  componentGtin: string | null;
};

/** Resolve a kit that can become one product line in the fiscal/DSLite order. */
export async function resolveSimpleKitOrderPlan(
  client: ServiceClientLike,
  kitSku: string,
): Promise<
  | { kind: 'not_kit' }
  | { kind: 'inactive' }
  | { kind: 'unsupported_composite'; componentCount: number }
  | { kind: 'ready'; plan: SimpleKitOrderPlan }
> {
  const normalizedSku = String(kitSku || '').trim();
  if (!normalizedSku) return { kind: 'not_kit' };
  const { data: kitProduct, error: kitProductError } = await client
    .from('produtos' as any)
    .select('id')
    .eq('sku', normalizedSku)
    .maybeSingle();
  if (kitProductError) throw new Error(`Falha ao localizar kit ${normalizedSku}: ${kitProductError.message}`);
  if (!kitProduct?.id) return { kind: 'not_kit' };

  const { data: kit, error: kitError } = await client
    .from('produto_kits' as any)
    .select('produto_id,ativo')
    .eq('produto_id', String(kitProduct.id))
    .maybeSingle();
  if (kitError) throw new Error(`Falha ao carregar configuração do kit ${normalizedSku}: ${kitError.message}`);
  if (!kit?.produto_id) return { kind: 'not_kit' };
  if (kit.ativo === false) return { kind: 'inactive' };

  const { data: components, error: componentsError } = await client
    .from('produto_kit_componentes' as any)
    .select('componente_produto_id,quantidade')
    .eq('kit_produto_id', String(kit.produto_id));
  if (componentsError) throw new Error(`Falha ao carregar componentes do kit ${normalizedSku}: ${componentsError.message}`);
  if ((components || []).length !== 1) {
    return { kind: 'unsupported_composite', componentCount: (components || []).length };
  }

  const component = components![0] as any;
  const { data: source, error: sourceError } = await client
    .from('produtos' as any)
    .select('sku,nome,ncm,gtin,ativo')
    .eq('id', String(component.componente_produto_id))
    .maybeSingle();
  if (sourceError || !source?.sku) throw new Error(`Componente base ausente no kit ${normalizedSku}`);
  if (source.ativo === false) return { kind: 'inactive' };

  return {
    kind: 'ready',
    plan: {
      componentSku: String(source.sku),
      componentTitle: String(source.nome || source.sku),
      componentQuantity: Math.max(1, Math.trunc(Number(component.quantidade || 0))),
      componentNcm: source.ncm ? String(source.ncm) : null,
      componentGtin: source.gtin ? String(source.gtin) : null,
    },
  };
}

export type KitStockSnapshot = {
  produtoId: string;
  sku: string;
  oldStock: number;
  newStock: number;
  oldCost: number;
  newCost: number;
  mlItemIds: string[];
};

/** Recalcula estoque vendável e custo de kits a partir dos produtos componentes. */
export async function recalculateProductKits(
  client: ServiceClientLike,
  componentProductIds?: string[],
): Promise<KitStockSnapshot[]> {
  const componentIds = Array.from(new Set((componentProductIds || []).map(String).filter(Boolean)));
  let componentQuery = client
    .from('produto_kit_componentes' as any)
    .select('kit_produto_id,componente_produto_id,quantidade');
  if (componentIds.length > 0) componentQuery = componentQuery.in('componente_produto_id', componentIds);

  const { data: affectedComponents, error: affectedError } = await componentQuery;
  if (affectedError) throw new Error(`Falha ao localizar kits afetados: ${affectedError.message}`);

  const kitIds = Array.from(new Set((affectedComponents || []).map((row: any) => String(row.kit_produto_id || '')).filter(Boolean)));
  if (kitIds.length === 0) return [];

  const [{ data: kitRows, error: kitsError }, { data: componentRows, error: componentsError }, { data: listings, error: listingsError }] = await Promise.all([
    client.from('produtos' as any).select('id,sku,estoque,custo').in('id', kitIds),
    client.from('produto_kit_componentes' as any).select('kit_produto_id,componente_produto_id,quantidade').in('kit_produto_id', kitIds),
    client.from('anuncios_ml' as any).select('produto_id,ml_item_id').in('produto_id', kitIds),
  ]);
  if (kitsError || componentsError || listingsError) {
    throw new Error(kitsError?.message || componentsError?.message || listingsError?.message || 'Falha ao carregar dados dos kits');
  }

  const sourceIds = Array.from(new Set((componentRows || []).map((row: any) => String(row.componente_produto_id || '')).filter(Boolean)));
  const { data: sources, error: sourcesError } = sourceIds.length > 0
    ? await client.from('produtos' as any).select('id,estoque,custo').in('id', sourceIds)
    : { data: [], error: null };
  if (sourcesError) throw new Error(`Falha ao carregar componentes dos kits: ${sourcesError.message}`);

  const sourceById = new Map((sources || []).map((row: any) => [String(row.id), row]));
  const componentsByKit = new Map<string, any[]>();
  for (const row of componentRows || []) {
    const key = String((row as any).kit_produto_id || '');
    const rows = componentsByKit.get(key) || [];
    rows.push(row);
    componentsByKit.set(key, rows);
  }
  const listingsByKit = new Map<string, string[]>();
  for (const row of listings || []) {
    const key = String((row as any).produto_id || '');
    const itemId = String((row as any).ml_item_id || '');
    if (!key || !itemId) continue;
    const items = listingsByKit.get(key) || [];
    items.push(itemId);
    listingsByKit.set(key, items);
  }

  const snapshots: KitStockSnapshot[] = [];
  for (const kit of kitRows || []) {
    const kitId = String((kit as any).id || '');
    const rows = componentsByKit.get(kitId) || [];
    if (!kitId || rows.length === 0) continue;

    let available = Number.MAX_SAFE_INTEGER;
    let cost = 0;
    let valid = true;
    for (const component of rows) {
      const quantity = Math.max(1, Math.trunc(Number((component as any).quantidade || 0)));
      const source = sourceById.get(String((component as any).componente_produto_id || ''));
      if (!source) { valid = false; break; }
      const sourceRow: any = source;
      available = Math.min(available, Math.floor(Math.max(0, Number(sourceRow.estoque || 0)) / quantity));
      cost += Math.max(0, Number(sourceRow.custo || 0)) * quantity;
    }
    const newStock = valid && Number.isFinite(available) ? Math.max(0, available) : 0;
    const newCost = Math.round(cost * 100) / 100;
    const oldStock = Math.max(0, Number((kit as any).estoque || 0));
    const oldCost = Math.max(0, Number((kit as any).custo || 0));
    if (oldStock !== newStock || oldCost !== newCost) {
      const { error } = await client.from('produtos' as any).update({ estoque: newStock, custo: newCost }).eq('id', kitId);
      if (error) throw new Error(`Falha ao atualizar kit ${kitId}: ${error.message}`);
    }
    snapshots.push({
      produtoId: kitId,
      sku: String((kit as any).sku || ''),
      oldStock,
      newStock,
      oldCost,
      newCost,
      mlItemIds: listingsByKit.get(kitId) || [],
    });
  }
  return snapshots;
}

export async function enqueueKitStockUpdates(client: ServiceClientLike, snapshots: KitStockSnapshot[]): Promise<number> {
  let queued = 0;
  for (const kit of snapshots) {
    for (const mlItemId of kit.mlItemIds) {
      const result = await enqueueMlPublishOutbox(client, {
        produtoId: kit.produtoId,
        mlItemId,
        desiredStatus: kit.newStock > 0 ? 'ativo' : 'pausado',
        desiredQuantity: kit.newStock,
        source: 'kit_stock_automation',
        dedupePending: true,
        payload: { apply_price: false, apply_quantity_pricing: false, apply_quantity: true, apply_status: true, sku: kit.sku },
      });
      if (!result.ok) throw new Error(`Falha ao enfileirar estoque do kit ${kit.sku}: ${result.error}`);
      queued += 1;
    }
  }
  return queued;
}
