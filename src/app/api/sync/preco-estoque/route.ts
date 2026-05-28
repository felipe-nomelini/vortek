import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku } from '@/lib/sku';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

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

export async function POST(req: Request) {
  const startedAt = Date.now();
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;

  const body = await req.json().catch(() => ({}));
  const fornecedorIdsRaw: Array<number | string> = Array.isArray(body?.fornecedorIds) ? body.fornecedorIds : [];
  const fornecedorIdSingle = body?.fornecedorId;
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

    let fornecedorIds = fornecedorIdsRaw.map((id) => String(id).trim()).filter(Boolean);
    if (fornecedorIdSingle !== undefined && fornecedorIdSingle !== null && String(fornecedorIdSingle).trim()) {
      fornecedorIds = [String(fornecedorIdSingle).trim()];
    }
    if (fornecedorIds.length === 0) {
      fornecedorIds = fornecedores
        .filter((f) => String(f.crossdocking || '').toLowerCase() === 'ativo')
        .map((f) => String(f.id));
    }
    fornecedorIds = Array.from(new Set(fornecedorIds));

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
        records: { seen: 0, updated: 0, missing: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      }, { status: 400 });
    }

    const client = createServiceClient();
    const targetFornecedor = String(fornecedorIds[0]);

    let currentPage = startPage;
    let hasMore = false;
    let pagesProcessed = 0;
    let recordsSeen = 0;
    let recordsUpdated = 0;
    let recordsMissing = 0;
    let recordsFailed = 0;

    for (let i = 0; i < maxPagesPerRun; i += 1) {
      const response = await sincronizarPrecoEstoque(targetFornecedor, currentPage, pageSize);
      if (!response?.produtos?.length) {
        break;
      }

      const produtos = response.produtos;
      pagesProcessed += 1;
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
        hasMore = false;
        break;
      }

      const skus = batch.map((row) => row.sku).filter(Boolean);
      const { data: existingRows, error: existingError } = await client
        .from('produtos')
        .select('id, sku, nome')
        .in('sku', skus);

      if (existingError) {
        errors.push({
          code: 'price_existing_select_failed',
          message: existingError.message,
          context: { fornecedorId: targetFornecedor, page: currentPage },
        });
        recordsFailed += batch.length;
        break;
      }

      const existingBySku = new Map((existingRows || []).map((row: any) => [String(row.sku || '').toUpperCase(), row]));

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
        }
      }

      const totalRegistros = Number(response?.detalhesConsulta?.totalRegistros || 0);
      const perPage = Number(response?.detalhesConsulta?.limit || produtos.length || pageSize);
      const totalPaginas = perPage > 0 ? Math.ceil(totalRegistros / perPage) : currentPage;

      hasMore = currentPage < totalPaginas;
      currentPage += 1;
      if (!hasMore) break;
    }

    let nextCursor: { fornecedorId: string; page: number } | null = null;
    if (hasMore) {
      nextCursor = { fornecedorId: targetFornecedor, page: currentPage };
    } else if (fornecedorIds.length > 1) {
      const currentIndex = fornecedorIds.indexOf(targetFornecedor);
      const nextFornecedor = fornecedorIds[currentIndex + 1] || fornecedorIds[0];
      nextCursor = { fornecedorId: String(nextFornecedor), page: 1 };
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
      records: {
        seen: recordsSeen,
        updated: recordsUpdated,
        missing: recordsMissing,
        failed: recordsFailed,
        pages: pagesProcessed,
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
      next_cursor: nextCursor,
      message: 'Sync DSLite de preço/estoque concluído sem acoplamento com ML',
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
