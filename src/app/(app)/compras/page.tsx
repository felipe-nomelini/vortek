'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Input, Select, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin, Modal, message,
} from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

interface Compra {
  id: string;
  dsid: string;
  pedido_vendas_numero: number | null;
  status: string;
  status_dslite: string;
  nf_chave: string | null;
  nf_numero: string | null;
  valor_total: number;
  valor_frete: number;
  data_criacao: string;
  rastreio: string | null;
  fornecedor_nome: string | null;
  destinatario_nome: string | null;
  destinatario_documento: string | null;
  produto_descricao: string | null;
  produto_sku: string | null;
  quantidade: number;
}

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: 'Aguardando Informações', label: 'Aguardando Informações' },
  { value: 'Iniciado', label: 'Iniciado' },
  { value: 'Aguardando Etiqueta', label: 'Aguardando Etiqueta' },
  { value: 'Solicitado', label: 'Solicitado' },
  { value: 'Confirmado', label: 'Confirmado' },
  { value: 'Faturado', label: 'Faturado' },
  { value: 'Em transporte', label: 'Em Transporte' },
  { value: 'Produto Entregue', label: 'Entregue' },
  { value: 'Cancelado', label: 'Cancelado' },
  { value: 'Rejeitado', label: 'Rejeitado' },
];

const statusColor: Record<string, string> = {
  'Aguardando Informações': 'orange',
  'Iniciado': 'blue',
  'Aguardando Etiqueta': 'cyan',
  'Solicitado': 'geekblue',
  'Confirmado': 'green',
  'Faturado': 'purple',
  'Em transporte': 'purple',
  'Produto Entregue': 'green',
  'Cancelado': 'default',
  'Rejeitado': 'red',
};

export default function ComprasPage() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [compras, setCompras] = useState<Compra[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);

  const [messageApi, contextHolder] = message.useMessage();

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    return params;
  }, [page, search, statusFilter, dateRange]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/compras?${buildParams()}`);
      if (res.ok) {
        const json = await res.json();
        setCompras(json.data || []);
        setTotal(json.total || 0);
      } else {
        messageApi.error('Erro ao carregar compras');
      }
    } catch {
      messageApi.error('Erro ao conectar');
    }
    setLoading(false);
  }, [buildParams, messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateRange]);

  const columns: TableProps<Compra>['columns'] = [
    {
      title: 'Número', dataIndex: 'dsid', key: 'dsid', width: 100,
      sorter: (a, b) => Number(a.dsid) - Number(b.dsid),
      render: (dsid: string) => (
        <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>
          #{String(dsid).padStart(6, '0')}
        </span>
      ),
    },
    {
      title: 'Pedido (vendas)', dataIndex: 'pedido_vendas_numero', key: 'pedido_vendas_numero', width: 140,
      sorter: (a, b) => {
        const aNum = a.pedido_vendas_numero ?? Number.MAX_SAFE_INTEGER;
        const bNum = b.pedido_vendas_numero ?? Number.MAX_SAFE_INTEGER;
        return aNum - bNum;
      },
      render: (numero: number | null) => numero ? (
        <a
          href={`https://www.mercadolivre.com.br/vendas/${numero}/detalhe`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: 'monospace', color: '#1677ff', fontWeight: 600, textDecoration: 'none' }}
        >
          #{String(numero).padStart(6, '0')}
        </a>
      ) : (
        <span style={{ color: '#666' }}>—</span>
      ),
    },
    {
      title: 'Data', dataIndex: 'data_criacao', key: 'data_criacao', width: 160,
      sorter: (a, b) => new Date(a.data_criacao || 0).getTime() - new Date(b.data_criacao || 0).getTime(),
      render: (d: string) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
    },
    {
      title: 'Destinatário', dataIndex: 'destinatario_nome', key: 'destinatario',
      render: (nome: string, record: Compra) => (
        <div>
          <div style={{ color: '#e0e0e0', fontSize: 13 }}>{nome || '—'}</div>
          {record.destinatario_documento && (
            <div style={{ color: '#888', fontSize: 11 }}>{record.destinatario_documento}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Produto', dataIndex: 'produto_descricao', key: 'produto',
      render: (desc: string, record: Compra) => (
        <div>
          <div style={{ color: '#e0e0e0', fontSize: 13 }}>{desc || '—'}</div>
          {record.produto_sku && (
            <div style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>{record.produto_sku}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Qtd', dataIndex: 'quantidade', key: 'quantidade', width: 60,
      sorter: (a, b) => (a.quantidade || 0) - (b.quantidade || 0),
      render: (v: number) => <span style={{ color: '#e0e0e0' }}>{v || 1}</span>,
    },
    {
      title: 'Total', dataIndex: 'valor_total', key: 'valor_total', width: 110,
      sorter: (a, b) => (a.valor_total || 0) - (b.valor_total || 0),
      render: (v: number) => formatCurrency(v || 0),
    },
    {
      title: 'Rastreio', dataIndex: 'rastreio', key: 'rastreio', width: 130,
      render: (v: string | null) => v ? (
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#1677ff' }}>{v}</span>
      ) : (
        <span style={{ color: '#666' }}>—</span>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 140,
      sorter: (a, b) => (a.status || '').localeCompare(b.status || ''),
      render: (status: string) => (
        <Tag color={statusColor[status] || 'default'} style={{ fontSize: 12 }}>
          {status || '—'}
        </Tag>
      ),
    },
    {
      title: 'NF', dataIndex: 'nf_numero', key: 'nf_numero', width: 100,
      render: (nf: string | null) => nf ? (
        <Tag color="green" style={{ fontFamily: 'monospace', fontSize: 12 }}>{nf}</Tag>
      ) : (
        <span style={{ color: '#666' }}>—</span>
      ),
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const items = [
          { key: 'view', label: 'Ver Detalhes' },
          { key: 'track', label: 'Rastrear' },
        ];
        return (
          <Dropdown
            menu={{ items, onClick: ({ key }) => {
              if (key === 'track' && record.rastreio) {
                window.open(`https://www.linkcorreios.com.br/?id=${record.rastreio}`, '_blank');
              }
            }}}
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Compras DSLite</Title>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por número, cliente ou produto"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={v => setStatusFilter(v)}
              options={statusOptions}
              style={{ width: 180 }}
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
        </Row>
      </div>

      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<Compra>
            storageKey="compras"
            dataSource={compras}
            columns={columns}
            rowKey="id"
            pagination={{
              current: page,
              pageSize: 50,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} compras`,
              onChange: (p) => setPage(p),
            }}
            scroll={{ x: 1040 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
    </div>
  );
}
