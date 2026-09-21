import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { readEvolusomMerchantOrderStatus } from '@/lib/evolusom/order-status';
import { getEvolusomOrderStatus } from '@/services/evolusom-purchase';
import { isEvolusomAccessError } from '@/services/evolusom';

export const maxDuration = 300;

const DOMAIN = 'compras:evolusom';

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }
  if (process.env.EVOLUSOM_DIRECT_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Integração direta Evolusom desativada' }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.trunc(requestedLimit))) : 20;
  const lock = await acquireDomainLock({
    domain: DOMAIN,
    ownerTask: 'sync_evolusom_pedidos_compra',
    ttlSeconds: 5 * 60,
  });
  if (!lock.acquired) {
    return NextResponse.json({ success: false, code: 'domain_lock_conflict' }, { status: 409 });
  }

  try {
    const client = createServiceClient();
    const { data: purchases, error: readError } = await client.from('compras')
      .select('id,evolusom_order_id,status')
      .eq('fornecedor_id', '133')
      .eq('evolusom_request_state', 'created')
      .not('evolusom_order_id', 'is', null)
      .order('updated_at', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    if (readError) throw new Error(`Falha ao selecionar compras Evolusom: ${readError.message}`);

    let checked = 0;
    let changed = 0;
    let failed = 0;
    const changes: Array<{ pedido: number; anterior: string; atual: string }> = [];
    for (const purchase of purchases || []) {
      const orderId = Number(purchase.evolusom_order_id);
      let status: string | null = null;
      try {
        const response = await getEvolusomOrderStatus(orderId);
        status = readEvolusomMerchantOrderStatus(response, orderId);
      } catch (error) {
        if (isEvolusomAccessError(error)) {
          return NextResponse.json({
            success: false, failure_reason: 'auth_fatal', auth_state: 'reauth_required',
            checked, changed, failed,
          }, { status: 401 });
        }
        failed += 1;
        console.error('[sync-evolusom-pedidos] falha na consulta', orderId,
          error instanceof Error ? error.message : String(error));
      }

      const previousStatus = String(purchase.status || '').trim();
      const hasChanged = status !== null && status !== previousStatus;
      // A escrita também avança updated_at para distribuir a próxima rodada.
      const update = { status: status ?? purchase.status };
      let query = client.from('compras').update(update)
        .eq('id', purchase.id)
        .eq('evolusom_order_id', orderId)
        .eq('evolusom_request_state', 'created');
      query = purchase.status == null ? query.is('status', null) : query.eq('status', purchase.status);
      const { data: saved, error: saveError } = await query.select('id').maybeSingle();
      if (saveError || !saved) {
        failed += 1;
        console.error('[sync-evolusom-pedidos] falha ao atualizar compra', orderId,
          saveError?.message || 'compra alterada durante a consulta');
        continue;
      }
      if (status === null) continue;
      checked += 1;
      if (hasChanged) {
        changed += 1;
        changes.push({ pedido: orderId, anterior: previousStatus, atual: status });
      }
    }

    return NextResponse.json({
      success: failed === 0,
      checked, changed, failed, changes,
    }, { status: failed ? 500 : 200 });
  } catch (error) {
    console.error('[sync-evolusom-pedidos] falha do ciclo',
      error instanceof Error ? error.message : String(error));
    return NextResponse.json({ success: false, error: 'Falha ao sincronizar pedidos Evolusom' }, { status: 500 });
  } finally {
    await releaseDomainLock({ domain: DOMAIN, ownerToken: lock.ownerToken }).catch((error) => {
      console.error('[sync-evolusom-pedidos] falha ao liberar lock',
        error instanceof Error ? error.message : String(error));
    });
  }
}
