'use client';

import { useState, useMemo } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, Space } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Title } = Typography;

type ListingType = 'classico' | 'premium';
type ListingStatus = 'ativo' | 'pausado';

interface Anuncio {
  id: string;
  sku: string;
  produto: string;
  tipo: ListingType;
  precoBling: number;
  precoML: number;
  vendidos: number;
  visitas: number;
  saude: number;
  status: ListingStatus;
  catalogo: boolean;
}

const tipoOptions = [
  { value: '', label: 'Todos os tipos' },
  { value: 'classico', label: 'Clássico' },
  { value: 'premium', label: 'Premium' },
];

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'pausado', label: 'Pausado' },
];

function healthColor(score: number): string {
  if (score >= 80) return '#52c41a';
  if (score >= 50) return '#faad14';
  return '#ff4d4f';
}

function healthBg(score: number): string {
  if (score >= 80) return '#52c41a1A';
  if (score >= 50) return '#faad141A';
  return '#ff4d4f1A';
}

const mockAnuncios: Anuncio[] = [
  { id: 'MLB1001', sku: 'FONE-001', produto: 'Fone Bluetooth X1', tipo: 'premium', precoBling: 59.90, precoML: 79.90, vendidos: 23, visitas: 320, saude: 92, status: 'ativo', catalogo: true },
  { id: 'MLB1002', sku: 'CAPA-002', produto: 'Capa Silicone iPhone 15', tipo: 'premium', precoBling: 29.90, precoML: 39.90, vendidos: 45, visitas: 580, saude: 88, status: 'ativo', catalogo: true },
  { id: 'MLB1003', sku: 'CAR-003', produto: 'Carregador USB-C 20W', tipo: 'classico', precoBling: 39.90, precoML: 49.90, vendidos: 12, visitas: 120, saude: 45, status: 'pausado', catalogo: false },
  { id: 'MLB1004', sku: 'PEL-004', produto: 'Película Premium Z10', tipo: 'premium', precoBling: 14.90, precoML: 24.90, vendidos: 78, visitas: 890, saude: 76, status: 'ativo', catalogo: true },
  { id: 'MLB1005', sku: 'MOUSE-005', produto: 'Mouse Gamer RGB', tipo: 'classico', precoBling: 89.90, precoML: 0, vendidos: 0, visitas: 0, saude: 0, status: 'pausado', catalogo: false },
  { id: 'MLB1006', sku: 'TEC-006', produto: 'Teclado Mecânico TKL', tipo: 'premium', precoBling: 149.90, precoML: 179.90, vendidos: 8, visitas: 210, saude: 71, status: 'ativo', catalogo: true },
  { id: 'MLB1007', sku: 'MON-007', produto: 'Suporte Articulado Monitor', tipo: 'classico', precoBling: 99.90, precoML: 119.90, vendidos: 5, visitas: 95, saude: 55, status: 'pausado', catalogo: false },
  { id: 'MLB1008', sku: 'CAB-008', produto: 'Cabo HDMI 2.1 2m', tipo: 'classico', precoBling: 34.90, precoML: 44.90, vendidos: 15, visitas: 180, saude: 35, status: 'pausado', catalogo: false },
  { id: 'MLB1009', sku: 'ADAP-009', produto: 'Adaptador Bluetooth 5.3', tipo: 'classico', precoBling: 24.90, precoML: 34.90, vendidos: 22, visitas: 260, saude: 82, status: 'ativo', catalogo: true },
  { id: 'MLB1010', sku: 'CAIXA-010', produto: 'Caixa Som Portátil 20W', tipo: 'premium', precoBling: 69.90, precoML: 89.90, vendidos: 18, visitas: 310, saude: 90, status: 'ativo', catalogo: true },
];

export default function AnunciosPage() {
  const [search, setSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState<ListingType | ''>('');
  const [statusFilter, setStatusFilter] = useState<ListingStatus | ''>('');
  const [blingMin, setBlingMin] = useState<number | null>(null);
  const [blingMax, setBlingMax] = useState<number | null>(null);
  const [mlMin, setMlMin] = useState<number | null>(null);
  const [mlMax, setMlMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const filtered = useMemo(() => {
    return mockAnuncios.filter(a => {
      if (search) {
        const q = search.toLowerCase();
        if (!a.produto.toLowerCase().includes(q) && !a.sku.toLowerCase().includes(q)) return false;
      }
      if (tipoFilter && a.tipo !== tipoFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      if (blingMin !== null && a.precoBling < blingMin) return false;
      if (blingMax !== null && a.precoBling > blingMax) return false;
      if (mlMin !== null && a.precoML < mlMin) return false;
      if (mlMax !== null && a.precoML > mlMax) return false;
      return true;
    });
  }, [search, tipoFilter, statusFilter, blingMin, blingMax, mlMin, mlMax]);

  const columns: TableProps<Anuncio>['columns'] = [
    {
      title: 'SKU', dataIndex: 'sku', key: 'sku', width: 110,
      sorter: (a, b) => a.sku.localeCompare(b.sku),
    },
    {
      title: 'Produto', dataIndex: 'produto', key: 'produto',
      sorter: (a, b) => a.produto.localeCompare(b.produto),
    },
    {
      title: 'Tipo', dataIndex: 'tipo', key: 'tipo', width: 100,
      sorter: (a, b) => a.tipo.localeCompare(b.tipo),
      render: (t: ListingType) => <Tag color={t === 'premium' ? 'purple' : 'blue'}>{t === 'premium' ? 'Premium' : 'Clássico'}</Tag>,
    },
    {
      title: 'Preço Bling', dataIndex: 'precoBling', key: 'precoBling', width: 120,
      sorter: (a, b) => a.precoBling - b.precoBling,
      render: (v: number) => v ? formatCurrency(v) : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Preço ML', dataIndex: 'precoML', key: 'precoML', width: 110,
      sorter: (a, b) => a.precoML - b.precoML,
      render: (v: number) => v ? formatCurrency(v) : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Vendidos', dataIndex: 'vendidos', key: 'vendidos', width: 90,
      sorter: (a, b) => a.vendidos - b.vendidos,
    },
    {
      title: 'Visitas', dataIndex: 'visitas', key: 'visitas', width: 80,
      sorter: (a, b) => a.visitas - b.visitas,
    },
    {
      title: 'Saúde', dataIndex: 'saude', key: 'saude', width: 90,
      sorter: (a, b) => a.saude - b.saude,
      render: (v: number) => (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '2px 8px', borderRadius: 4,
          background: healthBg(v), color: healthColor(v),
          fontWeight: 600, fontSize: 13,
        }}>
          {v}%
        </div>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (s: ListingStatus) => (
        <Tag color={s === 'ativo' ? 'green' : 'orange'}>{s.charAt(0).toUpperCase() + s.slice(1)}</Tag>
      ),
    },
    {
      title: 'Catálogo', dataIndex: 'catalogo', key: 'catalogo', width: 90,
      sorter: (a, b) => Number(a.catalogo) - Number(b.catalogo),
      render: (v: boolean) => v
        ? <Tag color="green">SIM</Tag>
        : <Tag color="default">NÃO</Tag>,
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Visualizar no ML' },
              ...(record.status === 'ativo' ? [{ key: 'pause', label: 'Pausar Anúncio' }] : [{ key: 'activate', label: 'Ativar Anúncio' }]),
              { key: 'updatePrice', label: 'Atualizar Preço' },
              { key: 'optimize', label: 'Otimizar com IA' },
            ],
            onClick: ({ key }) => console.log(`${key} ${record.id}`),
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Anúncios - Mercado Livre</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por produto ou SKU"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220 }}
              allowClear
            />
          </Col>
          <Col>
            <Select placeholder="Tipo" value={tipoFilter || undefined} onChange={v => setTipoFilter(v as ListingType | '')} options={tipoOptions} style={{ width: 130 }} allowClear onClear={() => setTipoFilter('')} />
          </Col>
          <Col>
            <Select placeholder="Status" value={statusFilter || undefined} onChange={v => setStatusFilter(v as ListingStatus | '')} options={statusOptions} style={{ width: 130 }} allowClear onClear={() => setStatusFilter('')} />
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Bling mín" value={blingMin} onChange={v => setBlingMin(v ?? null)} style={{ width: 110 }} />
              <InputNumber placeholder="Bling máx" value={blingMax} onChange={v => setBlingMax(v ?? null)} style={{ width: 110 }} />
            </Space.Compact>
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber placeholder="ML mín" value={mlMin} onChange={v => setMlMin(v ?? null)} style={{ width: 110 }} />
              <InputNumber placeholder="ML máx" value={mlMax} onChange={v => setMlMax(v ?? null)} style={{ width: 110 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <ResizableTable<Anuncio>
          storageKey="anuncios"
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} anúncios` }}
          scroll={{ x: 1200 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
