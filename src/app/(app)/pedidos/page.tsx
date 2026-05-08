'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Table, Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space,
} from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import type { Order, OrderStatus } from '@/types/order';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'aberto', label: 'Aberto' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'faturado', label: 'Faturado' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'cancelado', label: 'Cancelado' },
];

const statusColor: Record<OrderStatus, string> = {
  aberto: 'blue',
  atendido: 'processing',
  faturado: 'purple',
  entregue: 'green',
  cancelado: 'red',
};

const statusLabel: Record<OrderStatus, string> = {
  aberto: 'Aberto',
  atendido: 'Atendido',
  faturado: 'Faturado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

const mockOrders: Order[] = [
  { id: 1, numero: 342, numeroLoja: 'ML-2001', data: '2026-05-04T14:30:00Z', dataSaida: null, dataPrevista: '2026-05-08T23:59:00Z', contato: { id: 1, nome: 'Ana Ferreira', tipoPessoa: 'F', numeroDocumento: '123.456.789-00' }, totalProdutos: 79.90, total: 89.90, situacao: { id: 0, valor: 'aberto' }, loja: { id: 1 }, transporte: { frete: 10.00, prazoEntrega: 4, contato: { nome: 'Ana Ferreira' } }, notaFiscal: null, rastreio: null, lucro: 22.40 },
  { id: 2, numero: 341, numeroLoja: 'ML-2002', data: '2026-05-04T10:15:00Z', dataSaida: '2026-05-04T16:00:00Z', dataPrevista: null, contato: { id: 2, nome: 'Carlos Lima', tipoPessoa: 'F', numeroDocumento: '234.567.890-11' }, totalProdutos: 149.90, total: 161.90, situacao: { id: 4, valor: 'faturado' }, loja: { id: 1 }, transporte: { frete: 12.00, prazoEntrega: null, contato: { nome: 'Carlos Lima' } }, notaFiscal: { numero: 'NF-000001', emitida: true }, rastreio: 'BR123456789', lucro: 38.75 },
  { id: 3, numero: 340, numeroLoja: 'ML-2003', data: '2026-05-03T18:45:00Z', dataSaida: '2026-05-04T09:00:00Z', dataPrevista: null, contato: { id: 3, nome: 'Marina Costa', tipoPessoa: 'F', numeroDocumento: '345.678.901-22' }, totalProdutos: 24.90, total: 29.90, situacao: { id: 5, valor: 'entregue' }, loja: { id: 1 }, transporte: { frete: 5.00, prazoEntrega: null, contato: { nome: 'Marina Costa' } }, notaFiscal: { numero: 'NF-000002', emitida: true }, rastreio: 'BR987654321', lucro: 8.15 },
  { id: 4, numero: 339, numeroLoja: 'ML-2004', data: '2026-05-03T09:30:00Z', dataSaida: null, dataPrevista: null, contato: { id: 4, nome: 'Roberto Alves', tipoPessoa: 'F', numeroDocumento: '456.789.012-33' }, totalProdutos: 59.90, total: 59.90, situacao: { id: 0, valor: 'aberto' }, loja: { id: 1 }, transporte: null, notaFiscal: null, rastreio: null, lucro: 12.30 },
  { id: 5, numero: 338, numeroLoja: 'ML-2005', data: '2026-05-02T16:20:00Z', dataSaida: '2026-05-03T10:00:00Z', dataPrevista: null, contato: { id: 5, nome: 'Juliana Santos', tipoPessoa: 'F', numeroDocumento: '567.890.123-44' }, totalProdutos: 179.90, total: 194.90, situacao: { id: 4, valor: 'faturado' }, loja: { id: 1 }, transporte: { frete: 15.00, prazoEntrega: null, contato: { nome: 'Juliana Santos' } }, notaFiscal: { numero: 'NF-000003', emitida: true }, rastreio: 'BR456123789', lucro: 51.20 },
  { id: 6, numero: 337, numeroLoja: 'ML-2006', data: '2026-05-01T11:00:00Z', dataSaida: null, dataPrevista: null, contato: { id: 6, nome: 'Pedro Martins', tipoPessoa: 'F', numeroDocumento: '678.901.234-55' }, totalProdutos: 34.90, total: 34.90, situacao: { id: 2, valor: 'cancelado' }, loja: { id: 1 }, transporte: null, notaFiscal: null, rastreio: null, lucro: -34.90 },
  { id: 7, numero: 336, numeroLoja: 'ML-2007', data: '2026-04-30T14:00:00Z', dataSaida: '2026-04-30T18:00:00Z', dataPrevista: null, contato: { id: 7, nome: 'Luciana Rocha', tipoPessoa: 'F', numeroDocumento: '789.012.345-66' }, totalProdutos: 89.90, total: 99.90, situacao: { id: 5, valor: 'entregue' }, loja: { id: 1 }, transporte: { frete: 10.00, prazoEntrega: null, contato: { nome: 'Luciana Rocha' } }, notaFiscal: { numero: 'NF-000004', emitida: true }, rastreio: 'BR789321654', lucro: 28.50 },
  { id: 8, numero: 335, numeroLoja: 'ML-2008', data: '2026-04-29T09:45:00Z', dataSaida: '2026-04-29T15:30:00Z', dataPrevista: null, contato: { id: 8, nome: 'Fernando Oliveira', tipoPessoa: 'F', numeroDocumento: '890.123.456-77' }, totalProdutos: 149.90, total: 159.90, situacao: { id: 5, valor: 'entregue' }, loja: { id: 1 }, transporte: { frete: 10.00, prazoEntrega: null, contato: { nome: 'Fernando Oliveira' } }, notaFiscal: { numero: 'NF-000005', emitida: true }, rastreio: 'BR654987321', lucro: 42.00 },
  { id: 9, numero: 334, numeroLoja: 'ML-2009', data: '2026-04-28T13:30:00Z', dataSaida: '2026-04-29T08:00:00Z', dataPrevista: null, contato: { id: 9, nome: 'Camila Barbosa', tipoPessoa: 'F', numeroDocumento: '901.234.567-88' }, totalProdutos: 24.90, total: 29.90, situacao: { id: 4, valor: 'faturado' }, loja: { id: 1 }, transporte: { frete: 5.00, prazoEntrega: null, contato: { nome: 'Camila Barbosa' } }, notaFiscal: { numero: 'NF-000006', emitida: true }, rastreio: 'BR321789654', lucro: 6.80 },
  { id: 10, numero: 333, numeroLoja: 'ML-2010', data: '2026-04-27T10:00:00Z', dataSaida: null, dataPrevista: null, contato: { id: 10, nome: 'Diego Nunes', tipoPessoa: 'F', numeroDocumento: '012.345.678-99' }, totalProdutos: 69.90, total: 69.90, situacao: { id: 2, valor: 'cancelado' }, loja: { id: 1 }, transporte: null, notaFiscal: null, rastreio: null, lucro: -69.90 },
  { id: 11, numero: 332, numeroLoja: 'ML-2011', data: '2026-04-26T15:00:00Z', dataSaida: '2026-04-27T12:00:00Z', dataPrevista: null, contato: { id: 11, nome: 'Tatiane Souza', tipoPessoa: 'F', numeroDocumento: '111.222.333-44' }, totalProdutos: 89.90, total: 97.90, situacao: { id: 5, valor: 'entregue' }, loja: { id: 1 }, transporte: { frete: 8.00, prazoEntrega: null, contato: { nome: 'Tatiane Souza' } }, notaFiscal: { numero: 'NF-000007', emitida: true }, rastreio: 'BR147258369', lucro: 25.40 },
  { id: 12, numero: 331, numeroLoja: 'ML-2012', data: '2026-04-25T11:30:00Z', dataSaida: null, dataPrevista: null, contato: { id: 12, nome: 'Gustavo Pereira', tipoPessoa: 'F', numeroDocumento: '555.666.777-88' }, totalProdutos: 149.90, total: 164.90, situacao: { id: 0, valor: 'aberto' }, loja: { id: 1 }, transporte: { frete: 15.00, prazoEntrega: 6, contato: { nome: 'Gustavo Pereira' } }, notaFiscal: null, rastreio: null, lucro: 35.60 },
];

function mapDBtoOrder(item: any): Order {
  return {
    id: item.id,
    numero: item.numero || 0,
    numeroLoja: item.numero_loja || '',
    data: item.data || new Date().toISOString(),
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
    rastreio: item.rastreio,
    lucro: item.lucro || 0,
  };
}

export default function BlingPedidosPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/pedidos');
        if (res.ok) {
          const json = await res.json();
          const data = json.data || [];
          if (data.length > 0) {
            setAllOrders(data.map(mapDBtoOrder));
            return;
          }
        }
      } catch {}
      setAllOrders(mockOrders);
    })();
  }, []);

  const filtered = useMemo(() => {
    return allOrders.filter(o => {
      if (search) {
        const q = search.toLowerCase();
        if (!String(o.numero).includes(q) && !o.contato.nome.toLowerCase().includes(q)) return false;
      }
      if (statusFilter && o.situacao.valor !== statusFilter) return false;
      if (dateRange[0] && new Date(o.data) < new Date(dateRange[0])) return false;
      if (dateRange[1]) {
        const end = new Date(dateRange[1]);
        end.setHours(23, 59, 59, 999);
        if (new Date(o.data) > end) return false;
      }
      if (priceMin !== null && o.total < priceMin) return false;
      if (priceMax !== null && o.total > priceMax) return false;
      return true;
    });
  }, [search, statusFilter, dateRange, priceMin, priceMax]);

  const columns: TableProps<Order>['columns'] = [
    {
      title: 'Número', dataIndex: 'numero', key: 'numero', width: 100,
      sorter: (a, b) => a.numero - b.numero,
      render: (num: number) => <span style={{ fontFamily: 'monospace' }}>#{String(num).padStart(6, '0')}</span>,
    },
    {
      title: 'Data', dataIndex: 'data', key: 'data', width: 160,
      sorter: (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime(),
      render: (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    },
    {
      title: 'Cliente', dataIndex: ['contato', 'nome'], key: 'cliente',
      sorter: (a, b) => a.contato.nome.localeCompare(b.contato.nome),
    },
    {
      title: 'Total', dataIndex: 'total', key: 'total', width: 110,
      sorter: (a, b) => a.total - b.total,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Rastreio', dataIndex: 'rastreio', key: 'rastreio', width: 130,
      sorter: (a, b) => (a.rastreio ?? '').localeCompare(b.rastreio ?? ''),
      render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{v}</span> : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Status', dataIndex: ['situacao', 'valor'], key: 'status', width: 120,
      sorter: (a, b) => a.situacao.valor.localeCompare(b.situacao.valor),
      render: (status: OrderStatus) => (
        <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>
      ),
    },
    {
      title: 'Nota Fiscal', dataIndex: 'notaFiscal', key: 'notaFiscal', width: 120,
      sorter: (a, b) => {
        const na = a.notaFiscal?.numero ?? '';
        const nb = b.notaFiscal?.numero ?? '';
        return na.localeCompare(nb);
      },
      render: (nf: { numero: string; emitida: boolean } | null) => {
        if (!nf) return <Tag>Não emitida</Tag>;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Tag color={nf.emitida ? 'green' : 'orange'}>{nf.numero}</Tag>
          </div>
        );
      },
    },
    {
      title: 'Lucro', dataIndex: 'lucro', key: 'lucro', width: 110,
      sorter: (a, b) => a.lucro - b.lucro,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {formatCurrency(v)}
        </span>
      ),
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Visualizar' },
              { key: 'invoice', label: 'Emitir Nota Fiscal' },
              { key: 'bling', label: 'Abrir no Bling' },
              ...(record.situacao.valor === 'aberto' ? [{ key: 'cancel', label: 'Cancelar Pedido' }] : []),
            ],
            onClick: ({ key }) => console.log(`${key} ${record.numero}`),
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Pedidos - Bling</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por número ou cliente"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220 }}
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
            <RangePicker
              onChange={(_, dateStrings) => setDateRange([dateStrings[0] || null, dateStrings[1] || null])}
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
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Table<Order>
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} pedidos` }}
          scroll={{ x: 900 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
