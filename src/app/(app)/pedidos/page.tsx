'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin, Modal, message, Statistic, Divider, Tooltip, Upload,
} from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined, CarOutlined, WarningOutlined, UploadOutlined } from '@ant-design/icons';
import TrackingModal from '@/components/modals/TrackingModal';
import ProgressModal, { ProgressStep } from '@/components/modals/ProgressModal';
import { formatCurrency } from '@/lib/format';
import type { Database } from '@/types/database';
import type { Order, OrderStatus } from '@/types/order';
import { appendRemoteSortParams, getRemoteSortOrder, type RemoteSortState, resolveRemoteSortState } from '@/lib/remote-sort';
import { formatMlReleaseWindow, getMlReleaseComparableDate } from '@/lib/ml/release-window-display';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const HAYAMAX_FORNECEDOR_ID = '2';

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

const nfeExpectedStatuses = new Set<OrderStatus>([
  'etiqueta_impressa',
  'coletado',
  'em_transito',
  'saiu_entrega',
  'dest_ausente',
  'atendido',
  'faturado',
  'entregue',
]);

function initDsliteOrderSteps(): ProgressStep[] {
  return [
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
}

function isValidDsliteId(val: string | null | undefined): string | null {
  if (!val || val === 'undefined' || val === 'null' || val.trim() === '') return null;
  return val;
}

function initWhatsappLabelSteps(): ProgressStep[] {
  return [
    { label: 'Validando pedido e WhatsApp', status: 'loading', detail: 'Validando número de destino e pedido de venda' },
    { label: 'Localizando envio Mercado Livre', status: 'pending' },
    { label: 'Buscando pedido de compra vinculado', status: 'pending' },
    { label: 'Localizando etiqueta salva', status: 'pending' },
    { label: 'Vinculando XML da NF no Mercado Livre', status: 'pending' },
    { label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
    { label: 'Salvando etiqueta no sistema', status: 'pending' },
    { label: 'Gerando links públicos da etiqueta e NF', status: 'pending' },
    { label: 'Enviando mensagem pelo WhatsApp', status: 'pending' },
  ];
}

function isDsliteRejected(status: string | null | undefined): boolean {
  return String(status || '').toLowerCase().includes('rejeitado');
}

function formatReleaseWindow(value: string): { when: string; remaining: string | null } {
  return formatMlReleaseWindow(value);
}

function resolveSerieFromNfeChave(chave: string | null | undefined): string | null {
  const normalized = String(chave || '').replace(/\D/g, '');
  if (normalized.length !== 44) return null;
  const serieRaw = normalized.slice(22, 25);
  if (!/^\d{3}$/.test(serieRaw)) return null;
  return String(Number(serieRaw));
}

function formatNumeroWithSerie(numero: string, nfeChave: string | null | undefined): string {
  const serie = resolveSerieFromNfeChave(nfeChave);
  return serie ? `NF ${numero} • Série ${serie}` : `NF ${numero}`;
}

function sanitizeMlTechnicalSuffix(name: string): string {
  const raw = String(name || '').trim();
  const match = raw.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (!match) return raw;
  const base = match[1].trim();
  const suffix = match[2].trim();
  if (!base) return raw;
  const hasDigits = /\d/.test(suffix);
  const hasOnlyTechnicalChars = /^[A-Z0-9_.-]+$/.test(suffix.toUpperCase());
  if (hasDigits || hasOnlyTechnicalChars) return base;
  return raw;
}

function getDisplayClientName(order: Pick<Order, 'contato'>): string {
  const contatoNome = String(order.contato?.nome || '').trim();
  if (!contatoNome) return '—';
  return sanitizeMlTechnicalSuffix(contatoNome);
}

function getDisplayFiscalClientName(order: Pick<Order, 'billing_nome'>): string {
  return String(order.billing_nome || '').trim();
}

const DSLITE_PLACEHOLDER_LABEL_SOURCE = 'placeholder_release_window';

function getDsliteActionTag(action: Order['dslite_next_action']) {
  switch (action) {
    case 'confirm_supplier_payment':
      return { color: 'gold', label: 'PIX pendente' };
    case 'send_supplier_receipt':
      return { color: 'orange', label: 'Comprovante pendente' };
    case 'resume_dslite_flow':
      return { color: 'gold', label: 'Retomar fluxo' };
    case 'wait_ml_label':
      return { color: 'cyan', label: 'Aguardando ML' };
    case 'complete_dslite_label':
      return { color: 'blue', label: 'Etiqueta pendente' };
    case 'done':
      return { color: 'green', label: 'OK' };
    case 'blocked':
      return { color: 'red', label: 'Bloqueado' };
    case 'create_dslite_order':
    default:
      return { color: 'orange', label: 'Criar compra' };
  }
}

function formatSupplierWhatsappReason(reason: unknown): string {
  switch (String(reason || '')) {
    case 'supplier_phone_missing':
      return 'WhatsApp do fornecedor não cadastrado';
    case 'receipt_missing':
      return 'Comprovante não encontrado';
    case 'supplier_not_found':
      return 'Fornecedor não encontrado';
    default:
      return String(reason || 'motivo não informado');
  }
}

function getSupplierSetupWarning(order: Order): string | null {
  if (order.supplier_payment_mode !== 'prepaid_pix') return null;
  const pixMissing = !String(order.supplier_pix_key || '').trim();
  const phoneMissing = !String(order.fornecedor_telefone || '').replace(/\D/g, '');
  if (pixMissing && phoneMissing) return 'Chave PIX e WhatsApp do fornecedor não cadastrados';
  if (pixMissing) return 'Chave PIX do fornecedor não cadastrada';
  if (phoneMissing) return 'WhatsApp do fornecedor não cadastrado';
  return null;
}

function mapDBtoOrder(item: Database['public']['Tables']['pedidos']['Row']): Order {
  return {
    id: item.numero,
    dbId: item.id,
    numero: item.numero,
    numeroLoja: item.numero_loja || '',
    data: item.data_venda || item.data || new Date().toISOString(),
    dataCriacao: item.data || null,
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
    dslite_label_source: item.dslite_label_source || null,
    compra_id: (item as any).compra_id || null,
    fornecedor_nome: (item as any).fornecedor_nome || null,
    fornecedor_id: (item as any).fornecedor_id || null,
    fornecedor_telefone: (item as any).fornecedor_telefone || null,
    supplier_payment_mode: (item as any).supplier_payment_mode || null,
    supplier_payment_status: (item as any).supplier_payment_status || null,
    supplier_payment_amount: (item as any).supplier_payment_amount ?? null,
    supplier_payment_receipt_path: (item as any).supplier_payment_receipt_path || null,
    supplier_payment_reference: (item as any).supplier_payment_reference || null,
    supplier_payment_notes: (item as any).supplier_payment_notes || null,
    supplier_pix_key: (item as any).supplier_pix_key || null,
    dslite_next_action: (item as any).dslite_next_action || undefined,
    dslite_next_action_label: (item as any).dslite_next_action_label || null,
    ml_claim_id: item.ml_claim_id,
    ml_shipment_id: item.ml_shipment_id,
    ml_invoice_reported: item.ml_invoice_reported || false,
    ml_order_id: item.ml_order_id,
    ml_pack_id: item.ml_pack_id,
    billing_nome: item.billing_nome,
    ml_fiscal_release_at: item.ml_fiscal_release_at,
    ml_fiscal_release_reason: item.ml_fiscal_release_reason,
    ml_fiscal_release_source: item.ml_fiscal_release_source,
    ml_fiscal_release_checked_at: item.ml_fiscal_release_checked_at,
    ml_label_storage_path: item.ml_label_storage_path,
    nfe_chave: item.nfe_chave,
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
  mlCompatibleCount: number;
  mlCompatibleTotal: number;
  mlCompatibleMissingPaymentData: number;
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

interface DslitePaymentPrompt {
  order: Order;
  compraId: string;
  dsid: string;
  resumeAfterConfirm?: boolean;
  fornecedorNome?: string | null;
  supplierPaymentAmount?: number | null;
  supplierPixKey?: string | null;
  supplierPixKeyMissing?: boolean;
  supplierPhoneMissing?: boolean;
}

export default function PedidosPage() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'data', sortOrder: 'desc' });
  const [summary, setSummary] = useState<SummaryData>({
    count: 0,
    total: 0,
    lucroSum: 0,
    ticket: 0,
    margem: 0,
    statusCounts: {},
    mlCompatibleCount: 0,
    mlCompatibleTotal: 0,
    mlCompatibleMissingPaymentData: 0,
  });

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
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [sendingWhatsappLabel, setSendingWhatsappLabel] = useState(false);
  const [whatsappOrder, setWhatsappOrder] = useState<Order | null>(null);
  const [whatsappUsePlaceholderLabel, setWhatsappUsePlaceholderLabel] = useState(false);
  const [whatsappProgressOpen, setWhatsappProgressOpen] = useState(false);
  const [whatsappSteps, setWhatsappSteps] = useState<ProgressStep[]>(initWhatsappLabelSteps());
  const whatsappPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dsliteProgressOpen, setDsliteProgressOpen] = useState(false);
  const dslitePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dslitePaymentPrompt, setDslitePaymentPrompt] = useState<DslitePaymentPrompt | null>(null);
  const [dslitePaymentModalOpen, setDslitePaymentModalOpen] = useState(false);
  const [dslitePaymentReference, setDslitePaymentReference] = useState('');
  const [dslitePaymentNotes, setDslitePaymentNotes] = useState('');
  const [dslitePaymentReceiptFile, setDslitePaymentReceiptFile] = useState<File | null>(null);
  const [confirmingDslitePayment, setConfirmingDslitePayment] = useState(false);
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

  useEffect(() => {
    const initialSearch = new URLSearchParams(window.location.search).get('search')?.trim();
    if (!initialSearch) return;
    setSearch(initialSearch);
    setPage(1);
  }, []);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    appendRemoteSortParams(params, sort);
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    return params;
  }, [page, sort, search, statusFilter, dateRange, priceMin, priceMax]);

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
          mlCompatibleCount: json.mlCompatibleCount || 0,
          mlCompatibleTotal: json.mlCompatibleTotal || 0,
          mlCompatibleMissingPaymentData: json.mlCompatibleMissingPaymentData || 0,
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
    if (whatsappPollRef.current) clearTimeout(whatsappPollRef.current);
  }, []);

  const openWhatsappLabelModal = (order: Order, usePlaceholderLabel = false) => {
    setWhatsappOrder(order);
    setWhatsappUsePlaceholderLabel(usePlaceholderLabel);
    setWhatsappPhone(order.fornecedor_telefone || '');
    setWhatsappModalOpen(true);
  };

  const closeWhatsappLabelModal = () => {
    if (sendingWhatsappLabel) return;
    setWhatsappModalOpen(false);
    setWhatsappOrder(null);
    setWhatsappUsePlaceholderLabel(false);
    setWhatsappPhone('');
  };

  const handleSendWhatsappLabel = async () => {
    if (!whatsappOrder) return;
    const phoneNumber = whatsappPhone.replace(/\D/g, '');
    if (!phoneNumber) {
      messageApi.warning('Informe o número de WhatsApp do destinatário.');
      return;
    }

    setSendingWhatsappLabel(true);
    setWhatsappSteps(initWhatsappLabelSteps());
    setWhatsappProgressOpen(true);
    setWhatsappModalOpen(false);
    try {
      const res = await fetch(`/api/pedidos/${whatsappOrder.dbId}/enviar-etiqueta-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, usePlaceholderLabel: whatsappUsePlaceholderLabel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.jobId) throw new Error(json.error || 'Erro ao iniciar envio de etiqueta por WhatsApp');

      const poll = async () => {
        const statusRes = await fetch(`/api/pedidos/${whatsappOrder.dbId}/enviar-etiqueta-whatsapp/status?jobId=${encodeURIComponent(json.jobId)}`);
        const statusData = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok || !statusData?.success) {
          throw new Error(statusData?.error || 'Falha ao consultar status do envio por WhatsApp');
        }

        const mapped: ProgressStep[] = (statusData.steps || []).map((step: any) => ({
          label: step.label,
          status: step.status,
          detail: step.detail,
          error: step.error,
        }));
        if (mapped.length) setWhatsappSteps(mapped);

        const state = String(statusData.state || '');
        if (state === 'running') {
          whatsappPollRef.current = setTimeout(() => {
            poll().catch((err) => {
              setWhatsappSteps(prev => {
                const updated = [...prev];
                const firstActive = updated.findIndex(s => s.status === 'loading' || s.status === 'pending');
                const idx = firstActive >= 0 ? firstActive : updated.length - 1;
                updated[idx] = { ...updated[idx], status: 'error', error: err.message || 'Erro ao acompanhar envio por WhatsApp' };
                return updated;
              });
              setSendingWhatsappLabel(false);
            });
          }, 1200);
          return;
        }

        setSendingWhatsappLabel(false);
        if (state === 'success' || state === 'warning') {
          if (!whatsappUsePlaceholderLabel && whatsappOrder?.dbId) {
            setOrders(prev => prev.map((order) => (
              order.dbId === whatsappOrder.dbId
                ? {
                    ...order,
                    dslite_etiqueta_enviada: true,
                    dslite_label_source: 'mercado_livre',
                    dslite_next_action: 'done',
                    dslite_next_action_label: 'OK',
                  }
                : order
            )));
          }
          messageApi.success(statusData.data?.message || 'Etiqueta enviada por WhatsApp.');
          setWhatsappOrder(null);
          setWhatsappUsePlaceholderLabel(false);
          return;
        }

        if (state === 'error') {
          throw new Error(statusData.data?.error || 'Erro ao enviar etiqueta por WhatsApp');
        }
      };

      await poll();
    } catch (err: any) {
      setWhatsappSteps(prev => {
        const updated = [...prev];
        const firstActive = updated.findIndex(s => s.status === 'loading' || s.status === 'pending');
        const idx = firstActive >= 0 ? firstActive : updated.length - 1;
        updated[idx] = { ...updated[idx], status: 'error', error: err.message || 'Erro ao enviar etiqueta por WhatsApp' };
        return updated.map((step, stepIdx) => (
          stepIdx > idx && step.status === 'pending'
            ? { ...step, status: 'warning', detail: 'Não executada por encerramento antecipado' }
            : step
        ));
      });
      messageApi.error(err.message || 'Erro ao enviar etiqueta por WhatsApp');
      setSendingWhatsappLabel(false);
    } finally {
    }
  };

  const resolveNotaFiscalPdfUrl = useCallback(async (order: Order): Promise<string | null> => {
    if (!order.dbId) {
      messageApi.error('Pedido sem referência interna para localizar a DANFE');
      return null;
    }
    const res = await fetch(`/api/notas-fiscais/${order.dbId}/pdf`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.url) {
      messageApi.error(json?.error || 'Não foi possível localizar o PDF da nota fiscal');
      return null;
    }
    return String(json.url);
  }, [messageApi]);

  const handleOpenNotaFiscalPdf = useCallback(async (order: Order) => {
    const url = await resolveNotaFiscalPdfUrl(order);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [resolveNotaFiscalPdfUrl]);

  const pollDsliteJob = async (jobId: string, order: Order) => {
    const res = await fetch(`/api/dslite/pedido/status?jobId=${encodeURIComponent(jobId)}`);
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
        pollDsliteJob(jobId, order).catch((err) => {
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
      if (state === 'warning' && payload.stage === 'await_supplier_payment' && payload.compra_id) {
        setDslitePaymentPrompt({
          order,
          compraId: String(payload.compra_id),
          dsid: String(payload.dsid || order.dslite_id || ''),
          resumeAfterConfirm: true,
          fornecedorNome: payload.fornecedor_nome || null,
          supplierPaymentAmount: Number(payload.supplier_payment_amount || 0) || null,
          supplierPixKey: payload.supplier_pix_key || null,
          supplierPixKeyMissing: Boolean(payload.supplier_pix_key_missing),
          supplierPhoneMissing: Boolean(payload.supplier_phone_missing),
        });
        setDslitePaymentReference('');
        setDslitePaymentNotes('');
        setDslitePaymentReceiptFile(null);
        setDslitePaymentModalOpen(true);
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

  const criarPedidoDslite = async (order: Order, nfeProvider: 'brasilnfe' = 'brasilnfe') => {
    const steps = initDsliteOrderSteps();
    setDsliteSteps(steps);
    setDsliteProgressOpen(true);
    setDslitePaymentModalOpen(false);
    setDslitePaymentPrompt(null);
    setDslitePaymentReference('');
    setDslitePaymentNotes('');
    setDslitePaymentReceiptFile(null);

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

      await pollDsliteJob(startData.jobId, order);
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
    setDslitePaymentModalOpen(false);
  };

  const tentarNovamenteDslite = () => {
    pararPollingDslite();
    setDsliteProgressOpen(false);
  };

  const abrirConfirmacaoPixPedido = (order: Order) => {
    if (!order.compra_id || !order.dslite_id) {
      messageApi.error('Compra DSLite vinculada não encontrada para confirmar PIX.');
      return;
    }
    setDslitePaymentPrompt({
      order,
      compraId: order.compra_id,
      dsid: order.dslite_id,
      resumeAfterConfirm: true,
      fornecedorNome: order.fornecedor_nome || null,
      supplierPaymentAmount: order.supplier_payment_amount ?? null,
      supplierPixKey: order.supplier_pix_key || null,
      supplierPixKeyMissing: !order.supplier_pix_key,
      supplierPhoneMissing: !String(order.fornecedor_telefone || '').replace(/\D/g, ''),
    });
    setDslitePaymentReference(order.supplier_payment_reference || '');
    setDslitePaymentNotes(order.supplier_payment_notes || '');
    setDslitePaymentReceiptFile(null);
    setDslitePaymentModalOpen(true);
  };

  const confirmarPagamentoDsliteNoFluxo = async () => {
    if (!dslitePaymentPrompt) return;
    const hasSavedReceipt = Boolean(dslitePaymentPrompt.order.supplier_payment_receipt_path);
    const resumeOnly = Boolean(
      dslitePaymentPrompt.resumeAfterConfirm
      && dslitePaymentPrompt.order.supplier_payment_status === 'paid'
      && hasSavedReceipt
      && !dslitePaymentReceiptFile,
    );
    if (!dslitePaymentReceiptFile && !hasSavedReceipt && !resumeOnly) {
      messageApi.warning('Anexe o comprovante do PIX para continuar o fluxo.');
      return;
    }

    setConfirmingDslitePayment(true);
    try {
      const form = new FormData();
      form.append('resume_dslite_flow', dslitePaymentPrompt.resumeAfterConfirm ? 'true' : 'false');
      if (resumeOnly) {
        form.append('resume_only', 'true');
      }
      if (dslitePaymentReceiptFile) {
        form.append('receipt', dslitePaymentReceiptFile);
      }
      if (dslitePaymentReference.trim()) {
        form.append('supplier_payment_reference', dslitePaymentReference.trim());
      }
      if (dslitePaymentNotes.trim()) {
        form.append('supplier_payment_notes', dslitePaymentNotes.trim());
      }

      const res = await fetch(`/api/compras/${dslitePaymentPrompt.compraId}/confirmar-pagamento`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Falha ao confirmar PIX e retomar fluxo DSLite');
      }

      setDslitePaymentModalOpen(false);
      setDslitePaymentPrompt(null);
      setDslitePaymentReceiptFile(null);
      setDslitePaymentReference('');
      setDslitePaymentNotes('');
      if (dslitePaymentPrompt.resumeAfterConfirm && json.jobId) {
        setDsliteSteps(initDsliteOrderSteps());
        setDsliteProgressOpen(true);
        messageApi.success('PIX confirmado. Fluxo DSLite retomado.');
        await pollDsliteJob(String(json.jobId), dslitePaymentPrompt.order);
      } else if (dslitePaymentPrompt.resumeAfterConfirm && json.resume?.error) {
        messageApi.warning(`PIX confirmado, mas o fluxo não foi retomado: ${json.resume.error}`);
        fetchData();
      } else {
        const whatsappDetail = json.whatsapp?.sent
          ? 'WhatsApp enviado.'
          : `WhatsApp não enviado${json.whatsapp?.reason ? `: ${formatSupplierWhatsappReason(json.whatsapp.reason)}` : ''}.`;
        messageApi.success(`Comprovante processado. ${whatsappDetail}`);
        fetchData();
      }
    } catch (err: any) {
      messageApi.error(err?.message || 'Erro ao confirmar PIX');
    } finally {
      setConfirmingDslitePayment(false);
    }
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
      const res = await fetch('/api/dslite/completar-etiqueta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: order.dbId,
          dsid: order.dslite_id,
          ...(duplicateAction ? { nfeDuplicateAction: duplicateAction } : {}),
        }),
      });
      const responseText = await res.text();
      let data: any = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        const isHtml = /^\s*</.test(responseText);
        throw new Error(isHtml
          ? `Servidor retornou HTML (${res.status}) em vez de JSON ao completar etiqueta DSLite.`
          : `Resposta inválida ao completar etiqueta DSLite (${res.status}).`);
      }

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
        const operationStatus = String(data?.data?.operationStatus || '');
        if (operationStatus === 'label_sent') {
          messageApi.success(data?.data?.message || 'Etiqueta real enviada para DSLite.');
        } else if (operationStatus === 'placeholder_label_sent') {
          messageApi.warning(data?.data?.message || 'Etiqueta genérica Hayamax enviada. Etiqueta real ainda ficará pendente.');
        } else if (operationStatus === 'waiting_ml_label') {
          messageApi.warning(data?.data?.message || 'Etiqueta ainda não liberada pelo Mercado Livre.');
        } else if (operationStatus === 'already_done') {
          messageApi.info('Etiqueta já havia sido enviada anteriormente.');
        }
      } else {
        const step = String(data?.step || '');
        const actionRequired = String(data?.actionRequired || data?.details?.actionRequired || '');
        const errMsg = data?.error || 'Falha ao completar etiqueta DSLite';
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
      title: 'Número', dataIndex: 'numero', key: 'numero', width: 180,
      sorter: true,
      sortOrder: getRemoteSortOrder('numero', sort),
      render: (num: number, record: Order) => (
        <div>
          <a
            href={`https://www.mercadolivre.com.br/vendas/${record.ml_pack_id || num}/detalhe`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Order ID: ${record.ml_order_id || '—'} | Pack ID: ${record.ml_pack_id || '—'}`}
            style={{ fontFamily: 'monospace', color: '#1677ff', textDecoration: 'none' }}
          >
            #{String(num).padStart(6, '0')}
          </a>
          <div style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
            PACK ID {record.ml_pack_id || '—'}
          </div>
        </div>
      ),
    },
    {
      title: 'Data', dataIndex: 'data', key: 'data', width: 160,
      sorter: true,
      sortOrder: getRemoteSortOrder('data', sort),
      render: (d: string, record: Order) => {
        const display = new Date(d).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        if (!record.dataCriacao || record.dataCriacao === d) return display;
        const createdAt = new Date(record.dataCriacao).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        return (
          <Tooltip title={`Criado em ${createdAt}`}>
            <span>{display}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Cliente', dataIndex: ['contato', 'nome'], key: 'cliente',
      sorter: true,
      sortOrder: getRemoteSortOrder('cliente', sort),
      render: (_: string, record: Order) => {
        const clientName = getDisplayClientName(record);
        const fiscalName = getDisplayFiscalClientName(record);
        const showFiscalName = fiscalName && fiscalName.toLowerCase() !== clientName.toLowerCase();
        return (
          <div>
            <div style={{ color: '#e0e0e0' }}>{clientName}</div>
            {showFiscalName && (
              <Tooltip title="Nome fiscal vindo do billing_info do Mercado Livre">
                <div style={{ color: '#888', fontSize: 11 }}>
                  Fiscal: {fiscalName}
                </div>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Total', dataIndex: 'total', key: 'total', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('total', sort),
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Status', dataIndex: ['situacao', 'valor'], key: 'situacao', width: 140,
      sorter: true,
      sortOrder: getRemoteSortOrder('situacao', sort),
      render: (status: OrderStatus, record: Order) => {
        const canTrack = Boolean(record.ml_shipment_id);
        const statusTag = (
          <Tag
            color={statusColor[status]}
            style={{ marginInlineEnd: 0, cursor: canTrack ? 'pointer' : 'default' }}
            onClick={() => {
              if (!canTrack) return;
              setTrackingOrderId(record.dbId);
              setTrackingOrderStatus(record.situacao.valor);
              setTrackingModalOpen(true);
            }}
          >
            {statusLabel[status]}
          </Tag>
        );
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {canTrack ? (
              <Tooltip title={record.rastreio ? `Rastrear envio ${record.rastreio}` : 'Rastrear envio'}>
                {statusTag}
              </Tooltip>
            ) : statusTag}
            {(record as any).ml_claim_id && (
              <WarningOutlined style={{ color: '#faad14', fontSize: 14 }} title="Reclamação em andamento" />
            )}
          </div>
        );
      },
    },
    {
      title: 'Nota Fiscal', dataIndex: 'notaFiscal', key: 'nota_fiscal_numero', width: 220,
      sorter: true,
      sortOrder: getRemoteSortOrder('nota_fiscal_numero', sort),
      render: (nf: { numero: string; emitida: boolean } | null, record: Order) => {
        if (record.ml_fiscal_release_at) {
          const releaseAt = getMlReleaseComparableDate(record.ml_fiscal_release_at);
          if (releaseAt && releaseAt.getTime() > Date.now()) {
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
        if (!nf) {
          const nfeStatus = String(record.nfe_status || '').toLowerCase();
          if (nfeExpectedStatuses.has(record.situacao.valor) && (!nfeStatus || nfeStatus === 'pendente')) {
            return (
              <Tooltip title="Pedido já avançou, mas o snapshot local da NF ainda não foi reconciliado com a Brasil NFe.">
                <Tag color="orange">NF pendente sync</Tag>
              </Tooltip>
            );
          }
          return <Tag>Não emitida</Tag>;
        }
        const numeroFormatado = formatNumeroWithSerie(String(nf.numero), record.nfe_chave);
        const tag = <Tag color={nf.emitida ? 'green' : 'orange'}>{numeroFormatado}</Tag>;
        if (nf.emitida && record.dbId) {
          return (
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                handleOpenNotaFiscalPdf(record);
              }}
              style={{ textDecoration: 'none' }}
            >
              {tag}
            </a>
          );
        }
        return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{tag}</div>;
      },
    },
    {
      title: 'Pedido Compra',
      key: 'pedido_compra',
      dataIndex: 'dslite_id',
      width: 120,
      align: 'center',
      sorter: true,
      sortOrder: getRemoteSortOrder('pedido_compra', sort),
      render: (_: string | null, record: Order) => {
        const purchaseOrderId = isValidDsliteId(record.dslite_id);
        const actionTag = getDsliteActionTag(record.dslite_next_action);
        const supplierWarning = getSupplierSetupWarning(record);
        const usesPlaceholderLabel = record.dslite_label_source === DSLITE_PLACEHOLDER_LABEL_SOURCE;
        const supplierWarningTag = supplierWarning ? (
          <Tooltip title={supplierWarning}>
            <Tag color="red" style={{ marginInlineEnd: 0, fontSize: 11 }}>
              Fornecedor incompleto
            </Tag>
          </Tooltip>
        ) : null;
        if (!purchaseOrderId) {
          return (
            <Space direction="vertical" size={2} align="center">
              <Tag color="orange" style={{ marginInlineEnd: 0 }}>NÃO</Tag>
              <Tag color={actionTag.color} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                {actionTag.label}
              </Tag>
              {usesPlaceholderLabel ? (
                <Tag color="orange" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                  Padrão Hayamax
                </Tag>
              ) : null}
              {supplierWarningTag}
            </Space>
          );
        }
        if (isDsliteRejected(record.dslite_status)) return <Tag color="red">REJEITADO</Tag>;
        return (
          <Space direction="vertical" size={2} align="center">
            <Link
              href={`/compras?search=${encodeURIComponent(purchaseOrderId)}`}
              style={{ textDecoration: 'none' }}
            >
              <Tag color="green" style={{ cursor: 'pointer', marginInlineEnd: 0 }}>
                {purchaseOrderId}
              </Tag>
            </Link>
            <Tag color={actionTag.color} style={{ marginInlineEnd: 0, fontSize: 11 }}>
              {actionTag.label}
            </Tag>
            {usesPlaceholderLabel ? (
              <Tag color="orange" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                Padrão Hayamax
              </Tag>
            ) : null}
            {supplierWarningTag}
          </Space>
        );
      },
    },
    {
      title: 'Lucro', dataIndex: 'lucro', key: 'lucro', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('lucro', sort),
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
        const nextAction = record.dslite_next_action;
        const isHayamaxOrder = String(record.fornecedor_id || '') === HAYAMAX_FORNECEDOR_ID;
        const releaseAt = record.ml_fiscal_release_at ? getMlReleaseComparableDate(record.ml_fiscal_release_at) : null;
        const mlLabelStillBlocked = Boolean(releaseAt && releaseAt.getTime() > Date.now());
        if ((!hasDsliteId || nextAction === 'create_dslite_order') && !['cancelado', 'entregue', 'devolvido', 'recusado'].includes(record.situacao.valor)) {
          items.push({
            key: 'dslite',
            label: 'Criar Pedido DSLite (Brasil NFe)',
            icon: <CarOutlined />,
          });
        }
        if (hasDsliteId && nextAction === 'complete_dslite_label') {
          items.push({
            key: 'etiqueta',
            label: 'Completar etiqueta DSLite',
            icon: <UploadOutlined />,
          });
        }
        if (hasDsliteId && (nextAction === 'confirm_supplier_payment' || nextAction === 'send_supplier_receipt' || nextAction === 'resume_dslite_flow')) {
          items.push({
            key: 'confirm_supplier_payment',
            label: nextAction === 'resume_dslite_flow'
              ? 'Retomar fluxo DSLite'
              : nextAction === 'send_supplier_receipt'
                ? 'Anexar comprovante PIX'
                : 'Confirmar PIX do fornecedor',
            icon: <UploadOutlined />,
          });
        }
        if (isHayamaxOrder && !mlLabelStillBlocked && (record.ml_shipment_id || record.ml_order_id || record.ml_label_storage_path)) {
          items.push({
            key: 'send_whatsapp_label',
            label: 'Enviar etiqueta real Hayamax',
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
                if (key === 'confirm_supplier_payment') abrirConfirmacaoPixPedido(record);
                if (key === 'send_whatsapp_label') openWhatsappLabelModal(record);
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

  const handleTableChange: TableProps<Order>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'data', sortOrder: 'desc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

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
              title={(
                <Tooltip title="Compatível com ML: pagamentos aprovados no período/filtros atuais">
                  <span style={{ color: '#a0a0a0' }}>Valor Vendido</span>
                </Tooltip>
              )}
              value={formatCurrency(summary.mlCompatibleTotal)}
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
          {Object.entries(summary.statusCounts).map(([status, count]) => {
            const typedStatus = status as OrderStatus;
            const active = statusFilter === typedStatus;
            return (
              <Col key={status}>
                <Tag
                  color={statusColor[typedStatus]}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  title={active ? 'Clique para limpar este filtro' : 'Clique para filtrar por este status'}
                  onClick={() => setStatusFilter(active ? '' : typedStatus)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setStatusFilter(active ? '' : typedStatus);
                    }
                  }}
                  style={{
                    fontSize: 13,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    outline: active ? '1px solid #ffffff' : undefined,
                    fontWeight: active ? 700 : 400,
                    userSelect: 'none',
                  }}
                >
                  {statusLabel[typedStatus]}: {count}
                </Tag>
              </Col>
            );
          })}
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
              onChange={(dates) => setDateRange([
                dates?.[0]?.format('YYYY-MM-DD') || null,
                dates?.[1]?.format('YYYY-MM-DD') || null,
              ])}
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
            }}
            onChange={handleTableChange}
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
      <Modal
        title={whatsappUsePlaceholderLabel ? 'Enviar etiqueta genérica por WhatsApp' : 'Enviar etiqueta real Hayamax'}
        open={whatsappModalOpen}
        onCancel={closeWhatsappLabelModal}
        onOk={handleSendWhatsappLabel}
        okText="Enviar"
        cancelText="Cancelar"
        confirmLoading={sendingWhatsappLabel}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text style={{ color: '#a0a0a0' }}>
            Pedido venda #{whatsappOrder?.numero || '—'}.
            {whatsappOrder?.dslite_id ? ` Pedido DSLite #${whatsappOrder.dslite_id}.` : ' Sem pedido DSLite vinculado.'}
            {whatsappUsePlaceholderLabel ? ' Será enviada a etiqueta genérica de teste.' : ''}
            {' '}Confirme o WhatsApp da Hayamax para envio da etiqueta real.
          </Text>
          <Input
            placeholder="Ex.: 11999999999"
            value={whatsappPhone}
            onChange={(event) => setWhatsappPhone(event.target.value)}
            disabled={sendingWhatsappLabel}
          />
        </Space>
      </Modal>
      <ProgressModal
        open={whatsappProgressOpen}
        title="Enviando Etiqueta por WhatsApp"
        steps={whatsappSteps}
        onClose={() => {
          if (whatsappPollRef.current) {
            clearTimeout(whatsappPollRef.current);
            whatsappPollRef.current = null;
          }
          setWhatsappProgressOpen(false);
          setSendingWhatsappLabel(false);
          setWhatsappSteps(initWhatsappLabelSteps());
          fetchData();
        }}
        showCloseButton={whatsappSteps.some(s => s.status === 'error' || s.status === 'success' || s.status === 'warning')}
      />
      <Modal
        title={dslitePaymentPrompt?.resumeAfterConfirm && dslitePaymentPrompt.order.supplier_payment_status === 'paid'
          ? 'Retomar fluxo DSLite'
          : dslitePaymentPrompt?.resumeAfterConfirm === false
            ? 'Enviar comprovante PIX ao fornecedor'
            : 'Confirmar PIX do fornecedor'}
        open={dslitePaymentModalOpen}
        onCancel={() => setDslitePaymentModalOpen(false)}
        onOk={confirmarPagamentoDsliteNoFluxo}
        okText={dslitePaymentPrompt?.resumeAfterConfirm && dslitePaymentPrompt.order.supplier_payment_status === 'paid'
          ? 'Retomar fluxo'
          : dslitePaymentPrompt?.resumeAfterConfirm === false
            ? 'Enviar comprovante'
            : 'Confirmar PIX e continuar'}
        cancelText="Depois"
        confirmLoading={confirmingDslitePayment}
        maskClosable={false}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Text style={{ color: '#a0a0a0' }}>
            {dslitePaymentPrompt?.resumeAfterConfirm && dslitePaymentPrompt.order.supplier_payment_status === 'paid'
              ? 'O comprovante já foi enviado ao fornecedor. Esta ação apenas retoma etiqueta/transportadora.'
              : dslitePaymentPrompt?.resumeAfterConfirm === false
                ? 'Envie ou reenvie o comprovante PIX ao fornecedor sem retomar etapas de etiqueta.'
                : 'O pedido DSLite foi criado e precisa da confirmação do PIX para continuar etiqueta/transportadora.'}
          </Text>
          {(dslitePaymentPrompt?.supplierPixKeyMissing || dslitePaymentPrompt?.supplierPhoneMissing) && (
            <div style={{ background: '#2a1f00', border: '1px solid #faad1444', borderRadius: 8, padding: 12 }}>
              {dslitePaymentPrompt?.supplierPixKeyMissing && (
                <Text style={{ color: '#faad14', display: 'block' }}>
                  Chave PIX não cadastrada para este fornecedor.
                </Text>
              )}
              {dslitePaymentPrompt?.supplierPhoneMissing && (
                <Text style={{ color: '#faad14', display: 'block' }}>
                  WhatsApp do fornecedor não cadastrado. O comprovante será salvo, mas não será enviado automaticamente.
                </Text>
              )}
            </div>
          )}
          <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 12 }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text><b>Pedido DSLite:</b> #{dslitePaymentPrompt?.dsid || '—'}</Text>
              <Text><b>Fornecedor:</b> {dslitePaymentPrompt?.fornecedorNome || '—'}</Text>
              <Text><b>Valor PIX:</b> {formatCurrency(Number(dslitePaymentPrompt?.supplierPaymentAmount || 0))}</Text>
              <Space>
                <Text><b>Chave PIX:</b> {dslitePaymentPrompt?.supplierPixKey || 'Não cadastrada'}</Text>
                {dslitePaymentPrompt?.supplierPixKey && (
                  <Button
                    size="small"
                    onClick={() => {
                      navigator.clipboard?.writeText(dslitePaymentPrompt.supplierPixKey || '');
                      messageApi.success('Chave PIX copiada');
                    }}
                  >
                    Copiar
                  </Button>
                )}
              </Space>
            </Space>
          </div>
          <Input
            placeholder="Referência do PIX (opcional)"
            value={dslitePaymentReference}
            onChange={(event) => setDslitePaymentReference(event.target.value)}
            disabled={confirmingDslitePayment}
          />
          <Input.TextArea
            placeholder="Observações para o fornecedor (opcional)"
            value={dslitePaymentNotes}
            onChange={(event) => setDslitePaymentNotes(event.target.value)}
            disabled={confirmingDslitePayment}
            rows={3}
          />
          {!(dslitePaymentPrompt?.resumeAfterConfirm && dslitePaymentPrompt.order.supplier_payment_status === 'paid' && dslitePaymentPrompt.order.supplier_payment_receipt_path) && (
            <>
              <Upload
                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                maxCount={1}
                beforeUpload={(file) => {
                  setDslitePaymentReceiptFile(file);
                  return false;
                }}
                onRemove={() => {
                  setDslitePaymentReceiptFile(null);
                }}
                fileList={dslitePaymentReceiptFile ? [{
                  uid: 'supplier-payment-receipt',
                  name: dslitePaymentReceiptFile.name,
                  status: 'done' as const,
                }] : []}
                disabled={confirmingDslitePayment}
              >
                <Button icon={<UploadOutlined />} disabled={confirmingDslitePayment}>
                  {dslitePaymentPrompt?.order.supplier_payment_receipt_path ? 'Substituir comprovante' : 'Anexar comprovante'}
                </Button>
              </Upload>
              {dslitePaymentPrompt?.order.supplier_payment_receipt_path && !dslitePaymentReceiptFile && (
                <Text type="secondary">Comprovante já salvo. Você pode continuar sem anexar novamente.</Text>
              )}
            </>
          )}
          {dslitePaymentPrompt?.resumeAfterConfirm && dslitePaymentPrompt.order.supplier_payment_status === 'paid' && dslitePaymentPrompt.order.supplier_payment_receipt_path && (
            <Text type="secondary">Comprovante já salvo e já enviado. Nenhum novo envio será feito.</Text>
          )}
        </Space>
      </Modal>
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
        title="Completando Etiqueta DSLite"
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
