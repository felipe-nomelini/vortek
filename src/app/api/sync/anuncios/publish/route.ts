import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

export const maxDuration = 300;

const MAX_RETRY_ATTEMPTS = 5;

function parsePositiveInt(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function toMlStatus(value: unknown): 'active' | 'paused' | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'ativo' || raw === 'active') return 'active';
  if (raw === 'pausado' || raw === 'paused') return 'paused';
  return null;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(200, parsePositiveInt(body?.limit, 50));
  const seedFromProducts = Boolean(body?.seedFromProducts);

  let lockOwnerToken = '';
  let lockAcquired = false;
  const domain = 'anuncios:ml_push';
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_listings_publish',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/anuncios/publish' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_ml_listings_publish',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { pulled: 0, done: 0, retry: 0, failed: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const client = createServiceClient();

    if (seedFromProducts) {
      const { data: produtos } = await client
        .from('produtos')
        .select('id, ml_item_id, ml_status, custom_price, estoque')
        .not('ml_item_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (produtos?.length) {
        const seedRows = produtos
          .filter((p) => String(p.ml_item_id || '').trim())
          .map((p) => ({
            produto_id: p.id,
            ml_item_id: String(p.ml_item_id),
            desired_status: p.ml_status || null,
            desired_price: typeof p.custom_price === 'number' ? p.custom_price : null,
            desired_quantity: typeof p.estoque === 'number' ? p.estoque : null,
            source: 'seed_from_products',
            payload: { seeded_at: new Date().toISOString() },
            status: 'pending',
            available_at: new Date().toISOString(),
          }));

        if (seedRows.length > 0) {
          await (client.from('anuncios_ml_outbox' as any).insert(seedRows as any) as any).catch(() => null);
        }
      }
    }

    const { data: outboxRows, error: outboxError } = await (client
      .from('anuncios_ml_outbox' as any)
      .select('id, produto_id, ml_item_id, desired_status, desired_price, desired_quantity, status, attempts')
      .in('status', ['pending', 'retry'])
      .lte('available_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(limit) as any);

    if (outboxError) {
      throw new Error(`Falha ao consultar outbox de anúncios: ${outboxError.message}`);
    }

    const rows = Array.isArray(outboxRows) ? outboxRows : [];
    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        domain,
        job: {
          key: 'sync_ml_listings_publish',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: null,
        records: { pulled: 0, done: 0, retry: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
        ok: true,
        message: 'Outbox de publicação sem itens pendentes',
      });
    }

    let done = 0;
    let retry = 0;
    let failed = 0;

    for (const row of rows) {
      const outboxId = String(row.id);
      const mlItemId = String(row.ml_item_id || '').trim();
      const attempts = Number(row.attempts || 0) + 1;

      await (client
        .from('anuncios_ml_outbox' as any)
        .update({
          status: 'processing',
          attempts,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', outboxId) as any);

      const operations: Array<{ op: string; ok: boolean; error?: string }> = [];

      if (!mlItemId) {
        operations.push({ op: 'validate', ok: false, error: 'ml_item_id ausente no outbox' });
      } else {
        if (row.desired_price !== null && row.desired_price !== undefined) {
          const price = Number(row.desired_price);
          if (!Number.isFinite(price) || price <= 0) {
            operations.push({ op: 'price', ok: false, error: 'Preço desejado inválido' });
          } else {
            const result = await fetchMLResult<any>(`/items/${mlItemId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ price }),
            });
            operations.push({
              op: 'price',
              ok: result.ok,
              error: result.ok ? undefined : (result.error?.message || 'Falha ao publicar preço no ML'),
            });
          }
        }

        if (row.desired_quantity !== null && row.desired_quantity !== undefined) {
          const quantity = Math.max(0, Math.trunc(Number(row.desired_quantity)));
          const result = await fetchMLResult<any>(`/items/${mlItemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ available_quantity: quantity }),
          });
          operations.push({
            op: 'quantity',
            ok: result.ok,
            error: result.ok ? undefined : (result.error?.message || 'Falha ao publicar estoque no ML'),
          });
        }

        const statusMl = toMlStatus(row.desired_status);
        if (statusMl) {
          const result = await fetchMLResult<any>(`/items/${mlItemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: statusMl }),
          });
          operations.push({
            op: 'status',
            ok: result.ok,
            error: result.ok ? undefined : (result.error?.message || 'Falha ao publicar status no ML'),
          });
        }
      }

      const failedOperation = operations.find((entry) => !entry.ok);
      if (!failedOperation) {
        done += 1;
        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: 'done',
            last_error: null,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', outboxId) as any);
      } else {
        const isHardFail = attempts >= MAX_RETRY_ATTEMPTS;
        if (isHardFail) failed += 1;
        else retry += 1;

        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: isHardFail ? 'failed' : 'retry',
            last_error: failedOperation.error || 'Falha na publicação ML',
            available_at: isHardFail
              ? new Date().toISOString()
              : new Date(Date.now() + Math.min(15, attempts) * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', outboxId) as any);

        errors.push({
          code: 'ml_publish_operation_failed',
          message: failedOperation.error || 'Falha na publicação',
          context: { outboxId, mlItemId, operation: failedOperation.op, attempts },
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      domain,
      job: {
        key: 'sync_ml_listings_publish',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: null,
      records: {
        pulled: rows.length,
        done,
        retry,
        failed,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
      ok: errors.length === 0,
      processados: rows.length,
      publicados: done,
      reprocessar: retry,
      falhas: failed,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      job: {
        key: 'sync_ml_listings_publish',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      records: { pulled: 0, done: 0, retry: 0, failed: 0 },
      errors: [{ code: 'ml_publish_unexpected_error', message: err?.message || 'Erro inesperado no sync de publicação ML' }],
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}

