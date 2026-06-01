import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { resolveDestIePolicy } from '@/lib/fiscal/ie-policy';
import { resolveCodMunicipio } from '@/lib/fiscal/municipio-ibge';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

function normalizeDocument(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeUf(value: string | null | undefined): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('BR-') && raw.length >= 5) return raw.slice(3);
  return raw;
}

function normalizeZip(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeIe(value: string | null | undefined): string {
  return String(value || '').trim();
}

function ufFromStateName(value: string | null | undefined): string {
  const key = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (!key) return '';
  const map: Record<string, string> = {
    ACRE: 'AC',
    ALAGOAS: 'AL',
    AMAPA: 'AP',
    AMAZONAS: 'AM',
    BAHIA: 'BA',
    CEARA: 'CE',
    'DISTRITO FEDERAL': 'DF',
    'ESPIRITO SANTO': 'ES',
    GOIAS: 'GO',
    MARANHAO: 'MA',
    'MATO GROSSO': 'MT',
    'MATO GROSSO DO SUL': 'MS',
    'MINAS GERAIS': 'MG',
    PARA: 'PA',
    PARAIBA: 'PB',
    PARANA: 'PR',
    PERNAMBUCO: 'PE',
    PIAUI: 'PI',
    'RIO DE JANEIRO': 'RJ',
    'RIO GRANDE DO NORTE': 'RN',
    'RIO GRANDE DO SUL': 'RS',
    RONDONIA: 'RO',
    RORAIMA: 'RR',
    'SANTA CATARINA': 'SC',
    'SAO PAULO': 'SP',
    SERGIPE: 'SE',
    TOCANTINS: 'TO',
  };
  return map[key] || '';
}

function getAdditionalInfoValue(additionalInfo: any[], type: string): string {
  const found = additionalInfo.find((entry) => String(entry?.type || '').toUpperCase() === type.toUpperCase());
  return String(found?.value || '').trim();
}

function removePendencia(pendencias: any, key: string): any[] {
  const arr = Array.isArray(pendencias) ? pendencias : [];
  return arr.filter((item) => String(item || '') !== key);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const s = String(value || '').trim();
    if (s) return s;
  }
  return '';
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const domain = 'pedidos:fiscal';
  let lockOwnerToken = '';
  let lockAcquired = false;

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_reconcile_fiscal',
      ttlSeconds: 25 * 60,
      metadata: { source: 'api/sync/pedidos/reconciliar-fiscal' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        records: { total_target: 0, updated: 0, ie_filled: 0, failed: 0 },
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)));
  const forcedMlOrderId = String(searchParams.get('mlOrderId') || '').trim();
  const forcedPedidoId = String(searchParams.get('pedidoId') || '').trim();

  const serviceClient = createServiceClient();
  const pedidosTable = () => serviceClient.from('pedidos' as any) as any;
  const targets = new Map<string, any>();

  const [{ data: missingIe }, { data: incompletos }] = await Promise.all([
    pedidosTable()
      .select('id,ml_order_id,billing_tipo_pessoa,billing_ie,billing_endereco,snapshot_incompleto,snapshot_pendencias')
      .eq('billing_tipo_pessoa', 'J')
      .is('billing_ie', null)
      .not('ml_order_id', 'is', null)
      .limit(limit),
    pedidosTable()
      .select('id,ml_order_id,billing_tipo_pessoa,billing_ie,billing_endereco,snapshot_incompleto,snapshot_pendencias')
      .eq('snapshot_incompleto', true)
      .not('ml_order_id', 'is', null)
      .limit(limit),
  ]);
  const { data: stateMissing } = await pedidosTable()
    .select('id,ml_order_id,billing_tipo_pessoa,billing_ie,billing_endereco,snapshot_incompleto,snapshot_pendencias')
    .not('ml_order_id', 'is', null)
    .or('billing_endereco->>state_id.is.null,billing_endereco->>state_id.eq.,billing_endereco->>city_name.is.null,billing_endereco->>city_name.eq.,billing_endereco->>zip_code.is.null,billing_endereco->>zip_code.eq.,billing_endereco->>cod_municipio.is.null,billing_endereco->>cod_municipio.eq.')
    .limit(limit);
  const { data: semItensCandidates } = await pedidosTable()
    .select('id,ml_order_id,billing_tipo_pessoa,billing_ie,billing_endereco,snapshot_incompleto,snapshot_pendencias')
    .not('ml_order_id', 'is', null)
    .eq('snapshot_incompleto', false)
    .order('updated_at', { ascending: false })
    .limit(limit * 4);
  let forced: any[] = [];
  if (forcedMlOrderId || forcedPedidoId) {
    let q = pedidosTable()
      .select('id,ml_order_id,billing_tipo_pessoa,billing_ie,billing_endereco,snapshot_incompleto,snapshot_pendencias')
      .not('ml_order_id', 'is', null)
      .limit(5);
    if (forcedMlOrderId) q = q.eq('ml_order_id', forcedMlOrderId);
    if (forcedPedidoId) q = q.eq('id', forcedPedidoId);
    const { data } = await q;
    forced = data || [];
  }

  for (const p of missingIe || []) targets.set(String(p.id), p);
  for (const p of incompletos || []) targets.set(String(p.id), p);
  for (const p of stateMissing || []) targets.set(String(p.id), p);
  if (Array.isArray(semItensCandidates) && semItensCandidates.length > 0) {
    const ids = semItensCandidates.map((p) => String(p.id));
    const { data: itens } = await serviceClient
      .from('pedido_itens')
      .select('pedido_id')
      .in('pedido_id', ids as any);
    const withItens = new Set((itens || []).map((it: any) => String(it.pedido_id || '')));
    for (const p of semItensCandidates) {
      if (!withItens.has(String(p.id))) {
        targets.set(String(p.id), p);
      }
    }
  }
  for (const p of forced || []) targets.set(String(p.id), p);

  const list = Array.from(targets.values()).slice(0, Math.max(limit, forced.length || 0));
  const summary = {
    total_alvo: list.length,
    atualizados: 0,
    ie_preenchida: 0,
    falhas: 0,
  };

  for (const pedido of list) {
    const mlOrderId = String(pedido.ml_order_id || '');
    if (!mlOrderId) continue;

    try {
      const [order, billingLegacy] = await Promise.all([
        fetchML<any>(`/orders/${mlOrderId}`),
        fetchML<any>(`/orders/${mlOrderId}/billing_info`).catch(() => null),
      ]);
      const additionalInfo = Array.isArray(billingLegacy?.billing_info?.additional_info)
        ? billingLegacy.billing_info.additional_info
        : [];
      const siteId = String(order?.site_id || 'MLB');
      const billingInfoId = order?.buyer?.billing_info?.id || null;
      const billingV2 = billingInfoId
        ? await fetchML<any>(`/orders/billing-info/${siteId}/${billingInfoId}`).catch(() => null)
        : null;
      const v2 = billingV2?.buyer?.billing_info || {};
      const v2Address = v2?.address || {};
      const v2State = v2Address?.state || {};
      const v2Identification = v2?.identification || {};
      const taxpayerTypeMlRaw = String(v2?.taxes?.taxpayer_type?.description || v2?.taxes?.taxpayer_type || '').trim() || null;

      const documento = normalizeDocument(
        v2Identification?.number
        || '',
      ) || normalizeDocument(
        getAdditionalInfoValue(additionalInfo, 'DOC_NUMBER')
        || billingLegacy?.billing_info?.doc_number
        || order?.buyer?.billing_info?.doc_number
        || '',
      );
      const ie = normalizeIe(
        v2?.state_registration_number
        || v2?.state_registration
        || ''
      ) || normalizeIe(getAdditionalInfoValue(additionalInfo, 'STATE_REGISTRATION')) || normalizeIe(pedido.billing_ie);
      const stateName = firstNonEmpty(v2State?.name, getAdditionalInfoValue(additionalInfo, 'STATE_NAME'));
      const stateId = normalizeUf(firstNonEmpty(v2State?.code, getAdditionalInfoValue(additionalInfo, 'STATE_CODE'))) || ufFromStateName(stateName);
      const zip = normalizeZip(firstNonEmpty(v2Address?.zip_code, getAdditionalInfoValue(additionalInfo, 'ZIP_CODE')));
      const cityName = firstNonEmpty(v2Address?.city_name, getAdditionalInfoValue(additionalInfo, 'CITY_NAME'));
      const businessName = firstNonEmpty(v2?.business_name, `${v2?.name || ''} ${v2?.last_name || ''}`.trim(), getAdditionalInfoValue(additionalInfo, 'BUSINESS_NAME'));
      const tipoPessoa = documento.length === 14 ? 'J' : documento.length === 11 ? 'F' : (pedido.billing_tipo_pessoa || null);
      const iePolicy = resolveDestIePolicy({
        documento,
        billingIe: ie,
        taxpayerTypeMlRaw,
      });

      const currentAddress = (pedido.billing_endereco && typeof pedido.billing_endereco === 'object')
        ? { ...pedido.billing_endereco }
        : {};
      const nextAddress = {
        ...currentAddress,
        street_name: firstNonEmpty(v2Address?.street_name, getAdditionalInfoValue(additionalInfo, 'STREET_NAME'), currentAddress.street_name),
        street_number: firstNonEmpty(v2Address?.street_number, getAdditionalInfoValue(additionalInfo, 'STREET_NUMBER'), currentAddress.street_number),
        neighborhood: firstNonEmpty(v2Address?.neighborhood, getAdditionalInfoValue(additionalInfo, 'NEIGHBORHOOD'), currentAddress.neighborhood),
        city_name: cityName || currentAddress.city_name || '',
        city_id: firstNonEmpty(v2Address?.city_id, getAdditionalInfoValue(additionalInfo, 'CITY_ID'), currentAddress.city_id) || undefined,
        cod_municipio: String(currentAddress.cod_municipio || '').trim() || undefined,
        state_id: stateId || currentAddress.state_id || '',
        state_name: stateName || currentAddress.state_name || '',
        zip_code: zip || currentAddress.zip_code || '',
        country_id: firstNonEmpty(v2Address?.country_id, getAdditionalInfoValue(additionalInfo, 'COUNTRY_ID'), currentAddress.country_id) || undefined,
        taxpayer_type_ml_raw: iePolicy.taxpayerTypeMlRaw,
        ie_policy_resolved: iePolicy.iePolicyResolved,
      };
      const municipio = await resolveCodMunicipio({
        client: serviceClient as any,
        uf: nextAddress.state_id,
        cityName: nextAddress.city_name,
        zipCode: nextAddress.zip_code,
      });
      if (municipio.codMunicipio) {
        nextAddress.cod_municipio = municipio.codMunicipio;
      }

      let pendencias = removePendencia(pedido.snapshot_pendencias, 'billing_ie_ausente_cnpj');
      pendencias = removePendencia(pendencias, 'billing_endereco_incompleto');
      pendencias = removePendencia(pendencias, 'billing_cod_municipio_ausente');
      pendencias = removePendencia(pendencias, 'pedido_sem_itens');

      const { count: itensCount } = await serviceClient
        .from('pedido_itens')
        .select('*', { head: true, count: 'exact' })
        .eq('pedido_id', pedido.id);

      const enderecoIncompleto = !nextAddress.state_id || !nextAddress.zip_code || !nextAddress.city_name;
      if (enderecoIncompleto) pendencias.push('billing_endereco_incompleto');
      if (!String(nextAddress.cod_municipio || '').trim()) pendencias.push('billing_cod_municipio_ausente');
      if (tipoPessoa === 'J' && iePolicy.ieRequired && !ie) pendencias.push('billing_ie_ausente_cnpj');
      if (!(itensCount && itensCount > 0)) pendencias.push('pedido_sem_itens');

      const snapshotIncompleto = pendencias.length > 0;
      const { error } = await pedidosTable()
        .update({
          billing_nome: businessName || undefined,
          billing_documento: documento || undefined,
          billing_tipo_pessoa: tipoPessoa || undefined,
          billing_ie: ie || null,
          billing_endereco: nextAddress,
          snapshot_incompleto: snapshotIncompleto,
          snapshot_pendencias: pendencias,
          sincronizado_em: new Date().toISOString(),
        } as any)
        .eq('id', pedido.id);

      if (error) throw error;

      summary.atualizados += 1;
      if (ie && !pedido.billing_ie) summary.ie_preenchida += 1;

      await registrarEventoNfAuditoria({
        pedidoId: String(pedido.id),
        mlOrderId,
        evento: snapshotIncompleto ? 'sync_snapshot_partial' : 'sync_snapshot_success',
        respostaMl: {
          source: 'ml_live',
          pendencias,
          ie_atualizada: Boolean(ie),
          taxpayer_type_ml_raw: iePolicy.taxpayerTypeMlRaw,
          ie_policy_resolved: iePolicy.iePolicyResolved,
          cod_municipio_source: municipio.source,
          cod_municipio_reason: municipio.reason || null,
        },
        statusResultante: snapshotIncompleto ? 'partial' : 'success',
      });
    } catch (err: any) {
      summary.falhas += 1;
      await registrarEventoNfAuditoria({
        pedidoId: String(pedido.id),
        mlOrderId,
        evento: 'sync_snapshot_failed',
        respostaMl: { error: err?.message || 'reconciliacao_fiscal_failed' },
        statusResultante: 'failed',
      });
    }
  }

  return NextResponse.json({
    success: true,
    domain,
    ok: true,
    ...summary,
    records: {
      total_target: summary.total_alvo,
      updated: summary.atualizados,
      ie_filled: summary.ie_preenchida,
      failed: summary.falhas,
    },
    duration: { ms: Date.now() - startedAt },
  });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      errors: [{ code: 'reconcile_fiscal_unexpected_error', message: err?.message || 'Erro inesperado na reconciliação fiscal' }],
      records: { total_target: 0, updated: 0, ie_filled: 0, failed: 0 },
      duration: { ms: Date.now() - startedAt },
      lock_acquired: lockAcquired,
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
