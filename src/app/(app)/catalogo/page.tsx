'use client';

import { useState, useMemo } from 'react';
import { Table, Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, Space } from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Title } = Typography;

type BuyBoxStatus = 'ganhando' | 'perdendo' | 'disputando';
type CatalogoStatus = 'no_catalogo' | 'elegivel' | 'fora';

interface CatalogoItem {
  sku: string;
  produto: string;
  id: string;
  gtin: string;
  preco: number;
  buyBox: BuyBoxStatus;
  status: CatalogoStatus;
}

const buyBoxOptions = [
  { value: '', label: 'Todos' },
  { value: 'ganhando', label: 'Ganhando' },
  { value: 'perdendo', label: 'Perdendo' },
  { value: 'disputando', label: 'Disputando' },
];

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: 'no_catalogo', label: 'No Catálogo' },
  { value: 'elegivel', label: 'Elegível' },
  { value: 'fora', label: 'Fora do Catálogo' },
];

const buyBoxColor: Record<BuyBoxStatus, string> = {
  ganhando: 'green',
  perdendo: 'red',
  disputando: 'orange',
};

const statusColor: Record<CatalogoStatus, string> = {
  no_catalogo: 'purple',
  elegivel: 'blue',
  fora: 'default',
};

const statusLabel: Record<CatalogoStatus, string> = {
  no_catalogo: 'No Catálogo',
  elegivel: 'Elegível',
  fora: 'Fora do Catálogo',
};

const mockCatalogo: CatalogoItem[] = [
  { sku: 'FONE-001', produto: 'Fone Bluetooth X1', id: 'MLB-CAT-001', gtin: '7891234560010', preco: 79.90, buyBox: 'ganhando', status: 'no_catalogo' },
  { sku: 'CAPA-002', produto: 'Capa Silicone iPhone 15', id: 'MLB-CAT-002', gtin: '7891234560027', preco: 39.90, buyBox: 'ganhando', status: 'no_catalogo' },
  { sku: 'CAR-003', produto: 'Carregador USB-C 20W', id: 'MLB-CAT-003', gtin: '7891234560034', preco: 49.90, buyBox: 'perdendo', status: 'no_catalogo' },
  { sku: 'PEL-004', produto: 'Película Premium Z10', id: 'MLB-CAT-004', gtin: '7891234560041', preco: 24.90, buyBox: 'ganhando', status: 'no_catalogo' },
  { sku: 'MOUSE-005', produto: 'Mouse Gamer RGB', id: '', gtin: '7891234560058', preco: 89.90, buyBox: 'disputando', status: 'elegivel' },
  { sku: 'TEC-006', produto: 'Teclado Mecânico TKL', id: 'MLB-CAT-006', gtin: '7891234560065', preco: 179.90, buyBox: 'disputando', status: 'no_catalogo' },
  { sku: 'MON-007', produto: 'Suporte Articulado Monitor', id: '', gtin: '7891234560072', preco: 119.90, buyBox: 'perdendo', status: 'elegivel' },
  { sku: 'CAB-008', produto: 'Cabo HDMI 2.1 2m', id: '', gtin: '7891234560089', preco: 44.90, buyBox: 'perdendo', status: 'fora' },
  { sku: 'ADAP-009', produto: 'Adaptador Bluetooth 5.3', id: 'MLB-CAT-009', gtin: '7891234560096', preco: 34.90, buyBox: 'ganhando', status: 'no_catalogo' },
  { sku: 'CAIXA-010', produto: 'Caixa Som Portátil 20W', id: 'MLB-CAT-010', gtin: '7891234560102', preco: 89.90, buyBox: 'ganhando', status: 'no_catalogo' },
];

function priceToWin(record: CatalogoItem): number | null {
  if (record.buyBox === 'ganhando') return null;
  const base = record.preco;
  if (record.buyBox === 'perdendo') return Math.round((base * 0.92) * 100) / 100;
  return Math.round((base * 0.97) * 100) / 100;
}

export default function CatalogoPage() {
  const [search, setSearch] = useState('');
  const [buyBoxFilter, setBuyBoxFilter] = useState<BuyBoxStatus | ''>('');
  const [statusFilter, setStatusFilter] = useState<CatalogoStatus | ''>('');
  const [precoMin, setPrecoMin] = useState<number | null>(null);
  const [precoMax, setPrecoMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const filtered = useMemo(() => {
    return mockCatalogo.filter(item => {
      if (search) {
        const q = search.toLowerCase();
        const fields = [item.sku, item.produto, item.id, item.gtin];
        if (!fields.some(f => f.toLowerCase().includes(q))) return false;
      }
      if (buyBoxFilter && item.buyBox !== buyBoxFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (precoMin !== null && item.preco < precoMin) return false;
      if (precoMax !== null && item.preco > precoMax) return false;
      return true;
    });
  }, [search, buyBoxFilter, statusFilter, precoMin, precoMax]);

  const columns: TableProps<CatalogoItem>['columns'] = [
    {
      title: 'SKU', dataIndex: 'sku', key: 'sku', width: 110,
      sorter: (a, b) => a.sku.localeCompare(b.sku),
    },
    {
      title: 'Produto', dataIndex: 'produto', key: 'produto',
      sorter: (a, b) => a.produto.localeCompare(b.produto),
    },
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 130,
      sorter: (a, b) => a.id.localeCompare(b.id),
      render: (id: string) => id
        ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</span>
        : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'GTIN/EAN', dataIndex: 'gtin', key: 'gtin', width: 140,
      sorter: (a, b) => a.gtin.localeCompare(b.gtin),
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
    },
    {
      title: 'Preço', dataIndex: 'preco', key: 'preco', width: 110,
      sorter: (a, b) => a.preco - b.preco,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Buy Box', dataIndex: 'buyBox', key: 'buyBox', width: 130,
      sorter: (a, b) => a.buyBox.localeCompare(b.buyBox),
      render: (bb: BuyBoxStatus, record) => {
        const ptw = priceToWin(record);
        return (
          <div>
            <Tag color={buyBoxColor[bb]} style={{ marginBottom: ptw ? 4 : 0 }}>
              {bb.charAt(0).toUpperCase() + bb.slice(1)}
            </Tag>
            {ptw && (
              <div style={{ fontSize: 11, color: '#a0a0a0' }}>
                Preço sugerido: {formatCurrency(ptw)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 130,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (s: CatalogoStatus) => <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>,
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Ver no ML' },
              ...(record.status === 'elegivel' ? [{ key: 'addCatalog', label: 'Adicionar ao Catálogo' }] : []),
              ...(record.status === 'no_catalogo' ? [{ key: 'optimize', label: 'Otimizar Preço' }] : []),
            ],
            onClick: ({ key }) => console.log(`${key} ${record.sku}`),
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Catálogo - Mercado Livre</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (SKU, produto, ID, GTIN)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </Col>
          <Col>
            <Select placeholder="Buy Box" value={buyBoxFilter || undefined} onChange={v => setBuyBoxFilter(v as BuyBoxStatus | '')} options={buyBoxOptions} style={{ width: 140 }} allowClear onClear={() => setBuyBoxFilter('')} />
          </Col>
          <Col>
            <Select placeholder="Status" value={statusFilter || undefined} onChange={v => setStatusFilter(v as CatalogoStatus | '')} options={statusOptions} style={{ width: 150 }} allowClear onClear={() => setStatusFilter('')} />
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Preço mín" value={precoMin} onChange={v => setPrecoMin(v ?? null)} style={{ width: 110 }} />
              <InputNumber placeholder="Preço máx" value={precoMax} onChange={v => setPrecoMax(v ?? null)} style={{ width: 110 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Table<CatalogoItem>
          dataSource={filtered}
          columns={columns}
          rowKey="sku"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} produtos` }}
          scroll={{ x: 1100 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
