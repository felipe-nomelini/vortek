import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque, listarFornecedores } from '@/services/dslite';
import { sincronizarEstoqueComML, reconciliarPausasEstoqueZero } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku } from '@/lib/sku';

export const maxDuration = 300;

const MAX_BATCH_UPDATE = 200;

function fallbackNome(input: unknown, sku: string): string {
  const nome = String(input ?? '').trim();
  if (nome) return nome;
  return `Produto ${sku}`;
}

function parsePositiveInt(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));

    const fornecedorIdsRaw: (number | string)[] = Array.isArray(body.fornecedorIds) ? body.fornecedorIds : [];
    const fornecedorIdSingle = body.fornecedorId;
    const startPage = parsePositiveInt(body.page, 1);
    const pageSize = parsePositiveInt(body.pageSize, 50);
    const maxPagesPerRun = parsePositiveInt(body.maxPagesPerRun, 1);
    const withMlSync = Boolean(body.withMlSync);

    const client = createServiceClient();

    const fornecedores = await listarFornecedores();
    if (!fornecedores || fornecedores.length === 0) {
      return NextResponse.json({ error: 'Nenhum fornecedor encontrado' }, { status: 502 });
    }

    let ids = fornecedorIdsRaw;
    if (fornecedorIdSingle !== undefined && fornecedorIdSingle !== null && String(fornecedorIdSingle).trim()) {
      ids = [fornecedorIdSingle];
    }

    if (ids.length === 0) {
      ids = fornecedores.filter((f) => f.crossdocking === 'Ativo').map((f) => f.id);
    }

    ids = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Nenhum fornecedor ativo selecionado' }, { status: 400 });
    }

    const targetFornecedor = String(ids[0]);
    const resultados: any[] = [];

    let recordsSeen = 0;
    let recordsUpdated = 0;
    let recordsNotFound = 0;
    let recordsSkippedCreate = 0;
    let pagesProcessed = 0;

    let currentPage = startPage;
    let hasMore = false;

    for (let i = 0; i < maxPagesPerRun; i++) {
      const response = await sincronizarPrecoEstoque(targetFornecedor, currentPage, pageSize);
      if (!response?.produtos || response.produtos.length === 0) {
        if (currentPage === startPage) {
          resultados.push({ fornecedorId: targetFornecedor, pagina: currentPage, error: 'Falha ou página vazia' });
        }
        hasMore = false;
        break;
      }

      const { produtos, detalhesConsulta } = response;
      pagesProcessed += 1;
      recordsSeen += produtos.length;

      const totalRegistros = detalhesConsulta?.totalRegistros || 0;
      const apiPageSize = detalhesConsulta?.limit || produtos.length;
      const totalPaginas = Math.ceil(totalRegistros / apiPageSize);

      const batch = produtos.map((item) => {
        const sku = buildCanonicalDsliteSku(targetFornecedor, item.produtoid_empresa, item.produtoid);
        return {
          sku,
          nome: fallbackNome(item.titulo, sku),
          custo: item.preco_crossdocking || item.preco_normal || 0,
          estoque: item.estoque || 0,
          dslite_ultima_sync: new Date().toISOString(),
        };
      });

      const skus = batch.map((b) => b.sku).filter(Boolean);
      const { data: existentes, error: existentesErr } = await client
        .from('produtos')
        .select('id, sku, nome')
        .in('sku', skus);

      if (existentesErr) {
        return NextResponse.json({
          success: false,
          error: `Erro ao carregar SKUs existentes: ${existentesErr.message}`,
          context: { fornecedorId: targetFornecedor, page: currentPage },
        }, { status: 500 });
      }

      const existentesMap = new Map((existentes || []).map((p) => [String(p.sku).toUpperCase(), p]));
      const updates: Array<Record<string, unknown>> = [];

      for (const row of batch) {
        const existing = existentesMap.get(String(row.sku).toUpperCase()) as any;
        if (!existing?.id) {
          recordsNotFound += 1;
          recordsSkippedCreate += 1;
          resultados.push({ fornecedorId: targetFornecedor, pagina: currentPage, event: 'missing_in_catalog_sync', sku: row.sku });
          continue;
        }

        updates.push({
          id: existing.id,
          custo: row.custo,
          estoque: row.estoque,
          dslite_ultima_sync: row.dslite_ultima_sync,
          ...(existing.nome ? {} : { nome: row.nome }),
        });
      }

      if (updates.length > 0) {
        const chunks = chunkArray(updates, MAX_BATCH_UPDATE);
        for (const payload of chunks) {
          const { error: upsertErr } = await client
            .from('produtos')
            .upsert(payload as any[], { onConflict: 'id' });
          if (upsertErr) {
            return NextResponse.json({
              success: false,
              error: `Erro ao atualizar lote de produtos: ${upsertErr.message}`,
              context: { fornecedorId: targetFornecedor, page: currentPage },
            }, { status: 500 });
          }
          recordsUpdated += payload.length;
        }
      }

      if (withMlSync && skus.length > 0) {
        const { data: produtosComAnuncio } = await client
          .from('produtos')
          .select('sku, ml_item_id, estoque, ml_status')
          .not('ml_item_id', 'is', null)
          .in('sku', skus);

        if (produtosComAnuncio && produtosComAnuncio.length > 0) {
          const mlSync = await sincronizarEstoqueComML(produtosComAnuncio);
          for (const det of mlSync.detalhes) {
            const statusConfirmado = det.verified_status || det.status;
            if (det.sucesso && statusConfirmado && (statusConfirmado === 'active' || statusConfirmado === 'paused')) {
              const novoStatus = statusConfirmado === 'active' ? 'ativo' : 'pausado';
              await client.from('produtos').update({ ml_status: novoStatus as any }).eq('ml_item_id', det.ml_item_id);
              await client.from('anuncios_ml').update({ status: novoStatus as any }).eq('ml_item_id', det.ml_item_id);
            }
          }

          resultados.push({
            fornecedorId: targetFornecedor,
            pagina: currentPage,
            mlSync: {
              sucessos: mlSync.sucessos,
              erros: mlSync.erros,
              pausados: mlSync.pausados,
              reativados: mlSync.reativados,
              pausa_confirmada: mlSync.pausa_confirmada,
              pausa_pendente: mlSync.pausa_pendente,
              erros_bloqueio_ml: mlSync.erros_bloqueio_ml,
              bloqueios_ml_regra: mlSync.bloqueios_ml_regra,
              ativacao_bloqueada_sem_estoque: mlSync.ativacao_bloqueada_sem_estoque,
              erros_transitorios: mlSync.erros_transitorios,
              erros_nao_recuperaveis: mlSync.erros_nao_recuperaveis,
            },
          });
        }
      }

      hasMore = currentPage < totalPaginas;
      currentPage += 1;
      if (!hasMore) break;
    }

    let nextCursor: { fornecedorId: string; page: number } | null = null;
    if (hasMore) {
      nextCursor = { fornecedorId: targetFornecedor, page: currentPage };
    } else if (ids.length > 1) {
      const currentIndex = ids.indexOf(targetFornecedor);
      const nextFornecedor = ids[currentIndex + 1];
      if (nextFornecedor) {
        nextCursor = { fornecedorId: String(nextFornecedor), page: 1 };
      } else {
        nextCursor = { fornecedorId: String(ids[0]), page: 1 };
      }
    }

    let reconciliacao = null;
    if (withMlSync) {
      const { data: produtosZeroEstoque } = await client
        .from('produtos')
        .select('sku, ml_item_id, estoque, ml_status')
        .not('ml_item_id', 'is', null)
        .eq('estoque', 0);

      if (produtosZeroEstoque && produtosZeroEstoque.length > 0) {
        reconciliacao = await reconciliarPausasEstoqueZero(produtosZeroEstoque);

        for (const item of reconciliacao.detalhes || []) {
          if (item.sucesso && item.current_status === 'paused') {
            await client.from('produtos').update({ ml_status: 'pausado' as any }).eq('ml_item_id', item.ml_item_id);
            await client.from('anuncios_ml').update({ status: 'pausado' as any }).eq('ml_item_id', item.ml_item_id);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      total: recordsSeen,
      updated: recordsUpdated,
      not_found: recordsNotFound,
      skipped_create: recordsSkippedCreate,
      results: resultados,
      with_ml_sync: withMlSync,
      fornecedor_id: targetFornecedor,
      pages_processed: pagesProcessed,
      records_seen: recordsSeen,
      records_updated: recordsUpdated,
      duration_ms: Date.now() - startedAt,
      next_cursor: nextCursor,
      allow_create_on_price_sync: false,
      message: 'Sync de preço/estoque concluído',
      reconciliacao_estoque_zero: reconciliacao,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
