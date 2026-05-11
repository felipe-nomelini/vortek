import { NextResponse } from 'next/server';
import { sincronizarCatalogo, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 180;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const fornecedorIds: (number | string)[] = body.fornecedorIds || [];
    const pageSize: number = body.pageSize || 1000;

    const client = createServiceClient();

    // If no fornecedorIds provided, discover all active ones
    let ids = fornecedorIds;
    if (ids.length === 0) {
      const fornecedores = await listarFornecedores();
      if (!fornecedores || fornecedores.length === 0) {
        return NextResponse.json({ error: 'Nenhum fornecedor encontrado' }, { status: 502 });
      }
      ids = fornecedores
        .filter((f) => f.crossdocking === 'Ativo')
        .map((f) => f.id);
    }

    let totalGeral = 0;
    let inseridosGeral = 0;
    let atualizadosGeral = 0;
    const resultados: any[] = [];

    for (const fId of ids) {
      let page = 1;
      let totalPaginas = 1;

      while (page <= totalPaginas) {
        const response = await sincronizarCatalogo(fId, page, pageSize);
        if (!response?.produtos) {
          resultados.push({ fornecedorId: fId, error: 'Falha ao obter catálogo' });
          break;
        }

        const { produtos, detalhesConsulta } = response;
        totalPaginas = Math.ceil(detalhesConsulta.totalRegistros / pageSize);

        for (const item of produtos) {
          const sku = item.produtoid_empresa || item.produtoid;
          const custo = item.preco_crossdocking || item.preco_normal || 0;

          const { data: existing } = await client
            .from('produtos')
            .select('id')
            .eq('dslite_produto_id', String(item.produtoid))
            .eq('dslite_fornecedor_id', String(fId))
            .maybeSingle();

          const payload = {
            nome: item.titulo,
            sku,
            marca: item.marca || null,
            gtin: item.ean11 || null,
            ncm: item.ncm || null,
            categoria: item.categoria_nome || null,
            dslite_fornecedor_id: String(fId),
            dslite_produto_id: String(item.produtoid),
            dslite_ultima_sync: new Date().toISOString(),
            custo,
            estoque: item.estoque || 0,
            peso_liq: item.peso || null,
            peso_bruto: item.peso || null,
            largura: item.largura || null,
            altura: item.altura || null,
            profundidade: item.profundidade || null,
            descricao: item.descricao || null,
          };

          if (existing) {
            await client.from('produtos').update(payload).eq('id', existing.id);
            atualizadosGeral++;
          } else {
            await client.from('produtos').insert(payload);
            inseridosGeral++;
          }
          totalGeral++;
        }

        page++;
      }

      resultados.push({
        fornecedorId: fId,
        total: totalGeral,
        inseridos: inseridosGeral,
        atualizados: atualizadosGeral,
      });
      // Reset counters per fornecedor for cleaner reporting
      totalGeral = 0;
      inseridosGeral = 0;
      atualizadosGeral = 0;
    }

    return NextResponse.json({ success: true, resultados });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
