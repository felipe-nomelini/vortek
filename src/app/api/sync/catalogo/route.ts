import { NextResponse } from 'next/server';
import { sincronizarCatalogo, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku } from '@/lib/sku';
import {
  inferSupplierPaymentMode,
  normalizeGtin,
  syncPreferredProductSnapshot,
} from '@/lib/produto-fornecedor';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { shouldProductBeInactiveByCost } from '@/lib/product-activity';

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

function isProductSkuUniqueViolation(error: any): boolean {
  const text = `${error?.message || ''} ${(error as any)?.details || ''}`.toLowerCase();
  return text.includes('produtos_sku_key') || text.includes('produtos_sku_upper_unique');
}

async function getNextVortekSkuStart(client: any): Promise<number> {
  const { data, error } = await client
    .from('produtos')
    .select('sku')
    .like('sku', 'VTK%')
    .order('sku', { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error(`Falha ao gerar SKU mestre: ${error.message}`);
  }

  let max = 0;
  for (const row of data || []) {
    const numberPart = /^VTK(\d{6})$/.exec(String(row?.sku || ''))?.[1];
    if (!numberPart) continue;
    max = Math.max(max, Number(numberPart));
  }
  return max + 1;
}

async function insertProductRowsWithGeneratedSkus(
  client: any,
  payload: Array<Record<string, unknown>>,
): Promise<{ data: any[] | null; error: any | null }> {
  let nextSkuNumber = await getNextVortekSkuStart(client);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (nextSkuNumber + payload.length - 1 > 999999) {
      return {
        data: null,
        error: new Error('Faixa de SKU mestre VTK###### esgotada'),
      };
    }

    const insertPayload = payload.map((row, index) => {
      const { _product_key, ...clean } = row;
      return {
        ...clean,
        sku: `VTK${String(nextSkuNumber + index).padStart(6, '0')}`,
      };
    });

    const result = await client
      .from('produtos')
      .insert(insertPayload as any)
      .select('id,sku');

    if (!result.error || !isProductSkuUniqueViolation(result.error)) {
      return result;
    }

    nextSkuNumber = await getNextVortekSkuStart(client);
  }

  return {
    data: null,
    error: new Error('Falha ao gerar SKU mestre único após múltiplas tentativas'),
  };
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;

  const body = await req.json().catch(() => ({}));
  const pageSize = parsePositiveInt(body?.pageSize, 100);
  const maxPagesPerRun = parsePositiveInt(body?.maxPagesPerRun, Number.MAX_SAFE_INTEGER);
  const cursorFornecedorId = String(body?.fornecedorId || '').trim();
  const cursorPage = parsePositiveInt(body?.page, 1);
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

    const { data: fornecedoresAtivosLocal, error: fornecedoresAtivosError } = await client
      .from('fornecedores')
      .select('dslite_id')
      .eq('ativo', true)
      .not('dslite_id', 'is', null);

    if (fornecedoresAtivosError) {
      throw new Error(`Falha ao consultar fornecedores ativos locais: ${fornecedoresAtivosError.message}`);
    }

    const fornecedoresAtivosLocalIds = new Set(
      (fornecedoresAtivosLocal || [])
        .map((row) => String(row.dslite_id || '').trim())
        .filter(Boolean),
    );

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
    const fornecedorIdsAtivos = fornecedorIds.filter((id) => fornecedoresAtivosLocalIds.has(String(id)));

    if (fornecedorIdsAtivos.length === 0) {
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
    let remainingPagesBudget = maxPagesPerRun;
    const startSupplierIndex = cursorFornecedorId ? fornecedorIdsAtivos.indexOf(cursorFornecedorId) : 0;

    let supplierIndex = startSupplierIndex >= 0 ? startSupplierIndex : 0;
    let page = startSupplierIndex >= 0 && cursorFornecedorId ? cursorPage : 1;
    let stopByBudget = false;

    while (supplierIndex < fornecedorIdsAtivos.length) {
      const fornecedorId = fornecedorIdsAtivos[supplierIndex];
      const fornecedorNome = fornecedorMap.get(Number(fornecedorId)) || fornecedorId;

      while (remainingPagesBudget > 0) {
        const response = await sincronizarCatalogo(fornecedorId, page, pageSize);
        if (!response?.produtos?.length) {
          break;
        }

        const produtos = response.produtos;
        pagesProcessed += 1;
        remainingPagesBudget -= 1;
        recordsSeen += produtos.length;

        const batch = produtos.map((item) => {
          const supplierSku = buildCanonicalDsliteSku(fornecedorId, item.produtoid_empresa, item.produtoid);
          const normalizedGtin = normalizeGtin(item.ean11);
          return {
            sku_fornecedor: supplierSku,
            nome: fallbackNome(item.titulo, supplierSku),
            marca: item.marca || '',
            fornecedor: fornecedorNome,
            gtin: normalizedGtin,
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
            produtoid_empresa: String(item.produtoid_empresa || ''),
            dslite_ultima_sync: new Date().toISOString(),
          };
        });

        const dsliteProdutoIds = batch.map((row) => row.dslite_produto_id).filter(Boolean);
        const gtins = Array.from(new Set(batch.map((row) => String(row.gtin || '').trim()).filter(Boolean)));
        const [existingOffersResp, existingProductsResp, gtinProductsResp] = await Promise.all([
          client
          .from('produto_fornecedor_ofertas')
            .select('id,produto_id,dslite_fornecedor_id,dslite_produto_id,product:produtos!produto_fornecedor_ofertas_produto_id_fkey(ativo)')
            .eq('dslite_fornecedor_id', String(fornecedorId))
            .in('dslite_produto_id', dsliteProdutoIds),
          client
            .from('produtos')
            .select('id,sku,nome,marca,gtin,descricao,imagens,dslite_fornecedor_id,dslite_produto_id,ativo')
            .eq('dslite_fornecedor_id', String(fornecedorId))
            .in('dslite_produto_id', dsliteProdutoIds),
          gtins.length > 0
            ? client
                .from('produtos')
                .select('id,sku,nome,marca,gtin,descricao,imagens,ativo')
                .in('gtin', gtins)
            : Promise.resolve({ data: [], error: null } as any),
        ]);

        if (existingOffersResp.error || existingProductsResp.error || gtinProductsResp.error) {
          errors.push({
            code: 'catalog_existing_select_failed',
            message: existingOffersResp.error?.message || existingProductsResp.error?.message || gtinProductsResp.error?.message || 'Falha ao consultar produtos/ofertas existentes',
            context: { fornecedorId, page },
          });
          break;
        }

        const offerByDsliteIdentity = new Map(
          ((existingOffersResp.data || []) as any[]).map((row: any) => [
            `${String(row.dslite_fornecedor_id || '')}:${String(row.dslite_produto_id || '')}`,
            row,
          ]),
        );
        const existingProductByDsliteIdentity = new Map(
          ((existingProductsResp.data || []) as any[]).map((row: any) => [
            `${String(row.dslite_fornecedor_id || '')}:${String(row.dslite_produto_id || '')}`,
            row,
          ]),
        );
        const productsByGtin = new Map<string, any[]>();
        for (const row of (gtinProductsResp.data || []) as any[]) {
          const gtin = String(row?.gtin || '').trim();
          if (!gtin) continue;
          const list = productsByGtin.get(gtin) || [];
          list.push(row);
          productsByGtin.set(gtin, list);
        }

        const productRowsToCreate: Array<Record<string, unknown>> = [];
        const pendingOfferRows: Array<Record<string, unknown>> = [];
        const productKeysToCreate = new Set<string>();
        const touchedProductIds = new Set<string>();

        for (const row of batch) {
          const identityKey = `${String(row.dslite_fornecedor_id)}:${String(row.dslite_produto_id)}`;
          const existingOffer = offerByDsliteIdentity.get(identityKey) as any;
          const legacyProduct = existingProductByDsliteIdentity.get(identityKey) as any;
          const gtinMatches = String(row.gtin || '').trim() ? productsByGtin.get(String(row.gtin || '').trim()) || [] : [];
          const matchedByGtin = gtinMatches[0] || null;
          const resolvedProductId = String(
            existingOffer?.produto_id
            || matchedByGtin?.id
            || legacyProduct?.id
            || '',
          ).trim();

          let productId = resolvedProductId;
          const resolvedProductActive = existingOffer?.product?.ativo ?? matchedByGtin?.ativo ?? legacyProduct?.ativo;
          if (productId && resolvedProductActive === false) {
            continue;
          }

          if (!productId) {
            const productKey = String(row.gtin || '').trim()
              ? `gtin:${String(row.gtin || '').trim()}`
              : `dslite:${identityKey}`;
            const inactiveByCost = shouldProductBeInactiveByCost(row.custo);
            const insertPayload = {
              _product_key: productKey,
              ativo: !inactiveByCost,
              nome: row.nome,
              marca: row.marca || '',
              fornecedor: row.fornecedor,
              gtin: row.gtin || '',
              ncm: row.ncm || null,
              cest: row.cest || null,
              origem_fiscal: row.origem_fiscal || null,
              origem_uf: row.origem_uf || null,
              categoria: row.categoria || null,
              custo: Number(row.custo || 0),
              estoque: Number(row.estoque || 0),
              ml_fee: Number(row.ml_fee || 0.15),
              peso_liq: Number(row.peso_liq || 0),
              peso_bruto: Number(row.peso_bruto || 0),
              largura: Number(row.largura || 0),
              altura: Number(row.altura || 0),
              profundidade: Number(row.profundidade || 0),
              descricao: row.descricao || '',
              imagens: row.imagens,
              dslite_fornecedor_id: row.dslite_fornecedor_id,
              dslite_produto_id: row.dslite_produto_id,
              dslite_ultima_sync: row.dslite_ultima_sync,
            };
            if (!productKeysToCreate.has(productKey)) {
              productKeysToCreate.add(productKey);
              productRowsToCreate.push(insertPayload);
            }
          } else {
            touchedProductIds.add(productId);
          }

          pendingOfferRows.push({
            produto_id: productId || null,
            dslite_fornecedor_id: row.dslite_fornecedor_id,
            fornecedor_nome: row.fornecedor,
            dslite_produto_id: row.dslite_produto_id,
            sku_oferta: row.sku_fornecedor,
            sku_fornecedor: row.sku_fornecedor,
            nome: row.nome,
            descricao: row.descricao || '',
            marca: row.marca || '',
            imagens: row.imagens,
            gtin: row.gtin || '',
            ncm: row.ncm || null,
            cest: row.cest || null,
            _product_key: String(row.gtin || '').trim()
              ? `gtin:${String(row.gtin || '').trim()}`
              : `dslite:${identityKey}`,
            custo: Number(row.custo || 0),
            estoque: Number(row.estoque || 0),
            ativo: !shouldProductBeInactiveByCost(row.custo),
            prioridade: 100,
            payment_mode: inferSupplierPaymentMode(row.dslite_fornecedor_id),
            last_sync_at: row.dslite_ultima_sync,
            updated_at: new Date().toISOString(),
          });
        }

        if (productRowsToCreate.length > 0) {
          for (const payload of chunk(productRowsToCreate, UPSERT_CHUNK_SIZE)) {
            const { data: insertedRows, error: upsertError } = await insertProductRowsWithGeneratedSkus(client, payload);

            if (upsertError) {
              errors.push({
                code: 'catalog_upsert_failed',
                message: upsertError.message,
                context: { fornecedorId, page, batchSize: payload.length },
              });
              break;
            }

            for (let index = 0; index < (insertedRows || []).length; index += 1) {
              const inserted = (insertedRows || [])[index] as any;
              const productKey = String((payload[index] as any)?._product_key || '').trim();
              if (productKey) {
                for (const offerRow of pendingOfferRows) {
                  if (String((offerRow as any)._product_key || '') === productKey) {
                    offerRow.produto_id = String(inserted.id);
                  }
                }
              }
              touchedProductIds.add(String(inserted.id));
            }

            recordsUpserted += payload.length;
          }
        }

        const offerPayload = pendingOfferRows
          .filter((row) => String(row.produto_id || '').trim())
          .map((row) => {
            const {
              _product_key,
              ...payload
            } = row as Record<string, unknown>;
            return payload;
          });

        if (offerPayload.length > 0) {
          const { error: offerUpsertError } = await client
            .from('produto_fornecedor_ofertas')
            .upsert(offerPayload as any, { onConflict: 'dslite_fornecedor_id,dslite_produto_id' });

          if (offerUpsertError) {
            errors.push({
              code: 'catalog_offer_upsert_failed',
              message: offerUpsertError.message,
              context: { fornecedorId, page, batchSize: offerPayload.length },
            });
            break;
          }
        }

        try {
          await syncPreferredProductSnapshot(client, Array.from(touchedProductIds));
        } catch (err: any) {
          errors.push({
            code: 'catalog_preferred_snapshot_failed',
            message: err?.message || 'Falha ao sincronizar fornecedor preferencial do produto',
            context: { fornecedorId, page },
          });
          break;
        }

        recordsUpserted += Math.max(0, offerPayload.length);

        const totalRegistros = Number(response?.detalhesConsulta?.totalRegistros || 0);
        const perPage = Number(response?.detalhesConsulta?.limit || produtos.length || pageSize);
        const totalPaginas = perPage > 0 ? Math.ceil(totalRegistros / perPage) : page;
        const hasMore = page < totalPaginas;
        if (remainingPagesBudget <= 0) {
          if (hasMore) {
            nextCursor = { fornecedorId: String(fornecedorId), page: page + 1 };
          } else {
            const nextSupplierId = fornecedorIdsAtivos[supplierIndex + 1];
            nextCursor = nextSupplierId ? { fornecedorId: String(nextSupplierId), page: 1 } : null;
          }
          stopByBudget = true;
          break;
        }

        if (!hasMore) break;
        page += 1;
      }

      suppliersProcessed += 1;
      if (stopByBudget) break;

      supplierIndex += 1;
      page = 1;
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
      cursor_exhausted: true,
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
