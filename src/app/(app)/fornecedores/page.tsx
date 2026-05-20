'use client';

import { useState, useCallback, useEffect } from 'react';
import { Input, Button, Dropdown, Typography, Row, Col, Select, Tag, Spin } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TablePaginationConfig, TableProps } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import type { Database } from '@/types/database';

const { Title } = Typography;

type FornecedorRow = Database['public']['Tables']['fornecedores']['Row'];
type SortOrder = 'asc' | 'desc';

function formatDate(date: string | null): string {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR');
}

function statusColor(value: string): string {
  if (!value) return 'default';
  const normalized = value.toLowerCase();
  if (normalized.includes('ativo') || normalized.includes('ok')) return 'green';
  if (normalized.includes('inativo') || normalized.includes('bloque')) return 'red';
  return 'blue';
}

function statusBadgeColor(value: string): string {
  const normalized = (value || '').toLowerCase();
  if (normalized.includes('ativo')) return 'green';
  if (normalized.includes('inativo') || normalized.includes('bloque')) return 'red';
  return 'default';
}

export default function FornecedoresPage() {
  const [rows, setRows] = useState<FornecedorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [crossFilter, setCrossFilter] = useState<string>('');
  const [dropFilter, setDropFilter] = useState<string>('');

  const [sortBy, setSortBy] = useState<string>('dslite_id');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [statusOptions, setStatusOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [crossOptions, setCrossOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [dropOptions, setDropOptions] = useState<Array<{ value: string; label: string }>>([]);

  const fetchFornecedores = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        sortBy,
        sortOrder,
      });

      if (lastSearch) params.set('search', lastSearch);
      if (statusFilter) params.set('status_dslite', statusFilter);
      if (crossFilter) params.set('crossdocking', crossFilter);
      if (dropFilter) params.set('dropshipping', dropFilter);

      const res = await fetch(`/api/fornecedores?${params.toString()}`);
      if (!res.ok) return;

      const json = await res.json();
      const data: FornecedorRow[] = json.data || [];
      setRows(data);
      setTotal(json.total || 0);

      const statuses = new Set<string>();
      const cross = new Set<string>();
      const drop = new Set<string>();
      for (const item of data) {
        if (item.status_dslite) statuses.add(item.status_dslite);
        if (item.crossdocking) cross.add(item.crossdocking);
        if (item.dropshipping) drop.add(item.dropshipping);
      }
      setStatusOptions(Array.from(statuses).sort().map((v) => ({ value: v, label: v })));
      setCrossOptions(Array.from(cross).sort().map((v) => ({ value: v, label: v })));
      setDropOptions(Array.from(drop).sort().map((v) => ({ value: v, label: v })));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, lastSearch, statusFilter, crossFilter, dropFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== lastSearch) {
        setPage(1);
        setLastSearch(search);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, lastSearch]);

  useEffect(() => {
    fetchFornecedores();
  }, [fetchFornecedores]);

  const columns: TableProps<FornecedorRow>['columns'] = [
    {
      title: 'ID DSLite',
      dataIndex: 'dslite_id',
      key: 'dslite_id',
      width: 120,
      sorter: true,
      render: (v: string | null) => <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span>,
    },
    {
      title: 'Apelido',
      dataIndex: 'apelido',
      key: 'apelido',
      width: 180,
      sorter: true,
      render: (v: string) => v || '—',
    },
    {
      title: 'Capacidades',
      dataIndex: 'status_dslite',
      key: 'status_dslite',
      width: 290,
      sorter: true,
      render: (_: string, record: FornecedorRow) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Tag color={statusColor(record.status_dslite)}>Status: {record.status_dslite || '—'}</Tag>
          <Tag color={statusBadgeColor(record.crossdocking)}>Cross: {record.crossdocking || '—'}</Tag>
          <Tag color={statusBadgeColor(record.dropshipping)}>Drop: {record.dropshipping || '—'}</Tag>
        </div>
      ),
    },
    {
      title: 'Nome',
      dataIndex: 'nome',
      key: 'nome',
      width: 220,
      sorter: true,
      render: (v: string) => v || '—',
    },
    {
      title: 'Contato',
      key: 'contato',
      width: 300,
      render: (_: unknown, record: FornecedorRow) => (
        <div>
          <div style={{ fontFamily: 'monospace', color: '#d9d9d9' }}>
            CNPJ: {record.cnpj || '—'}
          </div>
          <div style={{ color: '#a6a6a6', fontSize: 12 }}>
            E-mail: {record.email || '—'}
          </div>
          <div style={{ color: '#a6a6a6', fontSize: 12 }}>
            Telefone: {record.telefone || '—'}
          </div>
        </div>
      ),
    },
    {
      title: 'Última Sync',
      dataIndex: 'dslite_ultima_sync',
      key: 'dslite_ultima_sync',
      width: 180,
      sorter: true,
      render: (v: string | null) => formatDate(v),
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 60,
      fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Visualizar payload DSLite' },
              { key: 'dslite', label: 'Ver no DSLite' },
            ],
            onClick: ({ key }) => {
              if (key === 'view') {
                window.console.log('[fornecedor payload]', record.payload_dslite);
              }
            },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];

  const handleTableChange = (
    pagination: TablePaginationConfig,
    _filters: Record<string, (React.Key | boolean)[] | null>,
    sorter: SorterResult<FornecedorRow> | SorterResult<FornecedorRow>[],
  ) => {
    if (pagination.current) setPage(pagination.current);
    if (pagination.pageSize) setPageSize(pagination.pageSize);

    if (Array.isArray(sorter)) return;
    if (!sorter.order || !sorter.field) return;

    setSortBy(String(sorter.field));
    setSortOrder(sorter.order === 'descend' ? 'desc' : 'asc');
  };

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Fornecedores</Title>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (ID DSLite, apelido, razão social, CNPJ, e-mail ou telefone)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 420 }}
              allowClear
              onClear={() => {
                setSearch('');
                setLastSearch('');
                setPage(1);
              }}
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
              options={[{ value: '', label: 'Todos os status' }, ...statusOptions]}
              style={{ width: 180 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Crossdocking"
              value={crossFilter || undefined}
              onChange={(v) => { setCrossFilter(v || ''); setPage(1); }}
              options={[{ value: '', label: 'Todos' }, ...crossOptions]}
              style={{ width: 150 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Dropshipping"
              value={dropFilter || undefined}
              onChange={(v) => { setDropFilter(v || ''); setPage(1); }}
              options={[{ value: '', label: 'Todos' }, ...dropOptions]}
              style={{ width: 150 }}
              allowClear
            />
          </Col>
        </Row>
      </div>

      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<FornecedorRow>
            storageKey="fornecedores"
            dataSource={rows}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            onChange={handleTableChange}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (t) => `${t} fornecedores`,
            }}
            scroll={{ x: 1550 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
    </div>
  );
}
