import { NextResponse } from 'next/server';
import {
  criarPedidoDropshipping,
  buscarProdutoPorSku,
  informarFornecedorPedido,
  consultarPedidoPorChaveAcesso,
  definirTransportadoraPedido,
  enviarEtiqueta,
} from '@/services/dslite';
import {
  baixarEtiquetaML,
  consultarInvoiceDataPorShipmentML,
  fetchML,
  upsertInvoiceDataMLByShipment,
} from '@/services/integration';
import { createServiceClient } from '@/lib/supabase';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import {
  buscarNotaBrasilNfePorIdentificadorInterno,
  checkBrasilNfeChaveExists,
  getFiscalProvider,
  obterXmlBrasilNfePorChave,
  parseBrasilNfeDuplicateIdentifier,
  type NfeProvider,
} from '@/services/fiscal-provider';
import {
  ALLOWED_CFOP_DSLITE,
  extractCfopsFromXml,
  extractEmitDestUfFromXml,
  validateCfopForDslite,
} from '@/lib/fiscal/cfop';

const TRANSPORTADORA_PADRAO_CORREIOS = 31;
const WAIT_AUTH_TIMEOUT_MS = 180_000;
const WAIT_AUTH_INTERVAL_MS = 3_000;
const XML_RETRY_DELAYS_MS = [0, 1500, 2500, 4000, 6000];
const LABEL_RETRY_INTERVAL_MS = 5_000;
const LABEL_WAIT_TIMEOUT_MS = 60_000;
const SHIPMENT_WAIT_INTERVAL_MS = 5_000;
const SHIPMENT_WAIT_TIMEOUT_MS = 90_000;
const SYNC_ORDER_TIMEOUT_MS = 120_000;
const SYNC_ORDER_LOCK_RETRY_ATTEMPTS = 6;
const SYNC_ORDER_LOCK_RETRY_INTERVAL_MS = 2_000;
const STRICT_NFE_VALIDATION = String(process.env.STRICT_NFE_VALIDATION || 'true').toLowerCase() === 'true';
const HOMOLOG_DEST_NAME_MARKER = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

type StrictIssue = {
  campo: string;
  encontrado: string | number | null;
  esperado: string | number | null;
  motivo: string;
};

type ModFreteDecision = {
  value: 0 | 2 | null;
  source: 'snapshot' | 'ml_frete' | 'regra_padrao';
  expectedOnly?: 0 | 2;
  degraded: boolean;
};

function normalizeForCompare(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function resolveBrasilNfeTipoAmbienteStrict():
  | { ok: true; value: 1; raw: string; interpreted: number }
  | { ok: false; value: null; error: string; raw: string; interpreted: number | null } {
  const envValue = process.env.BRASILNFE_TIPO_AMBIENTE;
  const raw = typeof envValue === 'string' ? envValue.trim() : '';
  const interpreted = raw === '' ? null : Number(raw);
  if (interpreted === 1) return { ok: true, value: 1, raw, interpreted };
  const interpretedDisplay = interpreted === null || Number.isNaN(interpreted) ? 'null' : String(interpreted);
  const rawDisplay = raw || '(vazio)';
  return {
    ok: false,
    value: null,
    raw,
    interpreted: interpreted === null || Number.isNaN(interpreted) ? null : interpreted,
    error: `Configuração fiscal inválida: BRASILNFE_TIPO_AMBIENTE="${rawDisplay}" (interpretado: ${interpretedDisplay}). Deve ser 1 (produção).`,
  };
}

function getConfiguredTipoAmbienteValue(): number | null {
  const strict = resolveBrasilNfeTipoAmbienteStrict();
  if (strict.ok) return strict.value;
  return strict.interpreted;
}

function buildReissueIdentifier(baseIdentifier: string): string {
  const base = String(baseIdentifier || 'VORTEK').trim() || 'VORTEK';
  const uniq = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  return `${base}-R${uniq}`;
}

type StepStatus = 'pending' | 'loading' | 'success' | 'error' | 'warning';
type JobState = 'running' | 'success' | 'warning' | 'error';

interface JobStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  error?: string;
  updatedAt: string;
}

const STEP_DEFS: Array<{ key: string; label: string }> = [
  { key: 'sync_order_snapshot', label: 'Sincronizando pedido no Mercado Livre' },
  { key: 'emit_nf_provider', label: 'Emitindo NF na Brasil NFe' },
  { key: 'wait_nf_authorized', label: 'Aguardando autorização da NF' },
  { key: 'fetch_xml_provider', label: 'Baixando XML da NF na Brasil NFe' },
  { key: 'validate_fiscal_prechecks', label: 'Validando vínculo fiscal e pré-checagens' },
  { key: 'find_product_dslite', label: 'Buscando produto no catálogo DSLite' },
  { key: 'create_order_dslite', label: 'Criando pedido na DSLite' },
  { key: 'set_supplier_dslite', label: 'Informando fornecedor' },
  { key: 'set_carrier_dslite', label: 'Definindo transportadora (Correios)' },
  { key: 'download_label_ml', label: 'Baixando etiqueta do Mercado Livre' },
  { key: 'send_label_dslite', label: 'Enviando etiqueta para DSLite' },
];

function now() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOrderSyncSnapshot(mlOrderId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const apiKey = process.env.API_SECRET_KEY || '';
  const endpointUrl = new URL(`${baseUrl}/api/sync/pedidos`);
  endpointUrl.searchParams.set('mlOrderId', mlOrderId);
  let lastResult: { ok: boolean; status: number; data: any; durationMs: number } | null = null;

  for (let attempt = 1; attempt <= SYNC_ORDER_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNC_ORDER_TIMEOUT_MS);

    try {
      const res = await fetch(endpointUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ mlOrderId }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && data?.ok !== false;
      const result = {
        ok,
        status: res.status,
        data,
        durationMs: Date.now() - startedAt,
      };
      lastResult = result;

      // 409 = lock de domínio em execução; aguarda e tenta novamente.
      const isDomainLockConflict = res.status === 409
        && Array.isArray(data?.errors)
        && data.errors.some((e: any) => String(e?.code || '') === 'domain_lock_conflict');
      if (!isDomainLockConflict || attempt >= SYNC_ORDER_LOCK_RETRY_ATTEMPTS) {
        return result;
      }

      await sleep(SYNC_ORDER_LOCK_RETRY_INTERVAL_MS);
    } finally {
      clearTimeout(timeout);
    }
  }

  return lastResult || {
    ok: false,
    status: 500,
    data: { error: 'Falha ao sincronizar pedido' },
    durationMs: 0,
  };
}

async function resolveShipmentIdWithWait(params: {
  client: ReturnType<typeof createServiceClient>;
  pedidoId: string;
  mlOrderId: string | null;
  initialShipmentId: string | null;
  stage: 'invoice_upload' | 'label_download';
}) {
  const { client, pedidoId, mlOrderId, initialShipmentId, stage } = params;
  if (initialShipmentId) {
    return {
      shipmentId: initialShipmentId,
      source: 'initial',
      elapsedMs: 0,
      attempts: 0,
    } as const;
  }

  const startedAt = Date.now();
  let tentativa = 0;
  let lastDbShipmentId: string | null = null;
  let lastMlShipmentId: string | null = null;
  let lastMlError: string | null = null;

  await registrarEventoNfAuditoria({
    pedidoId,
    mlOrderId,
    evento: 'ml_shipment_wait_start',
    payloadEnviado: {
      stage,
      timeout_ms: SHIPMENT_WAIT_TIMEOUT_MS,
      interval_ms: SHIPMENT_WAIT_INTERVAL_MS,
      initial_shipment_id: initialShipmentId || null,
    },
    statusResultante: 'starting',
  });

  while (Date.now() - startedAt <= SHIPMENT_WAIT_TIMEOUT_MS) {
    tentativa += 1;
    const elapsedMs = Date.now() - startedAt;

    const { data: pedidoAtual } = await client
      .from('pedidos')
      .select('ml_shipment_id')
      .eq('id', pedidoId)
      .maybeSingle();
    lastDbShipmentId = String((pedidoAtual as any)?.ml_shipment_id || '').trim() || null;
    if (lastDbShipmentId) {
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId,
        evento: 'ml_shipment_wait_resolved',
        respostaMl: {
          stage,
          source: 'db',
          shipment_id: lastDbShipmentId,
          attempt: tentativa,
          elapsed_ms: elapsedMs,
        },
        statusResultante: 'resolved',
      });
      return {
        shipmentId: lastDbShipmentId,
        source: 'db',
        elapsedMs,
        attempts: tentativa,
      } as const;
    }

    if (mlOrderId) {
      const shipment = await fetchML<any>(`/orders/${encodeURIComponent(String(mlOrderId))}/shipments`).catch((err: any) => {
        lastMlError = err?.message || String(err);
        return null;
      });
      const mlShipmentId = shipment?.id ? String(shipment.id).trim() : '';
      lastMlShipmentId = mlShipmentId || null;
      if (mlShipmentId) {
        await client
          .from('pedidos')
          .update({ ml_shipment_id: mlShipmentId } as any)
          .eq('id', pedidoId);

        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId,
          evento: 'ml_shipment_wait_resolved',
          respostaMl: {
            stage,
            source: 'ml_orders_shipments',
            shipment_id: mlShipmentId,
            attempt: tentativa,
            elapsed_ms: elapsedMs,
          },
          statusResultante: 'resolved',
        });
        return {
          shipmentId: mlShipmentId,
          source: 'ml_orders_shipments',
          elapsedMs,
          attempts: tentativa,
        } as const;
      }
    }

    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: 'ml_shipment_wait_attempt',
      respostaMl: {
        stage,
        attempt: tentativa,
        elapsed_ms: elapsedMs,
        shipment_id_db: lastDbShipmentId,
        shipment_id_ml: lastMlShipmentId,
        ml_error: lastMlError,
      },
      statusResultante: 'waiting',
    });

    const exceeded = elapsedMs + SHIPMENT_WAIT_INTERVAL_MS > SHIPMENT_WAIT_TIMEOUT_MS;
    if (exceeded) break;
    await sleep(SHIPMENT_WAIT_INTERVAL_MS);
  }

  await registrarEventoNfAuditoria({
    pedidoId,
    mlOrderId,
    evento: 'ml_shipment_wait_timeout',
    respostaMl: {
      stage,
      timeout_ms: SHIPMENT_WAIT_TIMEOUT_MS,
      elapsed_ms: Date.now() - startedAt,
      attempts: tentativa,
      shipment_id_db: lastDbShipmentId,
      shipment_id_ml: lastMlShipmentId,
      ml_error: lastMlError,
    },
    statusResultante: 'timeout',
  });

  return {
    shipmentId: null,
    source: 'timeout',
    elapsedMs: Date.now() - startedAt,
    attempts: tentativa,
  } as const;
}

function parseInvoiceDateFromXml(xml: string | null | undefined): string | null {
  const dhEmi = extrairTagDoXml(String(xml || ''), 'dhEmi');
  if (dhEmi) {
    const d = new Date(dhEmi);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const dEmi = extrairTagDoXml(String(xml || ''), 'dEmi');
  if (!dEmi) return null;
  const d = new Date(`${dEmi}T00:00:00-03:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseInvoiceAmountFromXml(xml: string | null | undefined): number | null {
  const vNf = extrairTagDoXml(String(xml || ''), 'vNF');
  if (!vNf) return null;
  const num = Number(String(vNf).replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function initSteps(): JobStep[] {
  const ts = now();
  return STEP_DEFS.map((s) => ({ key: s.key, label: s.label, status: 'pending', updatedAt: ts }));
}

function parseLog(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extrairSkuDoXml(xml: string): string | null {
  try {
    const match = xml.match(/<cProd>([^<]+)<\/cProd>/);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

function removerPrefixoSku(sku: string): string {
  return sku.replace(/^[A-Za-z]+/, '');
}

function extrairChaveAcessoDoXml(xml: string): string | null {
  try {
    const match = xml.match(/<chNFe>([^<]+)<\/chNFe>/);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

function extrairTagDoXml(xml: string, tag: string): string | null {
  try {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${escaped}>([^<]+)</${escaped}>`);
    const match = xml.match(regex);
    if (match?.[1]) return match[1].trim();
  } catch {}
  return null;
}

function extrairDestinatarioNomeDoXml(xml: string): string | null {
  try {
    const match = xml.match(/<dest>[\s\S]*?<xNome>([^<]+)<\/xNome>/i);
    if (match?.[1]) return match[1].trim();
  } catch {}
  return null;
}

function validarXmlNfeProducao(xml: string): {
  ok: boolean;
  tpAmb: string | null;
  destinatarioNome: string | null;
  marcadorHomologacao: boolean;
  message?: string;
} {
  const tpAmb = extrairTagDoXml(xml, 'tpAmb');
  const destinatarioNome = extrairDestinatarioNomeDoXml(xml);
  const marcadorHomologacao = normalizeForCompare(destinatarioNome).includes(normalizeForCompare(HOMOLOG_DEST_NAME_MARKER));

  if (tpAmb !== '1') {
    return {
      ok: false,
      tpAmb,
      destinatarioNome,
      marcadorHomologacao,
      message: 'NF-e em ambiente de homologação ou sem tpAmb=1. Emissão em produção é obrigatória.',
    };
  }

  if (marcadorHomologacao) {
    return {
      ok: false,
      tpAmb,
      destinatarioNome,
      marcadorHomologacao,
      message: 'NF-e com destinatário de homologação detectado no XML. Emissão em produção com dados reais é obrigatória.',
    };
  }

  return {
    ok: true,
    tpAmb,
    destinatarioNome,
    marcadorHomologacao,
  };
}

function isNfeAuthorizedStatus(status: string | null | undefined): boolean {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'authorized' || normalized === 'autorizada';
}

function normalizeDocument(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

const UF_CODES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

function normalizeUf(value: string | null | undefined): string | null {
  const uf = String(value || '').trim().toUpperCase();
  if (!UF_CODES.has(uf)) return null;
  return uf;
}

function extractUfFromAddress(value: string | null | undefined): string | null {
  const raw = String(value || '').toUpperCase();
  const dashMatch = raw.match(/-\s*([A-Z]{2})(?:\b|,)/);
  if (dashMatch?.[1] && UF_CODES.has(dashMatch[1])) return dashMatch[1];
  const endMatch = raw.match(/,\s*([A-Z]{2})\s*$/);
  if (endMatch?.[1] && UF_CODES.has(endMatch[1])) return endMatch[1];
  const tokens = raw
    .replace(/[^\w\s-]/g, ' ')
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const tk = tokens[i];
    if (UF_CODES.has(tk)) return tk;
  }
  return null;
}

function expectedCfopByUf(emitUf: string | null, destUf: string | null): 5120 | 6120 | null {
  if (!emitUf || !destUf) return null;
  return emitUf === destUf ? 5120 : 6120;
}

function resolveEmitUfFromEmpresa(empresa: any): { emitUf: string | null; source: 'empresa.uf_fiscal' | 'endereco_fallback' | 'missing' } {
  const fromConfig = normalizeUf(empresa?.uf_fiscal);
  if (fromConfig) return { emitUf: fromConfig, source: 'empresa.uf_fiscal' };
  const fromAddress = extractUfFromAddress(empresa?.endereco || null);
  if (fromAddress) return { emitUf: fromAddress, source: 'endereco_fallback' };
  return { emitUf: null, source: 'missing' };
}

function resolveModalidadeFreteFromSnapshot(pedido: any): ModFreteDecision {
  const snapshotCandidates = [
    pedido?.totais_snapshot?.modFrete,
    pedido?.totais_snapshot?.modalidade_frete,
    pedido?.billing_endereco?.modFrete,
    pedido?.billing_endereco?.modalidade_frete,
  ];

  for (const candidate of snapshotCandidates) {
    const value = Number(candidate);
    if (value === 0 || value === 2) {
      return { value, source: 'snapshot', expectedOnly: value, degraded: false };
    }
    if (Number.isFinite(value) && value >= 0) {
      return { value: null, source: 'snapshot', degraded: false };
    }
  }

  const hasMlShipment = Boolean(String(pedido?.ml_shipment_id || '').trim());
  if (hasMlShipment) {
    return { value: 2, source: 'ml_frete', expectedOnly: 2, degraded: false };
  }

  const defaultModFrete = Number(process.env.NFE_DEFAULT_MODFRETE || 0);
  if (defaultModFrete === 0 || defaultModFrete === 2) {
    return { value: defaultModFrete, source: 'regra_padrao', degraded: true };
  }

  return { value: null, source: 'regra_padrao', degraded: true };
}

function validateNfePayloadStrict(
  payload: any,
  expectedCfop: 5120 | 6120 | null,
  expectedModFrete?: 0 | 2 | null,
  allowedModFrete: Array<0 | 2> = [0, 2],
): { ok: boolean; issues: StrictIssue[] } {
  const issues: StrictIssue[] = [];
  const tipoAmbiente = Number(payload?.TipoAmbiente ?? 0);
  if (tipoAmbiente !== 1) {
    issues.push({ campo: 'TipoAmbiente', encontrado: tipoAmbiente || null, esperado: 1, motivo: 'tipo_ambiente_nao_producao' });
  }

  const destUf = String(payload?.Cliente?.Endereco?.Uf || '').trim().toUpperCase() || null;
  if (!payload?.Cliente?.Endereco?.CodMunicipio) {
    issues.push({ campo: 'Cliente.Endereco.CodMunicipio', encontrado: null, esperado: 'obrigatorio', motivo: 'municipio_ausente' });
  }
  if (!destUf) {
    issues.push({ campo: 'Cliente.Endereco.Uf', encontrado: null, esperado: 'obrigatorio', motivo: 'uf_ausente' });
  }
  if (!String(payload?.Cliente?.Endereco?.Cep || '').replace(/\D/g, '')) {
    issues.push({ campo: 'Cliente.Endereco.Cep', encontrado: null, esperado: 'obrigatorio', motivo: 'cep_ausente' });
  }

  const modFrete = Number(payload?.Transporte?.ModalidadeFrete ?? -1);
  if (expectedModFrete === 0 || expectedModFrete === 2) {
    if (modFrete !== expectedModFrete) {
      issues.push({ campo: 'Transporte.ModalidadeFrete', encontrado: modFrete, esperado: expectedModFrete, motivo: 'frete_divergente_contexto' });
    }
  } else if (!allowedModFrete.includes(modFrete as 0 | 2)) {
    issues.push({ campo: 'Transporte.ModalidadeFrete', encontrado: modFrete, esperado: allowedModFrete.join('|'), motivo: 'frete_fora_politica' });
  }

  const produtos = Array.isArray(payload?.Produtos) ? payload.Produtos : [];
  produtos.forEach((p: any, idx: number) => {
    const pos = `Produtos[${idx}]`;
    const cfop = Number(p?.CFOP ?? 0);
    if (![5120, 6120].includes(cfop)) {
      issues.push({ campo: `${pos}.CFOP`, encontrado: cfop || null, esperado: '5120|6120', motivo: 'cfop_fora_politica' });
    }
    if (expectedCfop && cfop !== expectedCfop) {
      issues.push({ campo: `${pos}.CFOP`, encontrado: cfop || null, esperado: expectedCfop, motivo: 'cfop_divergente_uf' });
    }
    const icmsCst = String(p?.Imposto?.ICMS?.CodSituacaoTributaria || '');
    if (icmsCst !== '102') {
      issues.push({ campo: `${pos}.Imposto.ICMS.CodSituacaoTributaria`, encontrado: icmsCst || null, esperado: '102', motivo: 'icms_cst_invalido' });
    }
    const origem = Number(p?.OrigemProduto ?? -1);
    if (origem !== 2) {
      issues.push({ campo: `${pos}.OrigemProduto`, encontrado: origem, esperado: 2, motivo: 'origem_invalida' });
    }
    const pisCst = String(p?.Imposto?.PIS?.CodSituacaoTributaria || '');
    if (pisCst !== '49') {
      issues.push({ campo: `${pos}.Imposto.PIS.CodSituacaoTributaria`, encontrado: pisCst || null, esperado: '49', motivo: 'pis_cst_invalido' });
    }
    const cofinsCst = String(p?.Imposto?.COFINS?.CodSituacaoTributaria || '');
    if (cofinsCst !== '49') {
      issues.push({ campo: `${pos}.Imposto.COFINS.CodSituacaoTributaria`, encontrado: cofinsCst || null, esperado: '49', motivo: 'cofins_cst_invalido' });
    }
    const ipi = p?.Imposto?.IPI;
    if (!ipi || typeof ipi !== 'object') {
      issues.push({ campo: `${pos}.Imposto.IPI`, encontrado: null, esperado: 'obrigatorio', motivo: 'ipi_ausente' });
      return;
    }
    const ipiCst = String(ipi?.CodSituacaoTributaria || '').trim();
    if (!ipiCst) {
      issues.push({ campo: `${pos}.Imposto.IPI.CodSituacaoTributaria`, encontrado: ipiCst || null, esperado: 'obrigatorio', motivo: 'ipi_invalido' });
    }
    const ipiCenq = String(ipi?.CodEnquadramento || ipi?.CodigoEnquadramentoLegal || '').trim();
    if (!ipiCenq) {
      issues.push({ campo: `${pos}.Imposto.IPI.CodEnquadramento`, encontrado: ipiCenq || null, esperado: 'obrigatorio', motivo: 'ipi_invalido' });
    }
  });

  return { ok: issues.length === 0, issues };
}

async function buildBrasilNfePayloadFromSnapshot(params: {
  client: ReturnType<typeof createServiceClient>;
  pedidoId: string;
}) {
  const { client, pedidoId } = params;
  const [{ data: pedido }, { data: itens }, { data: empresa }] = await Promise.all([
    client
      .from('pedidos')
      .select('id,numero,total,frete,ml_shipment_id,billing_nome,billing_documento,billing_ie,billing_tipo_pessoa,billing_endereco,pagamento_resumo,totais_snapshot,snapshot_incompleto')
      .eq('id', pedidoId)
      .maybeSingle(),
    client
      .from('pedido_itens')
      .select('titulo,quantidade,valor_unitario,valor_total_liquido,ncm,cfop_sugerido,origem_fiscal,gtin,cest,csosn,seller_sku')
      .eq('pedido_id', pedidoId),
    client
      .from('empresa')
      .select('nome,cnpj,endereco,email,uf_fiscal,cod_municipio_fiscal')
      .limit(1)
      .maybeSingle(),
  ]);

  if (!pedido) return { ok: false as const, error: 'Pedido não encontrado para montar payload local da NF-e' };
  if (!itens || itens.length === 0) {
    return {
      ok: false as const,
      error: 'Dados do pedido incompletos: itens não sincronizados. Rode a sincronização e tente novamente.',
      reason: 'pedido_sem_itens',
      pedidoItensCount: 0,
    };
  }
  if (pedido.snapshot_incompleto) {
    return {
      ok: false as const,
      error: 'Snapshot fiscal incompleto. Re-sincronize o pedido antes de emitir NF-e local.',
      reason: 'snapshot_incompleto',
      pedidoItensCount: itens.length,
    };
  }
  if (!empresa?.cnpj) return { ok: false as const, error: 'Empresa/CNPJ não configurada para emissão local' };
  const tipoAmbienteConfig = resolveBrasilNfeTipoAmbienteStrict();
  if (!tipoAmbienteConfig.ok) {
    return {
      ok: false as const,
      error: tipoAmbienteConfig.error,
      reason: 'tipo_ambiente_config_invalido',
      brasilnfeTipoAmbienteRaw: tipoAmbienteConfig.raw,
      brasilnfeTipoAmbienteInterpretado: tipoAmbienteConfig.interpreted,
    };
  }

  const doc = normalizeDocument((pedido as any).billing_documento);
  if (!(doc.length === 11 || doc.length === 14)) {
    return { ok: false as const, error: 'Documento do destinatário inválido para emissão local' };
  }

  const addr = (pedido as any).billing_endereco || {};
  const destCity = String(addr.city_name || '').trim();
  const destZip = String(addr.zip_code || '').replace(/\D/g, '');
  const billingIe = String((pedido as any).billing_ie || '').trim();
  const isCnpjDest = doc.length === 14;
  const indicadorIe = isCnpjDest ? (billingIe ? 1 : 2) : 9;
  if (isCnpjDest && !billingIe) {
    return {
      ok: false as const,
      error: 'Destinatário com CNPJ sem Inscrição Estadual (IE). Preencha a IE no pedido e sincronize novamente antes de emitir.',
    };
  }
  const emitUfDecision = resolveEmitUfFromEmpresa(empresa);
  const emitUf = emitUfDecision.emitUf;
  const destUf = String(addr.state_id || '').trim().toUpperCase() || null;
  const missingFields: string[] = [];
  if (!destUf) missingFields.push('UF');
  if (!destCity) missingFields.push('cidade');
  if (!destZip) missingFields.push('CEP');
  if (missingFields.length > 0) {
    return {
      ok: false as const,
      error: `Dados fiscais incompletos: ${missingFields.join(', ')} ausente(s). Rode a sincronização e tente novamente.`,
      emitUf,
      emitUfSource: emitUfDecision.source,
      destUf,
    };
  }
  if (!emitUf) {
    return {
      ok: false as const,
      error: 'Dados fiscais da empresa incompletos: UF do emitente ausente.',
      emitUf: null,
      emitUfSource: emitUfDecision.source,
      destUf,
    };
  }
  const cfopEsperado = expectedCfopByUf(emitUf, destUf);
  if (!cfopEsperado) {
    return {
      ok: false as const,
      error: 'Não foi possível definir CFOP por UF de emitente/destinatário.',
      emitUf,
      emitUfSource: emitUfDecision.source,
      destUf,
    };
  }
  const codMunicipioDest = String(addr.cod_municipio || '').trim()
    || (/^\d{7}$/.test(String(addr.city_id || '').trim()) ? String(addr.city_id || '').trim() : '');
  if (!codMunicipioDest) {
    return {
      ok: false as const,
      error: 'Dados fiscais incompletos: código do município (IBGE) ausente. Sincronize o pedido.',
      emitUf,
      emitUfSource: emitUfDecision.source,
      destUf,
    };
  }
  const modFreteDecision = resolveModalidadeFreteFromSnapshot(pedido);
  if (modFreteDecision.value !== 0 && modFreteDecision.value !== 2) {
    return {
      ok: false as const,
      error: 'Não foi possível resolver modFrete com segurança pelo snapshot local. Re-sincronize o pedido antes de emitir.',
      emitUf,
      emitUfSource: emitUfDecision.source,
      destUf,
    };
  }

  const produtos = (itens || []).map((it: any) => ({
    CodProdutoServico: String(it.seller_sku || it.titulo || 'ITEM'),
    NmProduto: String(it.titulo || 'Produto'),
    NCM: String(it.ncm || ''),
    CFOP: Number(cfopEsperado),
    UnidadeComercial: 'UN',
    Quantidade: Number(it.quantidade || 0),
    ValorUnitario: Number(it.valor_unitario || 0),
    ValorTotal: Number(it.valor_total_liquido || 0),
    OrigemProduto: 2,
    GTIN: it.gtin || undefined,
    CEST: it.cest || undefined,
    Imposto: {
      ICMS: { CodSituacaoTributaria: '102', AliquotaICMS: 0 },
      PIS: { CodSituacaoTributaria: '49', Aliquota: 0, BaseCalculo: 0 },
      COFINS: { CodSituacaoTributaria: '49', Aliquota: 0, BaseCalculo: 0 },
      IPI: {
        CodSituacaoTributaria: '99',
        BaseCalculo: 0,
        Aliquota: 0,
        Valor: 0,
        CodEnquadramento: '999',
      },
    },
  }));

  const payload = {
    IdentificadorInterno: `VORTEK-${String((pedido as any).numero || pedidoId)}`,
    TipoAmbiente: tipoAmbienteConfig.value,
    ModeloDocumento: 55,
    Finalidade: 1,
    NaturezaOperacao: 'VENDA DE MERCADORIA',
    IndicadorPresenca: 1,
    ConsumidorFinal: true,
    Cliente: {
      CpfCnpj: doc,
      NmCliente: String((pedido as any).billing_nome || 'Cliente'),
      IndicadorIe: indicadorIe,
      ...(isCnpjDest ? { IE: billingIe || 'ISENTO' } : {}),
      Endereco: {
        Logradouro: String(addr.street_name || 'Não informado'),
        Numero: String(addr.street_number || 'S/N'),
        Bairro: String(addr.neighborhood || 'Não informado'),
        CodMunicipio: codMunicipioDest,
        Municipio: String(addr.city_name || 'Não informado'),
        Uf: String(destUf || ''),
        Cep: String(addr.zip_code || '00000000').replace(/\D/g, ''),
      },
    },
    Produtos: produtos,
    Pagamentos: [
      {
        IndicadorPagamento: 0,
        FormaPagamento: '15',
        VlPago: Number((pedido as any).total || 0),
      },
    ],
    Transporte: {
      ModalidadeFrete: modFreteDecision.value,
    },
  };

  return {
    ok: true as const,
    payload,
    expectedCfop: cfopEsperado,
    expectedModFrete: modFreteDecision.expectedOnly ?? null,
    modFreteSource: modFreteDecision.source,
    modFreteDegraded: modFreteDecision.degraded,
    emitUf,
    emitUfSource: emitUfDecision.source,
    destUf,
  };
}

async function runDsliteCreateJob(
  jobId: string,
  pedidoId: string,
  mlOrderId: string | null,
  requestedProvider: NfeProvider,
  nfePayload?: Record<string, any> | null,
) {
  const client = createServiceClient();
  const selectedProvider = requestedProvider;
  const provider = getFiscalProvider(selectedProvider);
  const steps = initSteps();
  const syncStepIdx = steps.findIndex((s) => s.key === 'sync_order_snapshot');
  if (syncStepIdx >= 0) {
    steps[syncStepIdx] = {
      ...steps[syncStepIdx],
      status: 'loading',
      detail: 'Atualizando snapshot fiscal e itens do pedido',
      updatedAt: now(),
    };
  }
  const logEntries: any[] = [];
  let state: JobState = 'running';
  let result: any = null;
  let xml: string | null = null;
  let invoiceId: string | number | null = null;
  let danfeUrlAtual: string | null = null;
  const externalWarnings: string[] = [];

  const syncJob = async () => {
    if (state !== 'running') {
      for (const step of steps) {
        if (step.status !== 'pending') continue;
        if (step.key === 'wait_nf_authorized' && (invoiceId || xml)) {
          step.status = 'success';
          step.detail = 'Concluída implicitamente pelo fluxo (source: retorno_emissao)';
          step.updatedAt = now();
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId,
            evento: 'step_auto_close',
            respostaMl: { step: step.key, final_status: 'success', source: 'retorno_emissao' },
            statusResultante: 'auto_closed',
          });
          continue;
        }
        if (step.key === 'fetch_xml_provider' && xml) {
          step.status = 'success';
          step.detail = 'Concluída implicitamente pelo fluxo (source: retorno_emissao)';
          step.updatedAt = now();
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId,
            evento: 'step_auto_close',
            respostaMl: { step: step.key, final_status: 'success', source: 'retorno_emissao' },
            statusResultante: 'auto_closed',
          });
          continue;
        }
        step.status = 'warning';
        step.detail = 'Não executada por encerramento antecipado';
        step.updatedAt = now();
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId,
          evento: 'step_auto_close',
          respostaMl: { step: step.key, final_status: 'warning', source: 'encerramento_antecipado' },
          statusResultante: 'auto_closed',
        });
      }
    }
    const done = steps.filter((s) => s.status === 'success' || s.status === 'warning').length;
    const progress = Math.round((done / steps.length) * 100);
    const snapshot = { event: 'progress_snapshot', at: now(), state, steps, result };
    logEntries.push(snapshot);

    let dbStatus: 'rodando' | 'completo' | 'completo_parcial' | 'erro' = 'rodando';
    if (state === 'success') dbStatus = 'completo';
    if (state === 'warning') dbStatus = 'completo_parcial';
    if (state === 'error') dbStatus = 'erro';

    await client
      .from('jobs')
      .update({
        status: dbStatus,
        progresso: progress,
        total: steps.length,
        processados: done,
        log: JSON.parse(JSON.stringify(logEntries)),
        finished_at: state === 'running' ? null : now(),
      })
      .eq('id', jobId);
  };

  const setStep = async (key: string, next: StepStatus, detail?: string, error?: string) => {
    const idx = steps.findIndex((s) => s.key === key);
    if (idx < 0) return;
    steps[idx] = { ...steps[idx], status: next, detail, error, updatedAt: now() };
    await syncJob();
  };
  const completeAsSkipped = async (key: string, reason: string) => {
    await setStep(key, 'success', `Etapa pulada: ${reason}`);
  };

  try {
    await syncJob();

    let syncMlOrderId = mlOrderId ? String(mlOrderId).trim() : '';
    if (!syncMlOrderId) {
      const { data: pedidoBase } = await client
        .from('pedidos')
        .select('ml_order_id')
        .eq('id', pedidoId)
        .maybeSingle();
      syncMlOrderId = String((pedidoBase as any)?.ml_order_id || '').trim();
    }

    await setStep('sync_order_snapshot', 'loading', 'Atualizando snapshot fiscal e itens do pedido');
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId: syncMlOrderId || null,
      evento: 'sync_order_snapshot_start',
      payloadEnviado: {
        stage: 'dslite_create_job',
        sync_endpoint: '/api/sync/pedidos',
        ml_order_id: syncMlOrderId || null,
      },
      statusResultante: 'starting',
    });

    if (!syncMlOrderId) {
      const msg = 'Falha ao sincronizar pedido automaticamente. Tente novamente.';
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: null,
        evento: 'sync_order_snapshot_failed',
        respostaMl: {
          failure_reason: 'ml_order_id_ausente',
          sync_ok: false,
        },
        statusResultante: 'failed',
      });
      await setStep('sync_order_snapshot', 'error', undefined, msg);
      state = 'error';
      result = {
        stage: 'sync_order_snapshot',
        message: msg,
        error: 'Pedido sem ml_order_id para sincronização pontual.',
      };
      await syncJob();
      return;
    }

    const syncSnapshot = await runOrderSyncSnapshot(syncMlOrderId).catch((err: any) => ({
      ok: false,
      status: 500,
      data: { error: err?.message || 'Erro ao sincronizar pedido' },
      durationMs: 0,
    }));

    if (!syncSnapshot.ok) {
      const msg = 'Falha ao sincronizar pedido automaticamente. Tente novamente.';
      const failureReason = syncSnapshot.status === 401 ? 'failed_auth' : 'sync_http_error';
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: syncMlOrderId,
        evento: 'sync_order_snapshot_failed',
        respostaMl: {
          sync_http_status: syncSnapshot.status,
          sync_ok: false,
          sync_diagnostico: syncSnapshot.data?.sync_diagnostico || null,
          duration_ms: syncSnapshot.durationMs,
          failure_reason: failureReason,
          response: syncSnapshot.data || null,
        },
        statusResultante: failureReason,
      });
      await setStep('sync_order_snapshot', 'error', undefined, msg);
      state = 'error';
      result = {
        stage: 'sync_order_snapshot',
        message: msg,
        sync_http_status: syncSnapshot.status,
        sync_error: syncSnapshot.data?.erro || syncSnapshot.data?.error || null,
      };
      await syncJob();
      return;
    }

    const [{ data: pedidoSync }, { count: pedidoItensCount }] = await Promise.all([
      client
        .from('pedidos')
        .select('snapshot_incompleto,snapshot_pendencias')
        .eq('id', pedidoId)
        .maybeSingle(),
      client
        .from('pedido_itens')
        .select('*', { head: true, count: 'exact' })
        .eq('pedido_id', pedidoId),
    ]);

    const snapshotIncompletoPosSync = Boolean((pedidoSync as any)?.snapshot_incompleto);
    const itensCountPosSync = pedidoItensCount || 0;
    if (snapshotIncompletoPosSync || itensCountPosSync <= 0) {
      const msg = 'Falha ao sincronizar pedido automaticamente. Tente novamente.';
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: syncMlOrderId,
        evento: 'sync_order_snapshot_failed',
        respostaMl: {
          sync_http_status: syncSnapshot.status,
          sync_ok: true,
          sync_diagnostico: syncSnapshot.data?.sync_diagnostico || null,
          duration_ms: syncSnapshot.durationMs,
          failure_reason: snapshotIncompletoPosSync ? 'snapshot_incompleto_pos_sync' : 'pedido_sem_itens_pos_sync',
          pedido_itens_count: itensCountPosSync,
          snapshot_incompleto: snapshotIncompletoPosSync,
          snapshot_pendencias: (pedidoSync as any)?.snapshot_pendencias || null,
        },
        statusResultante: 'failed',
      });
      await setStep('sync_order_snapshot', 'error', undefined, msg);
      state = 'error';
      result = {
        stage: 'sync_order_snapshot',
        message: msg,
        pedido_itens_count: itensCountPosSync,
        snapshot_incompleto: snapshotIncompletoPosSync,
        snapshot_pendencias: (pedidoSync as any)?.snapshot_pendencias || [],
      };
      await syncJob();
      return;
    }

    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId: syncMlOrderId,
      evento: 'sync_order_snapshot_success',
      respostaMl: {
        sync_http_status: syncSnapshot.status,
        sync_ok: true,
        sync_diagnostico: syncSnapshot.data?.sync_diagnostico || null,
        duration_ms: syncSnapshot.durationMs,
        pedido_itens_count: itensCountPosSync,
        snapshot_incompleto: false,
      },
      statusResultante: 'success',
    });
    await setStep('sync_order_snapshot', 'success', `Pedido sincronizado com sucesso (${itensCountPosSync} itens)`);

    const { data: pedidoRow, error: pedidoRowError } = await client
      .from('pedidos')
      .select('nfe_xml,nfe_status,dslite_id,dslite_etiqueta_enviada,ml_shipment_id,ml_pack_id,nfe_danfe_url')
      .eq('id', pedidoId)
      .maybeSingle();
    if (pedidoRowError) {
      const isSchemaMissing = String((pedidoRowError as any)?.code || '') === '42703';
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'etiqueta_auto_pedido_lookup_failed',
        respostaMl: {
          route: '/api/dslite/pedido',
          db_code: (pedidoRowError as any)?.code || null,
          db_message: (pedidoRowError as any)?.message || null,
          db_hint: (pedidoRowError as any)?.hint || null,
          db_details: (pedidoRowError as any)?.details || null,
        },
        statusResultante: 'failed',
      });
      if (isSchemaMissing) {
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'db_schema_migration_missing_detected',
          respostaMl: {
            route: '/api/dslite/pedido',
            db_code: (pedidoRowError as any)?.code || null,
            db_message: (pedidoRowError as any)?.message || null,
          },
          statusResultante: 'migration_missing',
        });
      }
      await setStep(
        'sync_order_snapshot',
        'error',
        undefined,
        isSchemaMissing
          ? 'Migration pendente: colunas fiscais de liberação ML não encontradas.'
          : 'Falha de infraestrutura ao consultar pedido no banco.',
      );
      state = 'error';
      result = {
        stage: 'pedido_lookup',
        errorType: isSchemaMissing ? 'db_schema' : 'technical',
        db_code: (pedidoRowError as any)?.code || null,
        db_message: (pedidoRowError as any)?.message || null,
      };
      await syncJob();
      return;
    }
    const dsliteEtiquetaEnviada = Boolean(pedidoRow?.dslite_etiqueta_enviada);
    const existingShipmentId = pedidoRow?.ml_shipment_id ? String(pedidoRow.ml_shipment_id) : null;
    let resolvedShipmentId: string | null = existingShipmentId;
    danfeUrlAtual = pedidoRow?.nfe_danfe_url ? String(pedidoRow.nfe_danfe_url) : null;
    let releaseAtRaw = '';
    let releaseReasonRaw = '';
    const releaseWindowRead = await client
      .from('pedidos')
      .select('ml_fiscal_release_at,ml_fiscal_release_reason')
      .eq('id', pedidoId)
      .maybeSingle();
    if (!releaseWindowRead.error) {
      releaseAtRaw = String((releaseWindowRead.data as any)?.ml_fiscal_release_at || '').trim();
      releaseReasonRaw = String((releaseWindowRead.data as any)?.ml_fiscal_release_reason || '').trim();
    } else if (String((releaseWindowRead.error as any)?.code || '') === '42703') {
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'db_schema_migration_missing_detected',
        respostaMl: {
          route: '/api/dslite/pedido',
          db_code: (releaseWindowRead.error as any)?.code || null,
          db_message: (releaseWindowRead.error as any)?.message || null,
          missing_fields: ['ml_fiscal_release_at', 'ml_fiscal_release_reason'],
        },
        statusResultante: 'migration_missing_ignored',
      });
    }
    const releaseAt = releaseAtRaw ? new Date(releaseAtRaw) : null;
    if (releaseAt && !Number.isNaN(releaseAt.getTime()) && releaseAt.getTime() > Date.now()) {
      const releaseLabel = releaseAt.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const msg = `Pedido aguardando liberação do ML até ${releaseLabel}. Tente novamente após esse horário.`;
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        mlPackId: (pedidoRow as any)?.ml_pack_id ? String((pedidoRow as any).ml_pack_id) : null,
        evento: 'ml_fiscal_release_window_blocked',
        respostaMl: {
          release_at: releaseAt.toISOString(),
          reason: releaseReasonRaw || null,
          checked_at: new Date().toISOString(),
          now_utc: new Date().toISOString(),
          blocked_now: true,
          stage: 'dslite_pedido_precheck',
        },
        statusResultante: 'blocked',
      });
      await setStep('emit_nf_provider', 'warning', msg);
      state = 'warning';
      result = {
        stage: 'ml_release_window_blocked',
        message: msg,
      };
      await syncJob();
      return;
    }

    if (mlOrderId) {
      const { data: pedido } = await client
        .from('pedidos')
        .select('nfe_xml')
        .eq('ml_order_id', String(mlOrderId))
        .maybeSingle();
      if (pedido?.nfe_xml) xml = pedido.nfe_xml;
    }

    if (!xml && pedidoId) {
      const { data: pedido } = await client
        .from('pedidos')
        .select('nfe_xml')
        .eq('id', pedidoId)
        .maybeSingle();
      if (pedido?.nfe_xml) xml = pedido.nfe_xml;
    }

    let nfeStatusAtual = pedidoRow?.nfe_status || null;
    if (xml && !isNfeAuthorizedStatus(nfeStatusAtual) && selectedProvider === 'brasilnfe') {
      const chaveXml = extrairChaveAcessoDoXml(xml);
      const cStatXml = extrairTagDoXml(xml, 'cStat');
      const xMotivoXml = extrairTagDoXml(xml, 'xMotivo');
      const tpAmbTag = extrairTagDoXml(xml, 'tpAmb');
      const tpAmbXml: 1 | 2 | null = tpAmbTag === '1' ? 1 : (tpAmbTag === '2' ? 2 : null);

      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'nfe_local_consistencia_check',
        respostaMl: {
          nfe_status_local_antes: nfeStatusAtual,
          chave_xml: chaveXml,
          tpAmb_xml: tpAmbXml,
          tpAmb_xml_recebido: tpAmbTag,
          cStat_xml: cStatXml,
          xMotivo_xml: xMotivoXml,
        },
        statusResultante: 'checking',
      });

      try {
        const clearGhostNf = async () => {
          await client
            .from('pedidos')
            .update({
              nfe_xml: null,
              nfe_chave: null,
              nfe_status: null,
              nfe_external_id: null,
              nfe_protocolo: null,
              nota_fiscal_numero: null,
              nfe_danfe_url: null,
              nfe_cfop: null,
              nfe_last_sync_at: now(),
            } as any)
            .eq('id', pedidoId);
          xml = null;
          nfeStatusAtual = null;
        };

        if (cStatXml === '100' && chaveXml && tpAmbXml) {
          const check = await checkBrasilNfeChaveExists(chaveXml, tpAmbXml);
          if (check.exists) {
            await client
              .from('pedidos')
              .update({
                nfe_status: 'authorized',
                nfe_chave: chaveXml,
                nfe_provider: 'brasilnfe',
                nfe_last_sync_at: now(),
              } as any)
              .eq('id', pedidoId);
            nfeStatusAtual = 'authorized';
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'nfe_local_autocorrecao_status',
              respostaMl: {
                nfe_status_local_antes: pedidoRow?.nfe_status || null,
                chave_xml: chaveXml,
                tpAmb_xml: tpAmbXml,
                tpAmb_xml_recebido: tpAmbTag,
                cStat_xml: cStatXml,
                found_in_brasilnfe: true,
                acao: 'autocorrigir',
                check_raw: check.raw,
              },
              statusResultante: 'autocorrected',
            });
          } else {
            await clearGhostNf();
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'nfe_local_cleanup_ghost_xml',
              respostaMl: {
                nfe_status_local_antes: pedidoRow?.nfe_status || null,
                chave_xml: chaveXml,
                tpAmb_xml: tpAmbXml,
                tpAmb_xml_recebido: tpAmbTag,
                cStat_xml: cStatXml,
                found_in_brasilnfe: false,
                acao: 'limpar_e_reemitir',
                check_raw: check.raw,
              },
              statusResultante: 'cleaned',
            });
          }
        } else {
          await clearGhostNf();
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'nfe_local_cleanup_ghost_xml',
            respostaMl: {
              nfe_status_local_antes: pedidoRow?.nfe_status || null,
              chave_xml: chaveXml,
              tpAmb_xml: tpAmbXml,
              tpAmb_xml_recebido: tpAmbTag,
              cStat_xml: cStatXml,
              found_in_brasilnfe: false,
              acao: 'limpar_e_reemitir',
              motivo: 'xml_sem_autorizacao_ou_sem_chave',
            },
            statusResultante: 'cleaned',
          });
        }
      } catch (consistencyErr: any) {
        const msg = 'Inconsistência fiscal local detectada. Falha ao reconciliar com Brasil NFe. Tente novamente.';
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'pre_validacao',
          respostaMl: {
            motivo: 'falha_reconciliar_nfe_local',
            nfe_status: pedidoRow?.nfe_status || null,
            error: consistencyErr?.message || String(consistencyErr),
          },
          statusResultante: 'blocked_nfe_consistency',
        });
        await setStep('emit_nf_provider', 'error', undefined, msg);
        state = 'error';
        result = {
          stage: 'pre_validacao_nfe_consistencia',
          nfe_status: pedidoRow?.nfe_status || null,
          message: msg,
        };
        await syncJob();
        return;
      }
    }

    if (xml && !isNfeAuthorizedStatus(nfeStatusAtual)) {
      const msg = `NF local não autorizada (status: ${nfeStatusAtual || 'desconhecido'}). Cancele/regularize na origem fiscal (${selectedProvider}), gere novo XML autorizado e reprocese.`;
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'pre_validacao',
        respostaMl: {
          motivo: 'nfe_nao_autorizada',
          nfe_status: nfeStatusAtual,
        },
        statusResultante: 'blocked_nfe_status',
      });
      await setStep('emit_nf_provider', 'error', undefined, msg);
      state = 'error';
      result = {
        stage: 'pre_validacao_nfe_status',
        nfe_status: nfeStatusAtual,
        message: msg,
      };
      await syncJob();
      return;
    }

    if (selectedProvider === 'brasilnfe' && xml) {
      const xmlAmbienteLocalCheck = validarXmlNfeProducao(xml);
      if (!xmlAmbienteLocalCheck.ok) {
        const tipoAmbienteEnviado = getConfiguredTipoAmbienteValue();
        const limpezaPayload = {
          nfe_xml: null,
          nfe_status: null,
          nfe_chave: null,
          nfe_external_id: null,
          nfe_protocolo: null,
          nota_fiscal_numero: null,
          nfe_danfe_url: null,
          nfe_cfop: null,
          nfe_last_sync_at: now(),
        } as any;

        const { error: cleanupErr } = await client
          .from('pedidos')
          .update(limpezaPayload)
          .eq('id', pedidoId);

        if (cleanupErr) {
          const msg = 'NF local em homologação detectada, mas falhou a auto-remediação do snapshot fiscal. Tente novamente.';
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'nfe_homologacao_bloqueada',
            payloadEnviado: {
              reason: 'nf_xml_not_production_local_snapshot_cleanup_failed',
              tipo_ambiente_enviado: tipoAmbienteEnviado,
            },
            respostaMl: {
              tpAmb_xml_recebido: xmlAmbienteLocalCheck.tpAmb,
              destinatario_xml: xmlAmbienteLocalCheck.destinatarioNome,
              marcador_homologacao_detectado: xmlAmbienteLocalCheck.marcadorHomologacao,
              db_error: cleanupErr.message || null,
            },
            statusResultante: 'blocked_cleanup_failed',
          });
          await setStep('emit_nf_provider', 'error', undefined, msg);
          state = 'error';
          result = {
            stage: 'pre_validacao_ambiente_nf_cleanup',
            tpAmb_xml_recebido: xmlAmbienteLocalCheck.tpAmb,
            destinatario_xml: xmlAmbienteLocalCheck.destinatarioNome,
            marker: xmlAmbienteLocalCheck.marcadorHomologacao,
            message: msg,
          };
          await syncJob();
          return;
        }

        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'nfe_homologacao_auto_remediada',
          payloadEnviado: {
            reason: 'nf_xml_not_production_local_snapshot_reissue',
            tipo_ambiente_enviado: tipoAmbienteEnviado,
          },
          respostaMl: {
            tpAmb_xml_recebido: xmlAmbienteLocalCheck.tpAmb,
            destinatario_xml: xmlAmbienteLocalCheck.destinatarioNome,
            marcador_homologacao_detectado: xmlAmbienteLocalCheck.marcadorHomologacao,
            acao: 'snapshot_nfe_limpo_e_reemissao_no_mesmo_fluxo',
          },
          statusResultante: 'auto_remediated',
        });

        xml = null;
        nfeStatusAtual = null;
        danfeUrlAtual = null;
        await setStep('emit_nf_provider', 'loading', 'NF local em homologação detectada; limpando snapshot e reemitindo em produção');
      }
    }

    if (xml) {
      await completeAsSkipped('emit_nf_provider', 'NF já disponível no banco local');
      await completeAsSkipped('wait_nf_authorized', 'Autorização já refletida no XML local');
      await completeAsSkipped('fetch_xml_provider', 'XML já existente no banco local');
    } else {
      await setStep('emit_nf_provider', 'loading', `Provedor: ${selectedProvider}`);
      let payloadToEmit = nfePayload || null;
      let strictExpectedCfop: 5120 | 6120 | null = null;
      let strictExpectedModFrete: 0 | 2 | null = null;
      let modFreteSource: 'snapshot' | 'ml_frete' | 'regra_padrao' | null = null;
      let modFreteDegraded = false;
      let emitUfValue: string | null = null;
      let destUfValue: string | null = null;
      let emitUfSource: 'empresa.uf_fiscal' | 'endereco_fallback' | 'missing' | null = null;
      if (!payloadToEmit && selectedProvider === 'brasilnfe') {
        const built = await buildBrasilNfePayloadFromSnapshot({ client, pedidoId });
        if (!built.ok) {
          const { data: pedidoDiag } = await client
            .from('pedidos')
            .select('ml_order_id,snapshot_pendencias,billing_endereco')
            .eq('id', pedidoId)
            .maybeSingle();
          const { count: pedidoItensCount } = await client
            .from('pedido_itens')
            .select('*', { head: true, count: 'exact' })
            .eq('pedido_id', pedidoId);
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : String((pedidoDiag as any)?.ml_order_id || ''),
            evento: 'payload_validacao_bloqueio',
            payloadEnviado: {
              provider: selectedProvider,
              tipo_ambiente_enviado: Number((built as any)?.payload?.TipoAmbiente ?? 0) || null,
              motivo: (built as any)?.reason || null,
              pedido_itens_count: pedidoItensCount || 0,
              emit_uf_source: (built as any)?.emitUfSource || null,
              emit_uf_value: (built as any)?.emitUf || null,
              dest_uf_value: (built as any)?.destUf || String((pedidoDiag as any)?.billing_endereco?.state_id || '').trim().toUpperCase() || null,
              brasilnfe_tipo_ambiente_raw: (built as any)?.brasilnfeTipoAmbienteRaw ?? null,
              tipo_ambiente_interpretado: (built as any)?.brasilnfeTipoAmbienteInterpretado ?? null,
              expected: 1,
              missing_fields: {
                state_id: !String((pedidoDiag as any)?.billing_endereco?.state_id || '').trim(),
                city_name: !String((pedidoDiag as any)?.billing_endereco?.city_name || '').trim(),
                zip_code: !String((pedidoDiag as any)?.billing_endereco?.zip_code || '').replace(/\D/g, ''),
                cod_municipio: !String((pedidoDiag as any)?.billing_endereco?.cod_municipio || '').trim()
                  && !/^\d{7}$/.test(String((pedidoDiag as any)?.billing_endereco?.city_id || '').trim()),
              },
              billing_endereco_resumido: (pedidoDiag as any)?.billing_endereco || null,
            },
            respostaMl: {
              snapshot_pendencias: (pedidoDiag as any)?.snapshot_pendencias || [],
              error: built.error,
            },
            statusResultante: 'blocked_snapshot_readiness',
          });
          if ((built as any)?.reason === 'tipo_ambiente_config_invalido') {
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : String((pedidoDiag as any)?.ml_order_id || ''),
              evento: 'brasilnfe_tipo_ambiente_invalido',
              payloadEnviado: {
                brasilnfe_tipo_ambiente_raw: (built as any)?.brasilnfeTipoAmbienteRaw ?? null,
                tipo_ambiente_interpretado: (built as any)?.brasilnfeTipoAmbienteInterpretado ?? null,
                expected: 1,
              },
              respostaMl: {
                error: built.error,
                acao_recomendada: 'Definir BRASILNFE_TIPO_AMBIENTE=1 no runtime e redeploy',
              },
              statusResultante: 'blocked_invalid_env_config',
            });
          }
          if (String((built as any)?.emitUfSource || '') === 'missing') {
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : String((pedidoDiag as any)?.ml_order_id || ''),
              evento: 'empresa_fiscal_config_missing',
              respostaMl: {
                campo: 'empresa.uf_fiscal',
                emit_uf_source: 'missing',
                emit_uf_value: null,
                dest_uf_value: (built as any)?.destUf || null,
                error: built.error,
              },
              statusResultante: 'missing_emit_uf',
            });
          }
          await setStep('emit_nf_provider', 'error', undefined, built.error);
          state = 'error';
          await syncJob();
          return;
        }
        payloadToEmit = built.payload;
        strictExpectedCfop = built.expectedCfop;
        strictExpectedModFrete = built.expectedModFrete;
        modFreteSource = built.modFreteSource;
        modFreteDegraded = built.modFreteDegraded;
        emitUfValue = built.emitUf || null;
        destUfValue = built.destUf || null;
        emitUfSource = built.emitUfSource || null;
        if (built.emitUfSource === 'endereco_fallback') {
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'empresa_uf_fallback_endereco',
            respostaMl: {
              campo: 'empresa.uf_fiscal',
              emit_uf_source: built.emitUfSource,
              emit_uf_value: built.emitUf,
              dest_uf_value: built.destUf,
            },
            statusResultante: 'warning',
          });
        }
      }
      if (selectedProvider === 'brasilnfe' && STRICT_NFE_VALIDATION) {
        const strict = validateNfePayloadStrict(payloadToEmit, strictExpectedCfop, strictExpectedModFrete, [0, 2]);
        if (!strict.ok) {
          const msg = `Bloqueado pela validação fiscal estrita: ${strict.issues.map(i => `${i.campo}=${i.encontrado} (esperado ${i.esperado})`).join(' | ')}`;
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'payload_validacao_bloqueio',
            payloadEnviado: {
              provider: selectedProvider,
              strict_nfe_validation: true,
              tipo_ambiente_enviado: Number(payloadToEmit?.TipoAmbiente ?? 0) || null,
              emit_uf_source: emitUfSource,
              emit_uf_value: emitUfValue,
              dest_uf_value: destUfValue,
              modfrete_encontrado: Number(payloadToEmit?.Transporte?.ModalidadeFrete ?? -1),
              modfrete_esperado: strictExpectedModFrete,
              allowed_modfrete: [0, 2],
              fonte_decisao_modfrete: modFreteSource,
              modo_degradado: modFreteDegraded,
            },
            respostaMl: {
              issues: strict.issues,
            },
            statusResultante: 'blocked_payload_validation',
          });
          await setStep('emit_nf_provider', 'error', undefined, msg);
          state = 'error';
          result = {
            stage: 'payload_validacao_bloqueio',
            issues: strict.issues,
            message: msg,
          };
          await syncJob();
          return;
        }
      }
      if (selectedProvider === 'brasilnfe') {
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'envio',
          payloadEnviado: {
            provider: selectedProvider,
            tipo_ambiente_enviado: Number(payloadToEmit?.TipoAmbiente ?? 0) || null,
            emit_uf_source: emitUfSource,
            emit_uf_value: emitUfValue,
            dest_uf_value: destUfValue,
            modfrete_encontrado: Number(payloadToEmit?.Transporte?.ModalidadeFrete ?? -1),
            modfrete_esperado: strictExpectedModFrete,
            allowed_modfrete: [0, 2],
            fonte_decisao_modfrete: modFreteSource,
            modo_degradado: modFreteDegraded,
          },
          statusResultante: 'sending',
        });
      }
      let emissao = await provider.emitirNota({
        pedidoId,
        mlOrderId: String(mlOrderId),
        nfePayload: payloadToEmit,
      });
      let emissaoReaproveitada = false;
      if (!emissao.ok) {
        const duplicate = parseBrasilNfeDuplicateIdentifier(emissao.errorDetails || null);
        const identificadorInterno = duplicate.identificadorInterno
          || String((payloadToEmit as any)?.IdentificadorInterno || '').trim()
          || null;
        if (selectedProvider === 'brasilnfe' && duplicate.isDuplicateIdentifier && identificadorInterno) {
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'brasilnfe_duplicate_identifier_detected',
            respostaMl: {
              identificador_interno: identificadorInterno,
              provider_error_raw: emissao.errorDetails || null,
            },
            statusResultante: 'detected',
          });

          const found = await buscarNotaBrasilNfePorIdentificadorInterno({ identificadorInterno });
          const notaExistente = found.ok && found.nota?.chave ? found.nota : null;

          if (!notaExistente) {
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'retorno_ml',
              payloadEnviado: {
                provider: selectedProvider,
                stage: 'emitir_nota',
                tipo_ambiente_enviado: Number(payloadToEmit?.TipoAmbiente ?? 0) || null,
                modfrete_encontrado: Number(payloadToEmit?.Transporte?.ModalidadeFrete ?? -1),
                modfrete_esperado: strictExpectedModFrete,
                allowed_modfrete: [0, 2],
                fonte_decisao_modfrete: modFreteSource,
                modo_degradado: modFreteDegraded,
              },
              respostaMl: {
                error: emissao.error || null,
                details: emissao.errorDetails || null,
                duplicate_identifier: true,
                identificador_interno: identificadorInterno,
                duplicate_lookup_error: found.error || 'NF existente não localizada por identificador interno',
              },
              statusResultante: 'erro_emissao_provider',
            });
            await setStep(
              'emit_nf_provider',
              'error',
              undefined,
              'NF duplicada detectada, mas não foi possível localizar a nota existente para reutilizar.',
            );
            state = 'error';
            await syncJob();
            return;
          }

          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'brasilnfe_duplicate_note_found',
            respostaMl: {
              identificador_interno: identificadorInterno,
              nfe_chave_encontrada: notaExistente.chave,
              nfe_numero_encontrado: notaExistente.numero,
              nfe_status_encontrado: notaExistente.status,
              selecao_regra: 'mais_recente_autorizada',
            },
            statusResultante: 'found',
          });

          const xmlByKey = await obterXmlBrasilNfePorChave(notaExistente.chave);
          if (!xmlByKey.ok || !xmlByKey.xml) {
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'retorno_ml',
              payloadEnviado: {
                provider: selectedProvider,
                stage: 'emitir_nota',
                tipo_ambiente_enviado: Number(payloadToEmit?.TipoAmbiente ?? 0) || null,
                modfrete_encontrado: Number(payloadToEmit?.Transporte?.ModalidadeFrete ?? -1),
                modfrete_esperado: strictExpectedModFrete,
                allowed_modfrete: [0, 2],
                fonte_decisao_modfrete: modFreteSource,
                modo_degradado: modFreteDegraded,
              },
              respostaMl: {
                error: `NF já existente, porém falhou ao baixar XML por chave ${notaExistente.chave}`,
                details: {
                  duplicate_identifier: true,
                  identificador_interno: identificadorInterno,
                  nfe_chave_encontrada: notaExistente.chave,
                  xml_error: xmlByKey.error || null,
                },
              },
              statusResultante: 'erro_emissao_provider',
            });
            await setStep(
              'emit_nf_provider',
              'error',
              undefined,
              `NF já existente encontrada (${notaExistente.chave}), mas não foi possível baixar o XML para continuar.`,
            );
            state = 'error';
            await syncJob();
            return;
          }

          const xmlFoundCheck = validarXmlNfeProducao(xmlByKey.xml);
          if (xmlFoundCheck.ok) {
            const numeroXml = extrairTagDoXml(xmlByKey.xml, 'nNF');
            const cfopXml = extractCfopsFromXml(xmlByKey.xml)[0] || null;
            emissao.ok = true;
            emissao.status = 'already_issued';
            emissao.chave = notaExistente.chave;
            emissao.protocolo = notaExistente.numeroProtocolo || null;
            emissao.numero = numeroXml || (notaExistente.numero !== null ? String(notaExistente.numero) : null);
            emissao.xml = xmlByKey.xml;
            emissao.cfop = cfopXml;
            emissao.externalId = notaExistente.numeroProtocolo || undefined;
            emissao.error = undefined;
            emissao.errorDetails = null;
            emissaoReaproveitada = true;

            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'brasilnfe_duplicate_user_decision_use_existing',
              respostaMl: {
                identificador_interno: identificadorInterno,
                nfe_chave_encontrada: notaExistente.chave,
                decision_source: 'automatic',
              },
              statusResultante: 'auto_use_existing',
            });
          } else {
            const identificadorReemissao = buildReissueIdentifier(identificadorInterno);
            const payloadReemissao: Record<string, any> = {
              ...(payloadToEmit as Record<string, any>),
              IdentificadorInterno: identificadorReemissao,
            };
            const tipoAmbienteEnviado = Number(payloadReemissao.TipoAmbiente ?? 0) || getConfiguredTipoAmbienteValue();

            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'brasilnfe_duplicate_user_decision_reissue',
              payloadEnviado: {
                tipo_ambiente_enviado: tipoAmbienteEnviado,
                identificador_interno_original: identificadorInterno,
                identificador_interno_reemissao: identificadorReemissao,
                nfe_chave_encontrada: notaExistente.chave,
              },
              respostaMl: {
                tpAmb_xml_recebido: xmlFoundCheck.tpAmb,
                destinatario_xml: xmlFoundCheck.destinatarioNome,
                marcador_homologacao_detectado: xmlFoundCheck.marcadorHomologacao,
                reason: 'duplicate_note_xml_not_production',
              },
              statusResultante: 'auto_reissue',
            });

            emissao = await provider.emitirNota({
              pedidoId,
              mlOrderId: String(mlOrderId),
              nfePayload: payloadReemissao,
            });
            emissaoReaproveitada = false;
          }
        }
      }
      if (!emissao.ok) {
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'retorno_ml',
          payloadEnviado: {
            provider: selectedProvider,
            stage: 'emitir_nota',
            tipo_ambiente_enviado: Number(payloadToEmit?.TipoAmbiente ?? 0) || null,
            modfrete_encontrado: Number(payloadToEmit?.Transporte?.ModalidadeFrete ?? -1),
            modfrete_esperado: strictExpectedModFrete,
            allowed_modfrete: [0, 2],
            fonte_decisao_modfrete: modFreteSource,
            modo_degradado: modFreteDegraded,
          },
          respostaMl: {
            error: emissao.error || null,
            details: emissao.errorDetails || null,
          },
          statusResultante: 'erro_emissao_provider',
        });
        await setStep('emit_nf_provider', 'error', undefined, emissao.error || `Falha ao emitir NF em ${selectedProvider}`);
        state = 'error';
        await syncJob();
        return;
      }

      if (selectedProvider === 'brasilnfe' && emissao.xml) {
        const xmlPostEmissaoCheck = validarXmlNfeProducao(emissao.xml);
        if (!xmlPostEmissaoCheck.ok) {
          const tipoAmbienteEnviado = Number(payloadToEmit?.TipoAmbiente ?? 0) || getConfiguredTipoAmbienteValue();
          const msg = xmlPostEmissaoCheck.message
            || 'NF-e retornada em homologação na emissão. Persistência bloqueada; emissão em produção é obrigatória.';
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'nfe_homologacao_bloqueada',
            payloadEnviado: {
              reason: 'provider_xml_not_production_after_emission',
              tipo_ambiente_enviado: tipoAmbienteEnviado,
              nfe_chave_retorno: emissao.chave || null,
              nfe_status_retorno: emissao.status || null,
            },
            respostaMl: {
              tpAmb_xml_recebido: xmlPostEmissaoCheck.tpAmb,
              destinatario_xml: xmlPostEmissaoCheck.destinatarioNome,
              marcador_homologacao_detectado: xmlPostEmissaoCheck.marcadorHomologacao,
            },
            statusResultante: 'blocked_after_emission',
          });
          await setStep('emit_nf_provider', 'error', undefined, msg);
          state = 'error';
          result = {
            stage: 'pos_emissao_ambiente_nf',
            tpAmb_xml_recebido: xmlPostEmissaoCheck.tpAmb,
            destinatario_xml: xmlPostEmissaoCheck.destinatarioNome,
            marker: xmlPostEmissaoCheck.marcadorHomologacao,
            message: msg,
          };
          await syncJob();
          return;
        }
      }

      await setStep(
        'emit_nf_provider',
        'success',
        emissaoReaproveitada
          ? 'NF já emitida anteriormente (reutilizada)'
          : (emissao.status === 'already_issued' ? 'NF já emitida anteriormente' : 'NF emitida com sucesso'),
      );
      const danfeInicial = emissao.danfeUrl || null;
      if (danfeInicial) danfeUrlAtual = danfeInicial;

      await client
        .from('pedidos')
        .update({
          nfe_provider: selectedProvider,
          nfe_external_id: emissao.externalId || null,
          nfe_last_sync_at: now(),
          nfe_status: emissao.status || undefined,
          nfe_chave: emissao.chave || undefined,
          nfe_protocolo: emissao.protocolo || undefined,
          nota_fiscal_numero: emissao.numero || undefined,
          nfe_danfe_url: danfeInicial || undefined,
          ...(emissao.xml ? { nfe_xml: emissao.xml } : {}),
          ...(emissao.cfop ? { nfe_cfop: emissao.cfop } : {}),
        } as any)
        .eq('id', pedidoId);

      if (emissao.xml) xml = emissao.xml;
      if (emissao.externalId) invoiceId = emissao.externalId;
      if (invoiceId) {
        await setStep('wait_nf_authorized', 'success', 'Autorização já disponível no retorno da emissão');
      } else if (emissaoReaproveitada) {
        await setStep('wait_nf_authorized', 'success', 'Autorização já disponível na NF reutilizada');
      }
      if (xml) {
        await setStep('fetch_xml_provider', 'success', 'XML já retornado pelo provedor na emissão');
      }

      if ((!xml || !invoiceId) && !emissaoReaproveitada) {
        await setStep('wait_nf_authorized', 'loading');
        const started = Date.now();
        while (Date.now() - started < WAIT_AUTH_TIMEOUT_MS) {
          const lookupRef = String(invoiceId || emissao.externalId || '');
          if (!lookupRef) break;
          const invoice = await provider.consultarNota(lookupRef);
          if (invoice.ok && invoice.externalId && String(invoice.status || '').toLowerCase().includes('author')) {
            invoiceId = invoice.externalId;
            await setStep('wait_nf_authorized', 'success', `NF autorizada (invoice: ${String(invoiceId)})`);
            break;
          }
          await sleep(WAIT_AUTH_INTERVAL_MS);
        }
      }

      if (!invoiceId) {
        await setStep('wait_nf_authorized', 'warning', `NF emitida, aguardando autorização/propagação no provedor ${selectedProvider}`);
        state = 'warning';
        result = {
          message: `NF emitida, aguardando autorização/propagação no provedor ${selectedProvider}. Reprocessar em instantes.`,
          stage: 'wait_nf_authorized',
        };
        await syncJob();
        return;
      }

      if (!xml) {
        await setStep('fetch_xml_provider', 'loading');
        let lastXmlError = 'Falha ao baixar XML';
        for (const delay of XML_RETRY_DELAYS_MS) {
          if (delay > 0) await sleep(delay);
          const xmlFetch = await provider.obterXml(String(invoiceId));
          if (xmlFetch.xml) {
            if (selectedProvider === 'brasilnfe') {
              const xmlPostFetchCheck = validarXmlNfeProducao(xmlFetch.xml);
              if (!xmlPostFetchCheck.ok) {
                const tipoAmbienteEnviado = getConfiguredTipoAmbienteValue();
                const msg = xmlPostFetchCheck.message
                  || 'NF-e retornada em homologação no download do XML. Persistência bloqueada; emissão em produção é obrigatória.';
                await registrarEventoNfAuditoria({
                  pedidoId,
                  mlOrderId: mlOrderId ? String(mlOrderId) : null,
                  evento: 'nfe_homologacao_bloqueada',
                  payloadEnviado: {
                    reason: 'provider_xml_not_production_after_fetch',
                    tipo_ambiente_enviado: tipoAmbienteEnviado,
                    invoice_id: String(invoiceId),
                  },
                  respostaMl: {
                    tpAmb_xml_recebido: xmlPostFetchCheck.tpAmb,
                    destinatario_xml: xmlPostFetchCheck.destinatarioNome,
                    marcador_homologacao_detectado: xmlPostFetchCheck.marcadorHomologacao,
                  },
                  statusResultante: 'blocked_after_fetch',
                });
                await setStep('fetch_xml_provider', 'error', undefined, msg);
                state = 'error';
                result = {
                  stage: 'pos_fetch_xml_ambiente_nf',
                  tpAmb_xml_recebido: xmlPostFetchCheck.tpAmb,
                  destinatario_xml: xmlPostFetchCheck.destinatarioNome,
                  marker: xmlPostFetchCheck.marcadorHomologacao,
                  message: msg,
                };
                await syncJob();
                return;
              }
            }
            xml = xmlFetch.xml;
            await client
              .from('pedidos')
              .update({
                nfe_xml: xmlFetch.xml,
                nfe_provider: selectedProvider,
                nfe_external_id: String(invoiceId),
                nfe_last_sync_at: now(),
                nfe_cfop: extractCfopsFromXml(xmlFetch.xml)[0] || null,
              } as any)
              .eq('id', pedidoId);
            await setStep('fetch_xml_provider', 'success', `XML baixado (${xmlFetch.xml.length} chars)`);
            break;
          }
          lastXmlError = xmlFetch.error || lastXmlError;
        }

        if (!xml) {
          await setStep('fetch_xml_provider', 'error', undefined, lastXmlError);
          state = 'error';
          await syncJob();
          return;
        }
      }

      if (selectedProvider === 'brasilnfe' && !danfeInicial && invoiceId) {
        const danfe = await provider.obterDanfe(String(invoiceId));
        if (danfe.url) {
            await client
              .from('pedidos')
              .update({
                nfe_danfe_url: danfe.url,
                nfe_last_sync_at: now(),
              } as any)
              .eq('id', pedidoId);
            danfeUrlAtual = danfe.url;
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId,
            evento: 'download_danfe',
            respostaMl: { source: 'provider_obterDanfe', success: true },
            statusResultante: 'success',
          });
        } else {
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId,
            evento: 'download_danfe',
            respostaMl: { source: 'provider_obterDanfe', success: false, error: danfe.error || null },
            statusResultante: 'warning',
          });
        }
      }
    }

    await setStep('validate_fiscal_prechecks', 'loading', 'Validando vínculo fiscal no ML e pré-checagens DSLite');

    if (selectedProvider === 'brasilnfe' && mlOrderId) {
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: String(mlOrderId),
        evento: 'ml_fiscal_emission_skipped_policy',
        payloadEnviado: {
          provider: selectedProvider,
          observacao: 'Emissão e consulta fiscal de invoice no ML desativadas por política. Fluxo fiscal usa apenas Brasil NFe.',
          motivo: 'emissao_ml_desativada_por_politica',
        },
        statusResultante: 'skipped_policy',
      });
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: String(mlOrderId),
        evento: 'brasilnfe_source_enforced',
        respostaMl: {
          provider: selectedProvider,
          regra: 'brasilnfe_only',
        },
        statusResultante: 'enforced',
      });
    }

    if (selectedProvider === 'brasilnfe' && mlOrderId && xml) {
      const shipmentResolutionForInvoice = await resolveShipmentIdWithWait({
        client,
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        initialShipmentId: resolvedShipmentId,
        stage: 'invoice_upload',
      });
      resolvedShipmentId = shipmentResolutionForInvoice.shipmentId;
      const shipmentId = String(resolvedShipmentId || '').trim();
      const fiscalKey = extrairChaveAcessoDoXml(xml);
      const invoiceNumber = extrairTagDoXml(xml, 'nNF');
      const invoiceSerie = extrairTagDoXml(xml, 'serie') || '1';
      const invoiceDate = parseInvoiceDateFromXml(xml) || new Date().toISOString();
      const invoiceAmount = parseInvoiceAmountFromXml(xml);
      const cfop = extractCfopsFromXml(xml)[0] || String((pedidoRow as any)?.nfe_cfop || '').trim() || undefined;

      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: String(mlOrderId),
        evento: 'ml_invoice_data_upload_start',
        payloadEnviado: {
          provider: selectedProvider,
          ml_shipment_id: shipmentId || null,
          endpoint_ml: '/shipments/{shipment_id}/invoice_data?siteId=MLB',
          has_xml: true,
          has_fiscal_key: Boolean(fiscalKey),
        },
        statusResultante: 'starting',
      });

      if (!shipmentId || !fiscalKey || !invoiceNumber || !(Number(invoiceAmount) > 0)) {
        const warn = 'NF Brasil NFe sem dados mínimos para vincular no shipment do ML';
        externalWarnings.push(`Vínculo fiscal ML: ${warn}`);
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: String(mlOrderId),
          evento: 'ml_invoice_data_upload_failed',
          respostaMl: {
            ml_shipment_id: shipmentId || null,
            fiscal_key: fiscalKey || null,
            invoice_number: invoiceNumber || null,
            invoice_amount: invoiceAmount ?? null,
            reason: 'missing_required_fields',
            error: warn,
          },
          statusResultante: 'failed',
        });
      } else {
        const uploadRes = await upsertInvoiceDataMLByShipment({
          shipmentId,
          fiscalKey,
          invoiceNumber,
          invoiceSerie,
          invoiceDate,
          invoiceAmount: Number(invoiceAmount),
          nfeXml: xml,
          cfop,
        });

        for (const [idx, attempt] of (uploadRes.attempts || []).entries()) {
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: String(mlOrderId),
            evento: 'ml_invoice_data_upload_attempt',
            respostaMl: {
              ml_shipment_id: shipmentId,
              method: attempt.method,
              endpoint: attempt.endpoint,
              content_type: attempt.contentType,
              status_http: attempt.statusCode ?? null,
              error_code: attempt.code || null,
              error_message: attempt.message || null,
              attempt_index: idx + 1,
              attempts_total: (uploadRes.attempts || []).length,
              content_mode_selected: uploadRes.contentMode || null,
            },
            statusResultante: 'attempt',
          });
        }

        if (!uploadRes.ok) {
          const warn = uploadRes.error || 'Falha ao vincular NF Brasil NFe no shipment do ML';
          externalWarnings.push(`Vínculo fiscal ML: ${warn}`);
          if (uploadRes.errorCode === 'ml_fiscal_endpoint_blocked') {
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: String(mlOrderId),
              evento: 'ml_fiscal_runtime_call_denied',
              respostaMl: {
                endpoint: uploadRes.endpoint || null,
                method: uploadRes.method || uploadRes.lastMethodTried || null,
                blocked_reason: 'fiscal_ml_desativado_por_politica',
              },
              statusResultante: 'denied',
            });
          }
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: String(mlOrderId),
            evento: 'ml_invoice_data_upload_failed',
            respostaMl: {
              endpoint_ml: uploadRes.endpoint || null,
              method: uploadRes.method || null,
              last_method_tried: uploadRes.lastMethodTried || null,
              content_mode: uploadRes.contentMode || null,
              status_http: uploadRes.statusCode || null,
              error_code: uploadRes.errorCode || null,
              error: uploadRes.error || null,
              reason: uploadRes.reason || null,
              attempts: uploadRes.attempts || [],
            },
            statusResultante: 'failed',
          });
        } else {
          const verify = await consultarInvoiceDataPorShipmentML(shipmentId, 'MLB');
          const mlFiscalKey = verify.ok ? String(verify.data?.fiscal_key || '').trim() : '';
          if (verify.ok && mlFiscalKey && mlFiscalKey === fiscalKey) {
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: String(mlOrderId),
              evento: 'ml_invoice_data_upload_success',
              respostaMl: {
                endpoint_ml: uploadRes.endpoint || null,
                method: uploadRes.method || null,
                last_method_tried: uploadRes.lastMethodTried || null,
                status_http: uploadRes.statusCode || null,
                fiscal_key_local: fiscalKey,
                fiscal_key_ml: mlFiscalKey,
                reason: uploadRes.reason || null,
                content_mode_selected: uploadRes.contentMode || null,
                attempts: uploadRes.attempts || [],
              },
              statusResultante: 'success',
            });
          } else {
            const warn = 'Não foi possível confirmar o vínculo fiscal da NF no shipment do ML';
            externalWarnings.push(`Vínculo fiscal ML: ${warn}`);
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: String(mlOrderId),
              evento: 'ml_invoice_data_upload_failed',
              respostaMl: {
                endpoint_ml: uploadRes.endpoint || null,
                method: uploadRes.method || null,
                status_http: uploadRes.statusCode || null,
                fiscal_key_local: fiscalKey,
                fiscal_key_ml: mlFiscalKey || null,
                verify_error: verify.error || null,
              },
              statusResultante: 'failed_verify',
            });
          }
        }
      }
    }

    const xmlAmbienteCheck = validarXmlNfeProducao(xml);
    if (!xmlAmbienteCheck.ok) {
      const msg = xmlAmbienteCheck.message || 'NF-e inválida para criação na DSLite.';
      const tipoAmbienteEnviado = getConfiguredTipoAmbienteValue();
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'nfe_homologacao_bloqueada',
        payloadEnviado: {
          reason: 'nf_xml_not_production',
          tipo_ambiente_enviado: tipoAmbienteEnviado,
        },
        respostaMl: {
          tpAmb_xml_recebido: xmlAmbienteCheck.tpAmb,
          destinatario_xml: xmlAmbienteCheck.destinatarioNome,
          marcador_homologacao_detectado: xmlAmbienteCheck.marcadorHomologacao,
        },
        statusResultante: 'blocked_homologation',
      });
      await setStep('validate_fiscal_prechecks', 'error', undefined, msg);
      state = 'error';
      result = {
        stage: 'pre_validacao_ambiente_nf',
        tpAmb_xml_recebido: xmlAmbienteCheck.tpAmb,
        destinatario_xml: xmlAmbienteCheck.destinatarioNome,
        marker: xmlAmbienteCheck.marcadorHomologacao,
        message: msg,
      };
      await syncJob();
      return;
    }

    const chaveAcesso = extrairChaveAcessoDoXml(xml);
    let dsidAtual: number | null = null;
    if (chaveAcesso) {
      const existente = await consultarPedidoPorChaveAcesso(chaveAcesso);
      if (existente) {
        const msg = `Já existe pedido na DSLite para esta mesma nota fiscal (chave ${chaveAcesso}, dsid: ${existente.dsid}). Gere nova NF antes de tentar novamente.`;
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'dslite_blocked_same_nfe',
          respostaMl: {
            nfe_chave: chaveAcesso,
            dsid_encontrado: existente.dsid,
            status_dslite_encontrado: existente.status || null,
            cancelado: Boolean(existente.cancelado),
          },
          statusResultante: 'blocked_same_nfe',
        });
        await setStep('validate_fiscal_prechecks', 'error', undefined, msg);
        state = 'error';
        result = {
          stage: 'pre_validacao_nfe_duplicada_dslite',
          nfe_chave: chaveAcesso,
          dsid_encontrado: existente.dsid,
          status_dslite_encontrado: existente.status || null,
          message: msg,
        };
        await syncJob();
        return;
      }
    }

    await setStep('validate_fiscal_prechecks', 'success', 'Pré-checagens e vínculo fiscal concluídos');
    await setStep('find_product_dslite', 'loading');
    const skuComPrefixo = extrairSkuDoXml(xml);
    if (!skuComPrefixo) {
      await setStep('find_product_dslite', 'error', undefined, 'Não foi possível extrair o SKU do XML');
      state = 'error';
      await syncJob();
      return;
    }

    const { data: produtoLocal } = await client
      .from('produtos')
      .select('dslite_fornecedor_id')
      .eq('sku', skuComPrefixo)
      .maybeSingle();

    if (!produtoLocal?.dslite_fornecedor_id) {
      await setStep('find_product_dslite', 'error', undefined, `Produto com SKU ${skuComPrefixo} sem mapeamento DSLite`);
      state = 'error';
      await syncJob();
      return;
    }

    const fornecedorId = produtoLocal.dslite_fornecedor_id;
    const skuSemPrefixo = removerPrefixoSku(skuComPrefixo);
    const produto = await buscarProdutoPorSku(fornecedorId, skuSemPrefixo);
    if (!produto) {
      await setStep('find_product_dslite', 'error', undefined, `Produto ${skuSemPrefixo} não encontrado no fornecedor ${fornecedorId}`);
      state = 'error';
      await syncJob();
      return;
    }
    await setStep('find_product_dslite', 'success', `${produto.titulo} (ID: ${produto.produtoid})`);

    const cfopsDetectados = extractCfopsFromXml(xml);
    const { emitUf, destUf } = extractEmitDestUfFromXml(xml);
    const cfopCheck = validateCfopForDslite(cfopsDetectados, emitUf, destUf);

    if (!cfopCheck.ok) {
      const invalidosMsg = cfopCheck.cfopAusente
        ? 'ausente no XML'
        : cfopCheck.cfopsInvalidos.length > 0
          ? cfopCheck.cfopsInvalidos.join(', ')
          : cfopCheck.cfopsDetectados.join(', ');
      const regraUfMsg = cfopCheck.ufAusente
        ? 'UF emitente/destinatário ausente no XML.'
        : `Regra por UF: mesmo estado => CFOP 5120 | estado diferente => CFOP 6120. CFOP esperado: ${cfopCheck.cfopEsperado}.`;
      const msg = `CFOP inválido para DSLite: ${invalidosMsg}. Permitidos: ${ALLOWED_CFOP_DSLITE.join(', ')}. ${regraUfMsg} Corrija na origem fiscal (${selectedProvider}), regenere o XML e reprocese.`;

      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'pre_validacao',
        respostaMl: {
          cfops_detectados: cfopCheck.cfopsDetectados,
          cfops_invalidos: cfopCheck.cfopsInvalidos,
          cfops_permitidos: ALLOWED_CFOP_DSLITE,
          emit_uf: emitUf,
          dest_uf: destUf,
          cfop_esperado: cfopCheck.cfopEsperado,
          cfop_divergente_regra_uf: cfopCheck.cfopDivergenteDaRegraUf,
          sku_extraido: skuComPrefixo || null,
          motivo: cfopCheck.motivo,
        },
        statusResultante: 'blocked_cfop',
      });

      await setStep('create_order_dslite', 'error', undefined, msg);
      state = 'error';
      result = {
        stage: 'pre_validacao_cfop',
        cfops_detectados: cfopCheck.cfopsDetectados,
        cfops_invalidos: cfopCheck.cfopsInvalidos,
        cfops_permitidos: ALLOWED_CFOP_DSLITE,
        message: msg,
      };
      await syncJob();
      return;
    }

    let pedidoStatusFinal = 'criado';
    await setStep('create_order_dslite', 'loading');
    const pedidoResult = await criarPedidoDropshipping(xml);
    if (!pedidoResult?.dsid) {
      await setStep('create_order_dslite', 'error', undefined, 'Falha ao criar pedido na DSLite');
      state = 'error';
      await syncJob();
      return;
    }
    if (pedidoResult.status?.toLowerCase().includes('cancelado')) {
      await setStep('create_order_dslite', 'error', undefined, `DSLite retornou pedido cancelado (dsid: ${pedidoResult.dsid})`);
      state = 'error';
      await syncJob();
      return;
    }
    dsidAtual = Number(pedidoResult.dsid);
    pedidoStatusFinal = pedidoResult.status || 'criado';
    await setStep('create_order_dslite', 'success', `Pedido Nº ${pedidoResult.dsid}`);
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId: mlOrderId ? String(mlOrderId) : null,
      evento: 'dslite_purchase_created_with_brasilnfe_xml',
      respostaMl: {
        dsid: pedidoResult.dsid,
        nfe_chave: chaveAcesso || null,
        provider: selectedProvider,
      },
      statusResultante: 'success',
    });

    const pendencias: string[] = [...externalWarnings];

    await setStep('set_supplier_dslite', 'loading');
    const fornecedorResult = await informarFornecedorPedido(dsidAtual as number, fornecedorId);
    if (!fornecedorResult?.success) {
      const msg = fornecedorResult?.message || 'Falha ao informar fornecedor';
      pendencias.push(`Fornecedor: ${msg}`);
      await setStep('set_supplier_dslite', 'warning', msg);
    } else {
      await setStep('set_supplier_dslite', 'success', 'Fornecedor vinculado com sucesso');
    }

    await setStep('set_carrier_dslite', 'loading');
    const transportadoraResult = await definirTransportadoraPedido(dsidAtual as number, TRANSPORTADORA_PADRAO_CORREIOS);
    let transportadoraOk = true;
    if (!transportadoraResult?.success) {
      transportadoraOk = false;
      const msg = transportadoraResult?.message || 'Falha ao definir transportadora';
      pendencias.push(`Transportadora: ${msg}`);
      await setStep('set_carrier_dslite', 'warning', msg);
    } else {
      await setStep('set_carrier_dslite', 'success', 'Transportadora definida com sucesso');
    }

    await setStep('download_label_ml', 'loading');
    let etiquetaStatus: 'enviada' | 'nao_disponivel' | 'erro' = 'nao_disponivel';
    let etiquetaError: string | undefined;
    if (dsliteEtiquetaEnviada) {
      etiquetaStatus = 'enviada';
      await completeAsSkipped('download_label_ml', 'etiqueta já enviada anteriormente');
      await completeAsSkipped('send_label_dslite', 'etiqueta já enviada anteriormente');
    } else {
      const shipmentResolutionForLabel = await resolveShipmentIdWithWait({
        client,
        pedidoId,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        initialShipmentId: resolvedShipmentId,
        stage: 'label_download',
      });
      const shipmentIdForLabel = shipmentResolutionForLabel.shipmentId;
      resolvedShipmentId = shipmentIdForLabel;

      if (shipmentIdForLabel) {
      const startedAt = Date.now();
      let tentativa = 0;
      let etiquetaPdf: Buffer | null = null;
      let ultimoErroDownload = 'Etiqueta não disponível no ML';
      let ultimoStatusHttp: number | null = null;
      let ultimoMotivo: string | null = null;
      let stoppedByNonRetryable = false;

      while (Date.now() - startedAt <= LABEL_WAIT_TIMEOUT_MS) {
        tentativa += 1;
        const elapsedMs = Date.now() - startedAt;
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'ml_label_download_attempt',
          payloadEnviado: {
            ml_shipment_id: shipmentIdForLabel,
            nfe_chave: chaveAcesso || null,
            provider: selectedProvider,
            tentativa,
            elapsed_ms: elapsedMs,
          },
          statusResultante: 'attempt',
        });

        const etiquetaResult = await baixarEtiquetaML(shipmentIdForLabel);
        if (etiquetaResult.pdf) {
          etiquetaPdf = etiquetaResult.pdf;
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'ml_label_download_success',
            respostaMl: {
              ml_shipment_id: shipmentIdForLabel,
              tentativa,
              elapsed_ms: Date.now() - startedAt,
              status_http: etiquetaResult.statusCode || null,
              reason: etiquetaResult.reason || null,
              bytes: etiquetaResult.pdf.length,
            },
            statusResultante: 'success',
          });
          break;
        }

        ultimoErroDownload = etiquetaResult.error || 'Etiqueta não disponível no ML';
        ultimoStatusHttp = etiquetaResult.statusCode ?? null;
        ultimoMotivo = etiquetaResult.reason ?? null;
        const elapsedNow = Date.now() - startedAt;
        const exceeded = elapsedNow + LABEL_RETRY_INTERVAL_MS > LABEL_WAIT_TIMEOUT_MS;

        if (etiquetaResult.retryable && !exceeded) {
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'ml_label_download_retry',
            respostaMl: {
              ml_shipment_id: shipmentIdForLabel,
              tentativa,
              elapsed_ms: elapsedNow,
              status_http: ultimoStatusHttp,
              reason: ultimoMotivo,
              error: ultimoErroDownload,
              retry_in_ms: LABEL_RETRY_INTERVAL_MS,
            },
            statusResultante: 'retrying',
          });
          await sleep(LABEL_RETRY_INTERVAL_MS);
          continue;
        }

        if (!etiquetaResult.retryable) {
          stoppedByNonRetryable = true;
        }
        break;
      }

      if (!etiquetaPdf) {
        etiquetaStatus = 'erro';
        etiquetaError = ultimoErroDownload || 'Etiqueta não disponível no ML';
        pendencias.push(`Etiqueta: ${etiquetaError}`);
        const elapsedMs = Date.now() - startedAt;
        const timeoutMessage = 'Etiqueta ainda não disponível no ML após 1 minuto. A NF foi emitida somente na Brasil NFe.';
        const nonRetryableMessage = `Etiqueta indisponível no ML (erro não temporário): ${etiquetaError}`;
        const warningMessage = stoppedByNonRetryable ? nonRetryableMessage : timeoutMessage;
        await registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId: mlOrderId ? String(mlOrderId) : null,
          evento: 'ml_label_download_timeout',
          respostaMl: {
            ml_shipment_id: shipmentIdForLabel,
            elapsed_ms: elapsedMs,
            status_http: ultimoStatusHttp,
            reason: ultimoMotivo,
            error: etiquetaError,
            stopped_by_non_retryable: stoppedByNonRetryable,
          },
          statusResultante: stoppedByNonRetryable ? 'failed' : 'timeout',
        });
        await setStep('download_label_ml', 'warning', warningMessage);
        await setStep('send_label_dslite', 'warning', 'Etapa não executada por etiqueta indisponível');
      } else {
        await setStep('download_label_ml', 'success', 'Etiqueta baixada com sucesso no Mercado Livre');
        await setStep('send_label_dslite', 'loading');
        if (!transportadoraOk) {
          etiquetaStatus = 'erro';
          etiquetaError = 'Transportadora não definida. Execute "Enviar Etiqueta DSLite" após corrigir.';
          pendencias.push(`Etiqueta: ${etiquetaError}`);
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            evento: 'ml_label_send_failed',
            respostaMl: {
              ml_shipment_id: shipmentIdForLabel,
              error: etiquetaError,
            },
            statusResultante: 'failed',
          });
          await setStep('send_label_dslite', 'warning', etiquetaError);
        } else {
          const envioEtiqueta = await enviarEtiqueta(dsidAtual as number, etiquetaPdf, 'etiqueta_ml.pdf');
          if (envioEtiqueta?.success) {
            etiquetaStatus = 'enviada';
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'ml_label_send_success',
              respostaMl: {
                ml_shipment_id: shipmentIdForLabel,
              },
              statusResultante: 'success',
            });
            await setStep('send_label_dslite', 'success', 'Etiqueta enviada com sucesso para DSLite');
          } else {
            etiquetaStatus = 'erro';
            etiquetaError = envioEtiqueta?.message || 'Falha ao enviar etiqueta para DSLite';
            pendencias.push(`Etiqueta: ${etiquetaError}`);
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: mlOrderId ? String(mlOrderId) : null,
              evento: 'ml_label_send_failed',
              respostaMl: {
                ml_shipment_id: shipmentIdForLabel,
                error: etiquetaError,
              },
              statusResultante: 'failed',
            });
            await setStep('send_label_dslite', 'warning', etiquetaError);
          }
        }
      }
    } else {
        const shipmentWaitSecs = Math.floor(SHIPMENT_WAIT_TIMEOUT_MS / 1000);
        const warn = `Shipment do ML não ficou disponível após ${shipmentWaitSecs}s`;
        pendencias.push(`Etiqueta: ${warn}`);
        await setStep('download_label_ml', 'warning', warn);
        await setStep('send_label_dslite', 'warning', 'Etapa não executada por shipment indisponível no ML');
    }
    }

    await client
      .from('pedidos')
      .update({
        dslite_id: String(dsidAtual),
        dslite_status: pedidoStatusFinal,
        nfe_chave: chaveAcesso || undefined,
        dslite_etiqueta_enviada: etiquetaStatus === 'enviada',
        nfe_provider: selectedProvider,
        nfe_last_sync_at: now(),
        nfe_cfop: extractCfopsFromXml(xml)[0] || null,
      })
      .eq('id', pedidoId);

    result = {
      dsid: dsidAtual,
      status: pedidoStatusFinal,
      produto: {
        produtoid: produto.produtoid,
        produtoid_empresa: produto.produtoid_empresa,
        titulo: produto.titulo,
      },
      etiquetaStatus,
      etiquetaError,
      pendencias,
      reusedDsliteId: null,
    };

    state = pendencias.length > 0 ? 'warning' : 'success';
    await syncJob();
  } catch (err: any) {
    state = 'error';
    const msg = err?.message || 'Erro inesperado no processamento do job';
    const idx = steps.findIndex((s) => s.status === 'loading');
    if (idx >= 0) {
      steps[idx] = { ...steps[idx], status: 'error', error: msg, updatedAt: now() };
    }
    result = { error: msg };
    await syncJob();
  }
}

export async function POST(req: Request) {
  try {
    const { pedidoId, mlOrderId, nfeProvider, nfePayload } = await req.json();
    if (nfeProvider === 'mercadolivre') {
      await registrarEventoNfAuditoria({
        pedidoId: pedidoId ? String(pedidoId) : null,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'ml_fiscal_emission_blocked',
        respostaMl: {
          attempted_provider: 'mercadolivre',
          blocked_reason: 'emissao_ml_desativada_por_politica',
        },
        statusResultante: 'blocked',
      });
      await registrarEventoNfAuditoria({
        pedidoId: pedidoId ? String(pedidoId) : null,
        mlOrderId: mlOrderId ? String(mlOrderId) : null,
        evento: 'ml_fiscal_runtime_call_denied',
        respostaMl: {
          attempted_provider: 'mercadolivre',
          blocked_reason: 'emissao_ml_desativada_por_politica',
          endpoint: 'POST /api/dslite/pedido',
        },
        statusResultante: 'denied',
      });
      return NextResponse.json(
        { error: 'Provedor mercadolivre não é permitido. Use brasilnfe.' },
        { status: 422 },
      );
    }
    const provider: NfeProvider = 'brasilnfe';

    if (!pedidoId) {
      return NextResponse.json({ error: 'pedidoId é obrigatório' }, { status: 400 });
    }

    const client = createServiceClient();
    const jobId = crypto.randomUUID();
    const initialSteps = initSteps();
    const syncIdx = initialSteps.findIndex((s) => s.key === 'sync_order_snapshot');
    if (syncIdx >= 0) {
      initialSteps[syncIdx] = {
        ...initialSteps[syncIdx],
        status: 'loading',
        detail: 'Atualizando snapshot fiscal e itens do pedido',
        updatedAt: now(),
      };
    }

    await client.from('jobs').insert({
      id: jobId,
      tipo: 'dslite_criar_pedido',
      status: 'pendente',
      progresso: 0,
      total: STEP_DEFS.length,
      processados: 0,
      cancelado: false,
      log: JSON.parse(JSON.stringify([
        {
          event: 'progress_snapshot',
          at: now(),
          state: 'running',
          steps: initialSteps,
          payload: {
            pedidoId,
            mlOrderId: mlOrderId ? String(mlOrderId) : null,
            nfeProvider: provider,
            hasNfePayload: Boolean(nfePayload),
          },
        },
      ])),
    });

    void runDsliteCreateJob(
      jobId,
      String(pedidoId),
      mlOrderId ? String(mlOrderId) : null,
      provider,
      nfePayload || null,
    );

    return NextResponse.json({ success: true, jobId }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao iniciar job' }, { status: 500 });
  }
}
