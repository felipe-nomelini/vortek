import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { listarFornecedores, sincronizarCatalogo, type DsliteFornecedorStatus } from '@/services/dslite';
import type { Json } from '@/types/database';

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function extractFornecedorRecord(raw: DsliteFornecedorStatus): Record<string, unknown> {
  return raw as unknown as Record<string, unknown>;
}

async function buscarMetadadosFornecedorCatalogo(fornecedorId: string): Promise<{ nome: string; cnpj: string }> {
  try {
    const response = await sincronizarCatalogo(fornecedorId, 1, 1);
    if (!response) return { nome: '', cnpj: '' };

    const responseAny = response as unknown as Record<string, unknown>;
    const fornecedorObj = (responseAny.fornecedor || {}) as Record<string, unknown>;

    const nome = asText(responseAny.nome || fornecedorObj.nome);
    const cnpj = asText(responseAny.cnpj || fornecedorObj.cnpj);
    return { nome, cnpj };
  } catch {
    return { nome: '', cnpj: '' };
  }
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  const client = createServiceClient();
  const nowIso = new Date().toISOString();

  const fornecedores = await listarFornecedores();
  if (!fornecedores || fornecedores.length === 0) {
    return NextResponse.json({ error: 'Falha ao listar fornecedores na DSLite' }, { status: 502 });
  }

  const baseMapped = fornecedores
    .map((raw) => {
      const record = extractFornecedorRecord(raw);
      const dsliteId = asText(raw.id || record.fornecedorid || record.id_fornecedor);
      if (!dsliteId) return null;

      const apelido = asText(raw.apelido || record.apelido_fantasia || record.nickname);
      const nomeStatus = asText(raw.nome || record.razao_social || record.nome_fantasia);
      const cnpjStatus = asText(raw.cnpj || record.cpfcnpj || record.documento);
      const endereco = asText(raw.endereco || record.logradouro);
      const email = asText(raw.email);
      const telefone = asText(raw.telefone || record.fone || record.celular);

      return {
        dslite_id: dsliteId,
        apelido,
        status_dslite: asText(raw.status),
        crossdocking: asText(raw.crossdocking),
        dropshipping: asText(raw.dropshipping),
        nome: nomeStatus,
        cnpj: cnpjStatus,
        endereco,
        email,
        telefone,
        payload_dslite: record as unknown as Json,
        dslite_ultima_sync: nowIso,
        ativo: true,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (baseMapped.length === 0) {
    return NextResponse.json({ error: 'DSLite retornou fornecedores sem identificação válida' }, { status: 502 });
  }

  // Enriquecimento via catálogo para obter razão social e CNPJ do fornecedor
  const enriquecimentos = await Promise.all(
    baseMapped.map(async (item) => {
      const statusNormalizado = asText(item.status_dslite).toLowerCase();
      if (!statusNormalizado.includes('ativo')) {
        return { dslite_id: item.dslite_id, nome: '', cnpj: '' };
      }

      const meta = await buscarMetadadosFornecedorCatalogo(item.dslite_id);
      return { dslite_id: item.dslite_id, nome: meta.nome, cnpj: meta.cnpj };
    })
  );

  const enrichMap = new Map(enriquecimentos.map((e) => [e.dslite_id, e]));

  const mapped = baseMapped.map((item) => {
    const enrich = enrichMap.get(item.dslite_id);
    const nomeRazaoSocial = asText(enrich?.nome) || asText(item.nome);
    const cnpjFinal = asText(enrich?.cnpj) || asText(item.cnpj);

    return {
      ...item,
      // Regra solicitada: coluna NOME deve refletir razão social, sem fallback para apelido
      nome: nomeRazaoSocial,
      cnpj: cnpjFinal,
      payload_dslite: {
        ...(item.payload_dslite as Record<string, unknown>),
        _catalogo_enriquecimento: {
          nome: asText(enrich?.nome),
          cnpj: asText(enrich?.cnpj),
        },
      } as Json,
    };
  });

  const dsliteIds = mapped.map((item) => item.dslite_id);
  const { data: existingRows, error: existingError } = await client
    .from('fornecedores')
    .select('dslite_id')
    .in('dslite_id', dsliteIds);

  if (existingError) {
    return NextResponse.json({ error: `Falha ao consultar fornecedores existentes: ${existingError.message}` }, { status: 500 });
  }

  const existingIds = new Set((existingRows || []).map((row) => row.dslite_id).filter(Boolean));
  const inseridos = mapped.filter((row) => !existingIds.has(row.dslite_id)).length;
  const atualizados = mapped.length - inseridos;

  const { error: upsertError } = await client
    .from('fornecedores')
    .upsert(mapped, { onConflict: 'dslite_id' });

  if (upsertError) {
    return NextResponse.json({ error: `Falha no upsert dos fornecedores: ${upsertError.message}` }, { status: 500 });
  }

  const { data: ativosNoBanco, error: ativosError } = await client
    .from('fornecedores')
    .select('id, dslite_id')
    .eq('ativo', true)
    .not('dslite_id', 'is', null);

  if (ativosError) {
    return NextResponse.json({ error: `Falha ao listar fornecedores ativos: ${ativosError.message}` }, { status: 500 });
  }

  const idsAtuais = new Set(dsliteIds);
  const idsParaInativar = (ativosNoBanco || [])
    .filter((row) => row.dslite_id && !idsAtuais.has(row.dslite_id))
    .map((row) => row.id);

  let inativados = 0;
  if (idsParaInativar.length > 0) {
    const { error: deactivateError } = await client
      .from('fornecedores')
      .update({ ativo: false })
      .in('id', idsParaInativar);

    if (deactivateError) {
      return NextResponse.json({ error: `Falha ao inativar fornecedores antigos: ${deactivateError.message}` }, { status: 500 });
    }
    inativados = idsParaInativar.length;
  }

  return NextResponse.json({
    success: true,
    message: 'Fornecedores sincronizados com sucesso',
    total: mapped.length,
    inseridos,
    atualizados,
    inativados,
    erros: fornecedores.length - mapped.length,
  });
}
