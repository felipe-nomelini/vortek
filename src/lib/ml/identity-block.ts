type ServiceClientLike = {
  from: (table: string) => any;
};

export async function ensureAutomaticMlIdentityBlock(
  client: ServiceClientLike,
  itemId: string,
  reason: string,
) {
  const { data: existing, error: lookupError } = await client
    .from('ml_manual_blocklist')
    .select('id')
    .eq('ml_item_id', itemId)
    .eq('ativo', true)
    .limit(1)
    .maybeSingle();
  if (lookupError) return { ok: false as const, error: lookupError.message };
  if (existing?.id) return { ok: true as const };

  const { error } = await client.from('ml_manual_blocklist').insert({
    ml_item_id: itemId,
    sku: null,
    ativo: true,
    motivo: reason,
    created_by: 'ml_identity_gate',
  });
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const };
}

export async function clearAutomaticMlIdentityBlock(
  client: ServiceClientLike,
  itemId: string,
) {
  const { error } = await client
    .from('ml_manual_blocklist')
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq('ml_item_id', itemId)
    .eq('ativo', true)
    .eq('created_by', 'ml_identity_gate');
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const };
}

export async function findActiveMlListingBlock(
  client: ServiceClientLike,
  itemId: string,
  sku: string,
): Promise<
  | { ok: true; block: { motivo: string | null; created_by: string | null } | null }
  | { ok: false; error: string }
> {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const queries = [
    client
      .from('ml_manual_blocklist')
      .select('motivo,created_by')
      .eq('ml_item_id', itemId)
      .eq('ativo', true)
      .limit(1)
      .maybeSingle(),
  ];
  if (normalizedSku) {
    queries.push(
      client
        .from('ml_manual_blocklist')
        .select('motivo,created_by')
        .eq('sku', normalizedSku)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle(),
    );
  }

  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  const block = results.map((result) => result.data).find(Boolean) || null;
  return { ok: true, block };
}

export type MlActivationIdentityValidation =
  | { ok: true; item: any }
  | {
      ok: false;
      kind: 'conflict' | 'manual_block' | 'validation_error';
      error: string;
      transient: boolean;
      item?: any;
      conflicts?: Array<{ field: string; expected: string; remote: string }>;
    };

export async function validateMlListingIdentityForActivation(
  client: ServiceClientLike,
  params: { itemId: string; productId?: string | null },
): Promise<MlActivationIdentityValidation> {
  let productQuery = client
    .from('produtos')
    .select('id,sku,nome,descricao,categoria,marca,gtin,oferta_preferencial_id,fornecedor_preferencial_manual');
  productQuery = params.productId
    ? productQuery.eq('id', params.productId)
    : productQuery.eq('ml_item_id', params.itemId);
  const { data: product, error: productError } = await productQuery.maybeSingle();
  if (productError) {
    return { ok: false, kind: 'validation_error', error: productError.message, transient: true };
  }
  if (!product?.id) {
    return {
      ok: false,
      kind: 'validation_error',
      error: 'Produto não encontrado para validar a identidade antes da ativação',
      transient: false,
    };
  }

  const [itemResult, offersResult] = await Promise.all([
    fetchMLResult<any>(`/items/${params.itemId}`),
    client
      .from('produto_fornecedor_ofertas')
      .select('id,nome,descricao,custo,estoque,prioridade,ativo')
      .eq('produto_id', product.id),
  ]);
  if (!itemResult.ok || !itemResult.data) {
    return {
      ok: false,
      kind: 'validation_error',
      error: itemResult.error?.message || 'Falha ao consultar anúncio antes da ativação',
      transient: true,
    };
  }
  if (offersResult.error) {
    return {
      ok: false,
      kind: 'validation_error',
      error: offersResult.error.message,
      transient: true,
    };
  }

  const assessment = assessMlProductIdentity(
    itemResult.data,
    product,
    offersResult.data || [],
  );
  if (assessment.canonicalBrand) {
    const { error: brandUpdateError } = await client
      .from('produtos')
      .update({ marca: assessment.canonicalBrand })
      .eq('id', product.id);
    if (brandUpdateError) {
      return {
        ok: false,
        kind: 'validation_error',
        error: brandUpdateError.message,
        transient: true,
        item: itemResult.data,
      };
    }
  }

  if (assessment.blockingConflicts.length > 0) {
    const reason = `Divergência material de identidade ML: ${assessment.blockingConflicts
      .map((conflict) => `${conflict.field} local=${conflict.expected} remoto=${conflict.remote}`)
      .join('; ')}`;
    const blockResult = await ensureAutomaticMlIdentityBlock(
      client,
      params.itemId,
      reason,
    );
    if (!blockResult.ok) {
      return {
        ok: false,
        kind: 'validation_error',
        error: blockResult.error,
        transient: true,
        item: itemResult.data,
      };
    }
    return {
      ok: false,
      kind: 'conflict',
      error: reason,
      transient: false,
      item: itemResult.data,
      conflicts: assessment.blockingConflicts,
    };
  }

  const unblockResult = await clearAutomaticMlIdentityBlock(client, params.itemId);
  if (!unblockResult.ok) {
    return {
      ok: false,
      kind: 'validation_error',
      error: unblockResult.error,
      transient: true,
      item: itemResult.data,
    };
  }
  const activeBlock = await findActiveMlListingBlock(
    client,
    params.itemId,
    String(product.sku || ''),
  );
  if (!activeBlock.ok) {
    return {
      ok: false,
      kind: 'validation_error',
      error: activeBlock.error,
      transient: true,
      item: itemResult.data,
    };
  }
  if (activeBlock.block) {
    return {
      ok: false,
      kind: 'manual_block',
      error: activeBlock.block.motivo || 'Anúncio bloqueado manualmente',
      transient: false,
      item: itemResult.data,
    };
  }
  return { ok: true, item: itemResult.data };
}
import { assessMlProductIdentity } from '@/lib/ml-critical-attributes';
import { fetchMLResult } from '@/services/integration';
