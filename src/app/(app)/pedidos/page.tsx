'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin, Modal, message, Statistic, Divider, Tooltip,
} from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined, CarOutlined, WarningOutlined, UploadOutlined } from '@ant-design/icons';
import TrackingModal from '@/components/modals/TrackingModal';
import ProgressModal, { ProgressStep } from '@/components/modals/ProgressModal';
import { formatCurrency } from '@/lib/format';
import type { Database } from '@/types/database';
import type { Order, OrderStatus } from '@/types/order';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'aberto', label: 'Aberto' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'preparando', label: 'Preparando' },
  { value: 'pronto_envio', label: 'Pronto p/ envio' },
  { value: 'etiqueta_impressa', label: 'Etiqueta Impressa' },
  { value: 'coletado', label: 'Coletado' },
  { value: 'em_transito', label: 'Em Trânsito' },
  { value: 'saiu_entrega', label: 'Saiu para Entrega' },
  { value: 'dest_ausente', label: 'Dest. Ausente' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'faturado', label: 'Faturado' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'recusado', label: 'Recusado' },
  { value: 'devolvido', label: 'Devolvido' },
  { value: 'cancelado', label: 'Cancelado' },
];

const statusColor: Record<OrderStatus, string> = {
  aberto: 'blue',
  pendente: 'orange',
  preparando: 'processing',
  pronto_envio: 'cyan',
  etiqueta_impressa: 'blue',
  coletado: 'geekblue',
  em_transito: 'purple',
  saiu_entrega: 'cyan',
  dest_ausente: 'red',
  atendido: 'processing',
  faturado: 'purple',
  entregue: 'green',
  recusado: 'red',
  devolvido: 'magenta',
  cancelado: 'default',
};

const statusLabel: Record<OrderStatus, string> = {
  aberto: 'Aberto',
  pendente: 'Pendente',
  preparando: 'Preparando',
  pronto_envio: 'Pronto p/ envio',
  etiqueta_impressa: 'Etiqueta Impressa',
  coletado: 'Coletado',
  em_transito: 'Em Trânsito',
  saiu_entrega: 'Saiu para Entrega',
  dest_ausente: 'Dest. Ausente',
  atendido: 'Atendido',
  faturado: 'Faturado',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  cancelado: 'Cancelado',
};

function isValidDsliteId(val: string | null | undefined): string | null {
  if (!val || val === 'undefined' || val === 'null' || val.trim() === '') return null;
  return val;
}

function isDsliteRejected(status: string | null | undefined): boolean {
  return String(status || '').toLowerCase().includes('rejeitado');
}

function formatReleaseWindow(value: string): { when: string; remaining: string | null } {
  const dt = new Date(value);
  const when = dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '');
  const ms = dt.getTime() - Date.now();
  if (ms <= 0) return { when, remaining: null };
  const totalHours = Math.floor(ms / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return { when, remaining: days > 0 ? `faltam ${days}d ${hours}h` : `faltam ${hours}h` };
}

function mapDBtoOrder(item: Database['public']['Tables']['pedidos']['Row']): Order {
  return {
    id: item.numero,
    dbId: item.id,
    numero: item.numero,
    numeroLoja: item.numero_loja || '',
    data: item.data || new Date().toISOString(),
    dataSaida: item.data_saida,
    dataPrevista: item.data_prevista,
    contato: {
      id: 0,
      nome: item.contato_nome || '',
      tipoPessoa: 'F',
      numeroDocumento: item.contato_documento || '',
    },
    totalProdutos: item.total || 0,
    total: item.total || 0,
    situacao: { id: 0, valor: item.situacao || 'aberto' },
    loja: { id: 1 },
    transporte: item.frete ? { frete: item.frete, prazoEntrega: null, contato: { nome: item.contato_nome || '' } } : null,
    notaFiscal: item.nota_fiscal_numero ? { numero: item.nota_fiscal_numero, emitida: item.nota_fiscal_emitida } : null,
    nfe_danfe_url: item.nfe_danfe_url,
    rastreio: item.rastreio,
    lucro: item.lucro ?? null,
    dslite_id: isValidDsliteId(item.dslite_id),
    dslite_status: item.dslite_status,
    dslite_etiqueta_enviada: item.dslite_etiqueta_enviada || false,
    ml_claim_id: item.ml_claim_id,
    ml_shipment_id: item.ml_shipment_id,
    ml_invoice_reported: item.ml_invoice_reported || false,
    ml_order_id: item.ml_order_id,
    ml_pack_id: item.ml_pack_id,
    ml_fiscal_release_at: item.ml_fiscal_release_at,
    ml_fiscal_release_reason: item.ml_fiscal_release_reason,
    ml_fiscal_release_source: item.ml_fiscal_release_source,
    ml_fiscal_release_checked_at: item.ml_fiscal_release_checked_at,
    nfe_status: item.nfe_status,
  };
}

interface SummaryData {
  count: number;
  total: number;
  lucroSum: number;
  ticket: number;
  margem: number;
  statusCounts: Record<string, number>;
}

interface EtiquetaDuplicateDecision {
  pedidoId: string;
  dsid: string;
  mlOrderId: string;
  existingNfe: {
    chave: string;
    numero?: number | null;
    status?: number | null;
    dataEmissao?: string | null;
    linkInterno?: string | null;
  } | null;
  identificadorInterno?: string | null;
}

export default function PedidosPage() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<SummaryData>({ count: 0, total: 0, lucroSum: 0, ticket: 0, margem: 0, statusCounts: {} });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState<string>('');
  const [trackingOrderStatus, setTrackingOrderStatus] = useState<OrderStatus>('aberto');

  const [dsliteProgressOpen, setDsliteProgressOpen] = useState(false);
  const dslitePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dsliteSteps, setDsliteSteps] = useState<ProgressStep[]>([
    { label: 'Sincronizando pedido no Mercado Livre', status: 'loading', detail: 'Atualizando snapshot fiscal e itens do pedido' },
    { label: 'Emitindo NF na Brasil NFe', status: 'pending' },
    { label: 'Aguardando autorização da NF', status: 'pending' },
    { label: 'Baixando XML da NF na Brasil NFe', status: 'pending' },
    { label: 'Validando vínculo fiscal e pré-checagens', status: 'pending' },
    { label: 'Buscando produto no catálogo DSLite', status: 'pending' },
    { label: 'Criando pedido na DSLite', status: 'pending' },
    { label: 'Informando fornecedor', status: 'pending' },
    { label: 'Definindo transportadora (Correios)', status: 'pending' },
    { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
    { label: 'Enviando etiqueta para DSLite', status: 'pending' },
  ]);

  const [etiquetaProgressOpen, setEtiquetaProgressOpen] = useState(false);
  const [etiquetaDuplicateDecision, setEtiquetaDuplicateDecision] = useState<EtiquetaDuplicateDecision | null>(null);
  const [etiquetaSteps, setEtiquetaSteps] = useState<ProgressStep[]>([
    { label: 'Verificando vínculo fiscal no Mercado Livre', status: 'pending', detail: 'Fonte fiscal única: Brasil NFe. ML é usado apenas para vínculo documental e etiqueta.' },
    { label: 'Garantindo NF na Brasil NFe', status: 'pending' },
    { label: 'Vinculando NF Brasil NFe no Mercado Livre', status: 'pending' },
    { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
    { label: 'Definindo transportadora (Correios)', status: 'pending' },
    { label: 'Enviando etiqueta para DSLite', status: 'pending' },
  ]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    return params;
  }, [page, search, statusFilter, dateRange, priceMin, priceMax]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = buildParams();
    try {
      const [listRes, summaryRes] = await Promise.all([
        fetch(`/api/pedidos?${params}`),
        fetch(`/api/pedidos/resumo?${params}`),
      ]);

      if (listRes.ok) {
        const json = await listRes.json();
        setOrders((json.data || []).map(mapDBtoOrder));
        setTotal(json.total || 0);
      }

      if (summaryRes.ok) {
        const json = await summaryRes.json();
        setSummary({
          count: json.count || 0,
          total: json.total || 0,
          lucroSum: json.lucroSum || 0,
          ticket: json.ticket || 0,
          margem: json.margem || 0,
          statusCounts: json.statusCounts || {},
        });
      }
    } catch {}
    setLoading(false);
  }, [buildParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateRange, priceMin, priceMax]);

  useEffect(() => () => {
    if (dslitePollRef.current) clearTimeout(dslitePollRef.current);
  }, []);

  const criarPedidoDslite = async (order: Order, nfeProvider: 'brasilnfe' = 'brasilnfe') => {
    const steps: ProgressStep[] = [
      { label: 'Sincronizando pedido no Mercado Livre', status: 'loading', detail: 'Atualizando snapshot fiscal e itens do pedido' },
      { label: 'Emitindo NF na Brasil NFe', status: 'pending' },
      { label: 'Aguardando autorização da NF', status: 'pending' },
      { label: 'Baixando XML da NF na Brasil NFe', status: 'pending' },
      { label: 'Validando vínculo fiscal e pré-checagens', status: 'pending' },
      { label: 'Buscando produto no catálogo DSLite', status: 'pending' },
      { label: 'Criando pedido na DSLite', status: 'pending' },
      { label: 'Informando fornecedor', status: 'pending' },
      { label: 'Definindo transportadora (Correios)', status: 'pending' },
      { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
      { label: 'Enviando etiqueta para DSLite', status: 'pending' },
    ];
    setDsliteSteps(steps);
    setDsliteProgressOpen(true);

    try {
      const startRes = await fetch('/api/dslite/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: order.dbId,
          mlOrderId: order.ml_order_id,
          nfeProvider,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData?.jobId) {
        throw new Error(startData?.error || 'Falha ao iniciar criação do pedido DSLite');
      }

      const poll = async () => {
        const res = await fetch(`/api/dslite/pedido/status?jobId=${encodeURIComponent(startData.jobId)}`);
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Falha ao consultar status do job DSLite');
        }

        const mapped: ProgressStep[] = (data.steps || []).map((s: any) => ({
          label: s.label,
          status: s.status,
          detail: s.detail,
          error: s.error,
        }));
        if (mapped.length) setDsliteSteps(mapped);

        const state = data.state as string;
        if (state === 'running') {
          dslitePollRef.current = setTimeout(() => {
            poll().catch((err) => {
              setDsliteSteps((prev) => {
                const updated = [...prev];
                const firstPending = updated.findIndex(s => s.status === 'pending' || s.status === 'loading');
                const idx = firstPending >= 0 ? firstPending : updated.length - 1;
                updated[idx] = { ...updated[idx], status: 'error', error: err.message || 'Erro ao acompanhar job' };
                return updated;
              });
            });
          }, 1500);
          return;
        }

        if (state === 'success' || state === 'warning') {
          const payload = data.data || {};
          if (payload.dsid) {
            setOrders(prev => prev.map(o =>
              o.id === order.id ? {
                ...o,
                dslite_id: String(payload.dsid),
                dslite_etiqueta_enviada: payload.etiquetaStatus === 'enviada'
              } : o
            ));
          }
          return;
        }

        if (state === 'error') {
          setDsliteSteps((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex(s => s.status === 'error');
            if (idx === -1) {
              const fallback = updated.findIndex(s => s.status === 'loading');
              const pos = fallback >= 0 ? fallback : updated.length - 1;
              updated[pos] = { ...updated[pos], status: 'error', error: (data.data?.error || 'Falha ao criar pedido DSLite') };
            }
            return updated;
          });
        }
      };

      await poll();
    } catch (err: any) {
      setDsliteSteps(prev => {
        const updated = [...prev];
        const firstPending = updated.findIndex(s => s.status === 'pending' || s.status === 'loading');
        const idx = firstPending >= 0 ? firstPending : updated.length - 1;
        updated[idx] = { label: updated[idx].label, status: 'error', error: err.message };
        return updated;
      });
    }
  };

  const pararPollingDslite = () => {
    if (dslitePollRef.current) {
      clearTimeout(dslitePollRef.current);
      dslitePollRef.current = null;
    }
  };

  const fecharModalDslite = () => {
    pararPollingDslite();
    setDsliteProgressOpen(false);
  };

  const tentarNovamenteDslite = () => {
    pararPollingDslite();
    setDsliteProgressOpen(false);
  };

  const enviarEtiquetaAutomatica = async (
    order: Order,
    duplicateAction?: 'use_existing' | 'reissue',
  ) => {
    if (!isValidDsliteId(order.dslite_id)) {
      messageApi.error('Crie o pedido na DSLite primeiro');
      return;
    }

    if (!duplicateAction) {
      setEtiquetaDuplicateDecision(null);
      setEtiquetaSteps([
        { label: 'Verificando vínculo fiscal no Mercado Livre', status: 'loading', detail: 'Fonte fiscal única: Brasil NFe. ML é usado apenas para vínculo documental e etiqueta.' },
        { label: 'Garantindo NF na Brasil NFe', status: 'pending' },
        { label: 'Vinculando NF Brasil NFe no Mercado Livre', status: 'pending' },
        { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
        { label: 'Definindo transportadora (Correios)', status: 'pending' },
        { label: 'Enviando etiqueta para DSLite', status: 'pending' },
      ]);
      setEtiquetaProgressOpen(true);
    } else {
      setEtiquetaDuplicateDecision(null);
      setEtiquetaSteps((prev) => prev.map((s) => {
        if (s.label === 'Garantindo NF na Brasil NFe') {
          return { ...s, status: 'loading', error: undefined };
        }
        if (
          s.label === 'Vinculando NF Brasil NFe no Mercado Livre'
          || s.label === 'Baixando etiqueta do Mercado Livre'
          || s.label === 'Definindo transportadora (Correios)'
          || s.label === 'Enviando etiqueta para DSLite'
        ) {
          return { ...s, status: 'pending', error: undefined };
        }
        return { ...s, error: undefined };
      }));
    }

    try {
      const res = await fetch('/api/dslite/etiqueta-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: order.dbId,
          dsid: order.dslite_id,
          ...(duplicateAction ? { nfeDuplicateAction: duplicateAction } : {}),
        }),
      });
      const data = await res.json();

      if (data.success) {
        setEtiquetaDuplicateDecision(null);
        const mappedSteps: ProgressStep[] = (data?.data?.steps || []).map((s: any) => ({
          label: String(s?.label || ''),
          status: s?.status === 'skipped' ? 'success' : (s?.status || 'pending'),
          detail: s?.status === 'skipped'
            ? (s?.detail || 'Etapa pulada')
            : s?.detail,
          error: s?.error,
        }));

        if (mappedSteps.length) {
          setEtiquetaSteps(mappedSteps);
        }

        const sent = mappedSteps.some((s) => s.label === 'Enviando etiqueta para DSLite' && s.status === 'success');
        if (sent) {
          setOrders(prev => prev.map(o =>
            o.id === order.id ? { ...o, dslite_etiqueta_enviada: true } : o
          ));
        }
      } else {
        const step = String(data?.step || '');
        const actionRequired = String(data?.actionRequired || data?.details?.actionRequired || '');
        const errMsg = data?.error || 'Falha no envio automático de etiqueta';
        const errorType = String(data?.errorType || data?.details?.errorType || '');
        const dbCode = String(data?.details?.db_code || '');
        const isDbSchemaError = errorType === 'db_schema' || dbCode === '42703';
        const providerDetailRaw =
          data?.details?.errorDetails?.rawResponse
          || data?.details?.errorDetails?.error?.response?.data
          || data?.details?.errorDetails
          || null;
        const providerReason =
          providerDetailRaw?.Error
          || providerDetailRaw?.error
          || providerDetailRaw?.ReturnNF?.DsStatusRespostaSefaz
          || providerDetailRaw?.ReturnNF?.Mensagem
          || providerDetailRaw?.ReturnNF?.Msg
          || providerDetailRaw?.Mensagem
          || providerDetailRaw?.Message
          || providerDetailRaw?.erros?.[0]?.descricao
          || providerDetailRaw?.erros?.[0]?.mensagem
          || null;
        const ensureFriendly = isDbSchemaError
          ? 'Erro de configuração do banco (migration pendente). Contate suporte técnico.'
          : step === 'ensure_brasilnfe_invoice'
            ? `Falha ao emitir NF na Brasil NFe: ${String(providerReason || errMsg)}`
            : errMsg;
        const attempts = Array.isArray(data?.details?.attempts) ? data.details.attempts : [];
        const attemptsMethodChain = attempts.length
          ? attempts.map((a: any) => `${a.method}(${String(a.contentType || '').toLowerCase().includes('xml') ? 'xml' : 'json'})`).join('->')
          : '';
        const attemptsStatusChain = attempts.length
          ? attempts.map((a: any) => String(a.statusCode ?? 'n/a')).join(', ')
          : '';
        const uploadFriendly = step === 'upload_invoice_ml'
          ? `Falha ao subir NF no ML: ${String(data?.details?.error_message_ml || errMsg)}`
          : ensureFriendly;
        const detailHint = data?.details?.providerError
          ? `${uploadFriendly} (${String(data.details.providerError)})`
          : uploadFriendly;
        const mappedFromServer: ProgressStep[] = (data?.data?.steps || []).map((s: any) => ({
          label: String(s?.label || ''),
          status: s?.status === 'skipped' ? 'success' : (s?.status || 'pending'),
          detail: s?.status === 'skipped'
            ? (s?.detail || 'Etapa pulada')
            : s?.detail,
          error: s?.error,
        }));

        if (mappedFromServer.length) {
          const hasExplicitError = mappedFromServer.some((s) => s.status === 'error');
          if (!hasExplicitError) {
            const stepToLabel: Record<string, string> = {
              check_ml_invoice_xml: 'Verificando vínculo fiscal no Mercado Livre',
              ensure_brasilnfe_invoice: 'Garantindo NF na Brasil NFe',
              upload_invoice_ml: 'Vinculando NF Brasil NFe no Mercado Livre',
              download_label_ml: 'Baixando etiqueta do Mercado Livre',
              set_carrier_dslite: 'Definindo transportadora (Correios)',
              send_label_dslite: 'Enviando etiqueta para DSLite',
            };
            const labelToMark = stepToLabel[step];
            if (labelToMark) {
              const idx = mappedFromServer.findIndex((s) => s.label === labelToMark);
              if (idx >= 0) {
                const attemptsSuffix = step === 'upload_invoice_ml' && attempts.length
                  ? ` [métodos: ${attemptsMethodChain}; retornos: ${attemptsStatusChain}]`
                  : '';
                mappedFromServer[idx] = { ...mappedFromServer[idx], status: 'error', error: `${detailHint}${attemptsSuffix}` };
              }
            }
          }
          if (step === 'ensure_brasilnfe_invoice' && actionRequired === 'choose_existing_or_reissue') {
            const existing = data?.existingNfe || data?.details?.existingNfe || null;
            const idxEnsure = mappedFromServer.findIndex((s) => s.label === 'Garantindo NF na Brasil NFe');
            if (idxEnsure >= 0 && existing?.chave) {
              mappedFromServer[idxEnsure] = {
                ...mappedFromServer[idxEnsure],
                detail: `NF encontrada: ${existing.numero ? `nº ${existing.numero} · ` : ''}chave ${existing.chave}`,
              };
            }
          }
          setEtiquetaSteps(mappedFromServer);
          if (step === 'ensure_brasilnfe_invoice' && actionRequired === 'choose_existing_or_reissue') {
            setEtiquetaDuplicateDecision({
              pedidoId: String(order.dbId),
              dsid: String(order.dslite_id),
              mlOrderId: String(order.ml_order_id || ''),
              existingNfe: data?.existingNfe || data?.details?.existingNfe || null,
              identificadorInterno: data?.identificadorInterno || data?.details?.identificadorInterno || null,
            });
          }
          return;
        }

        if (step === 'ensure_brasilnfe_invoice' && actionRequired === 'choose_existing_or_reissue') {
          setEtiquetaDuplicateDecision({
            pedidoId: String(order.dbId),
            dsid: String(order.dslite_id),
            mlOrderId: String(order.ml_order_id || ''),
            existingNfe: data?.existingNfe || data?.details?.existingNfe || null,
            identificadorInterno: data?.identificadorInterno || data?.details?.identificadorInterno || null,
          });
        }

        setEtiquetaSteps(prev => {
          const updated = [...prev];
          const firstPending = updated.findIndex(s => s.status === 'pending' || s.status === 'loading');
          const idx = firstPending >= 0 ? firstPending : updated.length - 1;
          updated[idx] = {
            label: updated[idx].label,
            status: 'error',
            error: ensureFriendly,
          };
          return updated;
        });
      }
    } catch (err: any) {
      setEtiquetaSteps(prev => {
        const updated = [...prev];
        const firstPending = updated.findIndex(s => s.status === 'pending' || s.status === 'loading');
        const idx = firstPending >= 0 ? firstPending : updated.length - 1;
        updated[idx] = { label: updated[idx].label, status: 'error', error: err.message };
        return updated;
      });
    }
  };

  const executarAcaoDuplicidadeEtiqueta = async (action: 'use_existing' | 'reissue') => {
    if (!etiquetaDuplicateDecision) return;
    const order = orders.find((o) => String(o.dbId) === etiquetaDuplicateDecision.pedidoId);
    if (!order) {
      messageApi.error('Pedido não encontrado para continuar o fluxo da etiqueta.');
      return;
    }
    await enviarEtiquetaAutomatica(order, action);
  };

  const desvincularCompraDslite = async (order: Order) => {
    Modal.confirm({
      title: 'Desvincular compra DSLite',
      content: 'Isso remove apenas o vínculo local do pedido com a DSLite. Nenhum dado será apagado na DSLite.',
      okText: 'Desvincular',
      okButtonProps: { danger: true },
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          const res = await fetch('/api/dslite/desvincular-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pedidoId: order.dbId,
              mlOrderId: order.ml_order_id,
              motivo: 'desvinculo_local_para_correcao_de_estado',
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.success) {
            throw new Error(data?.error || 'Falha ao desvincular compra DSLite');
          }

          setOrders((prev) =>
            prev.map((o) =>
              o.id === order.id
                ? { ...o, dslite_id: null, dslite_status: null, dslite_etiqueta_enviada: false }
                : o
            )
          );
          messageApi.success('Vínculo local com DSLite removido com sucesso');
        } catch (err: any) {
          messageApi.error(err?.message || 'Erro ao desvincular compra DSLite');
        }
      },
    });
  };

  const columns: TableProps<Order>['columns'] = [
    {
      title: 'Número', dataIndex: 'numero', key: 'numero', width: 100,
      sorter: (a, b) => a.numero - b.numero,
      render: (num: number, record: Order) => (
        <a
          href={`https://www.mercadolivre.com.br/vendas/${record.ml_pack_id || num}/detalhe`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Order ID: ${record.ml_order_id || '—'} | Pack ID: ${record.ml_pack_id || '—'}`}
          style={{ fontFamily: 'monospace', color: '#1677ff', textDecoration: 'none' }}
        >
          #{String(num).padStart(6, '0')}
        </a>
      ),
    },
    {
      title: 'Pack', dataIndex: 'ml_pack_id', key: 'ml_pack_id', width: 180,
      render: (v: string | null | undefined) => <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span>,
    },
    {
      title: 'Data', dataIndex: 'data', key: 'data', width: 160,
      sorter: (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime(),
      render: (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    },
    {
      title: 'Cliente', dataIndex: ['contato', 'nome'], key: 'cliente',
      sorter: (a, b) => a.contato.nome.localeCompare(b.contato.nome),
    },
    {
      title: 'Total', dataIndex: 'total', key: 'total', width: 110,
      sorter: (a, b) => a.total - b.total,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Rastreio', dataIndex: 'rastreio', key: 'rastreio', width: 130,
      sorter: (a, b) => (a.rastreio ?? '').localeCompare(b.rastreio ?? ''),
      render: (v: string | null, record: Order) => {
        if (!v) return <span style={{ color: '#666' }}>—</span>;
        if (record.ml_shipment_id) {
          return (
            <Button
              type="link"
              size="small"
              style={{ fontFamily: 'monospace', fontSize: 13, padding: 0 }}
              onClick={() => {
                setTrackingOrderId(record.dbId);
                setTrackingOrderStatus(record.situacao.valor);
                setTrackingModalOpen(true);
              }}
            >
              {v}
            </Button>
          );
        }
        return <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{v}</span>;
      },
    },
    {
      title: 'Status', dataIndex: ['situacao', 'valor'], key: 'status', width: 140,
      sorter: (a, b) => a.situacao.valor.localeCompare(b.situacao.valor),
      render: (status: OrderStatus, record: Order) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>
          {(record as any).ml_claim_id && (
            <WarningOutlined style={{ color: '#faad14', fontSize: 14 }} title="Reclamação em andamento" />
          )}
        </div>
      ),
    },
    {
      title: 'Nota Fiscal', dataIndex: 'notaFiscal', key: 'notaFiscal', width: 120,
      sorter: (a, b) => {
        const na = a.notaFiscal?.numero ?? '';
        const nb = b.notaFiscal?.numero ?? '';
        return na.localeCompare(nb);
      },
      render: (nf: { numero: string; emitida: boolean } | null, record: Order) => {
        if (record.ml_fiscal_release_at) {
          const releaseAt = new Date(record.ml_fiscal_release_at);
          if (!Number.isNaN(releaseAt.getTime()) && releaseAt.getTime() > Date.now()) {
            const formatted = formatReleaseWindow(record.ml_fiscal_release_at);
            const content = (
              <Tag color="orange">
                Libera em {formatted.when}
              </Tag>
            );
            return (
              <Tooltip title={`Venda aguardando janela do ML para vínculo fiscal/etiqueta${formatted.remaining ? ` (${formatted.remaining})` : ''}`}>
                {content}
              </Tooltip>
            );
          }
        }
        if (!nf) return <Tag>Não emitida</Tag>;
        const tag = <Tag color={nf.emitida ? 'green' : 'orange'}>{nf.numero}</Tag>;
        if (record.nfe_danfe_url) {
          return (
            <a href={record.nfe_danfe_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              {tag}
            </a>
          );
        }
        return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{tag}</div>;
      },
    },
    {
      title: 'Pedido Compra',
      key: 'pedidoCompra',
      dataIndex: 'dslite_id',
      width: 120,
      align: 'center',
      sorter: (a, b) => {
        const va = isValidDsliteId(a.dslite_id) ? 1 : 0;
        const vb = isValidDsliteId(b.dslite_id) ? 1 : 0;
        return va - vb;
      },
      render: (_: string | null, record: Order) => {
        const hasPurchaseOrder = !!isValidDsliteId(record.dslite_id);
        if (!hasPurchaseOrder) return <Tag color="orange">NÃO</Tag>;
        if (isDsliteRejected(record.dslite_status)) return <Tag color="red">REJEITADO</Tag>;
        return <Tag color="green">SIM</Tag>;
      },
    },
    {
      title: 'Lucro', dataIndex: 'lucro', key: 'lucro', width: 110,
      sorter: (a, b) => (a.lucro ?? -Infinity) - (b.lucro ?? -Infinity),
      render: (v: number | null) => {
        if (v === null) return <span style={{ color: '#666' }}>—</span>;
        return (
          <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            {formatCurrency(v)}
          </span>
        );
      },
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const items: { key: string; label: React.ReactNode; disabled?: boolean; icon?: React.ReactNode }[] = [
          { key: 'view', label: 'Visualizar Detalhes' },
        ];
        if (record.ml_shipment_id) {
          items.push({
            key: 'track',
            label: 'Rastrear Envio',
            icon: <CarOutlined />,
          });
        }
        const hasDsliteId = !!isValidDsliteId(record.dslite_id);
        if (!hasDsliteId && !['cancelado', 'entregue', 'devolvido', 'recusado'].includes(record.situacao.valor)) {
          items.push({
            key: 'dslite',
            label: 'Criar Pedido DSLite (Brasil NFe)',
            icon: <CarOutlined />,
          });
        }
        if (hasDsliteId && !record.dslite_etiqueta_enviada) {
          items.push({
            key: 'etiqueta',
            label: 'Enviar Etiqueta DSLite',
            icon: <UploadOutlined />,
          });
        }
        if (hasDsliteId && isDsliteRejected(record.dslite_status)) {
          items.push({
            key: 'desvincular_dslite',
            label: 'Desvincular compra DSLite',
            icon: <WarningOutlined />,
          });
        }
        return (
          <Dropdown
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === 'track') {
                  setTrackingOrderId(record.dbId);
                  setTrackingOrderStatus(record.situacao.valor);
                  setTrackingModalOpen(true);
                }
                if (key === 'dslite') criarPedidoDslite(record, 'brasilnfe');
                if (key === 'etiqueta') enviarEtiquetaAutomatica(record);
                if (key === 'desvincular_dslite') desvincularCompraDslite(record);
              },
            }}
            trigger={['click']}
          >
            <Button type="text" size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Pedidos</Title>

      {/* Mini Dashboard */}
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Pedidos</span>}
              value={summary.count}
              valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Valor Vendido</span>}
              value={formatCurrency(summary.total)}
              valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Lucro Total</span>}
              value={formatCurrency(summary.lucroSum)}
              valueStyle={{ color: summary.lucroSum >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Margem Média</span>}
              value={`${summary.margem.toFixed(1)}%`}
              valueStyle={{ color: '#13c2c2', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
        <Divider style={{ borderColor: '#303030', margin: '12px 0' }} />
        <Row gutter={[8, 8]} align="middle">
          {Object.entries(summary.statusCounts).map(([status, count]) => (
            <Col key={status}>
              <Tag color={statusColor[status as OrderStatus]} style={{ fontSize: 13, padding: '4px 10px' }}>
                {statusLabel[status as OrderStatus]}: {count}
              </Tag>
            </Col>
          ))}
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por número ou cliente"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={v => setStatusFilter(v as OrderStatus | '')}
              options={statusOptions}
              style={{ width: 160 }}
              allowClear
              onClear={() => setStatusFilter('')}
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(_, dateStrings) => setDateRange([dateStrings[0] || null, dateStrings[1] || null])}
              format="DD/MM/YYYY"
              style={{ width: 240 }}
            />
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Valor mín" value={priceMin} onChange={v => setPriceMin(v ?? null)} style={{ width: 110 }} />
              <InputNumber placeholder="Valor máx" value={priceMax} onChange={v => setPriceMax(v ?? null)} style={{ width: 110 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>
      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<Order>
            storageKey="pedidos"
            dataSource={orders}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} pedidos`,
              onChange: (p) => setPage(p),
            }}
            scroll={{ x: 900 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
      <TrackingModal
        open={trackingModalOpen}
        onClose={() => setTrackingModalOpen(false)}
        orderId={trackingOrderId}
        orderStatus={trackingOrderStatus}
      />
      <ProgressModal
        open={dsliteProgressOpen}
        title="Criando Pedido DSLite"
        steps={dsliteSteps}
        onClose={() => {
          fecharModalDslite();
          fetchData();
        }}
        onCancel={tentarNovamenteDslite}
        showCloseButton={dsliteSteps.some(s => s.status === 'error' || s.status === 'success' || s.status === 'warning')}
      />
      <ProgressModal
        open={etiquetaProgressOpen}
        title="Enviando Etiqueta"
        steps={etiquetaSteps}
        onClose={() => {
          setEtiquetaProgressOpen(false);
          setEtiquetaDuplicateDecision(null);
          fetchData();
        }}
        showCloseButton={etiquetaSteps.some(s => s.status === 'error' || s.status === 'success')}
        customActions={etiquetaDuplicateDecision ? [
          {
            key: 'open_nf_found',
            label: 'Abrir Nota Encontrada',
            onClick: () => {
              const link = etiquetaDuplicateDecision.existingNfe?.linkInterno || null;
              if (link) {
                window.open(link, '_blank', 'noopener,noreferrer');
                return;
              }
              const chave = etiquetaDuplicateDecision.existingNfe?.chave || '';
              if (chave) {
                navigator.clipboard?.writeText(chave);
                messageApi.info('Chave da NF copiada para verificação.');
              }
            },
          },
          {
            key: 'use_existing_nf',
            label: 'Prosseguir com Nota Encontrada',
            primary: true,
            onClick: () => { void executarAcaoDuplicidadeEtiqueta('use_existing'); },
          },
          {
            key: 'reissue_nf',
            label: 'Gerar Nova Nota',
            danger: true,
            onClick: () => { void executarAcaoDuplicidadeEtiqueta('reissue'); },
          },
        ] : []}
      />
    </div>
  );
}
