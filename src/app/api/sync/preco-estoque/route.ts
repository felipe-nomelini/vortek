import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 180;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const fornecedorIds: (number | string)[] = body.fornecedorIds || [];
    const pageSize: number = body.pageSize || 1000;

    const client = createServiceClient();

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

    let atualizadosGeral = 0;
    const resultados: any[] = [];

    for (const fId of ids) {
      let page = 1;
      let totalPaginas = 1;
      let atualizados = 0;

      while (page <= totalPaginas) {
        const response = await sincronizarPrecoEstoque(fId, page, pageSize);
        if (!response?.produtos) {
          resultados.push({ fornecedorId: fId, error: 'Falha ao obter preços' });
          break;
        }

        const { produtos, detalhesConsulta } = response;
        totalPaginas = Math.ceil(detalhesConsulta.totalRegistros / pageSize);

        for (const item of produtos) {
          const custo = item.preco_crossdocking || item.preco_normal || 0;

          const { data: produto } = await client
            .from('produtos')
            .select('id')
            .eq('dslite_produto_id', String(item.produtoid))
            .eq('dslite_fornecedor_id', String(fId))
            .maybeSingle();

          if (produto) {
            await client
              .from('produtos')
              .update({
                custo,
                estoque: item.estoque || 0,
                dslite_ultima_sync: new Date().toISOString(),
              })
              .eq('id', produto.id);
            atualizados++;
          }
        }
        page++;
      }

      resultados.push({ fornecedorId: fId, atualizados });
      atualizadosGeral += atualizados;
    }

    return NextResponse.json({ success: true, total: atualizadosGeral, resultados });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
