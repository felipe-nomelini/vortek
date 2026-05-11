import { NextResponse } from 'next/server';
import { sincronizarPrecoEstoque, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const fornecedorIds: (number | string)[] = body.fornecedorIds || [];
    const pageSize: number = body.pageSize || 100;

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
          sku: item.produtoid_empresa || item.produtoid,
          custo: item.preco_crossdocking || item.preco_normal || 0,
          estoque: item.estoque || 0,
          dslite_ultima_sync: new Date().toISOString(),
        }));

        const res = await fetch(`${supabaseUrl}/rest/v1/produtos`, {
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

        atualizados += batch.length;
        page++;
        if (page > totalPaginas) break;
      }

      resultados.push({ fornecedorId: fId, atualizados });
      totalGeral += atualizados;
    }

    return NextResponse.json({ success: true, total: totalGeral, resultados });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
