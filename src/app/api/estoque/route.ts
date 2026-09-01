import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { BNT_D05_INVENTORY_FIXTURE_SOURCE } from '@/lib/homologation-fixture';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const adjustmentSchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().int().refine((value) => value !== 0),
  motivo: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'inventory.read');
  if (!auth.ok) return auth.response;
  const db = createServiceClient();
  const [positionsResult, receiptsResult, receiptItemsResult, movementsResult] = await Promise.all([
    (db as any)
      .from('estoque_interno_posicoes')
      .select('produto_id,sku,nome,fisico_util,reservado,disponivel,em_revisao,nao_aproveitavel,ultima_movimentacao_em')
      .or('fisico_util.gt.0,reservado.gt.0,em_revisao.gt.0,nao_aproveitavel.gt.0')
      .order('nome')
      .limit(1000),
    (db as any)
      .from('estoque_recebimentos_nfe')
      .select('id,chave_nfe,numero,serie,emitente_nome,emitente_cnpj,emitida_em,valor_total,origem_xml,status,created_at,confirmado_em,snapshot_source')
      .order('created_at', { ascending: false })
      .limit(200),
    (db as any)
      .from('estoque_recebimento_itens')
      .select('recebimento_id,quantidade_esperada,quantidade_liberada,quantidade_nao_aproveitavel'),
    (db as any)
      .from('estoque_interno_movimentacoes')
      .select('id,produto_id,pedido_id,tipo,quantidade,motivo,situacao_estoque,status_devolucao,estado_envio_interno,created_at,despachado_em,estornada_em,estorno_motivo,recebimento_id,created_by,snapshot_source,produtos(sku,nome),pedidos(ml_order_id,ml_pack_id),estoque_recebimentos_nfe(chave_nfe,numero,serie,emitente_nome)')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  for (const result of [positionsResult, receiptsResult, receiptItemsResult, movementsResult]) {
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const receiptTotals = new Map<string, { expected: number; received: number }>();
  for (const item of receiptItemsResult.data || []) {
    const id = String(item.recebimento_id);
    const current = receiptTotals.get(id) || { expected: 0, received: 0 };
    current.expected += Number(item.quantidade_esperada || 0);
    current.received += Number(item.quantidade_liberada || 0) + Number(item.quantidade_nao_aproveitavel || 0);
    receiptTotals.set(id, current);
  }
  const receipts = (receiptsResult.data || []).map((receipt: any) => ({
    ...receipt,
    itens_esperados: receiptTotals.get(String(receipt.id))?.expected || 0,
    itens_conferidos: receiptTotals.get(String(receipt.id))?.received || 0,
  }));
  const fixtureByProduct = new Map<string, any>();
  for (const movement of (movementsResult.data || []).filter((row: any) => row.snapshot_source === BNT_D05_INVENTORY_FIXTURE_SOURCE)) {
    const productId = String(movement.produto_id);
    const current = fixtureByProduct.get(productId) || {
      produto_id: `fixture:${productId}`,
      fixture_produto_id: productId,
      sku: movement.produtos?.sku || '—',
      nome: movement.produtos?.nome || 'Produto de demonstração',
      fisico_util: 0,
      reservado: 0,
      disponivel: 0,
      em_revisao: 0,
      nao_aproveitavel: 0,
      ultima_movimentacao_em: null,
      is_homologation_fixture: true,
    };
    const quantity = Number(movement.quantidade || 0);
    if (['entrada_devolucao', 'entrada_compra', 'ajuste_positivo'].includes(movement.tipo) && movement.situacao_estoque === 'liberado') current.fisico_util += quantity;
    if (movement.tipo === 'ajuste_negativo') current.fisico_util -= quantity;
    if (movement.tipo === 'saida_envio_interno' && movement.estado_envio_interno === 'despachado') current.fisico_util -= quantity;
    if (movement.tipo === 'saida_envio_interno' && movement.estado_envio_interno === 'reservado') current.reservado += quantity;
    if (['entrada_devolucao', 'entrada_compra'].includes(movement.tipo) && movement.situacao_estoque === 'revisao') current.em_revisao += quantity;
    if (['entrada_devolucao', 'entrada_compra'].includes(movement.tipo) && movement.situacao_estoque === 'nao_aproveitavel') current.nao_aproveitavel += quantity;
    if (!current.ultima_movimentacao_em || movement.created_at > current.ultima_movimentacao_em) current.ultima_movimentacao_em = movement.created_at;
    fixtureByProduct.set(productId, current);
  }
  for (const position of fixtureByProduct.values()) {
    position.fisico_util = Math.max(0, position.fisico_util);
    position.disponivel = Math.max(0, position.fisico_util - position.reservado);
  }
  const positions = [...(positionsResult.data || []), ...fixtureByProduct.values()];
  const inConference = receipts
    .filter((receipt: any) => receipt.status !== 'conferido')
    .reduce((total: number, receipt: any) => total + Math.max(0, receipt.itens_esperados - receipt.itens_conferidos), 0);

  return NextResponse.json({
    positions,
    receipts,
    movements: movementsResult.data || [],
    hasHomologationFixtures: fixtureByProduct.size > 0 || receipts.some((receipt: any) => receipt.snapshot_source === BNT_D05_INVENTORY_FIXTURE_SOURCE),
    summary: {
      skus: positions.length,
      fisico: positions.reduce((total: number, row: any) => total + Number(row.fisico_util || 0), 0),
      disponivel: positions.reduce((total: number, row: any) => total + Number(row.disponivel || 0), 0),
      reservado: positions.reduce((total: number, row: any) => total + Number(row.reservado || 0), 0),
      emConferencia: inConference,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const parsed = adjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ajuste de estoque inválido.' }, { status: 400 });

  const db = createServiceClient();
  const { data, error } = await (db as any).rpc('adjust_internal_stock', {
    p_product_id: parsed.data.produtoId,
    p_quantity: parsed.data.quantidade,
    p_reason: parsed.data.motivo,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_user_id: auth.userId,
  });
  if (error) {
    const conflict = String(error.message || '').includes('stock_adjustment_invades_reservations');
    return NextResponse.json({
      error: conflict
        ? 'O ajuste reduziria unidades já reservadas para vendas.'
        : error.message,
    }, { status: conflict ? 409 : 500 });
  }

  try {
    const mlSync = await enfileirarSyncMlEstoqueInterno(parsed.data.produtoId);
    return NextResponse.json({ success: true, movimentoId: data, mlSync }, { status: 201 });
  } catch (syncError: any) {
    console.error('[stock_adjustment_ml_sync_failed]', { produtoId: parsed.data.produtoId, error: syncError?.message || syncError });
    return NextResponse.json({
      success: true,
      movimentoId: data,
      mlSyncWarning: 'Ajuste salvo, mas a atualização do anúncio não foi enfileirada.',
    }, { status: 201 });
  }
}
