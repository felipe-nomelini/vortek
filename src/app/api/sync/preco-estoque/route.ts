import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque, listarFornecedores } from '@/services/dslite';
import { sincronizarEstoqueComML, reconciliarPausasEstoqueZero } from '@/services/mercadolibre';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 300;

function normalizeSku(input: unknown): string {
  return String(input ?? '').trim().toUpperCase();
}

function fallbackNome(input: unknown, sku: string): string {
  const nome = String(input ?? '').trim();
  if (nome) return nome;
  return `Produto ${sku}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const fornecedorIds: (number | string)[] = body.fornecedorIds || [];
    const pageSize: number = body.pageSize || 100;

    const client = createServiceClient();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    let ids = fornecedorIds;
    if (ids.length === 0) {
      const fornecedores = await listarFornecedores();
      if (!fornecedores || fornecedores.length === 0) {
        return NextResponse.json({ error: 'Nenhum fornecedor encontrado' }, { status: 502 });
      }
      ids = fornecedores.filter((f) => f.crossdocking === 'Ativo').map((f) => f.id);
    }

    const resultados: any[] = [];
    let totalGeral = 0;

    for (const fId of ids) {
      let page = 1;
      let atualizados = 0;

      while (true) {
        const response = await sincronizarPrecoEstoque(fId, page, pageSize);
        if (!response?.produtos || response.produtos.length === 0) {
          if (page === 1) resultados.push({ fornecedorId: fId, error: 'Falha' });
          break;
        }

        const { produtos, detalhesConsulta } = response;
        const totalRegistros = detalhesConsulta?.totalRegistros || 0;
        const apiPageSize = detalhesConsulta?.limit || produtos.length;
        const totalPaginas = Math.ceil(totalRegistros / apiPageSize);

        const batch = produtos.map((item) => ({
          sku: normalizeSku(item.produtoid_empresa || item.produtoid),
          nome: fallbackNome(item.titulo, normalizeSku(item.produtoid_empresa || item.produtoid)),
          custo: item.preco_crossdocking || item.preco_normal || 0,
          estoque: item.estoque || 0,
          dslite_ultima_sync: new Date().toISOString(),
        }));

        const res = await fetch(`${supabaseUrl}/rest/v1/produtos?on_conflict=sku`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify(batch),
        });

        if (!res.ok) {
          const errText = await res.text();
          resultados.push({ fornecedorId: fId, pagina: page, error: `HTTP ${res.status}: ${errText.substring(0, 200)}` });
          break;
        }

        // Busca produtos atualizados que têm anúncio no ML para sincronizar estoque
        const skus = batch.map((b) => b.sku).filter(Boolean);
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
              mlSync: {
                sucessos: mlSync.sucessos,
                erros: mlSync.erros,
                pausados: mlSync.pausados,
                reativados: mlSync.reativados,
                pausa_confirmada: mlSync.pausa_confirmada,
                pausa_pendente: mlSync.pausa_pendente,
                erros_bloqueio_ml: mlSync.erros_bloqueio_ml,
                erros_transitorios: mlSync.erros_transitorios,
                erros_nao_recuperaveis: mlSync.erros_nao_recuperaveis,
              },
            });
          }
        }

        atualizados += batch.length;
        page++;
        if (page > totalPaginas) break;
      }

      resultados.push({ fornecedorId: fId, atualizados });
      totalGeral += atualizados;
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
      total: totalGeral,
      resultados,
      message: 'Sync de preço/estoque concluído com reconciliação de estoque zero',
      reconciliacao_estoque_zero: reconciliacao,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
