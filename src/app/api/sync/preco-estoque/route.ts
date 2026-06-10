import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku } from '@/lib/sku';
import { inferSupplierPaymentMode, syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

export const maxDuration = 300;

const STOCK_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const STALE_GUARD_LIMIT = 100;

function fallbackNome(input: unknown, sku: string): string {
  const nome = String(input ?? '').trim();
  return nome || `Produto ${sku}`;
}

function extractErrorMessage(error: unknown): string {
  if (!error) return 'Erro desconhecido';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || 'Erro desconhecido');
  }
  return 'Erro desconhecido';
}

function parsePositiveInt(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function normalizeCost(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function normalizeStock(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function isValidDsliteIdentity(item: any): boolean {
  const produtoIdEmpresa = String(item?.produtoid_empresa || '').trim();
  const produtoId = String(item?.produtoid || '').trim();
  return Boolean(produtoIdEmpresa || produtoId);
}

function resolveDesiredMlStatusByStock(estoque: number): 'ativo' | 'pausado' {
  return estoque > 0 ? 'ativo' : 'pausado';
}

function isOlderThanThreshold(value: unknown, thresholdMs = STOCK_STALE_THRESHOLD_MS): boolean {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > thresholdMs;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;
  let fatalSyncError = false;

  const body = await req.json().catch(() => ({}));
  const fornecedorIdsRaw: Array<number | string> = Array.isArray(body?.fornecedorIds) ? body.fornecedorIds : [];
  const cursorFornecedorId = String(body?.fornecedorId || '').trim();
  const startPage = parsePositiveInt(body?.page, 1);
  const pageSize = parsePositiveInt(body?.pageSize, 50);
  const maxPagesPerRun = parsePositiveInt(body?.maxPagesPerRun, 1);
  const withMlSync = Boolean(body?.withMlSync);
  const runStaleGuard = body?.runStaleGuard !== false;

  const jobContext = {
    key: 'sync_dslite_preco_estoque',
    domain: 'produtos:dslite_preco',
    started_at: new Date(startedAt).toISOString(),
  };

  try {
    const lock = await acquireDomainLock({
      domain: jobContext.domain,
      ownerTask: jobContext.key,
      ttlSeconds: 15 * 60,
      metadata: { source: 'api/sync/preco-estoque' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      errors.push({
        code: 'domain_lock_conflict',
        message: `Domínio ${jobContext.domain} em execução por outro sync`,
      });
      return NextResponse.json({
        success: false,
        domain: jobContext.domain,
        job: {
          ...jobContext,
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { seen: 0, updated: 0, missing: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const fornecedores = await listarFornecedores();
    if (!fornecedores?.length) {
      errors.push({ code: 'dslite_fornecedores_empty', message: 'Nenhum fornecedor retornado pela DSLite' });
      return NextResponse.json({
        success: false,
        domain: jobContext.domain,
        job: {
          ...jobContext,
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: null,
        records: { seen: 0, updated: 0, missing: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      }, { status: 502 });
    }

    const fornecedorIds = fornecedorIdsRaw.length > 0
      ? Array.from(new Set(fornecedorIdsRaw.map((id) => String(id).trim()).filter(Boolean)))
      : fornecedores
          .filter((f) => String(f.crossdocking || '').toLowerCase() === 'ativo')
          .map((f) => String(f.id));
    const fornecedorMap = new Map<number, string>();
    for (const fornecedor of fornecedores) {
      fornecedorMap.set(Number(fornecedor.id), String(fornecedor.apelido || fornecedor.id));
    }

    if (fornecedorIds.length === 0) {
      errors.push({ code: 'dslite_fornecedor_ids_empty', message: 'Nenhum fornecedor ativo selecionado' });
      return NextResponse.json({
        success: false,
        domain: jobContext.domain,
        job: {
          ...jobContext,
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: null,
        cursor_exhausted: true,
        records: { seen: 0, updated: 0, missing: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      }, { status: 400 });
    }

    const client = createServiceClient();
    const startSupplierIndex = cursorFornecedorId ? fornecedorIds.indexOf(cursorFornecedorId) : 0;
    let supplierIndex = startSupplierIndex >= 0 ? startSupplierIndex : 0;
    let currentPage = startSupplierIndex >= 0 && cursorFornecedorId ? startPage : 1;
    let pagesProcessed = 0;
    let recordsSeen = 0;
    let recordsUpdated = 0;
    let recordsMissing = 0;
    let recordsFailed = 0;
    let mlOutboxEnqueued = 0;
    let mlOutboxUpdatedExisting = 0;
    let mlOutboxSkippedNoItem = 0;
    let mlOutboxSkippedManualBlock = 0;
    let mlOutboxFailed = 0;
    let recordsUpdatedSeen = 0;
    let mlOutboxPausedZeroStock = 0;
    let mlOutboxPausedStaleStock = 0;
    let remainingPagesBudget = maxPagesPerRun;
    let nextCursor: { fornecedorId: string; page: number } | null = null;
    let stopByBudget = false;
    let staleGuardRan = false;

    while (supplierIndex < fornecedorIds.length) {
      const targetFornecedor = String(fornecedorIds[supplierIndex]);
      const targetFornecedorNome = fornecedorMap.get(Number(targetFornecedor)) || targetFornecedor;
      const response = await sincronizarPrecoEstoque(targetFornecedor, currentPage, pageSize);
      if (!response?.produtos?.length) {
        supplierIndex += 1;
        currentPage = 1;
        continue;
      }

      const produtos = response.produtos;
      pagesProcessed += 1;
      remainingPagesBudget -= 1;
      recordsSeen += produtos.length;

      const batch: Array<{
        sku: string;
        nome: string;
        fornecedor_nome: string;
        dslite_produto_id: string;
        produtoid_empresa: string;
        custo: number;
        estoque: number;
        dslite_ultima_sync: string;
      }> = [];

      for (const item of produtos) {
        if (!isValidDsliteIdentity(item)) {
          recordsFailed += 1;
          errors.push({
            code: 'price_item_identity_missing',
            message: 'Item DSLite sem identidade de produto (produtoid/produtoid_empresa)',
            context: {
              fornecedorId: targetFornecedor,
              page: currentPage,
              titulo: String(item?.titulo || ''),
            },
          });
          continue;
        }

        const sku = String(buildCanonicalDsliteSku(targetFornecedor, item?.produtoid_empresa, item?.produtoid) || '').trim();
        if (!sku) {
          recordsFailed += 1;
          errors.push({
            code: 'price_item_sku_invalid',
            message: 'SKU canônico inválido para item DSLite',
            context: {
              fornecedorId: targetFornecedor,
              page: currentPage,
              produtoid: String(item?.produtoid || ''),
              produtoid_empresa: String(item?.produtoid_empresa || ''),
            },
          });
          continue;
        }

        batch.push({
          sku,
          nome: fallbackNome(item?.titulo, sku),
          fornecedor_nome: targetFornecedorNome,
          dslite_produto_id: String(item?.produtoid || '').trim(),
          produtoid_empresa: String(item?.produtoid_empresa || '').trim(),
          custo: normalizeCost(item?.preco_crossdocking || item?.preco_normal || 0),
          estoque: normalizeStock(item?.estoque || 0),
          dslite_ultima_sync: new Date().toISOString(),
        });
      }

      if (batch.length === 0) {
        const totalRegistros = Number(response?.detalhesConsulta?.totalRegistros || 0);
        const perPage = Number(response?.detalhesConsulta?.limit || produtos.length || pageSize);
        const totalPaginas = perPage > 0 ? Math.ceil(totalRegistros / perPage) : currentPage;
        const hasMore = currentPage < totalPaginas;

        if (remainingPagesBudget <= 0) {
          if (hasMore) {
            nextCursor = { fornecedorId: targetFornecedor, page: currentPage + 1 };
          } else {
            const nextFornecedor = fornecedorIds[supplierIndex + 1];
            nextCursor = nextFornecedor ? { fornecedorId: String(nextFornecedor), page: 1 } : null;
          }
          stopByBudget = true;
          break;
        }

        if (hasMore) {
          currentPage += 1;
          continue;
        }

        supplierIndex += 1;
        currentPage = 1;
        continue;
      }

      const skus = batch.map((row) => row.sku).filter(Boolean);
      const dsliteProdutoIds = batch.map((row) => String((row as any).dslite_produto_id || '').trim()).filter(Boolean);
      const [existingOffersResp, existingRowsResp] = await Promise.all([
        client
          .from('produto_fornecedor_ofertas')
          .select('id,produto_id,dslite_fornecedor_id,dslite_produto_id')
          .eq('dslite_fornecedor_id', targetFornecedor)
          .in('dslite_produto_id', dsliteProdutoIds),
        client
          .from('produtos')
          .select('id, sku, nome, ml_item_id')
          .in('sku', skus),
      ]);

      if (existingOffersResp.error || existingRowsResp.error) {
        fatalSyncError = true;
        errors.push({
          code: 'price_existing_select_failed',
          message: existingOffersResp.error?.message || existingRowsResp.error?.message || 'Falha ao consultar ofertas/produtos existentes',
          context: { fornecedorId: targetFornecedor, page: currentPage },
        });
        recordsFailed += batch.length;
        stopByBudget = true;
        break;
      }

      const existingOffersByIdentity = new Map(
        ((existingOffersResp.data || []) as any[]).map((row: any) => [
          `${String(row.dslite_fornecedor_id || '')}:${String(row.dslite_produto_id || '')}`,
          row,
        ]),
      );
      const existingBySku = new Map((existingRowsResp.data || []).map((row: any) => [String(row.sku || '').toUpperCase(), row]));
      const offerUpserts: Array<Record<string, unknown>> = [];
      const touchedProductIds = new Set<string>();

      for (let index = 0; index < batch.length; index += 1) {
        const row = batch[index];
        const dsliteProdutoId = String((row as any).dslite_produto_id || '').trim();
        const identityKey = `${targetFornecedor}:${dsliteProdutoId}`;
        const existingOffer = existingOffersByIdentity.get(identityKey) as any;
        const legacyProduct = existingBySku.get(String(row.sku || '').trim().toUpperCase()) as any;
        const productId = String(existingOffer?.produto_id || legacyProduct?.id || '').trim();

        if (!productId) {
          recordsMissing += 1;
          continue;
        }

        touchedProductIds.add(productId);
        offerUpserts.push({
          produto_id: productId,
          dslite_fornecedor_id: targetFornecedor,
          fornecedor_nome: String((row as any).fornecedor_nome || targetFornecedorNome),
          nome: fallbackNome(row.nome, String(row.sku || '').trim()),
          dslite_produto_id: dsliteProdutoId,
          sku_oferta: String(row.sku || '').trim(),
          sku_fornecedor: String(row.sku || '').trim(),
          custo: normalizeCost(row.custo),
          estoque: normalizeStock(row.estoque),
          ativo: true,
          prioridade: 100,
          payment_mode: inferSupplierPaymentMode(targetFornecedor),
          last_sync_at: row.dslite_ultima_sync,
          updated_at: new Date().toISOString(),
        });
      }

      const successfullyUpsertedProductIds = new Set<string>();

      if (offerUpserts.length > 0) {
        const { error: offerUpsertError } = await client
          .from('produto_fornecedor_ofertas')
          .upsert(offerUpserts as any, { onConflict: 'dslite_fornecedor_id,dslite_produto_id' });

        if (offerUpsertError) {
          // Fallback linha-a-linha: uma oferta ruim não pode travar o sync inteiro.
          for (const offerUpsert of offerUpserts) {
            const { error: rowError } = await client
              .from('produto_fornecedor_ofertas')
              .upsert(offerUpsert as any, { onConflict: 'dslite_fornecedor_id,dslite_produto_id' });

            if (rowError) {
              recordsFailed += 1;
              errors.push({
                code: 'price_offer_row_upsert_failed',
                message: extractErrorMessage(rowError),
                context: {
                  fornecedorId: targetFornecedor,
                  page: currentPage,
                  sku: String(offerUpsert.sku_oferta || ''),
                  dslite_produto_id: String(offerUpsert.dslite_produto_id || ''),
                },
              });
              continue;
            }

            const productId = String(offerUpsert.produto_id || '').trim();
            if (productId) {
              successfullyUpsertedProductIds.add(productId);
              recordsUpdatedSeen += 1;
            }
          }

          if (successfullyUpsertedProductIds.size === 0) {
            fatalSyncError = true;
            errors.push({
              code: 'price_offer_upsert_failed',
              message: offerUpsertError.message,
              context: { fornecedorId: targetFornecedor, page: currentPage },
            });
            stopByBudget = true;
            break;
          }
        } else {
          for (const productId of touchedProductIds) {
            successfullyUpsertedProductIds.add(productId);
          }
          recordsUpdatedSeen += offerUpserts.length;
        }
      }

      const snapshotProductIds = successfullyUpsertedProductIds.size > 0
        ? Array.from(successfullyUpsertedProductIds)
        : Array.from(touchedProductIds);

      if (snapshotProductIds.length === 0) {
        recordsUpdated += 0;
      }

      let changedSnapshots: Awaited<ReturnType<typeof syncPreferredProductSnapshot>> = [];
      try {
        changedSnapshots = await syncPreferredProductSnapshot(client, snapshotProductIds);
      } catch (err: any) {
          fatalSyncError = true;
          errors.push({
            code: 'price_preferred_snapshot_failed',
            message: err?.message || 'Falha ao recalcular snapshot preferencial do produto',
            context: { fornecedorId: targetFornecedor, page: currentPage },
          });
          recordsFailed += snapshotProductIds.length;
          stopByBudget = true;
          break;
      }

      const existingMlItemIds = Array.from(
        new Set(
          changedSnapshots
            .map((row) => String(row.previous.ml_item_id || '').trim())
            .filter(Boolean)
        )
      );
      const existingSkusUpper = Array.from(
        new Set(
          changedSnapshots
            .map((row) => String(row.previous.sku || '').trim().toUpperCase())
            .filter(Boolean)
        )
      );
      const manualBlockedByItemId = new Set<string>();
      const manualBlockedBySku = new Set<string>();

      const [manualByItemResp, manualBySkuResp] = await Promise.all([
        existingMlItemIds.length > 0
          ? client
              .from('ml_manual_blocklist')
              .select('ml_item_id')
              .eq('ativo', true)
              .in('ml_item_id', existingMlItemIds)
          : Promise.resolve({ data: [], error: null } as any),
        existingSkusUpper.length > 0
          ? client
              .from('ml_manual_blocklist')
              .select('sku')
              .eq('ativo', true)
              .in('sku', existingSkusUpper)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (manualByItemResp.error || manualBySkuResp.error) {
        const message = manualByItemResp.error?.message || manualBySkuResp.error?.message || 'Falha ao consultar bloqueio manual ML';
        errors.push({
          code: 'ml_manual_blocklist_query_failed',
          message,
          context: { fornecedorId: targetFornecedor, page: currentPage },
        });
      } else {
        for (const row of manualByItemResp.data || []) {
          const mlItemId = String((row as any).ml_item_id || '').trim();
          if (mlItemId) manualBlockedByItemId.add(mlItemId);
        }
        for (const row of manualBySkuResp.data || []) {
          const skuUpper = String((row as any).sku || '').trim().toUpperCase();
          if (skuUpper) manualBlockedBySku.add(skuUpper);
        }
      }

      recordsUpdated += changedSnapshots.length;

      for (const snapshot of changedSnapshots) {
        const mlItemId = String(snapshot.previous.ml_item_id || '').trim();
        if (!mlItemId) {
          mlOutboxSkippedNoItem += 1;
          continue;
        }

        const skuUpper = String(snapshot.previous.sku || '').trim().toUpperCase();
        const isManualBlocked = manualBlockedByItemId.has(mlItemId) || (skuUpper ? manualBlockedBySku.has(skuUpper) : false);
        if (isManualBlocked) {
          mlOutboxSkippedManualBlock += 1;
          continue;
        }

        const desiredStatus = resolveDesiredMlStatusByStock(Number(snapshot.next.estoque || 0));
        if (desiredStatus === 'pausado') mlOutboxPausedZeroStock += 1;
        const outbox = await enqueueMlPublishOutbox(client, {
          produtoId: String(snapshot.productId),
          mlItemId,
          desiredStatus,
          desiredQuantity: Number(snapshot.next.estoque || 0),
          desiredPrice: null,
          source: 'dslite_stock_automation',
          dedupePending: true,
          payload: {
            apply_price: false,
            apply_quantity_pricing: false,
            apply_quantity: true,
            apply_status: true,
            sku: snapshot.previous.sku,
            estoque_origem: Number(snapshot.next.estoque || 0),
            status_desejado: desiredStatus,
            fornecedor_preferencial: snapshot.next.fornecedor,
            fornecedor_dslite_id: snapshot.next.dslite_fornecedor_id,
            origin: 'api/sync/preco-estoque',
            synced_at: snapshot.next.dslite_ultima_sync,
          },
        });

        if (!outbox.ok) {
          mlOutboxFailed += 1;
          errors.push({
            code: 'ml_outbox_enqueue_failed',
            message: outbox.error,
            context: { fornecedorId: targetFornecedor, page: currentPage, sku: snapshot.previous.sku, mlItemId },
          });
        } else if (outbox.action === 'updated_existing') {
          mlOutboxUpdatedExisting += 1;
        } else {
          mlOutboxEnqueued += 1;
        }
      }

      if (runStaleGuard && !staleGuardRan) {
        staleGuardRan = true;
        const staleCutoffIso = new Date(Date.now() - STOCK_STALE_THRESHOLD_MS).toISOString();
        const { data: staleProducts, error: staleProductsError } = await client
          .from('produtos')
          .select('id,sku,ml_item_id,ml_status,dslite_ultima_sync,dslite_fornecedor_id,fornecedor')
          .eq('ativo', true)
          .not('ml_item_id', 'is', null)
          .or(`dslite_ultima_sync.is.null,dslite_ultima_sync.lt.${staleCutoffIso}`)
          .in('dslite_fornecedor_id', fornecedorIds)
          .limit(STALE_GUARD_LIMIT);

        if (staleProductsError) {
          errors.push({
            code: 'stock_stale_guard_select_failed',
            message: staleProductsError.message,
            context: { threshold_minutes: STOCK_STALE_THRESHOLD_MS / 60000 },
          });
        } else if (Array.isArray(staleProducts) && staleProducts.length > 0) {
          const staleMlItemIds = Array.from(new Set(
            staleProducts.map((row: any) => String(row.ml_item_id || '').trim()).filter(Boolean)
          ));
          const staleSkusUpper = Array.from(new Set(
            staleProducts.map((row: any) => String(row.sku || '').trim().toUpperCase()).filter(Boolean)
          ));

          const [manualStaleByItemResp, manualStaleBySkuResp] = await Promise.all([
            staleMlItemIds.length > 0
              ? client
                  .from('ml_manual_blocklist')
                  .select('ml_item_id')
                  .eq('ativo', true)
                  .in('ml_item_id', staleMlItemIds)
              : Promise.resolve({ data: [], error: null } as any),
            staleSkusUpper.length > 0
              ? client
                  .from('ml_manual_blocklist')
                  .select('sku')
                  .eq('ativo', true)
                  .in('sku', staleSkusUpper)
              : Promise.resolve({ data: [], error: null } as any),
          ]);

          const manualStaleByItemId = new Set<string>();
          const manualStaleBySku = new Set<string>();
          if (manualStaleByItemResp.error || manualStaleBySkuResp.error) {
            errors.push({
              code: 'stock_stale_guard_blocklist_failed',
              message: manualStaleByItemResp.error?.message || manualStaleBySkuResp.error?.message || 'Falha ao consultar bloqueio manual ML no stale guard',
            });
          } else {
            for (const row of manualStaleByItemResp.data || []) {
              const mlItemId = String((row as any).ml_item_id || '').trim();
              if (mlItemId) manualStaleByItemId.add(mlItemId);
            }
            for (const row of manualStaleBySkuResp.data || []) {
              const skuUpper = String((row as any).sku || '').trim().toUpperCase();
              if (skuUpper) manualStaleBySku.add(skuUpper);
            }
          }

          for (const product of staleProducts as any[]) {
            const mlItemId = String(product.ml_item_id || '').trim();
            const skuUpper = String(product.sku || '').trim().toUpperCase();
            if (!mlItemId) continue;
            if (manualStaleByItemId.has(mlItemId) || (skuUpper && manualStaleBySku.has(skuUpper))) {
              mlOutboxSkippedManualBlock += 1;
              continue;
            }

            const outbox = await enqueueMlPublishOutbox(client, {
              produtoId: String(product.id),
              mlItemId,
              desiredStatus: 'pausado',
              desiredQuantity: 0,
              desiredPrice: null,
              source: 'stock_stale_guard',
              dedupePending: true,
              payload: {
                apply_price: false,
                apply_quantity_pricing: false,
                apply_quantity: true,
                apply_status: true,
                sku: product.sku,
                estoque_origem: null,
                status_desejado: 'pausado',
                fornecedor_preferencial: product.fornecedor,
                fornecedor_dslite_id: product.dslite_fornecedor_id,
                origin: 'api/sync/preco-estoque',
                guard: 'stock_stale_guard',
                stale_threshold_minutes: STOCK_STALE_THRESHOLD_MS / 60000,
                last_seen_at: product.dslite_ultima_sync || null,
                checked_at: new Date().toISOString(),
              },
            });

            if (!outbox.ok) {
              mlOutboxFailed += 1;
              errors.push({
                code: 'stock_stale_guard_enqueue_failed',
                message: outbox.error,
                context: { sku: product.sku, mlItemId, produtoId: product.id },
              });
              continue;
            }

            mlOutboxPausedStaleStock += 1;
            if (outbox.action === 'updated_existing') mlOutboxUpdatedExisting += 1;
            else mlOutboxEnqueued += 1;
          }
        }
      }

      const totalRegistros = Number(response?.detalhesConsulta?.totalRegistros || 0);
      const perPage = Number(response?.detalhesConsulta?.limit || produtos.length || pageSize);
      const totalPaginas = perPage > 0 ? Math.ceil(totalRegistros / perPage) : currentPage;
      const hasMore = currentPage < totalPaginas;

      if (remainingPagesBudget <= 0) {
        if (hasMore) {
          nextCursor = { fornecedorId: targetFornecedor, page: currentPage + 1 };
        } else {
          const nextFornecedor = fornecedorIds[supplierIndex + 1];
          nextCursor = nextFornecedor ? { fornecedorId: String(nextFornecedor), page: 1 } : null;
        }
        stopByBudget = true;
        break;
      }

      if (hasMore) {
        currentPage += 1;
        continue;
      }

      supplierIndex += 1;
      currentPage = 1;
    }

    if (stopByBudget && nextCursor === null && supplierIndex < fornecedorIds.length) {
      nextCursor = { fornecedorId: String(fornecedorIds[supplierIndex]), page: currentPage };
    }

    return NextResponse.json({
      success: !fatalSyncError,
      domain: jobContext.domain,
      job: {
        ...jobContext,
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: nextCursor,
      cursor_exhausted: nextCursor === null,
      records: {
        seen: recordsSeen,
        updated: recordsUpdated,
        missing: recordsMissing,
        failed: recordsFailed,
        pages: pagesProcessed,
        ml_outbox_enqueued: mlOutboxEnqueued,
        ml_outbox_updated_existing: mlOutboxUpdatedExisting,
        ml_outbox_skipped_no_item: mlOutboxSkippedNoItem,
        ml_outbox_skipped_manual_block: mlOutboxSkippedManualBlock,
        ml_outbox_failed: mlOutboxFailed,
        updated_seen: recordsUpdatedSeen,
        paused_zero_stock: mlOutboxPausedZeroStock,
        paused_stale_stock: mlOutboxPausedStaleStock,
        row_failed: recordsFailed,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
      deprecations: withMlSync ? ['withMlSync foi ignorado nesta rota e será removido'] : [],
      // Compatibilidade com consumidores legados:
      total: recordsSeen,
      updated: recordsUpdated,
      not_found: recordsMissing,
      erros: recordsFailed,
      with_ml_sync: false,
      ml_outbox_enqueued: mlOutboxEnqueued,
      ml_outbox_updated_existing: mlOutboxUpdatedExisting,
      ml_outbox_skipped_no_item: mlOutboxSkippedNoItem,
      ml_outbox_skipped_manual_block: mlOutboxSkippedManualBlock,
      ml_outbox_failed: mlOutboxFailed,
      updated_seen: recordsUpdatedSeen,
      paused_zero_stock: mlOutboxPausedZeroStock,
      paused_stale_stock: mlOutboxPausedStaleStock,
      row_failed: recordsFailed,
      next_cursor: nextCursor,
      message: 'Sync DSLite de preço/estoque concluído com enfileiramento ML por outbox',
    });
  } catch (err: any) {
    errors.push({
      code: 'price_sync_unexpected_error',
      message: err?.message || 'Erro inesperado no sync de preço/estoque',
    });
    return NextResponse.json({
      success: false,
      domain: jobContext.domain,
      job: {
        ...jobContext,
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      cursor_exhausted: true,
      records: { seen: 0, updated: 0, missing: 0, failed: 0 },
      errors,
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain: jobContext.domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
