import { NextResponse } from 'next/server';
import { sincronizarCatalogo, listarFornecedores } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 300;

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

        // Build batch payloads
        const batch = produtos.map((item) => ({
          sku: item.produtoid_empresa || item.produtoid || `PROD-${item.produtoid}-${fId}`,
          nome: item.titulo,
          marca: item.marca || null,
          fornecedor: fornName,
          gtin: item.ean11 || null,
          ncm: item.ncm || null,
          categoria: item.categoria_nome || null,
          custo: item.preco_crossdocking || item.preco_normal || 0,
          estoque: item.estoque || 0,
          ml_fee: 0.15,
          ml_status: 'sem_anuncio',
          peso_liq: item.peso || null,
          peso_bruto: item.peso || null,
          largura: item.largura || null,
          altura: item.altura || null,
          profundidade: item.profundidade || null,
          descricao: item.descricao || null,
          dslite_fornecedor_id: String(fId),
          dslite_produto_id: item.produtoid,
          dslite_ultima_sync: new Date().toISOString(),
        }));

        // Upsert batch directly via Supabase REST API (much faster than individual)
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

        totalSync += batch.length;
        page++;

        // Stop if we've processed all pages
        if (page > totalPaginas) break;
      }

      resultados.push({ fornecedorId: fId, nome: fornName, total: totalSync });
    }

    return NextResponse.json({ success: true, resultados });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
