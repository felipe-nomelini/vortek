'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import {
  Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin, message, Statistic, Divider, Tooltip, Descriptions, Tabs,
} from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined, CarOutlined, WarningOutlined, UploadOutlined, FilePdfOutlined } from '@ant-design/icons';
import TrackingModal from '@/components/modals/TrackingModal';
import PedidosDsliteModals from '@/components/pedidos/PedidosDsliteModals';
import PedidosLabelWhatsappModals from '@/components/pedidos/PedidosLabelWhatsappModals';
import { isValidDsliteId, usePedidosDsliteFlow } from '@/components/pedidos/usePedidosDsliteFlow';
import { usePedidosLabelWhatsappFlow } from '@/components/pedidos/usePedidosLabelWhatsappFlow';
import { formatCurrency } from '@/lib/format';
import type { SupplierFilterOption } from '@/lib/produto-filtering';
import type {
  Order,
  OrderStatus,
  PedidoOperacionalApiDto,
  PedidosOperacionaisApiResponse,
} from '@/types/order';
import { appendRemoteSortParams, getRemoteSortOrder, type RemoteSortState, resolveRemoteSortState } from '@/lib/remote-sort';
import { formatMlReleaseWindow, getMlReleaseComparableDate } from '@/lib/ml/release-window-display';
import { getSkuLookupVariants } from '@/lib/sku';
import { normalizeNfeTechnicalStatus } from '@/lib/fiscal/nfe-status';
import {
  PREPARATION_ORDER_STATUSES,
  SHIPPING_ORDER_STATUSES,
  getOperationalUrgencyReasons,
  isPostDispatchOrder,
  type OrdersOperationalView,
} from '@/lib/orders/operational-view';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const OPERATIONAL_VIEW_KEYS: OrdersOperationalView[] = [
  'urgent',
  'preparation',
  'shipping',
  'delivered',
  'all',
];

function parsePersistedOperationalView(value: string | null): OrdersOperationalView | null {
  return OPERATIONAL_VIEW_KEYS.includes(value as OrdersOperationalView)
    ? value as OrdersOperationalView
    : null;
}

function getPedidoItemDisplaySku(sellerSku: string | null): string | null {
  if (!sellerSku) return null;
  return getSkuLookupVariants(sellerSku).find((sku) => /^VTK[A-Z0-9]+$/.test(sku)) || sellerSku;
}

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
    case 'internal_shipping':
      return { color: 'green', label: 'ENVIO INTERNO' };
    case 'blocked':
      return { color: 'red', label: 'Bloqueado' };
    case 'create_dslite_order':
    default:
      return { color: 'orange', label: 'Criar compra' };
  }
}

function FlowStatusLine(props: {
  label: string;
  value: React.ReactNode;
  color: string;
  tooltip?: string | null;
}) {
  const content = (
    <div style={{ display: 'grid', gridTemplateColumns: '8px 84px minmax(0, 1fr)', gap: 6, alignItems: 'center', lineHeight: 1.25 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: props.color }} />
      <Text type="secondary" style={{ fontSize: 11 }}>{props.label}</Text>
      <span style={{ color: '#e0e0e0', fontSize: 11, minWidth: 0 }}>{props.value}</span>
    </div>
  );
  return props.tooltip ? <Tooltip title={props.tooltip}>{content}</Tooltip> : content;
}

function getWhatsappFlowStatus(order: Order) {
  switch (order.whatsapp_label_status) {
    case 'sent':
      return { color: '#52c41a', label: 'Enviada' };
    case 'test_sent':
      return { color: '#faad14', label: 'Teste enviado' };
    case 'pending':
      return { color: '#1677ff', label: 'Processando' };
    case 'on_hold':
      return { color: '#faad14', label: 'Na fila' };
    case 'failed':
      return { color: '#ff4d4f', label: 'Falhou' };
    case 'not_applicable':
      return { color: '#8c8c8c', label: 'Não aplicável' };
    case 'unknown':
      return { color: '#8c8c8c', label: 'Indisponível' };
    case 'not_sent':
    default:
      return { color: '#8c8c8c', label: 'Não enviada' };
  }
}

function getDsliteLabelFlowStatus(order: Order) {
  switch (order.dslite_label_operational_status) {
    case 'real_sent':
      return { color: '#52c41a', label: 'Real confirmada' };
    case 'generic_sent':
      return { color: '#faad14', label: 'Genérica confirmada' };
    case 'provider_shipping':
      return { color: '#52c41a', label: 'Frete DSLite' };
    case 'sent_unverified':
      return { color: '#8c8c8c', label: 'Sem confirmação' };
    case 'failed':
      return { color: '#ff4d4f', label: 'Falhou' };
    case 'unknown':
      return { color: '#8c8c8c', label: 'Indisponível' };
    case 'pending':
    default:
      if (order.dslite_next_action === 'wait_ml_label') {
        return { color: '#1677ff', label: 'Aguardando ML' };
      }
      return { color: '#faad14', label: 'Pendente' };
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

function mapDBtoOrder(item: PedidoOperacionalApiDto): Order {
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
    profit_pending: Boolean(item.operational_profit_pending)
      || (
        Array.isArray(item.snapshot_pendencias)
        && item.snapshot_pendencias.some((value) => (
          String(value) === 'lucro_pendente_frete'
          || String(value) === 'lucro_pendente_produto'
        ))
      ),
    dslite_id: isValidDsliteId(item.dslite_id),
    dslite_status: item.dslite_status,
    dslite_etiqueta_enviada: item.dslite_etiqueta_enviada || false,
    dslite_label_source: item.dslite_label_source || null,
    compra_id: item.compra_id || null,
    fornecedor_nome: item.fornecedor_nome || null,
    fornecedor_id: item.fornecedor_id || null,
    fornecedor_telefone: item.fornecedor_telefone || null,
    internal_stock_available: Boolean(item.internal_stock_available),
    envio_interno_at: item.envio_interno_at || null,
    fulfillment_source: item.fulfillment_source || null,
    fulfillment_selected_at: item.fulfillment_selected_at || null,
    supplier_payment_mode: item.supplier_payment_mode || null,
    supplier_payment_status: item.supplier_payment_status || null,
    supplier_payment_amount: item.supplier_payment_amount ?? null,
    supplier_payment_receipt_path: item.supplier_payment_receipt_path || null,
    supplier_payment_reference: item.supplier_payment_reference || null,
    supplier_payment_notes: item.supplier_payment_notes || null,
    supplier_pix_key: item.supplier_pix_key || null,
    dslite_next_action: item.dslite_next_action || undefined,
    dslite_next_action_label: item.dslite_next_action_label || null,
    ml_claim_id: item.ml_claim_id,
    ml_shipment_id: item.ml_shipment_id,
    ml_invoice_reported: item.ml_invoice_reported || false,
    ml_order_id: item.ml_order_id,
    ml_pack_id: item.ml_pack_id,
    is_virtual_kit: Boolean(item.is_virtual_kit),
    is_cart: Boolean(item.is_cart),
    kit_order_ids: Array.isArray(item.kit_order_ids) ? item.kit_order_ids : [],
    operational_dslite_ids: Array.isArray(item.operational_dslite_ids)
      ? item.operational_dslite_ids
      : [],
    operational_invoice_numbers: Array.isArray(item.operational_invoice_numbers)
      ? item.operational_invoice_numbers
      : [],
    has_split_fulfillment: Boolean(item.has_split_fulfillment),
    billing_nome: item.billing_nome,
    billing_endereco: item.billing_endereco as Record<string, unknown> | null,
    ml_fiscal_release_at: item.ml_fiscal_release_at,
    ml_fiscal_release_reason: item.ml_fiscal_release_reason,
    ml_fiscal_release_source: item.ml_fiscal_release_source,
    ml_fiscal_release_checked_at: item.ml_fiscal_release_checked_at,
    ml_label_storage_path: item.ml_label_storage_path,
    ml_thermal_label_storage_path: item.ml_thermal_label_storage_path,
    nfe_chave: item.nfe_chave,
    nfe_status: item.nfe_status,
    pedido_itens: item.pedido_itens || [],
    compra_produto_descricao: item.compra_produto_descricao || null,
    compra_produto_sku: item.compra_produto_sku || null,
    compra_quantidade: item.compra_quantidade ?? null,
    cliente_id: item.cliente_id || null,
    whatsapp_label_status: item.whatsapp_label_status || 'not_sent',
    whatsapp_label_updated_at: item.whatsapp_label_updated_at || null,
    whatsapp_label_error: item.whatsapp_label_error || null,
    whatsapp_label_next_retry_at: item.whatsapp_label_next_retry_at || null,
    dslite_label_operational_status: item.dslite_label_operational_status || 'pending',
    dslite_label_operational_updated_at: item.dslite_label_operational_updated_at || null,
    dslite_label_operational_error: item.dslite_label_operational_error || null,
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
  urgentCount: number;
}

export default function PedidosPage() {
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
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
    urgentCount: 0,
  });

  const [operationalView, setOperationalView] = useState<OrdersOperationalView>('urgent');
  const selectOperationalView = useCallback((view: OrdersOperationalView) => {
    setOperationalView(view);
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [supplierFilterIds, setSupplierFilterIds] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierFilterOption[]>([]);
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState<string>('');
  const [trackingOrderStatus, setTrackingOrderStatus] = useState<OrderStatus>('aberto');

  useEffect(() => {
    const initialParams = new URLSearchParams(window.location.search);
    const initialView = parsePersistedOperationalView(initialParams.get('view'));
    if (initialView) setOperationalView(initialView);

    const initialSearch = initialParams.get('search')?.trim();
    if (!initialSearch) return;
    setSearch(initialSearch);
    setPage(1);
  }, []);

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (supplierFilterIds.length > 0) params.set('fornecedores', supplierFilterIds.join(','));
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    return params;
  }, [search, statusFilter, supplierFilterIds, dateRange, priceMin, priceMax]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const filterParams = buildFilterParams();
    const listParams = new URLSearchParams(filterParams);
    listParams.set('page', String(page));
    listParams.set('operationalView', operationalView);
    appendRemoteSortParams(listParams, sort);
    try {
      const [listRes, summaryRes] = await Promise.all([
        fetch(`/api/pedidos?${listParams}`),
        fetch(`/api/pedidos/resumo?${filterParams}`),
      ]);

      if (listRes.ok) {
        const json: PedidosOperacionaisApiResponse = await listRes.json();
        setOrders((json.data || []).map(mapDBtoOrder));
        setTotal(json.total || 0);
        if (Array.isArray(json.fornecedores)) setSupplierOptions(json.fornecedores);
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
          urgentCount: json.urgentCount || 0,
        });
      }
    } catch {}
    setLoading(false);
  }, [buildFilterParams, operationalView, page, sort]);

  const updateOrder = useCallback((target: Order, patch: Partial<Order>) => {
    setOrders((previous) => previous.map((order) => (
      order.dbId === target.dbId ? { ...order, ...patch } : order
    )));
  }, []);

  const dsliteFlow = usePedidosDsliteFlow({
    messageApi,
    refreshOrders: fetchData,
    updateOrder,
  });
  const labelWhatsappFlow = usePedidosLabelWhatsappFlow({
    messageApi,
    refreshOrders: fetchData,
    updateOrder,
    openShippingSelection: dsliteFlow.openShippingSelection,
  });

  const confirmarCriacaoPedidoDslite = dsliteFlow.confirmSupplierFulfillment;
  const abrirConfirmacaoPixPedido = dsliteFlow.openSupplierPayment;
  const desvincularCompraDslite = dsliteFlow.unlinkDslitePurchase;
  const openWhatsappLabelModal = labelWhatsappFlow.openWhatsappLabel;
  const enviarEtiquetaAutomatica = labelWhatsappFlow.completeDsliteLabel;
  const baixarEtiquetaSalva = labelWhatsappFlow.downloadSavedLabel;
  const confirmarEnvioInterno = labelWhatsappFlow.confirmInternalShipping;

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [operationalView, search, statusFilter, supplierFilterIds, dateRange, priceMin, priceMax]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const params = buildFilterParams();
      params.set('operationalView', operationalView);
      appendRemoteSortParams(params, sort);
      const response = await fetch(`/api/pedidos/exportar-pdf?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.erro || 'Falha ao gerar PDF das vendas.');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const fileName = contentDisposition.match(/filename="([^"]+)"/i)?.[1] || 'vendas.pdf';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      messageApi.success('PDF das vendas exportado.');
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao exportar PDF das vendas.');
    } finally {
      setExportingPdf(false);
    }
  }, [buildFilterParams, messageApi, operationalView, sort]);

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

  const handleDownloadNotaFiscalXml = useCallback((order: Order) => {
    if (!order.dbId) {
      messageApi.error('Pedido sem referência interna para localizar o XML');
      return;
    }
    window.open(`/api/notas-fiscais/${order.dbId}/xml`, '_blank', 'noopener,noreferrer');
  }, [messageApi]);

  const toggleOrderDetails = (order: Order) => {
    setExpandedRowKeys((keys) => (
      keys.includes(order.id)
        ? keys.filter((key) => key !== order.id)
        : [...keys, order.id]
    ));
  };

  const renderOrderDetails = (order: Order) => {
    const postDispatch = isPostDispatchOrder(order);
    const isInternalShipping = Boolean(order.envio_interno_at);
    const hasSplitFulfillment = Boolean(order.has_split_fulfillment);
    const address = (order.billing_endereco || {}) as {
      street_name?: string;
      street_number?: string;
      complement?: string;
      neighborhood?: string;
      city_name?: string;
      state_id?: string;
      zip_code?: string;
    };
    const addressLines = [
      [address.street_name, address.street_number].filter(Boolean).join(', '),
      address.complement,
      address.neighborhood,
      [address.city_name, address.state_id].filter(Boolean).join(' - '),
      address.zip_code ? `CEP ${address.zip_code}` : '',
    ].filter(Boolean);
    const canCreateDslite = !isValidDsliteId(order.dslite_id)
      && !hasSplitFulfillment
      && !isInternalShipping
      && order.fulfillment_source !== 'internal'
      && !postDispatch
      && !['cancelado', 'entregue', 'devolvido', 'recusado'].includes(order.situacao.valor);
    const canCompleteLabel = Boolean(
      !isInternalShipping
      && !hasSplitFulfillment
      && !postDispatch
      && isValidDsliteId(order.dslite_id)
      && order.dslite_next_action === 'complete_dslite_label',
    );
    const canConfirmPayment = Boolean(
      !isInternalShipping
      && !hasSplitFulfillment
      && !postDispatch
      && isValidDsliteId(order.dslite_id)
      && ['confirm_supplier_payment', 'send_supplier_receipt', 'resume_dslite_flow'].includes(order.dslite_next_action || ''),
    );
    const canProcessDirectShipping = Boolean(
      !isInternalShipping
      && !hasSplitFulfillment
      && !postDispatch
      && !isValidDsliteId(order.dslite_id)
      && order.fulfillment_source !== 'supplier'
      && order.internal_stock_available
      && order.ml_shipment_id
      && !['cancelado', 'entregue', 'devolvido', 'recusado'].includes(order.situacao.valor),
    );

    return (
      <div style={{ padding: '8px 4px' }}>
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={12}>
            <Text strong>Produtos</Text>
            <div style={{ marginTop: 8 }}>
              {(order.pedido_itens || []).length ? (order.pedido_itens || []).map((item, index) => (
                <div key={`${item.ml_item_id || item.seller_sku || item.titulo}-${index}`} style={{ marginBottom: 8 }}>
                  <div>{item.titulo}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    SKU: {getPedidoItemDisplaySku(item.seller_sku) ? (
                      <Link href={`/produtos?search=${encodeURIComponent(getPedidoItemDisplaySku(item.seller_sku)!)}`}>
                        {getPedidoItemDisplaySku(item.seller_sku)}
                      </Link>
                    ) : '—'} · Qtd: {item.quantidade} · {formatCurrency(item.valor_total_liquido)}
                  </Text>
                </div>
              )) : (
                <Text type="secondary">
                  {order.compra_produto_descricao || 'Produto ainda não sincronizado'}
                  {order.compra_quantidade ? ` · Qtd: ${order.compra_quantidade}` : ''}
                </Text>
              )}
            </div>
          </Col>
          <Col xs={24} lg={12}>
            <Text strong>Entrega</Text>
            <div style={{ marginTop: 8 }}>
              <div>
                {order.cliente_id ? (
                  <Link href={`/clientes/${order.cliente_id}`}>{getDisplayFiscalClientName(order) || getDisplayClientName(order)}</Link>
                ) : getDisplayFiscalClientName(order) || getDisplayClientName(order)}
              </div>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Documento: {order.contato.numeroDocumento || '—'}
              </Text>
              {addressLines.length ? addressLines.map((line) => (
                <Text key={line} type="secondary" style={{ display: 'block', fontSize: 12 }}>{line}</Text>
              )) : <Text type="secondary">Endereço ainda não sincronizado</Text>}
            </div>
          </Col>
          <Col xs={24} lg={12}>
            <Text strong>{isInternalShipping ? 'Envio interno' : 'Compra e fornecedor'}</Text>
            {isInternalShipping ? (
              <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                <Descriptions.Item label="Origem">Estoque interno</Descriptions.Item>
                <Descriptions.Item label="DSLite">Não utilizada</Descriptions.Item>
                <Descriptions.Item label="Processado em">
                  {order.envio_interno_at ? new Date(order.envio_interno_at).toLocaleString('pt-BR') : '—'}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
              <Descriptions.Item label="Pedido DSLite">
                {(order.operational_dslite_ids || []).length > 0 ? (
                  <Space size={4} wrap>
                    {(order.operational_dslite_ids || []).map((dsliteId) => (
                      <Link key={dsliteId} href={`/compras?search=${encodeURIComponent(dsliteId)}`}>{dsliteId}</Link>
                    ))}
                  </Space>
                ) : order.dslite_id ? (
                  <Link href={`/compras?search=${encodeURIComponent(order.dslite_id)}`}>{order.dslite_id}</Link>
                ) : 'Não criado'}
              </Descriptions.Item>
                <Descriptions.Item label={order.compra_id ? 'Fornecedor' : 'Fornecedor previsto'}>{order.fornecedor_nome || '—'}</Descriptions.Item>
                <Descriptions.Item label="Pagamento">
                  {order.supplier_payment_amount !== null && order.supplier_payment_amount !== undefined
                    ? `${formatCurrency(order.supplier_payment_amount)} · ${order.supplier_payment_status || 'pendente'}`
                    : '—'}
                </Descriptions.Item>
              </Descriptions>
            )}
          </Col>
          <Col xs={24} lg={12}>
            <Text strong>Logística e fiscal</Text>
            <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
              <Descriptions.Item label="Rastreio">
                {order.rastreio && order.ml_shipment_id ? (
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => {
                    setTrackingOrderId(order.dbId);
                    setTrackingOrderStatus(order.situacao.valor);
                    setTrackingModalOpen(true);
                  }}>
                    {order.rastreio}
                  </Button>
                ) : order.rastreio || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Envio ML">{order.ml_shipment_id || '—'}</Descriptions.Item>
              <Descriptions.Item label="Pedido ML">
                {(order.kit_order_ids || []).length > 1
                  ? (order.kit_order_ids || []).join(', ')
                  : order.ml_order_id ? (
                    <a
                      href={`https://www.mercadolivre.com.br/vendas/${order.ml_pack_id || order.ml_order_id}/detalhe`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {order.ml_order_id}
                    </a>
                  ) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="NF">
                {(order.operational_invoice_numbers || []).length > 1 ? (
                  (order.operational_invoice_numbers || []).join(', ')
                ) : order.notaFiscal?.numero ? (
                  <Space size={4}>
                    <span>{order.notaFiscal.numero}</span>
                    <Button size="small" onClick={() => handleOpenNotaFiscalPdf(order)}>DANFE</Button>
                    <Button size="small" onClick={() => handleDownloadNotaFiscalXml(order)}>XML</Button>
                  </Space>
                ) : 'Não emitida'}
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
        {hasSplitFulfillment && (
          <Tag color="red" style={{ marginTop: 10 }}>
            Fluxo legado dividido: múltiplos pedidos DSLite/NFs preservados
          </Tag>
        )}
        <Divider style={{ borderColor: '#303030', margin: '14px 0 10px' }} />
        <Space wrap>
          <Button size="small" href={`https://www.mercadolivre.com.br/vendas/${order.ml_pack_id || order.numero}/detalhe`} target="_blank">
            Abrir no ML
          </Button>
          {order.ml_shipment_id && (
            <Button size="small" icon={<CarOutlined />} onClick={() => {
              setTrackingOrderId(order.dbId);
              setTrackingOrderStatus(order.situacao.valor);
              setTrackingModalOpen(true);
            }}>
              Rastrear
            </Button>
          )}
          {canCreateDslite && <Button size="small" type="primary" onClick={() => confirmarCriacaoPedidoDslite(order)}>Enviar pelo fornecedor (DSLite)</Button>}
          {canProcessDirectShipping && <Button size="small" type="primary" onClick={() => confirmarEnvioInterno(order)}>Enviar pelo estoque interno</Button>}
          {canCompleteLabel && <Button size="small" onClick={() => enviarEtiquetaAutomatica(order)}>Completar etiqueta</Button>}
          {order.ml_label_storage_path && order.dslite_next_action === 'internal_shipping' && <Button size="small" type="primary" onClick={() => baixarEtiquetaSalva(order, 'thermal_pdf')}>Baixar térmica PDF</Button>}
          {order.ml_thermal_label_storage_path && <Button size="small" onClick={() => baixarEtiquetaSalva(order, 'zpl2')}>Baixar ZPL</Button>}
          {order.ml_label_storage_path && order.dslite_next_action !== 'internal_shipping' && <Button size="small" onClick={() => baixarEtiquetaSalva(order, 'pdf')}>Baixar PDF</Button>}
          {canConfirmPayment && <Button size="small" onClick={() => abrirConfirmacaoPixPedido(order)}>Confirmar PIX</Button>}
          {order.notaFiscal?.emitida && <Button size="small" onClick={() => handleOpenNotaFiscalPdf(order)}>Abrir DANFE</Button>}
        </Space>
      </div>
    );
  };

  const columns: TableProps<Order>['columns'] = [
    {
      title: 'Número', dataIndex: 'numero', key: 'numero', width: 180,
      sorter: true,
      sortOrder: getRemoteSortOrder('numero', sort),
      render: (num: number, record: Order) => {
        const isGroupedSale = Boolean(record.is_virtual_kit || record.is_cart);
        const displayNumber = isGroupedSale && record.ml_pack_id
          ? record.ml_pack_id
          : String(num);
        const orderIds = record.kit_order_ids || [];
        return (
          <div>
            <Space size={4}>
              <a
                href={`https://www.mercadolivre.com.br/vendas/${record.ml_pack_id || num}/detalhe`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Order IDs: ${orderIds.length ? orderIds.join(', ') : record.ml_order_id || '—'} | Pack ID: ${record.ml_pack_id || '—'}`}
                style={{ fontFamily: 'monospace', color: '#1677ff', textDecoration: 'none' }}
              >
                #{displayNumber}
              </a>
              {record.is_virtual_kit && <Tag color="purple" style={{ marginInlineEnd: 0 }}>KIT</Tag>}
              {record.is_cart && <Tag color="blue" style={{ marginInlineEnd: 0 }}>CARRINHO</Tag>}
            </Space>
            <div style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
              {isGroupedSale
                ? `${orderIds.length} ORDERS ML`
                : `PACK ID ${record.ml_pack_id || '—'}`}
            </div>
          </div>
        );
      },
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
            <div>
              {record.cliente_id ? (
                <Link href={`/clientes/${record.cliente_id}`} style={{ color: '#e0e0e0' }}>{clientName}</Link>
              ) : <span style={{ color: '#e0e0e0' }}>{clientName}</span>}
            </div>
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
      title: 'Status', dataIndex: ['situacao', 'valor'], key: 'situacao', width: 160,
      sorter: true,
      sortOrder: getRemoteSortOrder('situacao', sort),
      render: (status: OrderStatus, record: Order) => {
        const canTrack = Boolean(record.ml_shipment_id);
        let releaseWindow: { when: string; remaining: string | null } | null = null;
        if (record.ml_fiscal_release_at && record.situacao.valor !== 'etiqueta_impressa') {
          const releaseAt = getMlReleaseComparableDate(record.ml_fiscal_release_at);
          if (releaseAt && releaseAt.getTime() > Date.now()) {
            releaseWindow = formatReleaseWindow(record.ml_fiscal_release_at);
          }
        }
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {canTrack ? (
                <Tooltip title={record.rastreio ? `Rastrear envio ${record.rastreio}` : 'Rastrear envio'}>
                  {statusTag}
                </Tooltip>
              ) : statusTag}
              {record.ml_claim_id && (
                <WarningOutlined style={{ color: '#faad14', fontSize: 14 }} title="Reclamação em andamento" />
              )}
            </div>
            {releaseWindow && (
              <Tooltip title={`Etiqueta aguardando liberação pelo Mercado Livre${releaseWindow.remaining ? ` (${releaseWindow.remaining})` : ''}`}>
                <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                  Libera em {releaseWindow.when}
                </Tag>
              </Tooltip>
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
        const invoiceNumbers = Array.from(new Set(
          (record.operational_invoice_numbers || []).map(String).filter(Boolean),
        ));
        if (invoiceNumbers.length > 1) {
          return (
            <Tooltip title="Carrinho legado processado separadamente antes da correção. Notas preservadas.">
              <Space size={2} wrap>
                {invoiceNumbers.map((numero) => (
                  <Tag key={numero} color="orange">NF {numero}</Tag>
                ))}
              </Space>
            </Tooltip>
          );
        }
        if (!nf) {
          const nfeStatus = normalizeNfeTechnicalStatus(record.nfe_status);
          if (nfeExpectedStatuses.has(record.situacao.valor) && nfeStatus === 'pendente') {
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
      title: 'Fluxo fornecedor',
      key: 'pedido_compra',
      dataIndex: 'dslite_id',
      width: 285,
      sorter: true,
      sortOrder: getRemoteSortOrder('pedido_compra', sort),
      render: (_: string | null, record: Order) => {
        const isInternalShipping = Boolean(record.envio_interno_at);
        const postDispatch = isPostDispatchOrder(record);
        const purchaseOrderId = isValidDsliteId(record.dslite_id);
        const purchaseOrderIds = Array.from(new Set(
          (record.operational_dslite_ids || []).map(String).filter(Boolean),
        ));
        const purchaseRejected = isDsliteRejected(record.dslite_status);
        const actionTag = record.has_split_fulfillment
          ? { color: 'red', label: 'Revisar fluxo dividido' }
          : postDispatch
          ? { color: 'green', label: 'Somente acompanhar' }
          : record.dslite_label_operational_status === 'sent_unverified'
          && record.dslite_next_action === 'done'
            ? { color: 'default', label: 'Verificar DSLite' }
            : getDsliteActionTag(record.dslite_next_action);
        const supplierWarning = postDispatch || isInternalShipping
          ? null
          : getSupplierSetupWarning(record);
        const labelStatus = getDsliteLabelFlowStatus(record);
        const whatsappStatus = getWhatsappFlowStatus(record);
        const urgencyReasons = getOperationalUrgencyReasons(record);
        const whatsappUpdatedAt = record.whatsapp_label_updated_at
          ? new Date(record.whatsapp_label_updated_at).toLocaleString('pt-BR')
          : null;
        const whatsappTooltip = [
          whatsappUpdatedAt ? `Última atualização: ${whatsappUpdatedAt}` : null,
          record.whatsapp_label_error,
          record.whatsapp_label_next_retry_at
            ? `Nova tentativa: ${new Date(record.whatsapp_label_next_retry_at).toLocaleString('pt-BR')}`
            : null,
        ].filter(Boolean).join(' · ');
        const dsliteLabelUpdatedAt = record.dslite_label_operational_updated_at
          ? new Date(record.dslite_label_operational_updated_at).toLocaleString('pt-BR')
          : null;
        const dsliteLabelTooltip = [
          dsliteLabelUpdatedAt ? `Última confirmação: ${dsliteLabelUpdatedAt}` : null,
          record.dslite_label_operational_error,
          record.dslite_label_operational_status === 'sent_unverified'
            ? 'O campo antigo indica envio, mas não existe auditoria que confirme o recebimento pela DSLite.'
            : null,
        ].filter(Boolean).join(' · ');

        if (isInternalShipping) {
          return (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text strong style={{ fontSize: 11 }}>Estoque Interno</Text>
              <FlowStatusLine label="Modalidade" color="#52c41a" value="Envio interno" />
              <FlowStatusLine
                label="Etiqueta"
                color={record.ml_label_storage_path ? '#52c41a' : '#faad14'}
                value={record.ml_label_storage_path ? 'Pronta para uso' : 'Não localizada'}
              />
              <Tag color={postDispatch ? 'green' : 'blue'} style={{ marginInlineEnd: 0, fontSize: 11, width: 'fit-content' }}>
                {postDispatch ? 'Somente acompanhar' : 'Preparar despacho'}
              </Tag>
            </Space>
          );
        }

        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Tooltip title={record.fornecedor_nome || 'Fornecedor ainda não definido'}>
              <Text strong style={{ display: 'block', maxWidth: 250, fontSize: 11 }} ellipsis>
                {record.fornecedor_nome || 'Fornecedor não definido'}
              </Text>
            </Tooltip>
            {urgencyReasons.length > 0 && (
              <Tooltip title={urgencyReasons.join(' · ')}>
                <div style={{ color: '#ff7875', fontSize: 11, fontWeight: 600 }}>
                  Resolver: {urgencyReasons[0]}
                  {urgencyReasons.length > 1 ? ` +${urgencyReasons.length - 1}` : ''}
                </div>
              </Tooltip>
            )}
            <FlowStatusLine
              label="Compra"
              color={purchaseRejected ? '#ff4d4f' : purchaseOrderId ? '#52c41a' : '#faad14'}
              value={purchaseRejected ? 'Rejeitada' : purchaseOrderIds.length > 1 ? (
                <Space size={2} wrap>
                  {purchaseOrderIds.map((dsliteId) => (
                    <Link key={dsliteId} href={`/compras?search=${encodeURIComponent(dsliteId)}`}>
                      #{dsliteId}
                    </Link>
                  ))}
                </Space>
              ) : purchaseOrderId ? (
                <Link href={`/compras?search=${encodeURIComponent(purchaseOrderId)}`}>
                  #{purchaseOrderId}
                </Link>
              ) : 'Não criada'}
              tooltip={purchaseRejected ? record.dslite_status : record.fornecedor_nome}
            />
            <FlowStatusLine
              label="Etiqueta DSLite"
              color={labelStatus.color}
              value={labelStatus.label}
              tooltip={dsliteLabelTooltip || null}
            />
            <FlowStatusLine
              label="WhatsApp real"
              color={whatsappStatus.color}
              value={whatsappStatus.label}
              tooltip={whatsappTooltip || null}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', paddingTop: 2 }}>
              <Tag color={actionTag.color} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                Próxima: {actionTag.label}
              </Tag>
              {supplierWarning && (
                <Tooltip title={supplierWarning}>
                  <Tag color="red" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    Cadastro incompleto
                  </Tag>
                </Tooltip>
              )}
            </div>
          </Space>
        );
      },
    },
    {
      title: 'Lucro', dataIndex: 'lucro', key: 'lucro', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('lucro', sort),
      render: (v: number | null, record: Order) => {
        if (v === null && record.profit_pending) {
          return <Tag color="processing" style={{ marginInlineEnd: 0 }}>Calculando</Tag>;
        }
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
        const isInternalShipping = Boolean(record.envio_interno_at);
        const postDispatch = isPostDispatchOrder(record);
        const hasSplitFulfillment = Boolean(record.has_split_fulfillment);
        const nextAction = record.dslite_next_action;
        const releaseAt = record.ml_fiscal_release_at ? getMlReleaseComparableDate(record.ml_fiscal_release_at) : null;
        const mlLabelStillBlocked = Boolean(
          record.situacao.valor !== 'etiqueta_impressa'
          && releaseAt
          && releaseAt.getTime() > Date.now(),
        );
        if (!hasSplitFulfillment && !isInternalShipping && !postDispatch && (!hasDsliteId || nextAction === 'create_dslite_order') && record.fulfillment_source !== 'internal' && !['cancelado', 'entregue', 'devolvido', 'recusado'].includes(record.situacao.valor)) {
          items.push({
            key: 'dslite',
            label: 'Enviar pelo fornecedor (DSLite)',
            icon: <CarOutlined />,
          });
        }
        if (!hasSplitFulfillment && !isInternalShipping && !postDispatch && !hasDsliteId && record.fulfillment_source !== 'supplier' && record.internal_stock_available && record.ml_shipment_id && !['cancelado', 'entregue', 'devolvido', 'recusado'].includes(record.situacao.valor)) {
          items.push({ key: 'direct_shipping', label: 'Enviar pelo estoque interno', icon: <UploadOutlined /> });
        }
        if (record.ml_label_storage_path && record.dslite_next_action === 'internal_shipping') {
          items.push({ key: 'download_thermal_pdf', label: 'Baixar térmica PDF 100x150', icon: <UploadOutlined /> });
        } else if (record.ml_label_storage_path) {
          items.push({ key: 'download_label', label: 'Baixar etiqueta PDF', icon: <UploadOutlined /> });
        }
        if (record.ml_thermal_label_storage_path) {
          items.push({ key: 'download_thermal_label', label: 'Baixar etiqueta ZPL', icon: <UploadOutlined /> });
        }
        if (!hasSplitFulfillment && !isInternalShipping && !postDispatch && hasDsliteId && nextAction === 'complete_dslite_label') {
          items.push({
            key: 'etiqueta',
            label: 'Completar etiqueta DSLite',
            icon: <UploadOutlined />,
          });
        }
        if (!hasSplitFulfillment && !isInternalShipping && !postDispatch && hasDsliteId && (nextAction === 'confirm_supplier_payment' || nextAction === 'send_supplier_receipt' || nextAction === 'resume_dslite_flow')) {
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
        if (!mlLabelStillBlocked && (record.ml_shipment_id || record.ml_order_id || record.ml_label_storage_path)) {
          items.push({
            key: 'send_whatsapp_label',
            label: 'Enviar etiqueta real por WhatsApp',
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
                if (key === 'view') toggleOrderDetails(record);
                if (key === 'track') {
                  setTrackingOrderId(record.dbId);
                  setTrackingOrderStatus(record.situacao.valor);
                  setTrackingModalOpen(true);
                }
                if (key === 'dslite') confirmarCriacaoPedidoDslite(record);
                if (key === 'direct_shipping') confirmarEnvioInterno(record);
                if (key === 'download_thermal_pdf') baixarEtiquetaSalva(record, 'thermal_pdf');
                if (key === 'download_thermal_label') baixarEtiquetaSalva(record, 'zpl2');
                if (key === 'download_label') baixarEtiquetaSalva(record, 'pdf');
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

  const preparationCount = PREPARATION_ORDER_STATUSES.reduce(
    (count, status) => count + Number(summary.statusCounts[status] || 0),
    0,
  );
  const shippingCount = SHIPPING_ORDER_STATUSES.reduce(
    (count, status) => count + Number(summary.statusCounts[status] || 0),
    0,
  );
  const operationalViewDescriptions: Record<OrdersOperationalView, string> = {
    urgent: 'Falhas ou etapas internas atrasadas antes da coleta.',
    preparation: 'Vendas ainda em compra, pagamento, nota fiscal ou preparação da etiqueta.',
    shipping: 'Pedidos já despachados: somente acompanhamento do transporte.',
    delivered: 'Pedidos confirmados como entregues ao comprador.',
    all: 'Todas as vendas, incluindo canceladas e devolvidas.',
  };
  const operationalTabs = [
    { key: 'urgent', label: <>Urgentes <Tag color="red">{summary.urgentCount}</Tag></> },
    { key: 'preparation', label: <>Preparação <Tag>{preparationCount}</Tag></> },
    { key: 'shipping', label: <>Em transporte <Tag>{shippingCount}</Tag></> },
    { key: 'delivered', label: <>Entregues <Tag>{summary.statusCounts.entregue || 0}</Tag></> },
    { key: 'all', label: <>Todos <Tag>{summary.count}</Tag></> },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 4 }}>Vendas</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Acompanhe compra DSLite, etiqueta enviada ao fornecedor e confirmação do WhatsApp em um único fluxo.
      </Text>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: '0 16px 10px', marginBottom: 16 }}>
        <Tabs
          activeKey={operationalView}
          items={operationalTabs}
          onChange={(key) => {
            selectOperationalView(key as OrdersOperationalView);
            setStatusFilter('');
            setPage(1);
          }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {operationalViewDescriptions[operationalView]}
        </Text>
      </div>

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
                  onClick={() => {
                    selectOperationalView('all');
                    setStatusFilter(active ? '' : typedStatus);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectOperationalView('all');
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
              placeholder="Buscar venda, cliente, SKU, produto ou fornecedor"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 360, maxWidth: '100%' }}
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
            <Select
              mode="multiple"
              placeholder="Fornecedores"
              value={supplierFilterIds}
              onChange={setSupplierFilterIds}
              options={supplierOptions.map((option) => ({ value: option.id, label: option.label }))}
              optionFilterProp="label"
              maxTagCount="responsive"
              style={{ width: 240 }}
              allowClear
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
          <Col>
            <Button
              icon={<FilePdfOutlined />}
              onClick={() => void handleExportPdf()}
              loading={exportingPdf}
            >
              Exportar PDF
            </Button>
          </Col>
        </Row>
      </div>
      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<Order>
            storageKey="pedidos-operational-v2"
            dataSource={orders}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            expandable={{
              expandedRowKeys,
              onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
              expandedRowRender: renderOrderDetails,
              expandIconColumnIndex: 0,
            }}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} pedidos`,
            }}
            onChange={handleTableChange}
            scroll={{ x: 1200 }}
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
      <PedidosDsliteModals flow={dsliteFlow} />
      <PedidosLabelWhatsappModals flow={labelWhatsappFlow} />
    </div>
  );
}
