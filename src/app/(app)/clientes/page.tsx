'use client';

import { useState, useCallback, useEffect } from 'react';
import { Input, Select, Tag, Typography, Row, Col, Button, Dropdown, Spin, Statistic, Divider } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { useRouter } from 'next/navigation';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import type { Database } from '@/types/database';

const { Title } = Typography;

const tipoOptions = [
  { value: '', label: 'Todos os tipos' },
  { value: 'F', label: 'Pessoa Física' },
  { value: 'J', label: 'Pessoa Jurídica' },
];

type ClienteRow = Database['public']['Tables']['clientes']['Row'];

function formatDoc(doc: string): string {
  if (!doc) return '—';
  if (doc.length === 11) {
    return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (doc.length === 14) {
    return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
}

export default function ClientesPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClienteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState<string>('');

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [stats, setStats] = useState({ total: 0, pf: 0, pj: 0 });

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (lastSearch) params.set('search', lastSearch);
      if (tipoFilter) params.set('tipo', tipoFilter);
      const res = await fetch(`/api/clientes?${params}`);
      if (res.ok) {
        const json = await res.json();
        setClients(json.data || []);
        setTotal(json.total || 0);
      }
    } catch {}
    setLoading(false);
  }, [page, lastSearch, tipoFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (lastSearch) params.set('search', lastSearch);
      if (tipoFilter) params.set('tipo', tipoFilter);
      const res = await fetch(`/api/clientes/resumo?${params}`);
      if (res.ok) {
        const json = await res.json();
        setStats({
          total: json.total || 0,
          pf: json.pf || 0,
          pj: json.pj || 0,
        });
      }
    } catch {}
  }, [lastSearch, tipoFilter]);

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
  }, [tipoFilter]);

  useEffect(() => {
    fetchClients();
    fetchStats();
  }, [fetchClients, fetchStats]);

  const columns: TableProps<ClienteRow>['columns'] = [
    {
      title: 'ID ML', dataIndex: 'ml_id', key: 'ml_id', width: 100,
      sorter: (a, b) => (a.ml_id || '').localeCompare(b.ml_id || ''),
      render: (v: string | null) => v || <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Nome', dataIndex: 'nome', key: 'nome',
      sorter: (a, b) => a.nome.localeCompare(b.nome),
      render: (nome: string, record) => (
        <a onClick={() => router.push(`/clientes/${record.id}`)} style={{ color: '#1677ff', cursor: 'pointer' }}>
          {nome}
        </a>
      ),
    },
    {
      title: 'Tipo', dataIndex: 'tipo_pessoa', key: 'tipo_pessoa', width: 90,
      sorter: (a, b) => (a.tipo_pessoa || '').localeCompare(b.tipo_pessoa || ''),
      render: (t: string | null) => (
        <Tag color={t === 'J' ? 'purple' : 'blue'}>{t === 'J' ? 'PJ' : t === 'F' ? 'PF' : '—'}</Tag>
      ),
    },
    {
      title: 'Documento', dataIndex: 'documento', key: 'documento', width: 160,
      sorter: (a, b) => (a.documento || '').localeCompare(b.documento || ''),
      render: (doc: string) => (
        <span style={{ fontFamily: 'monospace' }}>{formatDoc(doc)}</span>
      ),
    },
    {
      title: 'Endereço', dataIndex: 'endereco', key: 'endereco',
      sorter: (a, b) => (a.endereco || '').localeCompare(b.endereco || ''),
      render: (end: string) => (
        <span style={{ fontSize: 13 }}>{end || '—'}</span>
      ),
    },
    {
      title: 'E-mail', dataIndex: 'email', key: 'email',
      sorter: (a, b) => (a.email || '').localeCompare(b.email || ''),
      render: (v: string) => <span>{v || '—'}</span>,
    },
    {
      title: 'Telefone', dataIndex: 'telefone', key: 'telefone', width: 180,
      sorter: (a, b) => (a.telefone || '').localeCompare(b.telefone || ''),
      render: (v: string) => <span>{v || '—'}</span>,
    },
    {
      title: 'Pedidos', dataIndex: 'total_vendas', key: 'total_vendas', width: 90,
      sorter: (a, b) => (a.total_vendas || 0) - (b.total_vendas || 0),
      render: (v: number | null) => <span style={{ fontWeight: 600, color: '#1677ff' }}>{v ?? 0}</span>,
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Visualizar' },
              { key: 'edit', label: 'Editar' },
            ],
            onClick: ({ key }) => {
              if (key === 'view') router.push(`/clientes/${record.id}`);
              // TODO: editar
            },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Clientes</Title>

      {/* Mini Dashboard */}
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Clientes</span>}
              value={stats.total}
              valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Pessoa Física</span>}
              value={stats.pf}
              valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Pessoa Jurídica</span>}
              value={stats.pj}
              valueStyle={{ color: '#722ed1', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (nome, documento ou endereço)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 400 }}
              allowClear
              onClear={() => { setSearch(''); setLastSearch(''); setPage(1); }}
            />
          </Col>
          <Col>
            <Select
              placeholder="Tipo"
              value={tipoFilter || undefined}
              onChange={v => setTipoFilter(v as string)}
              options={tipoOptions}
              style={{ width: 160 }}
              allowClear
              onClear={() => setTipoFilter('')}
            />
          </Col>
        </Row>
      </div>

      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<ClienteRow>
            storageKey="clientes"
            dataSource={clients}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} clientes`,
              onChange: (p) => setPage(p),
            }}
            scroll={{ x: 1200 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
    </div>
  );
}
