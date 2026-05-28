import { NextResponse } from 'next/server';
import { sincronizarCatalogo, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku } from '@/lib/sku';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

export const maxDuration = 300;

const UPSERT_CHUNK_SIZE = 300;

function fallbackNome(input: unknown, sku: string): string {
  const nome = String(input ?? '').trim();
  return nome || `Produto ${sku}`;
}

function normalizeText(input: unknown): string {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

function stripHtmlToText(input: unknown): { text: string; changed: boolean } {
  const raw = String(input ?? '');
  if (!raw) return { text: '', changed: false };

  let out = raw
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\s*\/p\s*>/gi, ' ')
    .replace(/<\s*\/li\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  out = normalizeText(out);
  const changed = normalizeText(raw) !== out;
  return { text: out, changed };
}

function pickBestDescription(item: any): string {
  const descricao = stripHtmlToText(item?.descricao).text;
  if (descricao) return descricao;
  const caracteristicas = stripHtmlToText(item?.caracteristicas).text;
  if (caracteristicas) return caracteristicas;
  return stripHtmlToText(item?.informacoes).text;
}

function extractImageUrls(item: any): string[] {
  const urls: string[] = [];
  const midias = Array.isArray(item?.midias) ? item.midias : [];

  for (const media of midias) {
    const tipo = normalizeText(media?.tipo).toLowerCase();
    const valor = normalizeText(media?.valor);
    if (!valor) continue;
    if (tipo === 'imagem' || tipo === 'image' || tipo === 'img') {
      urls.push(valor);
    }
  }

  if (urls.length === 0) {
    const fallback = normalizeText(item?.link_imagem);
    if (fallback) urls.push(fallback);
  }

  return Array.from(new Set(urls));
}

function parsePositiveInt(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;

  const body = await req.json().catch(() => ({}));
  const pageSize = parsePositiveInt(body?.pageSize, 100);
  const maxPagesPerRun = parsePositiveInt(body?.maxPagesPerRun, Number.MAX_SAFE_INTEGER);
  const withMlSync = Boolean(body?.withMlSync);

  const jobContext = {
    key: 'sync_dslite_catalogo',
    domain: 'produtos:dslite_catalogo',
    started_at: new Date(startedAt).toISOString(),
  };

  try {
    const lock = await acquireDomainLock({
      domain: jobContext.domain,
      ownerTask: jobContext.key,
      ttlSeconds: 45 * 60,
      metadata: { source: 'api/sync/catalogo' },
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
        records: { seen: 0, upserted: 0, suppliers: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const client = createServiceClient();
    const fornecedores = await listarFornecedores();
    if (!fornecedores || fornecedores.length === 0) {
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
        records: { seen: 0, upserted: 0, suppliers: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      }, { status: 502 });
    }

    const fornecedorIdsRaw: Array<string | number> = Array.isArray(body?.fornecedorIds) ? body.fornecedorIds : [];
    const fornecedorMap = new Map<number, string>();
    for (const fornecedor of fornecedores) {
      fornecedorMap.set(Number(fornecedor.id), String(fornecedor.apelido || fornecedor.id));
    }

    const fornecedorIds = fornecedorIdsRaw.length > 0
      ? Array.from(new Set(fornecedorIdsRaw.map((v) => String(v).trim()).filter(Boolean)))
      : fornecedores
          .filter((f) => String(f.crossdocking || '').toLowerCase() === 'ativo')
          .map((f) => String(f.id));

    if (fornecedorIds.length === 0) {
      errors.push({ code: 'dslite_fornecedor_ids_empty', message: 'Nenhum fornecedor ativo selecionado para catálogo' });
      return NextResponse.json({
        success: false,
        domain: jobContext.domain,
        job: {
          ...jobContext,
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: null,
        records: { seen: 0, upserted: 0, suppliers: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      }, { status: 400 });
    }

    let recordsSeen = 0;
    let recordsUpserted = 0;
    let suppliersProcessed = 0;
    let pagesProcessed = 0;
    let nextCursor: { fornecedorId: string; page: number } | null = null;

    for (let supplierIndex = 0; supplierIndex < fornecedorIds.length; supplierIndex += 1) {
      const fornecedorId = fornecedorIds[supplierIndex];
      const fornecedorNome = fornecedorMap.get(Number(fornecedorId)) || fornecedorId;

      let page = 1;
      let pagesThisSupplier = 0;

      while (pagesThisSupplier < maxPagesPerRun) {
        const response = await sincronizarCatalogo(fornecedorId, page, pageSize);
        if (!response?.produtos?.length) {
          break;
        }

        const produtos = response.produtos;
        pagesProcessed += 1;
        pagesThisSupplier += 1;
        recordsSeen += produtos.length;

        const batch = produtos.map((item) => {
          const sku = buildCanonicalDsliteSku(fornecedorId, item.produtoid_empresa, item.produtoid);
          return {
            sku,
            nome: fallbackNome(item.titulo, sku),
            marca: item.marca || '',
            fornecedor: fornecedorNome,
            gtin: item.ean11 || '',
            ncm: item.ncm || null,
            cest: item.cest || null,
            origem_fiscal: item.origem || null,
            origem_uf: item.origem_faturamento || null,
            categoria: item.categoria_nome || null,
            custo: Number(item.preco_crossdocking || item.preco_normal || 0),
            estoque: Number(item.estoque || 0),
            ml_fee: 0.15,
            peso_liq: Number(item.peso || 0),
            peso_bruto: Number(item.peso || 0),
            largura: Number(item.largura || 0),
            altura: Number(item.altura || 0),
            profundidade: Number(item.profundidade || 0),
            descricao: pickBestDescription(item),
            imagens: extractImageUrls(item),
            dslite_fornecedor_id: String(fornecedorId),
            dslite_produto_id: String(item.produtoid || ''),
            dslite_ultima_sync: new Date().toISOString(),
          };
        });

        const dsliteProdutoIds = batch.map((row) => row.dslite_produto_id).filter(Boolean);
        const { data: existentes, error: existentesError } = await client
          .from('produtos')
          .select('descricao, imagens, dslite_fornecedor_id, dslite_produto_id')
          .eq('dslite_fornecedor_id', String(fornecedorId))
          .in('dslite_produto_id', dsliteProdutoIds);

        if (existentesError) {
          errors.push({
            code: 'catalog_existing_select_failed',
            message: existentesError.message,
            context: { fornecedorId, page },
          });
          break;
        }

        const existentesMap = new Map(
          (existentes || []).map((row: any) => [
            `${String(row.dslite_fornecedor_id || '')}:${String(row.dslite_produto_id || '')}`,
            row,
          ]),
        );

        const merged = batch.map((row) => {
          const existing = existentesMap.get(`${String(row.dslite_fornecedor_id)}:${String(row.dslite_produto_id)}`) as any;
          const existingDescricao = normalizeText(existing?.descricao);
          const existingImagens = Array.isArray(existing?.imagens)
            ? existing.imagens.map((v: unknown) => normalizeText(v)).filter(Boolean)
            : [];
          return {
            ...row,
            descricao: row.descricao || existingDescricao,
            imagens: row.imagens.length > 0 ? row.imagens : existingImagens,
          };
        });

        for (const payload of chunk(merged, UPSERT_CHUNK_SIZE)) {
          const { error: upsertError } = await client
            .from('produtos')
            .upsert(payload as any, { onConflict: 'sku' });

          if (upsertError) {
            errors.push({
              code: 'catalog_upsert_failed',
              message: upsertError.message,
              context: { fornecedorId, page, batchSize: payload.length },
            });
            break;
          }

          recordsUpserted += payload.length;
        }

        const totalRegistros = Number(response?.detalhesConsulta?.totalRegistros || 0);
        const perPage = Number(response?.detalhesConsulta?.limit || produtos.length || pageSize);
        const totalPaginas = perPage > 0 ? Math.ceil(totalRegistros / perPage) : page;
        const hasMore = page < totalPaginas;
        if (!hasMore) break;

        page += 1;

        if (pagesThisSupplier >= maxPagesPerRun) {
          nextCursor = { fornecedorId: String(fornecedorId), page };
          break;
        }
      }

      suppliersProcessed += 1;
      if (nextCursor) break;
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
        upserted: recordsUpserted,
        suppliers: suppliersProcessed,
        pages: pagesProcessed,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
      deprecations: withMlSync ? ['withMlSync foi ignorado nesta rota e será removido'] : [],
      // Compatibilidade com consumidores legados:
      total: recordsSeen,
      updated: recordsUpserted,
      with_ml_sync: false,
      next_cursor: nextCursor,
      message: 'Sync DSLite de catálogo concluído sem acoplamento com ML',
    });
  } catch (err: any) {
    errors.push({
      code: 'catalog_sync_unexpected_error',
      message: err?.message || 'Erro inesperado no sync de catálogo',
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
      records: { seen: 0, upserted: 0, suppliers: 0 },
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

