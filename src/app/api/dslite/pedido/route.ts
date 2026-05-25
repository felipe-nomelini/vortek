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
  emitirNotaFiscalML,
  consultarInvoiceDoPedidoML,
  baixarXmlInvoiceML,
} from '@/services/integration';
import { createServiceClient } from '@/lib/supabase';

const TRANSPORTADORA_PADRAO_CORREIOS = 31;
const WAIT_AUTH_TIMEOUT_MS = 180_000;
const WAIT_AUTH_INTERVAL_MS = 3_000;
const XML_RETRY_DELAYS_MS = [0, 1500, 2500, 4000, 6000];

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
  { key: 'emit_nf_ml', label: 'Emitindo NF no Mercado Livre' },
  { key: 'wait_nf_authorized', label: 'Aguardando autorização da NF' },
  { key: 'fetch_xml_ml', label: 'Baixando XML da NF no Mercado Livre' },
  { key: 'find_product_dslite', label: 'Buscando produto no catálogo DSLite' },
  { key: 'create_order_dslite', label: 'Criando pedido na DSLite' },
  { key: 'set_supplier_dslite', label: 'Informando fornecedor' },
  { key: 'set_carrier_dslite', label: 'Definindo transportadora (Correios)' },
  { key: 'send_label_dslite', label: 'Enviando etiqueta para DSLite' },
];

function now() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runDsliteCreateJob(jobId: string, pedidoId: string, mlOrderId: string | null) {
  const client = createServiceClient();
  const steps = initSteps();
  const logEntries: any[] = [];
  let state: JobState = 'running';
  let result: any = null;

  const syncJob = async () => {
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

    let xml: string | null = null;
    let invoiceId: string | number | null = null;
    let reusedDsliteId: number | null = null;

    const { data: pedidoRow } = await client
      .from('pedidos')
      .select('nfe_xml,dslite_id,dslite_etiqueta_enviada,ml_shipment_id')
      .eq('id', pedidoId)
      .maybeSingle();
    const dsliteEtiquetaEnviada = Boolean(pedidoRow?.dslite_etiqueta_enviada);
    const existingShipmentId = pedidoRow?.ml_shipment_id ? String(pedidoRow.ml_shipment_id) : null;

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

    if (xml) {
      await completeAsSkipped('emit_nf_ml', 'NF já disponível no banco local');
      await completeAsSkipped('wait_nf_authorized', 'Autorização já refletida no XML local');
      await completeAsSkipped('fetch_xml_ml', 'XML já existente no banco local');
    } else {
      if (!mlOrderId) {
        await setStep('emit_nf_ml', 'error', undefined, 'mlOrderId ausente para emissão de NF');
        state = 'error';
        await syncJob();
        return;
      }

      await setStep('emit_nf_ml', 'loading');
      const emissao = await emitirNotaFiscalML(String(mlOrderId));
      if (!emissao.ok) {
        await setStep('emit_nf_ml', 'error', undefined, emissao.error || 'Falha ao emitir NF no ML');
        state = 'error';
        await syncJob();
        return;
      }
      await setStep('emit_nf_ml', 'success', emissao.status === 'already_issued' ? 'NF já emitida anteriormente' : 'NF emitida com sucesso');

      await setStep('wait_nf_authorized', 'loading');
      const started = Date.now();
      while (Date.now() - started < WAIT_AUTH_TIMEOUT_MS) {
        const invoice = await consultarInvoiceDoPedidoML(String(mlOrderId));
        if (invoice.ok && invoice.invoiceId && invoice.status === 'authorized') {
          invoiceId = invoice.invoiceId;
          await setStep('wait_nf_authorized', 'success', `NF autorizada (invoice: ${String(invoiceId)})`);
          break;
        }
        await sleep(WAIT_AUTH_INTERVAL_MS);
      }

      if (!invoiceId) {
        await setStep('wait_nf_authorized', 'warning', 'NF emitida, aguardando autorização/propagação no ML');
        state = 'warning';
        result = {
          message: 'NF emitida, aguardando autorização/propagação no ML. Reprocessar em instantes.',
          stage: 'wait_nf_authorized',
        };
        await syncJob();
        return;
      }

      await setStep('fetch_xml_ml', 'loading');
      let lastXmlError = 'Falha ao baixar XML';
      for (const delay of XML_RETRY_DELAYS_MS) {
        if (delay > 0) await sleep(delay);
        const xmlFetch = await baixarXmlInvoiceML(String(invoiceId));
        if (xmlFetch.xml) {
          xml = xmlFetch.xml;
          await client
            .from('pedidos')
            .update({ nfe_xml: xmlFetch.xml })
            .eq('ml_order_id', String(mlOrderId));
          await setStep('fetch_xml_ml', 'success', `XML baixado (${xmlFetch.xml.length} chars)`);
          break;
        }
        lastXmlError = xmlFetch.error || lastXmlError;
      }

      if (!xml) {
        await setStep('fetch_xml_ml', 'error', undefined, lastXmlError);
        state = 'error';
        await syncJob();
        return;
      }
    }

    const chaveAcesso = extrairChaveAcessoDoXml(xml);
    let dsidAtual: number | null = null;
    if (chaveAcesso) {
      const existente = await consultarPedidoPorChaveAcesso(chaveAcesso);
      if (existente) {
        reusedDsliteId = Number(existente.dsid);
      }
    }

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

    let pedidoStatusFinal = 'criado';
    if (reusedDsliteId) {
      dsidAtual = reusedDsliteId;
      await setStep('create_order_dslite', 'warning', `Pedido já existente para esta NF-e (dsid: ${reusedDsliteId})`);
      pedidoStatusFinal = 'existente';
    } else {
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
    }

    const pendencias: string[] = [];

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

    await setStep('send_label_dslite', 'loading');
    let etiquetaStatus: 'enviada' | 'nao_disponivel' | 'erro' = 'nao_disponivel';
    let etiquetaError: string | undefined;
    if (dsliteEtiquetaEnviada) {
      etiquetaStatus = 'enviada';
      await completeAsSkipped('send_label_dslite', 'etiqueta já enviada anteriormente');
    } else if (existingShipmentId) {
      const etiquetaResult = await baixarEtiquetaML(existingShipmentId);
      if (etiquetaResult.pdf) {
        if (!transportadoraOk) {
          etiquetaStatus = 'erro';
          etiquetaError = 'Transportadora não definida. Execute "Enviar Etiqueta DSLite" após corrigir.';
          pendencias.push(`Etiqueta: ${etiquetaError}`);
          await setStep('send_label_dslite', 'warning', etiquetaError);
        } else {
          const envioEtiqueta = await enviarEtiqueta(dsidAtual as number, etiquetaResult.pdf, 'etiqueta_ml.pdf');
          if (envioEtiqueta?.success) {
            etiquetaStatus = 'enviada';
            await setStep('send_label_dslite', 'success', 'Etiqueta enviada com sucesso para DSLite');
          } else {
            etiquetaStatus = 'erro';
            etiquetaError = envioEtiqueta?.message || 'Falha ao enviar etiqueta para DSLite';
            pendencias.push(`Etiqueta: ${etiquetaError}`);
            await setStep('send_label_dslite', 'warning', etiquetaError);
          }
        }
      } else {
        etiquetaStatus = 'erro';
        etiquetaError = etiquetaResult.error || 'Etiqueta não disponível no ML';
        pendencias.push(`Etiqueta: ${etiquetaError}`);
        await setStep('send_label_dslite', 'warning', etiquetaError);
      }
    } else {
      pendencias.push('Etiqueta: pedido sem ml_shipment_id no Mercado Livre');
      await setStep('send_label_dslite', 'warning', 'Pedido sem ml_shipment_id no Mercado Livre');
    }

    await client
      .from('pedidos')
      .update({
        dslite_id: String(dsidAtual),
        dslite_status: pedidoStatusFinal,
        nfe_chave: chaveAcesso || undefined,
        dslite_etiqueta_enviada: etiquetaStatus === 'enviada',
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
      reusedDsliteId: reusedDsliteId || null,
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
    const { pedidoId, mlOrderId } = await req.json();

    if (!pedidoId) {
      return NextResponse.json({ error: 'pedidoId é obrigatório' }, { status: 400 });
    }

    const client = createServiceClient();
    const jobId = crypto.randomUUID();
    const initialSteps = initSteps();

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
          payload: { pedidoId, mlOrderId: mlOrderId ? String(mlOrderId) : null },
        },
      ])),
    });

    void runDsliteCreateJob(jobId, String(pedidoId), mlOrderId ? String(mlOrderId) : null);

    return NextResponse.json({ success: true, jobId }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao iniciar job' }, { status: 500 });
  }
}
