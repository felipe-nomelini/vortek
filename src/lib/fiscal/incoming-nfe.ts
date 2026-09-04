import { createHash } from 'crypto';
import { BNT_D05_INVENTORY_FIXTURE_SOURCE } from '@/lib/homologation-fixture';
import { resolveStockNfeEnvironment } from '@/lib/estoque-recebimento';
import { isValidCnpj, normalizeCnpj } from '@/lib/fiscal/cnpj.js';
import { createServiceClient } from '@/lib/supabase';
import {
  manifestarNotaEntradaBrasilNfe,
  type BrasilNfeIncomingDocument,
} from '@/services/fiscal-provider';

type ServiceDb = ReturnType<typeof createServiceClient>;
export type IncomingManifestationType = 1 | 2 | 3 | 4;

export async function loadConfiguredCompanyCnpj(db: ServiceDb): Promise<string> {
  const { data, error } = await db.from('empresa').select('cnpj').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const cnpj = normalizeCnpj(data?.cnpj);
  if (!isValidCnpj(cnpj)) throw new Error('CNPJ da empresa não está configurado.');
  return cnpj;
}

export async function upsertIncomingNfeSnapshots(input: {
  documents: BrasilNfeIncomingDocument[];
  source: 'brasilnfe_sync';
}): Promise<{ inserted: number; updated: number; ignored: number }> {
  const db = createServiceClient();
  const companyCnpj = await loadConfiguredCompanyCnpj(db);
  const valid = input.documents.filter((document) => (
    document.modeloDocumento === 55
    && document.chave.length === 44
    && normalizeCnpj(document.destinatarioCnpj) === companyCnpj
    && isValidCnpj(document.emitenteCnpj)
  ));
  const keys = valid.map((document) => document.chave);
  const { data: existing, error: existingError } = keys.length
    ? await (db as any).from('estoque_recebimentos_nfe').select('chave_nfe').in('chave_nfe', keys)
    : { data: [], error: null };
  if (existingError) throw new Error(existingError.message);
  const existingKeys = new Set((existing || []).map((row: any) => String(row.chave_nfe)));

  let inserted = 0;
  let updated = 0;
  for (const document of valid) {
    const common = {
      numero: document.numero,
      emitente_cnpj: document.emitenteCnpj,
      emitente_nome: document.emitenteNome || 'Emitente não informado',
      destinatario_cnpj: document.destinatarioCnpj,
      emitida_em: document.emitidaEm,
      valor_total: document.valor,
      modelo_documento: 55,
      provider_status: document.status,
      numero_protocolo: document.numeroProtocolo,
      valor_icms: document.valorIcms,
      emitente_ie: document.emitenteIe,
      cfops: document.cfops,
      digest_value: document.digestValue,
      recebida_em: document.recebidaEm,
      updated_at: new Date().toISOString(),
    };
    if (existingKeys.has(document.chave)) {
      const { error } = await (db as any).from('estoque_recebimentos_nfe')
        .update(common).eq('chave_nfe', document.chave);
      if (error) throw new Error(error.message);
      updated += 1;
    } else {
      const { error } = await (db as any).from('estoque_recebimentos_nfe').insert({
        ...common,
        chave_nfe: document.chave,
        tipo_ambiente: resolveStockNfeEnvironment(),
        status: 'identificada',
        snapshot_source: input.source,
      });
      if (error) throw new Error(error.message);
      inserted += 1;
    }
  }
  return { inserted, updated, ignored: input.documents.length - valid.length };
}

function manifestationStatus(providerStatus: number | null): string {
  if (providerStatus === 1) return 'processada';
  if (providerStatus === 2) return 'aguardando_processamento';
  return 'falha';
}

export async function requestIncomingNfeManifestation(input: {
  receiptId?: string;
  chave?: string;
  type: IncomingManifestationType;
  justification?: string;
  idempotencyKey: string;
  userId: string;
}) {
  const db = createServiceClient();
  let query = (db as any).from('estoque_recebimentos_nfe')
    .select('id,chave_nfe,tipo_ambiente,snapshot_source,provider_status');
  query = input.receiptId ? query.eq('id', input.receiptId) : query.eq('chave_nfe', input.chave);
  const { data: foundReceipt, error: receiptError } = await query.maybeSingle();
  if (receiptError) throw new Error(receiptError.message);
  const receipt = foundReceipt || (!input.receiptId && input.chave ? {
    id: null,
    chave_nfe: input.chave,
    tipo_ambiente: resolveStockNfeEnvironment(),
    snapshot_source: 'operacional',
    provider_status: 1,
  } : null);
  if (!receipt) throw new Error('NF-e de entrada não encontrada.');
  if (receipt.snapshot_source === BNT_D05_INVENTORY_FIXTURE_SOURCE) {
    throw new Error('homologation_fixture_read_only');
  }
  if (Number(receipt.provider_status) !== 1) {
    throw new Error('A manifestação só pode ser enviada para uma NF-e autorizada.');
  }

  const { data: previous, error: previousError } = await (db as any)
    .from('estoque_manifestacoes_nfe')
    .select('*')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (previousError) throw new Error(previousError.message);
  if (previous) return { manifestation: previous, repeated: true };

  const requestedAt = new Date().toISOString();
  const { data: created, error: createError } = await (db as any)
    .from('estoque_manifestacoes_nfe')
    .insert({
      recebimento_id: receipt.id || null,
      chave_nfe: receipt.chave_nfe,
      tipo_ambiente: receipt.tipo_ambiente,
      tipo_manifestacao: input.type,
      justificativa: input.justification || null,
      status: 'solicitada',
      requested_by: input.userId,
      requested_at: requestedAt,
      updated_at: requestedAt,
      idempotency_key: input.idempotencyKey,
    })
    .select('*')
    .single();
  if (createError) throw new Error(createError.message);

  try {
    const result = await manifestarNotaEntradaBrasilNfe({
      chave: receipt.chave_nfe,
      tipoAmbiente: receipt.tipo_ambiente,
      tipoManifestacao: input.type,
      justificativa: input.justification,
    });
    const status = manifestationStatus(result.status);
    const completedAt = new Date().toISOString();
    const update = {
      status,
      protocolo: result.protocolo,
      motivo: result.motivo,
      numero_sequencial: result.numeroSequencial,
      codigo_sefaz: result.codigoSefaz,
      provider_evento: result.evento,
      completed_at: completedAt,
      updated_at: completedAt,
    };
    const { data: manifestation, error: updateError } = await (db as any)
      .from('estoque_manifestacoes_nfe').update(update).eq('id', created.id).select('*').single();
    if (updateError) throw new Error(updateError.message);
    if (receipt.id) {
      await (db as any).from('estoque_recebimentos_nfe').update({
        manifestacao_status: `${input.type}:${status}`,
        manifestacao_protocolo: result.protocolo,
        manifestada_em: completedAt,
        updated_at: completedAt,
      }).eq('id', receipt.id);
    }
    return { manifestation, repeated: false };
  } catch (error: any) {
    const failedAt = new Date().toISOString();
    await (db as any).from('estoque_manifestacoes_nfe').update({
      status: 'desconhecido',
      motivo: error?.message || 'Falha ambígua ao enviar manifestação.',
      completed_at: failedAt,
      updated_at: failedAt,
    }).eq('id', created.id);
    throw error;
  }
}

export function hashWebhookBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
