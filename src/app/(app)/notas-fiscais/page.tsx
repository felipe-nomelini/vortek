'use client';

import { useState, useMemo } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Title } = Typography;
const { RangePicker } = DatePicker;

type NFStatus = 'emitida' | 'cancelada' | 'pendente';

interface NotaFiscal {
  id: number;
  pedido: number;
  cliente: string;
  data: string;
  numero: string;
  valor: number;
  status: NFStatus;
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

const mockNFs: NotaFiscal[] = [
  { id: 1, pedido: 341, cliente: 'Carlos Lima', data: '2026-05-06T10:00:00Z', numero: 'NF-000001', valor: 161.90, status: 'emitida' },
  { id: 2, pedido: 340, cliente: 'Marina Costa', data: '2026-05-05T09:00:00Z', numero: 'NF-000002', valor: 29.90, status: 'emitida' },
  { id: 3, pedido: 338, cliente: 'Juliana Santos', data: '2026-05-04T11:30:00Z', numero: 'NF-000003', valor: 194.90, status: 'emitida' },
  { id: 4, pedido: 336, cliente: 'Luciana Rocha', data: '2026-05-01T10:00:00Z', numero: 'NF-000004', valor: 99.90, status: 'emitida' },
  { id: 5, pedido: 335, cliente: 'Fernando Oliveira', data: '2026-04-30T16:00:00Z', numero: 'NF-000005', valor: 159.90, status: 'emitida' },
  { id: 6, pedido: 334, cliente: 'Camila Barbosa', data: '2026-04-29T09:00:00Z', numero: 'NF-000006', valor: 29.90, status: 'emitida' },
  { id: 7, pedido: 332, cliente: 'Tatiane Souza', data: '2026-04-28T12:00:00Z', numero: 'NF-000007', valor: 97.90, status: 'emitida' },
  { id: 8, pedido: 337, cliente: 'Pedro Martins', data: '2026-05-01T11:00:00Z', numero: 'NF-000008', valor: 34.90, status: 'cancelada' },
  { id: 9, pedido: 333, cliente: 'Diego Nunes', data: '2026-04-28T10:00:00Z', numero: 'NF-000009', valor: 69.90, status: 'cancelada' },
  { id: 10, pedido: 342, cliente: 'Ana Ferreira', data: '', numero: 'NF-000010', valor: 89.90, status: 'pendente' },
  { id: 11, pedido: 339, cliente: 'Roberto Alves', data: '', numero: 'NF-000011', valor: 59.90, status: 'pendente' },
  { id: 12, pedido: 331, cliente: 'Gustavo Pereira', data: '', numero: 'NF-000012', valor: 164.90, status: 'pendente' },
];

export default function NotasFiscaisPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NFStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [valorMin, setValorMin] = useState<number | null>(null);
  const [valorMax, setValorMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const filtered = useMemo(() => {
    return mockNFs.filter(nf => {
      if (search) {
        const q = search.toLowerCase();
        const fields = [String(nf.id), String(nf.pedido), nf.cliente, nf.numero];
        if (!fields.some(f => f.toLowerCase().includes(q))) return false;
      }
      if (statusFilter && nf.status !== statusFilter) return false;
      if (dateRange[0] && nf.data && new Date(nf.data) < new Date(dateRange[0])) return false;
      if (dateRange[1] && nf.data) {
        const end = new Date(dateRange[1]);
        end.setHours(23, 59, 59, 999);
        if (new Date(nf.data) > end) return false;
      }
      if (valorMin !== null && nf.valor < valorMin) return false;
      if (valorMax !== null && nf.valor > valorMax) return false;
      return true;
    });
  }, [search, statusFilter, dateRange, valorMin, valorMax]);

  const columns: TableProps<NotaFiscal>['columns'] = [
    {
      title: 'Pedido', dataIndex: 'pedido', key: 'pedido', width: 90,
      sorter: (a, b) => a.pedido - b.pedido,
      render: (v: number) => <span style={{ fontFamily: 'monospace' }}>#{String(v).padStart(6, '0')}</span>,
    },
    {
      title: 'Número', dataIndex: 'numero', key: 'numero', width: 120,
      sorter: (a, b) => a.numero.localeCompare(b.numero),
      render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span>,
    },
    {
      title: 'Cliente', dataIndex: 'cliente', key: 'cliente',
      sorter: (a, b) => a.cliente.localeCompare(b.cliente),
    },
    {
      title: 'Data', dataIndex: 'data', key: 'data', width: 160,
      sorter: (a, b) => {
        if (!a.data) return 1;
        if (!b.data) return -1;
        return new Date(a.data).getTime() - new Date(b.data).getTime();
      },
      render: (d: string) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Valor', dataIndex: 'valor', key: 'valor', width: 110,
      sorter: (a, b) => a.valor - b.valor,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (s: NFStatus) => <Tag color={statusColor[s]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Tag>,
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
              items: [
                { key: 'view', label: 'Visualizar' },
                { key: 'download', label: 'Baixar PDF' },
                { key: 'email', label: 'Enviar por e-mail' },
              ],
            onClick: ({ key }) => { /* TODO: implementar ação */ },
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Notas Fiscais</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (ID, pedido, cliente, número)"
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
              onChange={v => setStatusFilter(v as NFStatus | '')}
              options={statusOptions}
              style={{ width: 150 }}
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
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Valor mín" value={valorMin} onChange={v => setValorMin(v ?? null)} style={{ width: 110 }} />
              <InputNumber placeholder="Valor máx" value={valorMax} onChange={v => setValorMax(v ?? null)} style={{ width: 110 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <ResizableTable<NotaFiscal>
          storageKey="notas-fiscais"
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} notas fiscais` }}
          scroll={{ x: 1000 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
