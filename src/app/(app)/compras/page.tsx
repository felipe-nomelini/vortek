'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert, Button, Card, Col, DatePicker, Dropdown, Empty, Input, Modal,
  Row, Select, Space, Tag, Typography, Upload, message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  EllipsisOutlined, EyeOutlined, FilePdfOutlined, ReloadOutlined,
  SearchOutlined, TruckOutlined, UploadOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import CompraDetailsDrawer, {
  getPurchaseSaleReference,
  type CompraOperacional,
} from '@/components/compras/CompraDetailsDrawer';
import { formatCurrency } from '@/lib/format';
import { hasPermission, type VortekRole } from '@/lib/permissions';
import {
  appendRemoteSortParams, getRemoteSortOrder, resolveRemoteSortState,
  type RemoteSortState,
} from '@/lib/remote-sort';
import styles from './compras.module.css';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;
const PAGE_SIZE = 50;
const VALID_ROLES: VortekRole[] = ['admin', 'gerente', 'operador', 'visualizador'];

interface MlAnunciosAlertas {
  activeZeroStock: { count: number; items: Array<{ sku: string; nome: string; ml_item_id: string }> };
  mlPublishAuthFailures: { count: number; items: Array<{ ml_item_id: string; last_error: string | null }> };
}

interface SupplierOption {
  value: string;
  label: string;
}

interface PurchaseSummary {
  total: number;
  pendentes: number;
  faturado: number;
  aguardando_informacoes: number;
  cancelado: number;
  revisao: number;
  valor_total: number;
  supplier_payment_total: number;
  supplier_payment_missing_count: number;
}

type PurchaseActionKey = 'details' | 'payment' | 'track' | 'sale';

const EMPTY_SUMMARY: PurchaseSummary = {
  total: 0, pendentes: 0, faturado: 0, aguardando_informacoes: 0,
  cancelado: 0, revisao: 0, valor_total: 0,
  supplier_payment_total: 0, supplier_payment_missing_count: 0,
};

const statusOptions = [
  { value: 'Aguardando Informações', label: 'Aguardando informações' },
  { value: 'Aguardando Pagamento Fornecedor', label: 'Aguardando pagamento' },
  { value: 'Iniciado', label: 'Iniciado' },
  { value: 'Aguardando Etiqueta', label: 'Aguardando etiqueta' },
  { value: 'Solicitado', label: 'Solicitado' },
  { value: 'Confirmado', label: 'Confirmado' },
  { value: 'Faturado', label: 'Faturado' },
  { value: 'Cancelado', label: 'Cancelado' },
  { value: 'Revisão', label: 'Revisão' },
];

const statusColor: Record<string, string> = {
  'Aguardando Informações': 'orange',
  'Aguardando Pagamento Fornecedor': 'gold',
  Iniciado: 'blue',
  'Aguardando Etiqueta': 'cyan',
  Solicitado: 'geekblue',
  Confirmado: 'green',
  Faturado: 'purple',
  Cancelado: 'default',
  Revisão: 'magenta',
};

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function formatStatus(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '—';
  return normalized.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSupplierWhatsappReason(reason: unknown): string {
  switch (String(reason || '')) {
    case 'supplier_phone_missing': return 'WhatsApp do fornecedor não cadastrado';
    case 'receipt_missing': return 'Comprovante não encontrado';
    case 'supplier_not_found': return 'Fornecedor não encontrado';
    default: return String(reason || 'motivo não informado');
  }
}

function renderPaymentTag(purchase: CompraOperacional) {
  if (purchase.supplier_payment_mode === 'balance_account') return <Tag>Saldo Hayamax (histórico)</Tag>;
  if (purchase.supplier_payment_mode !== 'prepaid_pix') return <Text type="secondary">Não aplicável</Text>;
  if (purchase.supplier_payment_status === 'paid') return <Tag color="green">PIX pago</Tag>;
  if (purchase.supplier_payment_status === 'failed') return <Tag color="red">PIX falhou</Tag>;
  if (purchase.supplier_payment_status === 'cancelled') return <Tag>PIX cancelado</Tag>;
  return <Tag color="gold">PIX pendente</Tag>;
}

function paymentActionLabel(purchase: CompraOperacional): string {
  if (purchase.supplier_payment_status !== 'paid') return 'Confirmar PIX';
  return purchase.supplier_payment_receipt_path ? 'Reenviar comprovante' : 'Anexar comprovante';
}

function hasPaymentAction(purchase: CompraOperacional, canConfirmPayment: boolean): boolean {
  return Boolean(
    canConfirmPayment
      && !purchase.is_homologation_fixture
      && purchase.supplier_payment_mode === 'prepaid_pix'
      && purchase.supplier_payment_status !== 'cancelled'
      && !purchase.bkr1_pix_deferred,
  );
}

function primaryAction(purchase: CompraOperacional, canConfirmPayment: boolean): { key: PurchaseActionKey; label: string } {
  if (hasPaymentAction(purchase, canConfirmPayment)) return { key: 'payment', label: paymentActionLabel(purchase) };
  if (!purchase.is_homologation_fixture && purchase.rastreio) return { key: 'track', label: 'Rastrear' };
  return { key: 'details', label: 'Ver detalhes' };
}

export default function ComprasPage() {
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [compras, setCompras] = useState<CompraOperacional[]>([]);
  const [summary, setSummary] = useState<PurchaseSummary>(EMPTY_SUMMARY);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'data_criacao', sortOrder: 'desc' });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [independentLoading, setIndependentLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [independentError, setIndependentError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [role, setRole] = useState<VortekRole | null>(null);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);
  const [mlAnunciosAlertas, setMlAnunciosAlertas] = useState<MlAnunciosAlertas | null>(null);
  const [drawerPurchase, setDrawerPurchase] = useState<CompraOperacional | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedCompra, setSelectedCompra] = useState<CompraOperacional | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentReceiptUrl, setPaymentReceiptUrl] = useState('');
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [messageApi, contextHolder] = message.useMessage();
  const requestSequence = useRef(0);

  const canConfirmPayment = Boolean(role && hasPermission(role, 'purchases.payment.confirm'));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get('search')?.trim() || '');
    const initialStatus = params.get('status') || '';
    setStatusFilter(statusOptions.some((option) => option.value === initialStatus) ? initialStatus : '');
    setSupplierFilter(params.get('fornecedorId')?.trim() || '');
    setDateRange([params.get('dateFrom'), params.get('dateTo')]);
    setPage(parsePositiveInteger(params.get('page'), 1));
    setSort({ sortBy: params.get('sortBy') || 'data_criacao', sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : 'desc' });
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
    if (supplierFilter) params.set('fornecedorId', supplierFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    return params;
  }, [dateRange, search, statusFilter, supplierFilter]);

  const buildListParams = useCallback(() => {
    const params = buildFilterParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    appendRemoteSortParams(params, sort);
    return params;
  }, [buildFilterParams, page, sort]);

  useEffect(() => {
    if (!filtersHydrated) return;
    const params = buildListParams();
    if (page === 1) params.delete('page');
    params.delete('limit');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [buildListParams, filtersHydrated, page]);

  const fetchFilteredPurchases = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setListLoading(true);
    setSummaryLoading(true);
    setListError(null);
    setSummaryError(null);

    const listRequest = fetch(`/api/compras?${buildListParams().toString()}`, { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar as compras.');
      return payload;
    });
    const summaryRequest = fetch(`/api/compras/resumo?${buildFilterParams().toString()}`, { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar o resumo.');
      return payload;
    });

    const [listResult, summaryResult] = await Promise.allSettled([listRequest, summaryRequest]);
    if (sequence !== requestSequence.current) return;

    if (listResult.status === 'fulfilled') {
      const nextPurchases = (listResult.value.data || []) as CompraOperacional[];
      setCompras(nextPurchases);
      setTotal(Number(listResult.value.total || 0));
      setDrawerPurchase((current) => current ? nextPurchases.find((item) => item.id === current.id) || current : null);
      setLastUpdatedAt(new Date());
    } else {
      setListError(listResult.reason instanceof Error ? listResult.reason.message : 'Não foi possível carregar as compras.');
    }

    if (summaryResult.status === 'fulfilled') {
      const value = summaryResult.value;
      setSummary({
        total: Number(value.total || 0), pendentes: Number(value.pendentes || 0),
        faturado: Number(value.faturado || 0), aguardando_informacoes: Number(value.aguardando_informacoes || 0),
        cancelado: Number(value.cancelado || 0), revisao: Number(value.revisao || 0),
        valor_total: Number(value.valor_total || 0), supplier_payment_total: Number(value.supplier_payment_total || 0),
        supplier_payment_missing_count: Number(value.supplier_payment_missing_count || 0),
      });
    } else {
      setSummaryError(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Não foi possível carregar o resumo.');
    }
    setListLoading(false);
    setSummaryLoading(false);
  }, [buildFilterParams, buildListParams]);

  const fetchIndependentIndicators = useCallback(async () => {
    setIndependentLoading(true);
    setIndependentError(null);
    const [alertsResult, suppliersResult] = await Promise.allSettled([
      fetch('/api/ml/anuncios/alertas', { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error('Alertas ML indisponíveis');
        return response.json();
      }),
      fetch('/api/fornecedores?limit=100&sortBy=apelido&sortOrder=asc', { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error('Fornecedores indisponíveis');
        return response.json();
      }),
    ]);
    const errors: string[] = [];
    if (alertsResult.status === 'fulfilled') setMlAnunciosAlertas(alertsResult.value);
    else errors.push('alertas ML');
    if (suppliersResult.status === 'fulfilled') {
      const options = (suppliersResult.value.data || []).map((supplier: any) => ({
        value: String(supplier.dslite_id || '').trim(),
        label: String(supplier.apelido || supplier.nome || supplier.dslite_id || '').trim(),
      })).filter((option: SupplierOption) => option.value && option.label);
      setSupplierOptions(options);
    } else errors.push('lista de fornecedores');
    setIndependentError(errors.length ? `Não foi possível atualizar: ${errors.join(' e ')}.` : null);
    setIndependentLoading(false);
  }, []);

  useEffect(() => {
    if (filtersHydrated) void fetchFilteredPurchases();
  }, [fetchFilteredPurchases, filtersHydrated]);

  useEffect(() => {
    if (filtersHydrated) void fetchIndependentIndicators();
  }, [fetchIndependentIndicators, filtersHydrated]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchFilteredPurchases(), fetchIndependentIndicators()]);
  }, [fetchFilteredPurchases, fetchIndependentIndicators]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const params = buildListParams();
      params.delete('page');
      params.delete('limit');
      const response = await fetch(`/api/compras/exportar-pdf?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.erro || 'Falha ao gerar PDF das compras.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const fileName = disposition.match(/filename="([^"]+)"/i)?.[1] || 'compras.pdf';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      messageApi.success('PDF das compras exportado.');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Falha ao exportar PDF das compras.');
    } finally {
      setExportingPdf(false);
    }
  }, [buildListParams, messageApi]);

  const resetPaymentModal = useCallback(() => {
    setPaymentModalOpen(false);
    setSelectedCompra(null);
    setPaymentReference('');
    setPaymentReceiptUrl('');
    setPaymentReceiptFile(null);
    setPaymentNotes('');
  }, []);

  const openPaymentModal = useCallback((purchase: CompraOperacional) => {
    if (!hasPaymentAction(purchase, canConfirmPayment)) {
      messageApi.warning(purchase.is_homologation_fixture
        ? 'Ações estão desabilitadas para a amostra protegida.'
        : 'Seu cargo ou o estado da compra não permite esta operação.');
      return;
    }
    setSelectedCompra(purchase);
    setPaymentReference(purchase.supplier_payment_reference || '');
    setPaymentReceiptUrl(purchase.supplier_payment_receipt_url || '');
    setPaymentReceiptFile(null);
    setPaymentNotes(purchase.supplier_payment_notes || '');
    setPaymentModalOpen(true);
  }, [canConfirmPayment, messageApi]);

  const handleConfirmSupplierPayment = useCallback(async () => {
    if (!selectedCompra) return;
    if (!paymentReceiptFile && !selectedCompra.supplier_payment_receipt_path) {
      messageApi.warning('Anexe o comprovante do PIX antes de enviar ao fornecedor.');
      return;
    }
    setConfirmingPayment(true);
    try {
      const formData = new FormData();
      formData.append('supplier_payment_reference', paymentReference);
      formData.append('supplier_payment_receipt_url', paymentReceiptUrl);
      formData.append('supplier_payment_notes', paymentNotes);
      if (paymentReceiptFile) formData.append('receipt', paymentReceiptFile);
      const response = await fetch(`/api/compras/${selectedCompra.id}/confirmar-pagamento`, { method: 'POST', body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao confirmar pagamento do fornecedor');
      const whatsappDetail = payload.whatsapp?.sent
        ? 'WhatsApp enviado.'
        : `WhatsApp não enviado${payload.whatsapp?.reason ? `: ${formatSupplierWhatsappReason(payload.whatsapp.reason)}` : ''}.`;
      messageApi.success(`Comprovante processado. ${whatsappDetail}`);
      resetPaymentModal();
      await fetchFilteredPurchases();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Erro ao confirmar pagamento do fornecedor');
    } finally {
      setConfirmingPayment(false);
    }
  }, [fetchFilteredPurchases, messageApi, paymentNotes, paymentReceiptFile, paymentReceiptUrl, paymentReference, resetPaymentModal, selectedCompra]);

  const copyToClipboard = useCallback(async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      messageApi.success(successMessage);
    } catch {
      messageApi.error('Não foi possível copiar automaticamente.');
    }
  }, [messageApi]);

  const openSale = useCallback((purchase: CompraOperacional) => {
    const reference = getPurchaseSaleReference(purchase);
    if (!reference || purchase.is_homologation_fixture) return;
    window.open(`https://www.mercadolivre.com.br/vendas/${encodeURIComponent(reference)}/detalhe`, '_blank', 'noopener,noreferrer');
  }, []);

  const trackPurchase = useCallback((purchase: CompraOperacional) => {
    if (purchase.rastreio) window.open(`https://www.linkcorreios.com.br/?id=${encodeURIComponent(purchase.rastreio)}`, '_blank', 'noopener,noreferrer');
  }, []);

  const openDanfe = useCallback(async (purchase: CompraOperacional) => {
    if (!purchase.pedido_vendas_id || purchase.is_homologation_fixture) return;
    const response = await fetch(`/api/notas-fiscais/${purchase.pedido_vendas_id}/pdf`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.url) {
      messageApi.error(payload?.error || 'Não foi possível localizar a DANFE.');
      return;
    }
    window.open(String(payload.url), '_blank', 'noopener,noreferrer');
  }, [messageApi]);

  const runAction = useCallback((key: PurchaseActionKey, purchase: CompraOperacional) => {
    if (key === 'details') setDrawerPurchase(purchase);
    if (key === 'payment') openPaymentModal(purchase);
    if (key === 'track') trackPurchase(purchase);
    if (key === 'sale') openSale(purchase);
  }, [openPaymentModal, openSale, trackPurchase]);

  const columns: TableProps<CompraOperacional>['columns'] = [
    {
      title: 'Compra', dataIndex: 'dsid', key: 'dsid', width: 155,
      sorter: true, sortOrder: getRemoteSortOrder('dsid', sort),
      render: (_value, purchase) => <div className={styles.purchaseCell}>
        <button type="button" className={styles.purchaseLink} onClick={() => setDrawerPurchase(purchase)}>DSLite #{purchase.dsid}</button>
        <span className={styles.secondaryText}>{formatDateTime(purchase.data_criacao)}</span>
        <span><Tag color={statusColor[purchase.status] || 'default'}>{purchase.status || 'Sem status'}</Tag></span>
      </div>,
    },
    {
      title: 'Venda', dataIndex: 'pedido_vendas_numero', key: 'pedido_vendas_numero', width: 190,
      sorter: true, sortOrder: getRemoteSortOrder('pedido_vendas_numero', sort),
      render: (_value, purchase) => {
        const reference = getPurchaseSaleReference(purchase);
        return <div className={styles.stackedCell}>
          <span className={styles.primaryText}>{reference ? `${purchase.pedido_ml_pack_id ? 'Pack' : 'Venda'} #${reference}` : 'Venda não vinculada'}</span>
          <span className={styles.secondaryText}>{purchase.destinatario_nome || 'Destinatário não informado'}</span>
        </div>;
      },
    },
    {
      title: 'Fornecedor', dataIndex: 'fornecedor_nome', key: 'fornecedor_nome', width: 165,
      render: (value: string | null, purchase) => <div className={styles.stackedCell}>
        <span className={styles.primaryText}>{value || 'Não informado'}</span>
        <span className={styles.secondaryText}>{purchase.fornecedor_id ? `DSLite ${purchase.fornecedor_id}` : 'Sem identificador'}</span>
      </div>,
    },
    {
      title: 'Produto', dataIndex: 'produto_descricao', key: 'produto_descricao', width: 235,
      sorter: true, sortOrder: getRemoteSortOrder('produto_descricao', sort),
      render: (value: string | null, purchase) => <div className={styles.stackedCell}>
        <span className={styles.primaryText}>{value || 'Produto não informado'}</span>
        <span className={styles.secondaryText}>{purchase.produto_sku ? `SKU ${purchase.produto_sku}` : 'Sem SKU'} · Qtd. {purchase.quantidade || 1}</span>
      </div>,
    },
    {
      title: 'Valores', dataIndex: 'supplier_payment_amount', key: 'valor_total', width: 145,
      sorter: true, sortOrder: getRemoteSortOrder('valor_total', sort),
      render: (_value, purchase) => <div className={styles.valueCell}>
        {purchase.supplier_payment_amount == null
          ? <span className={styles.missingAmount}>A pagar: a definir</span>
          : <span className={styles.supplierAmount}>{formatCurrency(purchase.supplier_payment_amount)}</span>}
        <span className={styles.secondaryText}>Venda {formatCurrency(purchase.valor_total || 0)}</span>
        {purchase.valor_frete > 0 && <span className={styles.secondaryText}>Frete {formatCurrency(purchase.valor_frete)}</span>}
      </div>,
    },
    {
      title: 'Pagamento', dataIndex: 'supplier_payment_status', key: 'supplier_payment_status', width: 145,
      render: (_value, purchase) => <div className={styles.stackedCell}>
        <span>{renderPaymentTag(purchase)}</span>
        {purchase.bkr1_pix_deferred && <span className={styles.secondaryText}>Após etiqueta real do ML</span>}
        {(purchase.supplier_payment_receipt_path || purchase.supplier_payment_receipt_url) && <span className={styles.secondaryText}>Comprovante anexado</span>}
      </div>,
    },
    {
      title: 'Fiscal e envio', dataIndex: 'nf_numero', key: 'nf_numero', width: 145,
      sorter: true, sortOrder: getRemoteSortOrder('nf_numero', sort),
      render: (_value, purchase) => <div className={styles.stackedCell}>
        <span>{purchase.nf_numero ? <Tag color="green">NF {purchase.nf_numero}</Tag> : <Tag color="gold">NF pendente</Tag>}</span>
        <span className={styles.secondaryText}>{purchase.rastreio ? `Rastreio ${purchase.rastreio}` : formatStatus(purchase.status_dslite)}</span>
      </div>,
    },
    {
      title: 'Próxima ação', key: 'actions', width: 185, fixed: 'right',
      render: (_value, purchase) => {
        const primary = primaryAction(purchase, canConfirmPayment);
        const secondary = [
          primary.key !== 'details' ? { key: 'details', label: 'Ver detalhes', icon: <EyeOutlined /> } : null,
          primary.key !== 'track' && purchase.rastreio ? { key: 'track', label: 'Rastrear', icon: <TruckOutlined /> } : null,
          primary.key !== 'sale' && getPurchaseSaleReference(purchase) && !purchase.is_homologation_fixture ? { key: 'sale', label: 'Abrir venda no ML' } : null,
          primary.key !== 'payment' && hasPaymentAction(purchase, canConfirmPayment) ? { key: 'payment', label: paymentActionLabel(purchase) } : null,
        ].filter(Boolean) as Array<{ key: PurchaseActionKey; label: string; icon?: React.ReactNode }>;
        return <Space.Compact>
          <Button
            className={styles.primaryAction}
            type={primary.key === 'payment' ? 'primary' : 'default'}
            size="small"
            icon={primary.key === 'details' ? <EyeOutlined /> : primary.key === 'track' ? <TruckOutlined /> : undefined}
            onClick={() => runAction(primary.key, purchase)}
          >{primary.label}</Button>
          {secondary.length > 0 && <Dropdown
            trigger={['click']}
            menu={{ items: secondary, onClick: ({ key }) => runAction(key as PurchaseActionKey, purchase) }}
          ><Button size="small" aria-label={`Mais ações da compra ${purchase.dsid}`} icon={<EllipsisOutlined />} /></Dropdown>}
        </Space.Compact>;
      },
    },
  ];

  const handleTableChange: TableProps<CompraOperacional>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'data_criacao', sortOrder: 'desc' });
    const changed = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(changed ? 1 : pagination.current || 1);
  };

  const supplierLabel = supplierOptions.find((option) => option.value === supplierFilter)?.label || supplierFilter;
  const activeFilters = useMemo(() => [
    search ? { key: 'search', label: `Busca: ${search}`, clear: () => { setSearch(''); setPage(1); } } : null,
    statusFilter ? { key: 'status', label: `Status: ${statusFilter}`, clear: () => { setStatusFilter(''); setPage(1); } } : null,
    supplierFilter ? { key: 'supplier', label: `Fornecedor: ${supplierLabel}`, clear: () => { setSupplierFilter(''); setPage(1); } } : null,
    dateRange[0] || dateRange[1] ? { key: 'date', label: `Período: ${dateRange[0] || 'início'} — ${dateRange[1] || 'hoje'}`, clear: () => { setDateRange([null, null]); setPage(1); } } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>, [dateRange, search, statusFilter, supplierFilter, supplierLabel]);

  const datePickerValue: [Dayjs | null, Dayjs | null] = [dateRange[0] ? dayjs(dateRange[0]) : null, dateRange[1] ? dayjs(dateRange[1]) : null];
  const hasHomologationFixtures = compras.some((purchase) => purchase.is_homologation_fixture);
  const alertCount = Number(mlAnunciosAlertas?.activeZeroStock.count || 0) + Number(mlAnunciosAlertas?.mlPublishAuthFailures.count || 0);
  const drawerActions = drawerPurchase && hasPaymentAction(drawerPurchase, canConfirmPayment)
    ? <Button type="primary" size="small" onClick={() => openPaymentModal(drawerPurchase)}>{paymentActionLabel(drawerPurchase)}</Button>
    : null;

  return <div className={styles.page}>
    {contextHolder}
    <header className={styles.header}>
      <div>
        <Title level={2} className={styles.title}>Compras</Title>
        <Text type="secondary">Acompanhe a compra DSLite, o fornecedor, o pagamento e a nota fiscal ligados a cada venda.</Text>
        <Text type="secondary" className={styles.updatedAt}>{lastUpdatedAt ? `Atualizado às ${lastUpdatedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando primeira atualização'}</Text>
      </div>
      <Space wrap>
        <Button icon={<FilePdfOutlined />} loading={exportingPdf} onClick={() => void handleExportPdf()}>Exportar PDF</Button>
        <Button type="primary" icon={<ReloadOutlined />} loading={listLoading || summaryLoading || independentLoading} onClick={() => void refreshAll()}>Atualizar</Button>
      </Space>
    </header>

    {hasHomologationFixtures && <Alert type="info" showIcon message="Amostra real protegida para homologação" description="Os dados servem para avaliar o layout. Pagamentos, documentos e ações externas estão desabilitados." />}
    {alertCount > 0 && mlAnunciosAlertas && <Alert type="warning" showIcon message="Atenção em anúncios do Mercado Livre" description={[
      mlAnunciosAlertas.activeZeroStock.count > 0 ? `${mlAnunciosAlertas.activeZeroStock.count} anúncio(s) ativo(s) com estoque local zero.` : null,
      mlAnunciosAlertas.mlPublishAuthFailures.count > 0 ? `${mlAnunciosAlertas.mlPublishAuthFailures.count} publicação(ões) com falha de autorização.` : null,
    ].filter(Boolean).join(' ')} />}
    {independentError && <Alert type="warning" showIcon message="Indicadores independentes parcialmente indisponíveis" description={independentError} />}
    {summaryError && <Alert type="warning" showIcon message="Resumo parcialmente indisponível" description={summaryError} action={<Button size="small" onClick={() => void fetchFilteredPurchases()}>Tentar novamente</Button>} />}

    <section className={styles.summaryBand} aria-label="Resumo das compras">
      {[
        ['Total', summary.total, 'Compras nos filtros atuais'],
        ['Pendentes', summary.pendentes, 'Ainda exigem acompanhamento'],
        ['Em revisão', summary.revisao, 'Precisam de conferência'],
        ['Faturadas', summary.faturado, 'Nota registrada pelo fornecedor'],
        ['Valor comprometido', formatCurrency(summary.supplier_payment_total), summary.supplier_payment_missing_count > 0 ? `${summary.supplier_payment_missing_count} compra(s) ainda sem valor devido` : 'Valor conhecido devido aos fornecedores'],
      ].map(([label, value, hint]) => <div className={styles.summaryItem} key={String(label)} aria-busy={summaryLoading}>
        <span className={styles.summaryLabel}>{label}</span>
        <strong className={styles.summaryValue}>{summaryLoading && !lastUpdatedAt ? '—' : value}</strong>
        <span className={styles.summaryHint}>{hint}</span>
      </div>)}
    </section>

    <Card size="small" className={styles.filterCard}>
      <Row gutter={[8, 8]} align="middle" className={styles.filterRow}>
        <Col flex="1 1 320px"><Input aria-label="Buscar compras" placeholder="Compra DSLite, cliente, fornecedor, produto ou SKU" prefix={<SearchOutlined />} value={search} allowClear onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></Col>
        <Col flex="0 1 210px"><Select placeholder="Status" value={statusFilter || undefined} options={statusOptions} allowClear style={{ width: '100%' }} onChange={(value) => { setStatusFilter(value || ''); setPage(1); }} /></Col>
        <Col flex="0 1 230px"><Select showSearch optionFilterProp="label" placeholder="Fornecedor" value={supplierFilter || undefined} options={supplierOptions} allowClear loading={independentLoading} style={{ width: '100%' }} onChange={(value) => { setSupplierFilter(value || ''); setPage(1); }} /></Col>
        <Col flex="0 1 260px"><RangePicker value={datePickerValue} format="DD/MM/YYYY" style={{ width: '100%' }} onChange={(dates) => { setDateRange([dates?.[0]?.format('YYYY-MM-DD') || null, dates?.[1]?.format('YYYY-MM-DD') || null]); setPage(1); }} /></Col>
      </Row>
      {activeFilters.length > 0 && <Space wrap className={styles.activeFilters}>
        <Text type="secondary">Filtros ativos:</Text>
        {activeFilters.map((filter) => <Tag key={filter.key} closable onClose={filter.clear}>{filter.label}</Tag>)}
        <Button type="link" size="small" onClick={() => { setSearch(''); setStatusFilter(''); setSupplierFilter(''); setDateRange([null, null]); setPage(1); }}>Limpar filtros</Button>
      </Space>}
    </Card>

    {listError && <Alert type="error" showIcon message="Falha ao atualizar as compras" description={`${listError}${compras.length > 0 ? ' Os dados anteriores foram preservados.' : ''}`} action={<Button size="small" onClick={() => void fetchFilteredPurchases()}>Tentar novamente</Button>} />}
    <Card size="small" className={styles.tableCard}>
      {!listLoading && !listError && compras.length === 0 ? <Empty description="Nenhuma compra encontrada com os filtros atuais." image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <ResizableTable<CompraOperacional>
        storageKey="compras-bentevi-v1" dataSource={compras} columns={columns} rowKey="id" loading={listLoading}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (count) => `${count} compras` }}
        onChange={handleTableChange} scroll={{ x: 1365 }} size="small"
      />}
    </Card>

    <CompraDetailsDrawer purchase={drawerPurchase} open={Boolean(drawerPurchase)} onClose={() => setDrawerPurchase(null)} actions={drawerActions} onTrack={trackPurchase} onOpenSale={openSale} onOpenDanfe={(purchase) => void openDanfe(purchase)} />

    <Modal
      title={selectedCompra?.supplier_payment_status === 'paid' ? 'Enviar comprovante ao fornecedor' : 'Confirmar pagamento do fornecedor'}
      open={paymentModalOpen} closable={!confirmingPayment} maskClosable={!confirmingPayment}
      onCancel={() => { if (!confirmingPayment) resetPaymentModal(); }} onOk={() => void handleConfirmSupplierPayment()}
      okText={selectedCompra?.supplier_payment_status === 'paid' ? 'Enviar comprovante' : 'Confirmar pagamento'} cancelText="Cancelar"
      cancelButtonProps={{ disabled: confirmingPayment }} confirmLoading={confirmingPayment}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div><Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Compra</Text><Text strong>{selectedCompra ? `DSLite #${selectedCompra.dsid}` : '—'}</Text></div>
        <div><Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Fornecedor</Text><Text>{selectedCompra?.fornecedor_nome || '—'}</Text></div>
        <div>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Valor devido ao fornecedor</Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={selectedCompra?.supplier_payment_amount == null ? 'A definir' : formatCurrency(selectedCompra.supplier_payment_amount)} />
            {selectedCompra?.supplier_payment_amount != null && <Button onClick={() => void copyToClipboard(String(selectedCompra.supplier_payment_amount), 'Valor do PIX copiado')}>Copiar</Button>}
          </Space.Compact>
        </div>
        <div>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Chave PIX do fornecedor</Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={selectedCompra?.supplier_pix_key || 'Chave PIX não cadastrada'} />
            {selectedCompra?.supplier_pix_key && <Button onClick={() => void copyToClipboard(selectedCompra.supplier_pix_key || '', 'Chave PIX copiada')}>Copiar</Button>}
          </Space.Compact>
        </div>
        <div><Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Referência do pagamento</Text><Input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Ex.: PIX 123456 / ID da transação" /></div>
        <div>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Comprovante do PIX</Text>
          <Upload
            maxCount={1} fileList={paymentReceiptFile ? [{ uid: 'supplier-payment-receipt', name: paymentReceiptFile.name, status: 'done' }] as any : []}
            accept="application/pdf,image/jpeg,image/png,image/webp"
            beforeUpload={(file) => { if (file.size > 10 * 1024 * 1024) { messageApi.error('Comprovante maior que 10MB.'); return Upload.LIST_IGNORE; } setPaymentReceiptFile(file as File); return false; }}
            onRemove={() => { setPaymentReceiptFile(null); }}
          ><Button icon={<UploadOutlined />}>Selecionar comprovante</Button></Upload>
          {(selectedCompra?.supplier_payment_receipt_path || selectedCompra?.supplier_payment_receipt_url) && !paymentReceiptFile && <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>Comprovante já anexado. Selecione outro somente para substituir.</Text>}
        </div>
        <div><Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Observações</Text><Input.TextArea rows={3} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Observações internas do pagamento" /></div>
      </Space>
    </Modal>
  </div>;
}
