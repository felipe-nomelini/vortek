import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { loadStockReceipt } from '@/lib/estoque-recebimento';
import { createServiceClient } from '@/lib/supabase';

const schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  itens: z.array(z.object({
    itemId: z.string().uuid(),
    produtoId: z.string().uuid(),
    quantidadeLiberada: z.number().int().min(0),
    quantidadeNaoAproveitavel: z.number().int().min(0),
  })).min(1),
});

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Conferência inválida.' }, { status: 400 });
  const receiptId = (await props.params).id;
  const db = createServiceClient();
  const { data, error } = await (db as any).rpc('confirm_internal_stock_receipt', {
    p_receipt_id: receiptId,
    p_items: parsed.data.itens.map((item) => ({
      item_id: item.itemId,
      produto_id: item.produtoId,
      quantidade_liberada: item.quantidadeLiberada,
      quantidade_nao_aproveitavel: item.quantidadeNaoAproveitavel,
    })),
    p_idempotency_key: parsed.data.idempotencyKey,
    p_user_id: auth.userId,
  });
  if (error) {
    const code = String(error.message || '');
    const message = code.includes('unmapped')
      ? 'Todos os itens precisam estar vinculados a um produto Bentevi.'
      : code.includes('quantities')
        ? 'As quantidades conferidas são inválidas ou excedem a NF-e.'
        : error.message;
    return NextResponse.json({ error: message }, { status: 409 });
  }
  const result = Array.isArray(data) ? data[0] : data;
  const warnings: string[] = [];
  for (const productId of Array.isArray(result?.product_ids) ? result.product_ids : []) {
    try {
      await enfileirarSyncMlEstoqueInterno(String(productId));
    } catch (syncError: any) {
      console.error('[stock_receipt_ml_sync_failed]', { receiptId, productId, error: syncError?.message || syncError });
      warnings.push(String(productId));
    }
  }
  return NextResponse.json({
    success: true,
    receipt: await loadStockReceipt(receiptId),
    mlSyncWarning: warnings.length ? 'Estoque confirmado, mas alguns anúncios não foram enfileirados para atualização.' : null,
  });
}
