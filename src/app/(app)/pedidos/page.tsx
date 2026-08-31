'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert, Button, Card, Col, DatePicker, Dropdown, Empty, Input, InputNumber,
  Row, Select, Space, Tag, Tooltip, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  CarOutlined, EllipsisOutlined, EyeOutlined, FilePdfOutlined, ReloadOutlined,
  SearchOutlined, UploadOutlined, WarningOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import TrackingModal from '@/components/modals/TrackingModal';
import PedidoDetailsDrawer, {
  getDisplayClientName,
  getDisplayFiscalClientName,
} from '@/components/pedidos/PedidoDetailsDrawer';
import PedidosDsliteModals from '@/components/pedidos/PedidosDsliteModals';
import PedidosLabelWhatsappModals from '@/components/pedidos/PedidosLabelWhatsappModals';
import { isValidDsliteId, usePedidosDsliteFlow } from '@/components/pedidos/usePedidosDsliteFlow';
import { usePedidosLabelWhatsappFlow } from '@/components/pedidos/usePedidosLabelWhatsappFlow';
import { formatCurrency } from '@/lib/format';
import { formatMlReleaseWindow, getMlReleaseComparableDate } from '@/lib/ml/release-window-display';
import {
  PREPARATION_ORDER_STATUSES,
  SHIPPING_ORDER_STATUSES,
  getOperationalUrgencyReasons,
  isPostDispatchOrder,
  type OrdersOperationalView,
} from '@/lib/orders/operational-view';
import { hasPermission, type VortekPermission, type VortekRole } from '@/lib/permissions';
import type { SupplierFilterOption } from '@/lib/produto-filtering';
import {
  appendRemoteSortParams,
  getRemoteSortOrder,
  resolveRemoteSortState,
  type RemoteSortState,
} from '@/lib/remote-sort';
import type {
  Order, OrderStatus, PedidoOperacionalApiDto, PedidosOperacionaisApiResponse,
} from '@/types/order';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;
const PAGE_SIZE = 100;
const TERMINAL_STATUSES: OrderStatus[] = ['cancelado', 'entregue', 'devolvido', 'recusado'];
const OPERATIONAL_VIEW_KEYS: OrdersOperationalView[] = ['urgent', 'preparation', 'shipping', 'delivered', 'all'];
const VALID_ROLES: VortekRole[] = ['admin', 'gerente', 'operador', 'visualizador'];

const statusOptions = [
  { value: 'aberto', label: 'Aberto' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'preparando', label: 'Preparando' },
  { value: 'pronto_envio', label: 'Pronto p/ envio' },
  { value: 'etiqueta_impressa', label: 'Etiqueta impressa' },
  { value: 'coletado', label: 'Coletado' },
  { value: 'em_transito', label: 'Em trânsito' },
  { value: 'saiu_entrega', label: 'Saiu para entrega' },
  { value: 'dest_ausente', label: 'Destinatário ausente' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'faturado', label: 'Faturado' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'recusado', label: 'Recusado' },
  { value: 'devolvido', label: 'Devolvido' },
  { value: 'cancelado', label: 'Cancelado' },
] as const;

const statusLabel = Object.fromEntries(statusOptions.map((option) => [option.value, option.label])) as Record<OrderStatus, string>;
const statusColor: Record<OrderStatus, string> = {
  aberto: 'blue', pendente: 'orange', preparando: 'processing', pronto_envio: 'cyan',
  etiqueta_impressa: 'blue', coletado: 'geekblue', em_transito: 'purple',
  saiu_entrega: 'cyan', dest_ausente: 'red', atendido: 'processing', faturado: 'purple',
  entregue: 'green', recusado: 'red', devolvido: 'magenta', cancelado: 'default',
};

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

const EMPTY_SUMMARY: SummaryData = {
  count: 0, total: 0, lucroSum: 0, ticket: 0, margem: 0, statusCounts: {},
  mlCompatibleCount: 0, mlCompatibleTotal: 0, mlCompatibleMissingPaymentData: 0, urgentCount: 0,
};

type OrderActionKey =
  | 'view' | 'track' | 'dslite' | 'direct_shipping' | 'download_thermal_pdf'
  | 'download_thermal_label' | 'download_label' | 'complete_label' | 'supplier_payment'
  | 'send_whatsapp_label' | 'unlink_dslite';

type OrderAction = { key: OrderActionKey; label: string; permission?: VortekPermission };

function parseOperationalView(value: string | null): OrdersOperationalView {
  return OPERATIONAL_VIEW_KEYS.includes(value as OrdersOperationalView) ? value as OrdersOperationalView : 'urgent';
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDsliteRejected(status: string | null | undefined): boolean {
  return String(status || '').toLowerCase().includes('rejeitado');
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
    contato: { id: 0, nome: item.contato_nome || '', tipoPessoa: 'F', numeroDocumento: item.contato_documento || '' },
    totalProdutos: item.total || 0,
    total: item.total || 0,
    situacao: { id: 0, valor: item.situacao || 'aberto' },
    loja: { id: 1 },
    transporte: item.frete ? { frete: item.frete, prazoEntrega: null, contato: { nome: item.contato_nome || '' } } : null,
    notaFiscal: item.nota_fiscal_numero ? { numero: item.nota_fiscal_numero, emitida: item.nota_fiscal_emitida } : null,
    nfe_danfe_url: item.nfe_danfe_url,
    rastreio: item.rastreio,
    lucro: item.lucro ?? null,
    profit_pending: Boolean(item.operational_profit_pending) || (Array.isArray(item.snapshot_pendencias) && item.snapshot_pendencias.some((value) => ['lucro_pendente_frete', 'lucro_pendente_produto'].includes(String(value)))),
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
    operational_dslite_ids: Array.isArray(item.operational_dslite_ids) ? item.operational_dslite_ids : [],
    operational_invoice_numbers: Array.isArray(item.operational_invoice_numbers) ? item.operational_invoice_numbers : [],
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

function getOrderActions(order: Order, role: VortekRole | null, now: number): OrderAction[] {
  const can = (permission?: VortekPermission) => !permission || (role ? hasPermission(role, permission) : false);
  const actions: OrderAction[] = [{ key: 'view', label: 'Ver detalhes' }];
  const hasDsliteId = Boolean(isValidDsliteId(order.dslite_id));
  const internalShipping = Boolean(order.envio_interno_at);
  const postDispatch = isPostDispatchOrder(order);
  const split = Boolean(order.has_split_fulfillment);
  const active = !TERMINAL_STATUSES.includes(order.situacao.valor);
  const nextAction = order.dslite_next_action;
  const releaseAt = order.ml_fiscal_release_at ? getMlReleaseComparableDate(order.ml_fiscal_release_at) : null;
  const labelBlocked = Boolean(order.situacao.valor !== 'etiqueta_impressa' && releaseAt && releaseAt.getTime() > now);

  if (order.ml_shipment_id) actions.push({ key: 'track', label: 'Rastrear envio', permission: 'sales.track' });
  if (!split && !internalShipping && !postDispatch && (!hasDsliteId || nextAction === 'create_dslite_order') && order.fulfillment_source !== 'internal' && active) {
    actions.push({ key: 'dslite', label: 'Enviar pelo fornecedor', permission: 'sales.dslite.create' });
  }
  if (!split && !internalShipping && !postDispatch && !hasDsliteId && order.fulfillment_source !== 'supplier' && order.internal_stock_available && order.ml_shipment_id && active) {
    actions.push({ key: 'direct_shipping', label: 'Enviar pelo estoque interno', permission: 'sales.internal_shipping.process' });
  }
  if (order.ml_label_storage_path && nextAction === 'internal_shipping') actions.push({ key: 'download_thermal_pdf', label: 'Baixar térmica PDF' });
  else if (order.ml_label_storage_path) actions.push({ key: 'download_label', label: 'Baixar etiqueta PDF' });
  if (order.ml_thermal_label_storage_path) actions.push({ key: 'download_thermal_label', label: 'Baixar etiqueta ZPL' });
  if (!split && !internalShipping && !postDispatch && hasDsliteId && nextAction === 'complete_dslite_label') {
    actions.push({ key: 'complete_label', label: 'Completar etiqueta DSLite', permission: 'sales.dslite.label.complete' });
  }
  if (!split && !internalShipping && !postDispatch && hasDsliteId && ['confirm_supplier_payment', 'send_supplier_receipt', 'resume_dslite_flow'].includes(nextAction || '')) {
    actions.push({
      key: 'supplier_payment',
      label: nextAction === 'resume_dslite_flow' ? 'Retomar fluxo DSLite' : nextAction === 'send_supplier_receipt' ? 'Anexar comprovante PIX' : 'Confirmar PIX do fornecedor',
      permission: nextAction === 'resume_dslite_flow' ? 'sales.dslite.resume' : 'purchases.payment.confirm',
    });
  }
  if (!labelBlocked && (order.ml_shipment_id || order.ml_order_id || order.ml_label_storage_path)) {
    actions.push({ key: 'send_whatsapp_label', label: 'Enviar etiqueta por WhatsApp', permission: 'sales.whatsapp_label.send' });
  }
  if (hasDsliteId && isDsliteRejected(order.dslite_status)) {
    actions.push({ key: 'unlink_dslite', label: 'Desvincular compra DSLite', permission: 'sales.dslite.unlink' });
  }
  return actions.filter((action) => can(action.permission));
}

function getOrderPending(order: Order): { label: string; color: string; detail?: string } {
  if (order.has_split_fulfillment) return { label: 'Revisar fluxo dividido', color: 'red' };
  const urgency = getOperationalUrgencyReasons(order);
  if (urgency.length > 0) return { label: urgency[0], color: 'red', detail: urgency.join(' · ') };
  if (isDsliteRejected(order.dslite_status)) return { label: 'Compra DSLite rejeitada', color: 'red' };
  if (order.supplier_payment_mode === 'prepaid_pix' && (!order.supplier_pix_key || !order.fornecedor_telefone)) return { label: 'Cadastro do fornecedor incompleto', color: 'orange' };
  if (order.profit_pending) return { label: 'Lucro em processamento', color: 'processing' };
  return { label: 'Sem bloqueio', color: 'green' };
}

function formatAge(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

export default function PedidosPage() {
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<SummaryData>(EMPTY_SUMMARY);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'data', sortOrder: 'desc' });
  const [operationalView, setOperationalView] = useState<OrdersOperationalView>('urgent');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [supplierFilterIds, setSupplierFilterIds] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierFilterOption[]>([]);
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [role, setRole] = useState<VortekRole | null>(null);
  const [drawerOrder, setDrawerOrder] = useState<Order | null>(null);
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState('');
  const [trackingOrderStatus, setTrackingOrderStatus] = useState<OrderStatus>('aberto');
  const [messageApi, contextHolder] = message.useMessage();
  const requestSequence = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOperationalView(parseOperationalView(params.get('view')));
    setSearch(params.get('search')?.trim() || '');
    const initialStatus = params.get('status') as OrderStatus | null;
    setStatusFilter(initialStatus && statusOptions.some((option) => option.value === initialStatus) ? initialStatus : '');
    setSupplierFilterIds((params.get('fornecedores') || '').split(',').filter(Boolean));
    setDateRange([params.get('dateFrom'), params.get('dateTo')]);
    setPriceMin(parseOptionalNumber(params.get('priceMin')));
    setPriceMax(parseOptionalNumber(params.get('priceMax')));
    setPage(parsePositiveInteger(params.get('page'), 1));
    setSort({ sortBy: params.get('sortBy') || 'data', sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : 'desc' });
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => {
        const cargo = profile?.cargo as VortekRole | undefined;
        setRole(cargo && VALID_ROLES.includes(cargo) ? cargo : null);
      })
      .catch(() => setRole(null));
  }, []);

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (supplierFilterIds.length > 0) params.set('fornecedores', supplierFilterIds.join(','));
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    return params;
  }, [dateRange, priceMax, priceMin, search, statusFilter, supplierFilterIds]);

  useEffect(() => {
    if (!filtersHydrated) return;
    const params = buildFilterParams();
    params.set('view', operationalView);
    if (page > 1) params.set('page', String(page));
    appendRemoteSortParams(params, sort);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [buildFilterParams, filtersHydrated, operationalView, page, sort]);

  const fetchData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const filterParams = buildFilterParams();
    const listParams = new URLSearchParams(filterParams);
    listParams.set('page', String(page));
    listParams.set('operationalView', operationalView);
    appendRemoteSortParams(listParams, sort);
    setListLoading(true);
    setSummaryLoading(true);
    setListError(null);
    setSummaryError(null);

    const listRequest = fetch(`/api/pedidos?${listParams.toString()}`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.erro || 'Não foi possível carregar os pedidos.');
      return response.json() as Promise<PedidosOperacionaisApiResponse>;
    });
    const summaryRequest = fetch(`/api/pedidos/resumo?${filterParams.toString()}`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.erro || 'Não foi possível carregar o resumo.');
      return response.json();
    });

    const [listResult, summaryResult] = await Promise.allSettled([listRequest, summaryRequest]);
    if (sequence !== requestSequence.current) return;
    if (listResult.status === 'fulfilled') {
      setOrders((listResult.value.data || []).map(mapDBtoOrder));
      setTotal(listResult.value.total || 0);
      if (Array.isArray(listResult.value.fornecedores)) setSupplierOptions(listResult.value.fornecedores);
    } else {
      setListError(listResult.reason instanceof Error ? listResult.reason.message : 'Não foi possível carregar os pedidos.');
    }
    setListLoading(false);

    if (summaryResult.status === 'fulfilled') {
      const value = summaryResult.value;
      setSummary({
        count: value.count || 0,
        total: value.total || 0,
        lucroSum: value.lucroSum || 0,
        ticket: value.ticket || 0,
        margem: value.margem || 0,
        statusCounts: value.statusCounts || {},
        mlCompatibleCount: value.mlCompatibleCount || 0,
        mlCompatibleTotal: value.mlCompatibleTotal || 0,
        mlCompatibleMissingPaymentData: value.mlCompatibleMissingPaymentData || 0,
        urgentCount: value.urgentCount || 0,
      });
    } else {
      setSummaryError(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Não foi possível carregar o resumo.');
    }
    setSummaryLoading(false);
    if (listResult.status === 'fulfilled' || summaryResult.status === 'fulfilled') setLastUpdatedAt(new Date());
  }, [buildFilterParams, operationalView, page, sort]);

  useEffect(() => {
    if (!filtersHydrated) return;
    const timer = window.setTimeout(() => void fetchData(), 300);
    return () => window.clearTimeout(timer);
  }, [fetchData, filtersHydrated]);

  const updateOrder = useCallback((target: Order, patch: Partial<Order>) => {
    setOrders((previous) => previous.map((order) => order.dbId === target.dbId ? { ...order, ...patch } : order));
    setDrawerOrder((previous) => previous?.dbId === target.dbId ? { ...previous, ...patch } : previous);
  }, []);

  const dsliteFlow = usePedidosDsliteFlow({ messageApi, refreshOrders: fetchData, updateOrder });
  const labelWhatsappFlow = usePedidosLabelWhatsappFlow({ messageApi, refreshOrders: fetchData, updateOrder, openShippingSelection: dsliteFlow.openShippingSelection });

  const openTracking = useCallback((order: Order) => {
    setTrackingOrderId(order.dbId);
    setTrackingOrderStatus(order.situacao.valor);
    setTrackingModalOpen(true);
  }, []);

  const resolveNotaFiscalPdfUrl = useCallback(async (order: Order): Promise<string | null> => {
    if (!order.dbId) {
      messageApi.error('Pedido sem referência interna para localizar a DANFE.');
      return null;
    }
    const response = await fetch(`/api/notas-fiscais/${order.dbId}/pdf`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.url) {
      messageApi.error(payload?.error || 'Não foi possível localizar o PDF da nota fiscal.');
      return null;
    }
    return String(payload.url);
  }, [messageApi]);

  const handleOpenNotaFiscalPdf = useCallback(async (order: Order) => {
    const url = await resolveNotaFiscalPdfUrl(order);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, [resolveNotaFiscalPdfUrl]);

  const handleDownloadNotaFiscalXml = useCallback((order: Order) => {
    if (!order.dbId) {
      messageApi.error('Pedido sem referência interna para localizar o XML.');
      return;
    }
    window.open(`/api/notas-fiscais/${order.dbId}/xml`, '_blank', 'noopener,noreferrer');
  }, [messageApi]);

  const runOrderAction = useCallback((key: OrderActionKey, order: Order) => {
    if (key === 'view') setDrawerOrder(order);
    if (key === 'track') openTracking(order);
    if (key === 'dslite') dsliteFlow.confirmSupplierFulfillment(order);
    if (key === 'direct_shipping') labelWhatsappFlow.confirmInternalShipping(order);
    if (key === 'download_thermal_pdf') labelWhatsappFlow.downloadSavedLabel(order, 'thermal_pdf');
    if (key === 'download_thermal_label') labelWhatsappFlow.downloadSavedLabel(order, 'zpl2');
    if (key === 'download_label') labelWhatsappFlow.downloadSavedLabel(order, 'pdf');
    if (key === 'complete_label') labelWhatsappFlow.completeDsliteLabel(order);
    if (key === 'supplier_payment') dsliteFlow.openSupplierPayment(order);
    if (key === 'send_whatsapp_label') labelWhatsappFlow.openWhatsappLabel(order);
    if (key === 'unlink_dslite') dsliteFlow.unlinkDslitePurchase(order);
  }, [dsliteFlow, labelWhatsappFlow, openTracking]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const params = buildFilterParams();
      params.set('operationalView', operationalView);
      appendRemoteSortParams(params, sort);
      const response = await fetch(`/api/pedidos/exportar-pdf?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.erro || 'Falha ao gerar PDF das vendas.');
      const blob = await response.blob();
      const fileName = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/i)?.[1] || 'vendas.pdf';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      messageApi.success('PDF das vendas exportado.');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Falha ao exportar PDF das vendas.');
    } finally {
      setExportingPdf(false);
    }
  }, [buildFilterParams, messageApi, operationalView, sort]);

  const selectOperationalView = useCallback((view: OrdersOperationalView) => {
    setOperationalView(view);
    setStatusFilter('');
    setPage(1);
  }, []);

  const clearRefinements = useCallback(() => {
    setSearch(''); setStatusFilter(''); setSupplierFilterIds([]); setDateRange([null, null]);
    setPriceMin(null); setPriceMax(null); setPage(1);
  }, []);

  const activeFilters = useMemo(() => {
    const filters: { key: string; label: string; clear: () => void }[] = [];
    if (search) filters.push({ key: 'search', label: `Busca: ${search}`, clear: () => { setSearch(''); setPage(1); } });
    if (statusFilter) filters.push({ key: 'status', label: `Status: ${statusLabel[statusFilter]}`, clear: () => { setStatusFilter(''); setPage(1); } });
    if (supplierFilterIds.length) filters.push({ key: 'suppliers', label: `${supplierFilterIds.length} origem(ns)`, clear: () => { setSupplierFilterIds([]); setPage(1); } });
    if (dateRange[0] || dateRange[1]) filters.push({ key: 'dates', label: 'Período definido', clear: () => { setDateRange([null, null]); setPage(1); } });
    if (priceMin !== null || priceMax !== null) filters.push({ key: 'price', label: 'Faixa de valor', clear: () => { setPriceMin(null); setPriceMax(null); setPage(1); } });
    return filters;
  }, [dateRange, priceMax, priceMin, search, statusFilter, supplierFilterIds]);

  const renderActions = useCallback((order: Order) => {
    const actions = getOrderActions(order, role, Date.now());
    const operational = actions.find((action) => !['view', 'track'].includes(action.key)) || actions.find((action) => action.key === 'track') || actions[0];
    const secondary = actions.filter((action) => action.key !== operational.key);
    const icon = operational.key === 'view' ? <EyeOutlined /> : operational.key === 'track' ? <CarOutlined /> : <UploadOutlined />;
    return (
      <Space size={4}>
        <Button size="small" type={operational.key === 'view' ? 'default' : 'primary'} icon={icon} onClick={() => runOrderAction(operational.key, order)}>{operational.label}</Button>
        {secondary.length > 0 && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: secondary.map((action) => ({ key: action.key, label: action.label, icon: action.key === 'unlink_dslite' ? <WarningOutlined /> : undefined })),
              onClick: ({ key }) => runOrderAction(key as OrderActionKey, order),
            }}
          >
            <Button size="small" aria-label="Mais ações" icon={<EllipsisOutlined />} />
          </Dropdown>
        )}
      </Space>
    );
  }, [role, runOrderAction]);

  const columns: TableProps<Order>['columns'] = useMemo(() => [
    {
      title: 'Pedido', dataIndex: 'numero', key: 'numero', width: 185, sorter: true, sortOrder: getRemoteSortOrder('numero', sort),
      render: (number: number, order: Order) => {
        const displayNumber = (order.is_virtual_kit || order.is_cart) && order.ml_pack_id ? order.ml_pack_id : String(number);
        return (
          <div>
            <Button type="link" size="small" style={{ padding: 0, fontFamily: 'monospace', fontWeight: 700 }} onClick={() => setDrawerOrder(order)}>#{displayNumber}</Button>
            <Space size={4} style={{ marginLeft: 6 }}>{order.is_virtual_kit && <Tag color="purple">KIT</Tag>}{order.is_cart && <Tag color="blue">CARRINHO</Tag>}</Space>
            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{new Date(order.data).toLocaleString('pt-BR')}</Text>
          </div>
        );
      },
    },
    {
      title: 'Cliente', dataIndex: ['contato', 'nome'], key: 'cliente', width: 210, sorter: true, sortOrder: getRemoteSortOrder('cliente', sort),
      render: (_: string, order: Order) => {
        const name = getDisplayClientName(order);
        const fiscalName = getDisplayFiscalClientName(order);
        return <div>{order.cliente_id ? <Link href={`/clientes/${order.cliente_id}`}>{name}</Link> : name}{fiscalName && fiscalName.toLowerCase() !== name.toLowerCase() && <Text type="secondary" ellipsis style={{ display: 'block', fontSize: 11 }}>Fiscal: {fiscalName}</Text>}</div>;
      },
    },
    {
      title: 'Valor', dataIndex: 'total', key: 'total', width: 130, sorter: true, sortOrder: getRemoteSortOrder('total', sort),
      render: (value: number, order: Order) => <div><Text strong>{formatCurrency(value)}</Text><Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{order.lucro === null ? (order.profit_pending ? 'Lucro calculando' : 'Lucro —') : `Lucro ${formatCurrency(order.lucro)}`}</Text></div>,
    },
    {
      title: 'Etapa', dataIndex: ['situacao', 'valor'], key: 'situacao', width: 170, sorter: true, sortOrder: getRemoteSortOrder('situacao', sort),
      render: (status: OrderStatus, order: Order) => {
        const releaseAt = order.ml_fiscal_release_at ? getMlReleaseComparableDate(order.ml_fiscal_release_at) : null;
        const release = releaseAt && releaseAt.getTime() > Date.now() ? formatMlReleaseWindow(order.ml_fiscal_release_at!) : null;
        return <Space direction="vertical" size={4}><Tag color={statusColor[status]}>{statusLabel[status]}</Tag>{order.ml_claim_id && <Tag color="orange">Reclamação</Tag>}{release && <Tooltip title={release.remaining || undefined}><Tag color="orange">Libera em {release.when}</Tag></Tooltip>}</Space>;
      },
    },
    {
      title: 'Pendência', key: 'pending', width: 250,
      render: (_: unknown, order: Order) => {
        const pending = getOrderPending(order);
        return <Tooltip title={pending.detail}><Tag color={pending.color} style={{ whiteSpace: 'normal', height: 'auto' }}>{pending.label}</Tag></Tooltip>;
      },
    },
    {
      title: 'Idade', dataIndex: 'data', key: 'data', width: 95, sorter: true, sortOrder: getRemoteSortOrder('data', sort),
      render: (value: string) => <Tooltip title={new Date(value).toLocaleString('pt-BR')}><Text>{formatAge(value)}</Text></Tooltip>,
    },
    { title: 'Próxima ação', key: 'next_action', width: 260, fixed: 'right', render: (_: unknown, order: Order) => renderActions(order) },
  ], [renderActions, sort]);

  const handleTableChange: TableProps<Order>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'data', sortOrder: 'desc' });
    const changed = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(changed ? 1 : pagination.current || 1);
  };

  const preparationCount = PREPARATION_ORDER_STATUSES.reduce((sum, status) => sum + Number(summary.statusCounts[status] || 0), 0);
  const shippingCount = SHIPPING_ORDER_STATUSES.reduce((sum, status) => sum + Number(summary.statusCounts[status] || 0), 0);
  const queues: { key: OrdersOperationalView; label: string; count: number; description: string }[] = [
    { key: 'urgent', label: 'Urgentes', count: summary.urgentCount, description: 'Exigem ação antes do despacho' },
    { key: 'preparation', label: 'Preparação', count: preparationCount, description: 'Compra, fiscal e etiqueta' },
    { key: 'shipping', label: 'Em transporte', count: shippingCount, description: 'Acompanhar entrega' },
    { key: 'delivered', label: 'Entregues', count: summary.statusCounts.entregue || 0, description: 'Concluídos' },
    { key: 'all', label: 'Todos', count: summary.count, description: 'Histórico completo' },
  ];
  const datePickerValue: [Dayjs | null, Dayjs | null] = [dateRange[0] ? dayjs(dateRange[0]) : null, dateRange[1] ? dayjs(dateRange[1]) : null];

  return (
    <div>
      {contextHolder}
      <Row justify="space-between" align="top" gutter={[16, 12]} style={{ marginBottom: 20 }}>
        <Col>
          <Title level={2} style={{ margin: 0 }}>Vendas</Title>
          <Text type="secondary">Decida o próximo passo de cada pedido e acompanhe bloqueios até a entrega.</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>{lastUpdatedAt ? `Atualizado às ${lastUpdatedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando primeira atualização'}</Text>
        </Col>
        <Col><Space wrap><Button icon={<FilePdfOutlined />} loading={exportingPdf} onClick={() => void handleExportPdf()}>Exportar PDF</Button><Button type="primary" icon={<ReloadOutlined />} loading={listLoading || summaryLoading} onClick={() => void fetchData()}>Atualizar</Button></Space></Col>
      </Row>

      {summaryError && <Alert type="warning" showIcon message="Resumo parcialmente indisponível" description={summaryError} action={<Button size="small" onClick={() => void fetchData()}>Tentar novamente</Button>} style={{ marginBottom: 12 }} />}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {queues.map((queue) => {
          const selected = queue.key === operationalView;
          return (
            <Col key={queue.key} flex="1 1 180px">
              <Card
                size="small" hoverable role="button" tabIndex={0} aria-pressed={selected}
                loading={summaryLoading && !lastUpdatedAt}
                onClick={() => selectOperationalView(queue.key)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectOperationalView(queue.key); }}
                style={{ borderColor: selected ? '#FFBD0E' : undefined, background: selected ? '#201B0E' : undefined }}
              >
                <Text type="secondary">{queue.label}</Text><Title level={3} style={{ margin: '4px 0 0' }}>{queue.count}</Title><Text type="secondary" style={{ fontSize: 11 }}>{queue.description}</Text>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[20, 8]}>
          <Col><Text type="secondary">Vendido</Text><Text strong style={{ display: 'block' }}>{formatCurrency(summary.mlCompatibleTotal)}</Text></Col>
          <Col><Text type="secondary">Lucro</Text><Text strong style={{ display: 'block', color: summary.lucroSum >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatCurrency(summary.lucroSum)}</Text></Col>
          <Col><Text type="secondary">Margem</Text><Text strong style={{ display: 'block' }}>{summary.margem.toFixed(1)}%</Text></Col>
          <Col><Text type="secondary">Ticket médio</Text><Text strong style={{ display: 'block' }}>{formatCurrency(summary.ticket)}</Text></Col>
        </Row>
      </Card>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col flex="1 1 320px"><Input aria-label="Buscar pedidos" placeholder="Pedido, cliente, SKU, produto ou fornecedor" prefix={<SearchOutlined />} value={search} allowClear onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></Col>
          <Col flex="0 1 180px"><Select placeholder="Status" value={statusFilter || undefined} options={[...statusOptions]} allowClear style={{ width: '100%' }} onChange={(value) => { setStatusFilter(value || ''); setPage(1); }} /></Col>
          <Col flex="1 1 240px"><Select mode="multiple" placeholder="Origem / fornecedor" value={supplierFilterIds} options={supplierOptions.map((option) => ({ value: option.id, label: option.label }))} optionFilterProp="label" maxTagCount="responsive" allowClear style={{ width: '100%' }} onChange={(value) => { setSupplierFilterIds(value); setPage(1); }} /></Col>
          <Col flex="0 1 250px"><RangePicker value={datePickerValue} format="DD/MM/YYYY" style={{ width: '100%' }} onChange={(dates) => { setDateRange([dates?.[0]?.format('YYYY-MM-DD') || null, dates?.[1]?.format('YYYY-MM-DD') || null]); setPage(1); }} /></Col>
          <Col><Space.Compact><InputNumber aria-label="Valor mínimo" placeholder="Mínimo" value={priceMin} onChange={(value) => { setPriceMin(value ?? null); setPage(1); }} style={{ width: 105 }} /><InputNumber aria-label="Valor máximo" placeholder="Máximo" value={priceMax} onChange={(value) => { setPriceMax(value ?? null); setPage(1); }} style={{ width: 105 }} /></Space.Compact></Col>
        </Row>
        {activeFilters.length > 0 && <Space wrap style={{ marginTop: 12 }}><Text type="secondary">Filtros ativos:</Text>{activeFilters.map((filter) => <Tag key={filter.key} closable onClose={filter.clear}>{filter.label}</Tag>)}<Button type="link" size="small" onClick={clearRefinements}>Limpar filtros</Button></Space>}
      </Card>

      {listError && <Alert type="error" showIcon message="Falha ao atualizar os pedidos" description={`${listError}${orders.length ? ' Os dados anteriores foram preservados.' : ''}`} action={<Button size="small" onClick={() => void fetchData()}>Tentar novamente</Button>} style={{ marginBottom: 12 }} />}

      <Card size="small">
        {!listLoading && !listError && orders.length === 0 ? <Empty description="Nenhum pedido encontrado nesta fila e filtros." image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
          <ResizableTable<Order>
            storageKey="pedidos-bentevi-v1" dataSource={orders} columns={columns} rowKey="id" loading={listLoading}
            pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (count) => `${count} pedidos` }}
            onChange={handleTableChange} scroll={{ x: 1300 }} size="small"
          />
        )}
      </Card>

      <PedidoDetailsDrawer
        order={drawerOrder} open={Boolean(drawerOrder)} onClose={() => setDrawerOrder(null)}
        onTrack={openTracking} onOpenDanfe={(order) => void handleOpenNotaFiscalPdf(order)}
        onDownloadXml={handleDownloadNotaFiscalXml} actions={drawerOrder ? renderActions(drawerOrder) : null}
      />
      <TrackingModal open={trackingModalOpen} onClose={() => setTrackingModalOpen(false)} orderId={trackingOrderId} orderStatus={trackingOrderStatus} />
      <PedidosDsliteModals flow={dsliteFlow} />
      <PedidosLabelWhatsappModals flow={labelWhatsappFlow} />
    </div>
  );
}
