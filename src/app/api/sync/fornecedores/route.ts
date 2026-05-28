import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { listarFornecedores, sincronizarCatalogo, type DsliteFornecedorStatus } from '@/services/dslite';
import type { Json } from '@/types/database';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

export const maxDuration = 300;

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
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  let lockOwnerToken = '';
  let lockAcquired = false;
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  const domain = 'fornecedores:dslite';

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_dslite_fornecedores',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/fornecedores' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_dslite_fornecedores',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const client = createServiceClient();
    const nowIso = new Date().toISOString();

    const fornecedores = await listarFornecedores();
    if (!fornecedores || fornecedores.length === 0) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_dslite_fornecedores',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: null,
        records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
        errors: [{ code: 'dslite_fornecedores_empty', message: 'Falha ao listar fornecedores na DSLite' }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 502 });
    }

    const baseMapped = fornecedores
      .map((raw) => {
        const record = extractFornecedorRecord(raw);
        const dsliteId = asText(raw.id || record.fornecedorid || record.id_fornecedor);
        if (!dsliteId) return null;

        return {
          dslite_id: dsliteId,
          apelido: asText(raw.apelido || record.apelido_fantasia || record.nickname),
          status_dslite: asText(raw.status),
          crossdocking: asText(raw.crossdocking),
          dropshipping: asText(raw.dropshipping),
          nome: asText(raw.nome || record.razao_social || record.nome_fantasia),
          cnpj: asText(raw.cnpj || record.cpfcnpj || record.documento),
          endereco: asText(raw.endereco || record.logradouro),
          email: asText(raw.email),
          telefone: asText(raw.telefone || record.fone || record.celular),
          payload_dslite: record as unknown as Json,
          dslite_ultima_sync: nowIso,
          ativo: true,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (baseMapped.length === 0) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_dslite_fornecedores',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: null,
        records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
        errors: [{ code: 'dslite_fornecedor_missing_identity', message: 'DSLite retornou fornecedores sem identificação válida' }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 502 });
    }

    const enriquecimentos = await Promise.all(
      baseMapped.map(async (item) => {
        const statusNormalizado = asText(item.status_dslite).toLowerCase();
        if (!statusNormalizado.includes('ativo')) {
          return { dslite_id: item.dslite_id, nome: '', cnpj: '' };
        }
        return { dslite_id: item.dslite_id, ...(await buscarMetadadosFornecedorCatalogo(item.dslite_id)) };
      }),
    );
    const enrichMap = new Map(enriquecimentos.map((entry) => [entry.dslite_id, entry]));

    const mapped = baseMapped.map((item) => {
      const enrich = enrichMap.get(item.dslite_id);
      const nomeRazaoSocial = asText(enrich?.nome) || asText(item.nome);
      const cnpjFinal = asText(enrich?.cnpj) || asText(item.cnpj);

      return {
        ...item,
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
      .select('id, dslite_id')
      .in('dslite_id', dsliteIds);

    if (existingError) {
      throw new Error(`Falha ao consultar fornecedores existentes: ${existingError.message}`);
    }

    const existingIds = new Set((existingRows || []).map((row) => row.dslite_id).filter(Boolean));
    const inseridos = mapped.filter((row) => !existingIds.has(row.dslite_id)).length;
    const atualizados = mapped.length - inseridos;

    const { error: upsertError } = await client
      .from('fornecedores')
      .upsert(mapped as any, { onConflict: 'dslite_id' });

    if (upsertError) {
      throw new Error(`Falha no upsert dos fornecedores: ${upsertError.message}`);
    }

    const { data: ativosNoBanco, error: ativosError } = await client
      .from('fornecedores')
      .select('id, dslite_id')
      .eq('ativo', true)
      .not('dslite_id', 'is', null);

    if (ativosError) {
      throw new Error(`Falha ao listar fornecedores ativos: ${ativosError.message}`);
    }

    const idsAtuais = new Set(dsliteIds);
    const idsParaInativar = (ativosNoBanco || [])
      .filter((row) => row.dslite_id && !idsAtuais.has(row.dslite_id))
      .map((row) => row.id);

    let inativados = 0;
    if (idsParaInativar.length > 0) {
      const { error: deactivateError } = await client
        .from('fornecedores')
        .update({ ativo: false } as any)
        .in('id', idsParaInativar);

      if (deactivateError) {
        throw new Error(`Falha ao inativar fornecedores antigos: ${deactivateError.message}`);
      }
      inativados = idsParaInativar.length;
    }

    return NextResponse.json({
      success: true,
      domain,
      job: {
        key: 'sync_dslite_fornecedores',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: null,
      records: {
        seen: mapped.length,
        inserted: inseridos,
        updated: atualizados,
        deactivated: inativados,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
      // Compatibilidade
      message: 'Fornecedores sincronizados com sucesso',
      total: mapped.length,
      inseridos,
      atualizados,
      inativados,
      erros: fornecedores.length - mapped.length,
    });
  } catch (err: any) {
    errors.push({
      code: 'fornecedores_sync_unexpected_error',
      message: err?.message || 'Erro inesperado no sync de fornecedores',
    });
    return NextResponse.json({
      success: false,
      domain,
      job: {
        key: 'sync_dslite_fornecedores',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
      errors,
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}

