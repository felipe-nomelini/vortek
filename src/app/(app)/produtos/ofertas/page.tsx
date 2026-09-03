'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Segmented, Select, Spin, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import {
  ArrowLeftOutlined,
  EyeOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  StarFilled,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import ResizableTable from '@/components/ResizableTable';
import { formatCurrency } from '@/lib/format';
import {
  appendRemoteSortParams,
  getRemoteSortOrder,
  resolveRemoteSortState,
  type RemoteSortState,
} from '@/lib/remote-sort';
import type {
  SupplierOfferListRow,
  SupplierOfferMetrics,
  SupplierOfferOption,
  SupplierOfferQueueCounts,
  SupplierOffersView,
} from '@/lib/products/supplier-offers';
import styles from './ofertas.module.css';

const { Title, Text } = Typography;

type VisualReviewMetadata = {
  enabled: true;
  source: 'production-read-only';
  capturedAt: string;
  expiresAt: string;
  itemCount: number;
};

const EMPTY_METRICS: SupplierOfferMetrics = {
  totalLinked: 0,
  eligible: 0,
  problems: 0,
  historical: 0,
  productsWithAlternatives: 0,
};

const EMPTY_QUEUES: SupplierOfferQueueCounts = {
  operational: 0,
  alternatives: 0,
  problems: 0,
  historical: 0,
  all: 0,
};

const statusPresentation = {
  eligible: { label: 'Elegível', color: 'success' },
  out_of_stock: { label: 'Sem estoque', color: 'warning' },
  invalid_cost: { label: 'Custo inválido', color: 'error' },
  product_inactive: { label: 'Produto inativo', color: 'default' },
  offer_inactive: { label: 'Oferta inativa', color: 'default' },
  historical: { label: 'Histórica', color: 'default' },
} as const;

const paymentLabels: Record<string, string> = {
  prepaid_pix: 'PIX antecipado',
  postpaid: 'Pós-pago',
  balance_account: 'Conta-saldo aposentada',
};

const stockOptions = [
  { value: 'todos', label: 'Qualquer estoque' },
  { value: 'com_estoque', label: 'Com estoque' },
  { value: 'sem_estoque', label: 'Sem estoque' },
];

const preferenceOptions = [
  { value: 'todos', label: 'Todas as preferências' },
  { value: 'preferenciais', label: 'Somente preferenciais' },
  { value: 'alternativas', label: 'Somente alternativas' },
];

const validViews = new Set<SupplierOffersView>(['operational', 'alternatives', 'problems', 'historical', 'all']);

function formatDateTime(value: string | null) {
  if (!value) return 'Não sincronizada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function ProductOffersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SupplierOfferListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'cost', sortOrder: 'asc' });
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [view, setView] = useState<SupplierOffersView>('operational');
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOfferOption[]>([]);
  const [stockStatus, setStockStatus] = useState('todos');
  const [preference, setPreference] = useState('todos');
  const [metrics, setMetrics] = useState<SupplierOfferMetrics>(EMPTY_METRICS);
  const [queueCounts, setQueueCounts] = useState<SupplierOfferQueueCounts>(EMPTY_QUEUES);
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedSuppliers = (params.get('fornecedores') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const requestedView = params.get('view') as SupplierOffersView | null;
    setSupplierIds(Array.from(new Set(requestedSuppliers)));
    if (requestedView && validViews.has(requestedView)) setView(requestedView);
    setFiltersHydrated(true);
  }, []);

  const fetchOffers = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), view, estoque: stockStatus, preferencia: preference });
      appendRemoteSortParams(params, sort);
      if (committedSearch) params.set('search', committedSearch);
      if (supplierIds.length > 0) params.set('fornecedores', supplierIds.join(','));

      const response = await fetch(`/api/produtos/ofertas?${params}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.erro || json?.error || 'Falha ao carregar ofertas');
      if (requestRef.current !== requestId) return;

      setRows(Array.isArray(json.data) ? json.data : []);
      setTotal(Number(json.total || 0));
      setMetrics({ ...EMPTY_METRICS, ...(json.metrics || {}) });
      setQueueCounts({ ...EMPTY_QUEUES, ...(json.queueCounts || {}) });
      setSupplierOptions(Array.isArray(json.suppliers) ? json.suppliers : []);
      setVisualReview(json?.visualReview?.enabled === true ? json.visualReview : null);
    } catch (fetchError: any) {
      if (requestRef.current !== requestId) return;
      setRows([]);
      setTotal(0);
      setError(fetchError?.message || 'Falha ao carregar ofertas');
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [committedSearch, page, preference, sort, stockStatus, supplierIds, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      if (next !== committedSearch) {
        setPage(1);
        setCommittedSearch(next);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [committedSearch, search]);

  useEffect(() => {
    setPage(1);
  }, [preference, stockStatus, supplierIds, view]);

  useEffect(() => {
    if (filtersHydrated) void fetchOffers();
  }, [fetchOffers, filtersHydrated]);

  const queueOptions = useMemo(() => ([
    { value: 'operational', label: <span className={styles.quickViewLabel}>Operacionais <strong className={styles.quickViewCount}>{queueCounts.operational}</strong></span> },
    { value: 'alternatives', label: <span className={styles.quickViewLabel}>Alternativas <strong className={styles.quickViewCount}>{queueCounts.alternatives}</strong></span> },
    { value: 'problems', label: <span className={styles.quickViewLabel}>Com problema <strong className={styles.quickViewCount}>{queueCounts.problems}</strong></span> },
    { value: 'historical', label: <span className={styles.quickViewLabel}>Históricas <strong className={styles.quickViewCount}>{queueCounts.historical}</strong></span> },
    { value: 'all', label: <span className={styles.quickViewLabel}>Todas <strong className={styles.quickViewCount}>{queueCounts.all}</strong></span> },
  ]), [queueCounts]);

  const clearFilters = () => {
    setSearch('');
    setCommittedSearch('');
    setSupplierIds([]);
    setStockStatus('todos');
    setPreference('todos');
    setView('operational');
    setSort({ sortBy: 'cost', sortOrder: 'asc' });
    setPage(1);
  };

  const openOffer = (row: SupplierOfferListRow) => {
    router.push(`/produtos/ofertas/${row.offerId}`);
  };

  const columns: TableProps<SupplierOfferListRow>['columns'] = [
    {
      title: 'Oferta do fornecedor',
      key: 'offer',
      width: 300,
      sorter: true,
      sortOrder: getRemoteSortOrder('offer', sort),
      render: (_value, row) => (
        <div className={styles.primaryCell}>
          <strong>{row.offerName || 'Oferta sem nome'}</strong>
          <span>SKU externo {row.supplierSku || 'não informado'}</span>
        </div>
      ),
    },
    {
      title: 'Produto Bentevi',
      key: 'product',
      width: 270,
      sorter: true,
      sortOrder: getRemoteSortOrder('product', sort),
      render: (_value, row) => (
        <button className={styles.productLink} type="button" onClick={() => router.push(`/produtos/${row.productId}`)}>
          <strong>{row.productName || 'Produto sem nome'}</strong>
          <span>{row.productSku || 'SKU Bentevi não informado'}</span>
        </button>
      ),
    },
    {
      title: 'Fornecedor',
      key: 'supplier',
      width: 170,
      sorter: true,
      sortOrder: getRemoteSortOrder('supplier', sort),
      render: (_value, row) => (
        <div className={styles.compactCell}>
          <strong>{row.supplierName}</strong>
          <span>{paymentLabels[row.paymentMode] || row.paymentMode}</span>
        </div>
      ),
    },
    {
      title: 'Disponibilidade',
      key: 'stock',
      width: 145,
      sorter: true,
      sortOrder: getRemoteSortOrder('stock', sort),
      render: (_value, row) => (
        <div className={styles.compactCell}>
          <strong className={row.stock > 0 ? styles.positive : styles.negative}>{row.stock} un.</strong>
          <span>{row.leadTimeDays == null ? 'Prazo não informado' : `${row.leadTimeDays} ${row.leadTimeDays === 1 ? 'dia' : 'dias'} de prazo`}</span>
        </div>
      ),
    },
    {
      title: 'Custo comparado',
      key: 'cost',
      width: 165,
      sorter: true,
      sortOrder: getRemoteSortOrder('cost', sort),
      render: (_value, row) => (
        <div className={styles.compactCell}>
          <strong>{formatCurrency(row.cost)}</strong>
          {row.lowestEligibleCost == null ? (
            <span>Sem base elegível</span>
          ) : Number(row.costDeltaAmount || 0) <= 0 ? (
            <span className={styles.positive}>Menor custo elegível</span>
          ) : (
            <span className={styles.negative}>+{formatCurrency(row.costDeltaAmount || 0)} · {Number(row.costDeltaPercent || 0).toLocaleString('pt-BR')}%</span>
          )}
        </div>
      ),
    },
    {
      title: 'Situação',
      key: 'status',
      width: 185,
      sorter: true,
      sortOrder: getRemoteSortOrder('status', sort),
      render: (_value, row) => {
        const status = statusPresentation[row.status];
        return (
          <div className={styles.statusCell}>
            <Tag color={status.color}>{status.label}</Tag>
            <span className={row.preferred ? styles.preferred : styles.secondaryStatus}>
              {row.preferred && <StarFilled />} {row.preferred ? `Preferencial ${row.preferenceMode === 'manual' ? 'manual' : 'automática'}` : 'Oferta alternativa'}
            </span>
            <small>Sync {formatDateTime(row.lastSyncAt)}</small>
          </div>
        );
      },
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 118,
      fixed: 'right',
      render: (_value, row) => <Button icon={<EyeOutlined />} onClick={() => openOffer(row)}>Ver oferta</Button>,
    },
  ];

  const handleTableChange: TableProps<SupplierOfferListRow>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'cost', sortOrder: 'asc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : pagination.current || 1);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Button className={styles.backButton} type="text" icon={<ArrowLeftOutlined />} onClick={() => router.push('/produtos')}>Produtos</Button>
          <Title level={2} className={styles.title}>Ofertas de fornecedores</Title>
          <Text type="secondary">Compare disponibilidade, custo e preferência antes de decidir a fonte de compra.</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchOffers} loading={loading}>Atualizar</Button>
      </header>

      {visualReview && (
        <Alert
          className={styles.visualReviewAlert}
          type="warning"
          showIcon
          message="Amostra real protegida para homologação"
          description="As ofertas refletem um recorte somente leitura da produção. Produto e detalhe da oferta podem ser consultados; alterações e links externos permanecem bloqueados."
        />
      )}

      <section className={styles.summaryBand} aria-label="Resumo das ofertas">
        <div><span>Ofertas vinculadas</span><strong>{metrics.totalLinked.toLocaleString('pt-BR')}</strong><small>fontes externas encontradas</small></div>
        <div className={styles.summaryPositive}><span>Elegíveis agora</span><strong>{metrics.eligible.toLocaleString('pt-BR')}</strong><small>custo e estoque válidos</small></div>
        <div className={styles.summaryDanger}><span>Com problema</span><strong>{metrics.problems.toLocaleString('pt-BR')}</strong><small>exigem revisão operacional</small></div>
        <div className={styles.summaryHighlight}><span>Produtos com alternativas</span><strong>{metrics.productsWithAlternatives.toLocaleString('pt-BR')}</strong><small>mais de uma oferta elegível</small></div>
      </section>

      <Segmented
        className={styles.quickViews}
        options={queueOptions}
        value={view}
        onChange={(value) => setView(value as SupplierOffersView)}
      />

      <section className={styles.filterBar} aria-label="Filtros de ofertas">
        <Input
          className={styles.searchInput}
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Buscar oferta, produto ou SKU"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          className={styles.supplierFilter}
          mode="multiple"
          maxTagCount="responsive"
          allowClear
          placeholder="Fornecedores"
          value={supplierIds}
          onChange={setSupplierIds}
          options={supplierOptions.map((supplier) => ({
            value: supplier.dsliteId || supplier.id,
            label: supplier.active ? supplier.label : `${supplier.label} · histórico`,
          }))}
        />
        <Select value={stockStatus} onChange={setStockStatus} options={stockOptions} />
        <Select value={preference} onChange={setPreference} options={preferenceOptions} />
        <Button onClick={clearFilters}>Limpar</Button>
      </section>

      <section className={styles.tableCard}>
        {error && (
          <Alert
            type="error"
            showIcon
            message="Não foi possível carregar as ofertas"
            description={error}
            action={<Button size="small" onClick={fetchOffers}>Tentar novamente</Button>}
          />
        )}
        <Spin spinning={loading} indicator={<LoadingOutlined className={styles.loadingIcon} spin />}>
          {!error && !loading && rows.length === 0 ? (
            <Empty
              className={styles.emptyState}
              description="Nenhuma oferta corresponde a esta fila e aos filtros aplicados."
            >
              <Button onClick={clearFilters}>Limpar filtros</Button>
            </Empty>
          ) : (
            <div className={styles.desktopTable}>
              <ResizableTable
                storageKey="bentevi-produtos-ofertas"
                columns={columns}
                dataSource={rows}
                rowKey="offerId"
                pagination={{
                  current: page,
                  pageSize: 100,
                  total,
                  showSizeChanger: false,
                  showTotal: (value) => `${value.toLocaleString('pt-BR')} ofertas`,
                }}
                onChange={handleTableChange}
                scroll={{ x: 1380 }}
              />
            </div>
          )}
        </Spin>
      </section>
    </main>
  );
}
