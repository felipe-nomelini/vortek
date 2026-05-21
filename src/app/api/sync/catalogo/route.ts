import { NextResponse } from 'next/server';
import { sincronizarCatalogo, listarFornecedores } from '@/services/dslite';
import { sincronizarEstoqueComML, reconciliarPausasEstoqueZero } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku } from '@/lib/sku';

export const maxDuration = 300;

function fallbackNome(input: unknown, sku: string): string {
  const nome = String(input ?? '').trim();
  if (nome) return nome;
  return `Produto ${sku}`;
}

function normalizeText(input: unknown): string {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

function pickBestDescription(item: any): { text: string; source: 'descricao' | 'caracteristicas' | 'informacoes' | 'none' } {
  const descricao = normalizeText(item?.descricao);
  if (descricao) return { text: descricao, source: 'descricao' };
  const caracteristicas = normalizeText(item?.caracteristicas);
  if (caracteristicas) return { text: caracteristicas, source: 'caracteristicas' };
  const informacoes = normalizeText(item?.informacoes);
  if (informacoes) return { text: informacoes, source: 'informacoes' };
  return { text: '', source: 'none' };
}

function extractImageUrls(item: any): { urls: string[]; fromMidias: boolean } {
  const urls: string[] = [];
  const midias = Array.isArray(item?.midias) ? item.midias : [];
  let fromMidias = false;

  for (const media of midias) {
    const tipo = normalizeText(media?.tipo).toLowerCase();
    const valor = normalizeText(media?.valor);
    if (!valor) continue;
    if (tipo === 'imagem' || tipo === 'image' || tipo === 'img') {
      urls.push(valor);
      fromMidias = true;
    }
  }

  if (urls.length === 0) {
    const fallback = normalizeText(item?.link_imagem);
    if (fallback) urls.push(fallback);
  }

  return { urls: Array.from(new Set(urls)), fromMidias };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const fornecedorIds: (number | string)[] = body.fornecedorIds || [];
    const pageSize: number = body.pageSize || 100;

    const client = createServiceClient();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    // Build map of fornecedorId -> apelido
    const fornecedores = await listarFornecedores();
    const fornecedorMap = new Map<number, string>();
    if (fornecedores) {
      for (const f of fornecedores) {
        fornecedorMap.set(f.id, f.apelido);
      }
    }

    // If no fornecedorIds provided, discover all active ones
    let ids = fornecedorIds;
    if (ids.length === 0) {
      if (!fornecedores || fornecedores.length === 0) {
        return NextResponse.json({ error: 'Nenhum fornecedor encontrado' }, { status: 502 });
      }
      ids = fornecedores
        .filter((f) => f.crossdocking === 'Ativo')
        .map((f) => f.id);
    }

    const resultados: any[] = [];
    for (const fId of ids) {
      let page = 1;
      let totalSync = 0;
      const fornName = fornecedorMap.get(Number(fId)) || String(fId);

      while (true) {
        const response = await sincronizarCatalogo(fId, page, pageSize);
        if (!response?.produtos || response.produtos.length === 0) {
          if (page === 1) resultados.push({ fornecedorId: fId, error: 'Falha ou catálogo vazio' });
          break;
        }

        const { produtos, detalhesConsulta } = response;
        const totalRegistros = detalhesConsulta?.totalRegistros || 0;
        // Use actual API page size if response returned fewer than requested
        const apiPageSize = detalhesConsulta?.limit || produtos.length;
        const registrosRetornados = detalhesConsulta?.registrosRetornados || produtos.length;
        const totalPaginas = Math.ceil(totalRegistros / apiPageSize);

        const pageCounters = {
          descricao_preservada: 0,
          imagens_preservadas: 0,
          descricao_enriquecida_por_fallback: 0,
          imagens_extraidas_midias: 0,
        };

        // Build batch payloads
        const batch = produtos.map((item) => {
          const sku = buildCanonicalDsliteSku(fId, item.produtoid_empresa, item.produtoid);
          const description = pickBestDescription(item);
          const images = extractImageUrls(item);
          if (description.source !== 'descricao' && description.source !== 'none') {
            pageCounters.descricao_enriquecida_por_fallback += 1;
          }
          if (images.fromMidias && images.urls.length > 0) {
            pageCounters.imagens_extraidas_midias += 1;
          }

          return {
            sku,
            nome: fallbackNome(item.titulo, sku),
            marca: item.marca || '',
            fornecedor: fornName,
            gtin: item.ean11 || '',
            ncm: item.ncm || null,
            cest: item.cest || null,
            origem_fiscal: item.origem || '0',
            origem_uf: item.origem_faturamento || null,
            categoria: item.categoria_nome || null,
            custo: item.preco_crossdocking || item.preco_normal || 0,
            estoque: item.estoque || 0,
            ml_fee: 0.15,
            peso_liq: item.peso || 0,
            peso_bruto: item.peso || 0,
            largura: item.largura || 0,
            altura: item.altura || 0,
            profundidade: item.profundidade || 0,
            descricao: description.text,
            imagens: images.urls,
            dslite_fornecedor_id: String(fId),
            dslite_produto_id: item.produtoid,
            dslite_ultima_sync: new Date().toISOString(),
          };
        });

        const skus = batch.map((b) => b.sku).filter(Boolean);
        const { data: existentes } = await client
          .from('produtos')
          .select('sku, descricao, imagens')
          .in('sku', skus);
        const existentesMap = new Map((existentes || []).map((p) => [String(p.sku).toUpperCase(), p]));

        const batchMerged = batch.map((row) => {
          const existing = existentesMap.get(String(row.sku).toUpperCase()) as any;
          const existingDescricao = normalizeText(existing?.descricao);
          const existingImagens = Array.isArray(existing?.imagens)
            ? existing.imagens.map((v: unknown) => normalizeText(v)).filter(Boolean)
            : [];

          const shouldPreserveDescricao = !row.descricao && existingDescricao;
          const shouldPreserveImagens = row.imagens.length === 0 && existingImagens.length > 0;

          if (shouldPreserveDescricao) pageCounters.descricao_preservada += 1;
          if (shouldPreserveImagens) pageCounters.imagens_preservadas += 1;

          return {
            ...row,
            descricao: shouldPreserveDescricao ? existingDescricao : row.descricao,
            imagens: shouldPreserveImagens ? existingImagens : row.imagens,
          };
        });

        // Upsert batch directly via Supabase REST API (much faster than individual)
        const res = await fetch(`${supabaseUrl}/rest/v1/produtos?on_conflict=sku`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify(batchMerged),
        });

        if (!res.ok) {
          const errText = await res.text();
          resultados.push({ fornecedorId: fId, pagina: page, error: `HTTP ${res.status}: ${errText.substring(0, 200)}` });
          break;
        }

        // Busca produtos atualizados que têm anúncio no ML para sincronizar estoque
        if (skus.length > 0) {
          const { data: produtosComAnuncio } = await client
            .from('produtos')
            .select('sku, ml_item_id, estoque, ml_status')
            .not('ml_item_id', 'is', null)
            .in('sku', skus);

          if (produtosComAnuncio && produtosComAnuncio.length > 0) {
            const mlSync = await sincronizarEstoqueComML(produtosComAnuncio);

            // Atualiza status no banco
            for (const det of mlSync.detalhes) {
              const statusConfirmado = det.verified_status || det.status;
              if (det.sucesso && statusConfirmado && (statusConfirmado === 'active' || statusConfirmado === 'paused')) {
                const novoStatus = statusConfirmado === 'active' ? 'ativo' : 'pausado';
                await client
                  .from('produtos')
                  .update({ ml_status: novoStatus as any })
                  .eq('ml_item_id', det.ml_item_id);
                await client
                  .from('anuncios_ml')
                  .update({ status: novoStatus as any })
                  .eq('ml_item_id', det.ml_item_id);
              }
            }

            resultados.push({
              fornecedorId: fId,
              pagina: page,
              catalog_merge: pageCounters,
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
          } else {
            resultados.push({
              fornecedorId: fId,
              pagina: page,
              catalog_merge: pageCounters,
            });
          }
        }

        totalSync += batchMerged.length;
        page++;

        // Stop if we've processed all pages
        if (page > totalPaginas) break;
      }

      resultados.push({ fornecedorId: fId, nome: fornName, total: totalSync });
    }

    const { data: produtosZeroEstoque } = await client
      .from('produtos')
      .select('sku, ml_item_id, estoque, ml_status')
      .not('ml_item_id', 'is', null)
      .eq('estoque', 0);

    let reconciliacao = null;
    if (produtosZeroEstoque && produtosZeroEstoque.length > 0) {
      reconciliacao = await reconciliarPausasEstoqueZero(produtosZeroEstoque);

      for (const item of reconciliacao.detalhes || []) {
        if (item.sucesso && item.current_status === 'paused') {
          await client
            .from('produtos')
            .update({ ml_status: 'pausado' as any })
            .eq('ml_item_id', item.ml_item_id);
          await client
            .from('anuncios_ml')
            .update({ status: 'pausado' as any })
            .eq('ml_item_id', item.ml_item_id);
        }
      }
    }

    return NextResponse.json({
      success: true,
      resultados,
      message: 'Sync de catálogo concluído com reconciliação de estoque zero',
      reconciliacao_estoque_zero: reconciliacao,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
