import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku } from '@/lib/sku';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

export const maxDuration = 300;

function fallbackNome(input: unknown, sku: string): string {
  const nome = String(input ?? '').trim();
  return nome || `Produto ${sku}`;
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

export async function POST(req: Request) {
  const startedAt = Date.now();
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;

  const body = await req.json().catch(() => ({}));
  const fornecedorIdsRaw: Array<number | string> = Array.isArray(body?.fornecedorIds) ? body.fornecedorIds : [];
  const cursorFornecedorId = String(body?.fornecedorId || '').trim();
  const startPage = parsePositiveInt(body?.page, 1);
  const pageSize = parsePositiveInt(body?.pageSize, 50);
  const maxPagesPerRun = parsePositiveInt(body?.maxPagesPerRun, 1);
  const withMlSync = Boolean(body?.withMlSync);

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
    let remainingPagesBudget = maxPagesPerRun;
    let nextCursor: { fornecedorId: string; page: number } | null = null;
    let stopByBudget = false;

    while (supplierIndex < fornecedorIds.length) {
      const targetFornecedor = String(fornecedorIds[supplierIndex]);
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
      const { data: existingRows, error: existingError } = await client
        .from('produtos')
        .select('id, sku, nome, ml_item_id')
        .in('sku', skus);

      if (existingError) {
        errors.push({
          code: 'price_existing_select_failed',
          message: existingError.message,
          context: { fornecedorId: targetFornecedor, page: currentPage },
        });
        recordsFailed += batch.length;
        stopByBudget = true;
        break;
      }

      const existingBySku = new Map((existingRows || []).map((row: any) => [String(row.sku || '').toUpperCase(), row]));
      const existingMlItemIds = Array.from(
        new Set(
          (existingRows || [])
            .map((row: any) => String(row.ml_item_id || '').trim())
            .filter(Boolean)
        )
      );
      const existingSkusUpper = Array.from(
        new Set(
          (existingRows || [])
            .map((row: any) => String(row.sku || '').trim().toUpperCase())
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

      for (const row of batch) {
        const existing = existingBySku.get(String(row.sku || '').toUpperCase()) as any;
        if (!existing?.id) {
          recordsMissing += 1;
          continue;
        }

        const patch: Record<string, unknown> = {
          custo: normalizeCost(row.custo),
          estoque: normalizeStock(row.estoque),
          dslite_ultima_sync: row.dslite_ultima_sync,
        };
        if (!String(existing.nome || '').trim()) {
          patch.nome = row.nome;
        }

        const { error: updateError } = await client
          .from('produtos')
          .update(patch as any)
          .eq('id', String(existing.id));

        if (updateError) {
          recordsFailed += 1;
          errors.push({
            code: 'price_update_failed',
            message: updateError.message,
            context: { fornecedorId: targetFornecedor, page: currentPage, sku: row.sku },
          });
        } else {
          recordsUpdated += 1;

          const mlItemId = String(existing.ml_item_id || '').trim();
          if (!mlItemId) {
            mlOutboxSkippedNoItem += 1;
            continue;
          }

          const skuUpper = String(row.sku || '').trim().toUpperCase();
          const isManualBlocked = manualBlockedByItemId.has(mlItemId) || (skuUpper ? manualBlockedBySku.has(skuUpper) : false);
          if (isManualBlocked) {
            mlOutboxSkippedManualBlock += 1;
            continue;
          }

          const desiredStatus = resolveDesiredMlStatusByStock(Number(row.estoque || 0));
          const outbox = await enqueueMlPublishOutbox(client, {
            produtoId: String(existing.id),
            mlItemId,
            desiredStatus,
            desiredQuantity: Number(row.estoque || 0),
            desiredPrice: null,
            source: 'dslite_stock_automation',
            dedupePending: true,
            payload: {
              apply_price: false,
              apply_quantity_pricing: false,
              apply_quantity: true,
              apply_status: true,
              sku: row.sku,
              estoque_origem: Number(row.estoque || 0),
              status_desejado: desiredStatus,
              origin: 'api/sync/preco-estoque',
              synced_at: row.dslite_ultima_sync,
            },
          });

          if (!outbox.ok) {
            mlOutboxFailed += 1;
            errors.push({
              code: 'ml_outbox_enqueue_failed',
              message: outbox.error,
              context: { fornecedorId: targetFornecedor, page: currentPage, sku: row.sku, mlItemId },
            });
          } else if (outbox.action === 'updated_existing') {
            mlOutboxUpdatedExisting += 1;
          } else {
            mlOutboxEnqueued += 1;
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
      success: errors.length === 0,
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
