'use client';

import { useState, useCallback, useEffect } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TablePaginationConfig, TableProps } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Title } = Typography;
const { RangePicker } = DatePicker;

type NFStatus = 'emitida' | 'cancelada' | 'pendente';
type SortOrder = 'asc' | 'desc';

interface NotaFiscalRow {
  id: string;
  pedido: number;
  cliente: string;
  data: string;
  numero: string;
  valor: number;
  status: NFStatus;
  ml_order_id: string | null;
}

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'emitida', label: 'Emitida' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'pendente', label: 'Pendente' },
];

const statusColor: Record<NFStatus, string> = {
  emitida: 'green',
  cancelada: 'red',
  pendente: 'orange',
};

export default function NotasFiscaisPage() {
  const PAGE_SIZE = 100;
  const [rows, setRows] = useState<NotaFiscalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NFStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [valorMin, setValorMin] = useState<number | null>(null);
  const [valorMax, setValorMax] = useState<number | null>(null);

  const [sortBy, setSortBy] = useState<string>('data');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const fetchNotas = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortBy,
        sortOrder,
      });

      if (lastSearch) params.set('search', lastSearch);
      if (statusFilter) params.set('status', statusFilter);
      if (dateRange[0]) params.set('dateFrom', dateRange[0]);
      if (dateRange[1]) params.set('dateTo', dateRange[1]);
      if (valorMin !== null) params.set('valorMin', String(valorMin));
      if (valorMax !== null) params.set('valorMax', String(valorMax));

      const res = await fetch(`/api/notas-fiscais?${params.toString()}`);
      if (!res.ok) return;

      const json = await res.json();
      setRows(json.data || []);
      setTotal(json.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, lastSearch, statusFilter, dateRange, valorMin, valorMax]);

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
    fetchNotas();
  }, [fetchNotas]);

  const columns: TableProps<NotaFiscalRow>['columns'] = [
    {
      title: 'Pedido',
      dataIndex: 'pedido',
      key: 'pedido',
      width: 110,
      sorter: true,
      render: (v: number) => <span style={{ fontFamily: 'monospace' }}>#{String(v).padStart(6, '0')}</span>,
    },
    {
      title: 'Número',
      dataIndex: 'numero',
      key: 'numero',
      width: 130,
      sorter: true,
      render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span>,
    },
    {
      title: 'Cliente',
      dataIndex: 'cliente',
      key: 'cliente',
      sorter: true,
    },
    {
      title: 'Data',
      dataIndex: 'data',
      key: 'data',
      width: 170,
      sorter: true,
      render: (d: string) => {
        if (!d) return <span style={{ color: '#666' }}>—</span>;
        const dt = new Date(d);
        if (Number.isNaN(dt.getTime())) return <span style={{ color: '#666' }}>—</span>;
        return dt.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      },
    },
    {
      title: 'Valor',
      dataIndex: 'valor',
      key: 'valor',
      width: 120,
      sorter: true,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      sorter: true,
      render: (s: NFStatus) => <Tag color={statusColor[s]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Tag>,
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 60,
      fixed: 'right',
      render: () => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Visualizar' },
              { key: 'download', label: 'Baixar PDF' },
              { key: 'email', label: 'Enviar por e-mail' },
            ],
            onClick: () => {
              // TODO: implementar ações da NF
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
    sorter: SorterResult<NotaFiscalRow> | SorterResult<NotaFiscalRow>[],
  ) => {
    if (pagination.current) setPage(pagination.current);

    if (Array.isArray(sorter)) return;
    if (!sorter.order || !sorter.field) return;

    setSortBy(String(sorter.field));
    setSortOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
  };

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Notas Fiscais</Title>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (pedido, cliente, número NF ou ID ML)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 320 }}
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
              onChange={v => {
                setStatusFilter((v as NFStatus) || '');
                setPage(1);
              }}
              options={statusOptions}
              style={{ width: 150 }}
              allowClear
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(_, dateStrings) => {
                setDateRange([dateStrings[0] || null, dateStrings[1] || null]);
                setPage(1);
              }}
              format="DD/MM/YYYY"
              style={{ width: 240 }}
            />
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber
                placeholder="Valor mín"
                value={valorMin}
                onChange={v => {
                  setValorMin(v ?? null);
                  setPage(1);
                }}
                style={{ width: 110 }}
              />
              <InputNumber
                placeholder="Valor máx"
                value={valorMax}
                onChange={v => {
                  setValorMax(v ?? null);
                  setPage(1);
                }}
                style={{ width: 110 }}
              />
            </Space.Compact>
          </Col>
        </Row>
      </div>

      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<NotaFiscalRow>
            storageKey="notas-fiscais"
            dataSource={rows}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            onChange={handleTableChange}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} notas fiscais`,
            }}
            scroll={{ x: 1080 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
    </div>
  );
}
