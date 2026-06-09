'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Col, Input, Row, Select, Space, Spin, Statistic, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { LoadingOutlined, SearchOutlined, StarOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import ResizableTable from '@/components/ResizableTable';
import { formatCurrency } from '@/lib/format';
import { appendRemoteSortParams, getRemoteSortOrder, resolveRemoteSortState, type RemoteSortState } from '@/lib/remote-sort';

const { Title } = Typography;

type OfferListRow = {
  offerId: string;
  productId: string;
  productSku: string;
  productName: string;
  preferred: boolean;
  skuOferta: string;
  fornecedor: string | null;
  nome: string;
  custo: number;
  estoque: number;
  paymentMode: string;
  ativo: boolean;
};

type SupplierOption = {
  id: string;
  label: string;
  apelido: string;
};

const estoqueOptions = [
  { value: 'todos', label: 'Todos' },
  { value: 'com_estoque', label: 'Com Estoque' },
  { value: 'sem_estoque', label: 'Sem Estoque' },
];

export default function ProductOffersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OfferListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'sku', sortOrder: 'asc' });
  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [filterFornecedores, setFilterFornecedores] = useState<string[]>([]);
  const [fornecedorOptions, setFornecedorOptions] = useState<SupplierOption[]>([]);
  const [filterEstoque, setFilterEstoque] = useState('todos');
  const [metrics, setMetrics] = useState({ comEstoque: 0, semAnuncio: 0, receitaPotencial: 0, lucroSomado: 0, lucroCount: 0 });
  const requestRef = useRef(0);

  const fetchOffers = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      appendRemoteSortParams(params, sort);
      if (lastSearch) params.set('search', lastSearch);
      if (filterFornecedores.length > 0) params.set('fornecedores', filterFornecedores.join(','));
      if (filterEstoque !== 'todos') params.set('estoque', filterEstoque);

      const response = await fetch(`/api/produtos/ofertas?${params}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.erro || json?.error || 'Falha ao carregar ofertas');

      const data = Array.isArray(json.data) ? json.data : [];
      if (requestRef.current !== requestId) return;
      setRows(data.map((item: any) => ({
        offerId: String(item.offerId || item.id),
        productId: String(item.productId || item.product?.id || ''),
        productSku: String(item.product?.sku || ''),
        productName: String(item.product?.nome || ''),
        preferred: Boolean(item.preferred),
        skuOferta: String(item.skuOferta || ''),
        fornecedor: item.fornecedor ? String(item.fornecedor) : null,
        nome: String(item.nome || ''),
        custo: Number(item.custo || 0),
        estoque: Number(item.estoque || 0),
        paymentMode: String(item.paymentMode || 'postpaid'),
        ativo: Boolean(item.ativo),
      })));
      setTotal(Number(json.total || 0));
      setFornecedorOptions(
        Array.isArray(json.fornecedores)
          ? json.fornecedores.map((item: any) => ({
            id: String(item?.id || ''),
            label: String(item?.label || item?.apelido || ''),
            apelido: String(item?.apelido || item?.label || ''),
          })).filter((item: SupplierOption) => item.id && item.label)
          : [],
      );
      if (json.metrics) setMetrics(json.metrics);
    } catch (err: any) {
      if (requestRef.current !== requestId) return;
      setRows([]);
      setTotal(0);
      setError(err.message || 'Falha ao carregar ofertas');
    } finally {
      if (requestRef.current !== requestId) return;
      setLoading(false);
    }
  }, [page, sort, lastSearch, filterFornecedores, filterEstoque]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== lastSearch) {
        setPage(1);
        setLastSearch(search);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, lastSearch]);

  useEffect(() => {
    setPage(1);
  }, [filterFornecedores, filterEstoque]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const lucroMedio = useMemo(() => (
    metrics.lucroCount > 0 ? metrics.lucroSomado / metrics.lucroCount : 0
  ), [metrics]);

  const columns: TableProps<OfferListRow>['columns'] = [
    {
      title: 'SKU Fornecedor',
      dataIndex: 'skuOferta',
      key: 'sku',
      width: 150,
      sorter: true,
      sortOrder: getRemoteSortOrder('sku', sort),
    },
    {
      title: 'Oferta',
      dataIndex: 'nome',
      key: 'nome',
      sorter: true,
      sortOrder: getRemoteSortOrder('nome', sort),
      render: (_value, record) => (
        <div>
          <a onClick={() => router.push(`/produtos/ofertas/${record.offerId}`)} style={{ color: '#1677ff' }}>
            {record.nome}
          </a>
          <div style={{ marginTop: 4 }}>
            <Space size={6} wrap>
              {record.preferred && <Tag color="green" icon={<StarOutlined />}>Preferencial</Tag>}
              {!record.ativo && <Tag>Inativa</Tag>}
              <Tag color={record.paymentMode === 'balance_account' ? 'blue' : record.paymentMode === 'prepaid_pix' ? 'orange' : 'default'}>
                {record.paymentMode === 'balance_account' ? 'Saldo Hayamax' : record.paymentMode === 'prepaid_pix' ? 'PIX antecipado' : 'Pós-pago'}
              </Tag>
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: 'Produto Mestre',
      key: 'produto',
      width: 190,
      render: (_value, record) => (
        <div>
          <a onClick={() => router.push(`/produtos/${record.productId}`)} style={{ color: '#1677ff' }}>
            {record.productSku || 'Abrir produto'}
          </a>
          <div style={{ color: '#888', marginTop: 4 }}>{record.productName || 'Produto mestre'}</div>
        </div>
      ),
    },
    {
      title: 'Fornecedor',
      dataIndex: 'fornecedor',
      key: 'fornecedor',
      width: 150,
      sorter: true,
      sortOrder: getRemoteSortOrder('fornecedor', sort),
      render: (value: string | null) => value ? <Tag>{value}</Tag> : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Estoque',
      dataIndex: 'estoque',
      key: 'estoque',
      width: 90,
      sorter: true,
      sortOrder: getRemoteSortOrder('estoque', sort),
      render: (value: number) => <span style={{ color: value > 0 ? '#e0e0e0' : '#ff4d4f' }}>{value}</span>,
    },
    {
      title: 'Custo',
      dataIndex: 'custo',
      key: 'custo',
      width: 120,
      sorter: true,
      sortOrder: getRemoteSortOrder('custo', sort),
      render: (value: number) => formatCurrency(value),
    },
  ];

  const handleTableChange: TableProps<OfferListRow>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'sku', sortOrder: 'asc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e0e0e0', marginBottom: 0 }}>Ofertas de Fornecedor</Title>
        <Button onClick={() => router.push('/produtos')}>Voltar para Produtos</Button>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Ofertas</span>} value={total} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Com Estoque</span>} value={metrics.comEstoque} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Sem Anúncio ML</span>} value={metrics.semAnuncio} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Lucro Médio</span>} value={formatCurrency(lucroMedio)} valueStyle={{ color: lucroMedio >= 0 ? '#52c41a' : '#ff4d4f' }} />
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Buscar oferta, produto ou SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="Fornecedores"
            value={filterFornecedores}
            onChange={setFilterFornecedores}
            options={fornecedorOptions.map((fornecedor) => ({ value: fornecedor.id, label: fornecedor.label }))}
            style={{ width: 260 }}
          />
          <Select
            value={filterEstoque}
            onChange={setFilterEstoque}
            options={estoqueOptions}
            style={{ width: 180 }}
          />
        </Space>

        {error && (
          <Alert
            type="error"
            showIcon
            message="Falha ao carregar as ofertas"
            description={error}
            style={{ marginBottom: 16 }}
          />
        )}

        <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
          <ResizableTable
            storageKey="produtos-ofertas"
            columns={columns}
            dataSource={rows}
            rowKey="offerId"
            pagination={{
              current: page,
              pageSize: 100,
              total,
              onChange: setPage,
              showSizeChanger: false,
            }}
            onChange={handleTableChange}
            scroll={{ x: 1100 }}
          />
        </Spin>
      </div>
    </div>
  );
}
