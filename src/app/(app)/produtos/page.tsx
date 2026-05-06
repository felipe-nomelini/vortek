'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Table, Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Space, Row, Col,
} from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import { calculateSuggestedPrice } from '@/services/pricing';
import { formatCurrency, formatPercent } from '@/lib/format';
import { useRouter } from 'next/navigation';
import type { Product, BlingStatus, MLStatus } from '@/types/product';

const { Title } = Typography;

const blingStatusOptions: { value: BlingStatus; label: string }[] = [
  { value: 'ativo', label: 'Ativo' },
  { value: 'inativo', label: 'Inativo' },
];

const mlStatusOptions: { value: MLStatus | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'pausado', label: 'Pausado' },
  { value: 'sem_anuncio', label: 'Sem Anúncio' },
];

const priceFieldOptions = [
  { value: 'cost', label: 'Custo' },
  { value: 'blingPrice', label: 'Preço Bling' },
  { value: 'suggestedPrice', label: 'Sugerido' },
  { value: 'profit', label: 'Lucro' },
];

const mockProducts: Product[] = [
  { id: '1', sku: 'FONE-001', name: 'Fone Bluetooth X1', brand: 'TechSound', stock: 45, cost: 22.50, blingPrice: 59.90, mlFee: 0.15, mlShipping: 8.50, customPrice: null, blingStatus: 'ativo', mlStatus: 'ativo', netWeight: 0.150, grossWeight: 0.220, width: 8, height: 5, depth: 3, gtin: '7891234560010', description: 'Fone Bluetooth com drivers de 40mm, bateria com 20h de autonomia e alcance de 10m. Compatível com todos os dispositivos Bluetooth.', images: ['https://picsum.photos/seed/fone1/400/400', 'https://picsum.photos/seed/fone2/400/400', 'https://picsum.photos/seed/fone3/400/400'], category: 'Eletrônicos > Áudio > Fones de Ouvido' },
  { id: '2', sku: 'CAPA-002', name: 'Capa Silicone iPhone 15', brand: 'TechSound', stock: 120, cost: 8.30, blingPrice: 29.90, mlFee: 0.13, mlShipping: 5.00, customPrice: 34.90, blingStatus: 'ativo', mlStatus: 'ativo', netWeight: 0.035, grossWeight: 0.060, width: 16, height: 8, depth: 1, gtin: '7891234560027', description: 'Capa de silicone flexível para iPhone 15. Proteção contra quedas e arranhões. Disponível em diversas cores.', images: ['https://picsum.photos/seed/capa1/400/400', 'https://picsum.photos/seed/capa2/400/400'], category: 'Celulares > Capas > iPhone 15' },
  { id: '3', sku: 'CAR-003', name: 'Carregador USB-C 20W', brand: 'VoltPower', stock: 78, cost: 14.90, blingPrice: 39.90, mlFee: 0.14, mlShipping: 6.50, customPrice: null, blingStatus: 'ativo', mlStatus: 'pausado', netWeight: 0.060, grossWeight: 0.100, width: 6, height: 6, depth: 3, gtin: '7891234560034', description: 'Carregador USB-C com tecnologia GaN, 20W de potência e carregamento rápido para smartphones e tablets.', images: ['https://picsum.photos/seed/car1/400/400'], category: 'Eletrônicos > Carregadores > USB-C' },
  { id: '4', sku: 'PEL-004', name: 'Película Premium Z10', brand: 'GlassShield', stock: 200, cost: 3.50, blingPrice: 14.90, mlFee: 0.17, mlShipping: 4.00, customPrice: 19.90, blingStatus: 'ativo', mlStatus: 'ativo', netWeight: 0.010, grossWeight: 0.030, width: 18, height: 10, depth: 0.1, gtin: '7891234560041', description: 'Película de vidro temperado 9H para iPhone 15. Resistente a riscos e oleosidade. Fácil instalação.', images: ['https://picsum.photos/seed/pel1/400/400', 'https://picsum.photos/seed/pel2/400/400'], category: 'Celulares > Películas > iPhone 15' },
  { id: '5', sku: 'MOUSE-005', name: 'Mouse Gamer RGB', brand: 'GameX', stock: 0, cost: 35.00, blingPrice: 89.90, mlFee: 0.14, mlShipping: 10.00, customPrice: null, blingStatus: 'inativo', mlStatus: 'sem_anuncio', netWeight: 0.100, grossWeight: 0.180, width: 12, height: 6, depth: 4, gtin: '7891234560058', description: 'Mouse gamer com sensor óptico de 6400DPI, 6 botões programáveis e iluminação RGB personalizável.', images: ['https://picsum.photos/seed/mouse1/400/400'], category: undefined },
  { id: '6', sku: 'TEC-006', name: 'Teclado Mecânico TKL', brand: 'GameX', stock: 23, cost: 65.00, blingPrice: 149.90, mlFee: 0.13, mlShipping: 12.00, customPrice: null, blingStatus: 'ativo', mlStatus: 'ativo', netWeight: 0.700, grossWeight: 1.100, width: 36, height: 14, depth: 4, gtin: '7891234560065', description: 'Teclado mecânico Tenkeyless com switches Red, retroiluminado RGB e construção em alumínio escovado.', images: ['https://picsum.photos/seed/tec1/400/400', 'https://picsum.photos/seed/tec2/400/400', 'https://picsum.photos/seed/tec3/400/400'], category: 'Informática > Teclados > Mecânicos' },
  { id: '7', sku: 'MON-007', name: 'Suporte Articulado Monitor', brand: 'ErgoTech', stock: 15, cost: 42.00, blingPrice: 99.90, mlFee: 0.12, mlShipping: 15.00, customPrice: 89.90, blingStatus: 'ativo', mlStatus: 'pausado', netWeight: 0.800, grossWeight: 1.300, width: 20, height: 45, depth: 12, gtin: '7891234560072', description: 'Suporte articulado para monitor de 17" a 32". Movimento de rotação, inclinação e ajuste de altura com sistema a gás.', images: ['https://picsum.photos/seed/mon1/400/400'], category: 'Informática > Acessórios > Suportes' },
  { id: '8', sku: 'CAB-008', name: 'Cabo HDMI 2.1 2m', brand: 'VoltPower', stock: 90, cost: 11.00, blingPrice: 34.90, mlFee: 0.16, mlShipping: 5.50, customPrice: null, blingStatus: 'inativo', mlStatus: 'sem_anuncio', netWeight: 0.080, grossWeight: 0.120, width: 12, height: 8, depth: 2, gtin: '7891234560089', description: 'Cabo HDMI 2.1 de 2 metros com suporte a 4K@120Hz, HDR10+ e eARC. Compatível com TVs, monitores e consoles.', images: ['https://picsum.photos/seed/cab1/400/400'], category: undefined },
  { id: '9', sku: 'ADAP-009', name: 'Adaptador Bluetooth 5.3', brand: 'TechSound', stock: 55, cost: 9.50, blingPrice: 24.90, mlFee: 0.15, mlShipping: 4.50, customPrice: null, blingStatus: 'ativo', mlStatus: 'ativo', netWeight: 0.005, grossWeight: 0.020, width: 3, height: 1.5, depth: 0.8, gtin: '7891234560096', description: 'Adaptador Bluetooth 5.3 USB-A para PCs. Baixa latência, alcance de 30m e compatível com Windows, Linux e Mac.', images: ['https://picsum.photos/seed/adap1/400/400', 'https://picsum.photos/seed/adap2/400/400'], category: 'Informática > Acessórios > Adaptadores' },
  { id: '10', sku: 'CAIXA-010', name: 'Caixa Som Portátil 20W', brand: 'TechSound', stock: 32, cost: 28.00, blingPrice: 69.90, mlFee: 0.14, mlShipping: 9.00, customPrice: null, blingStatus: 'ativo', mlStatus: 'ativo', netWeight: 0.450, grossWeight: 0.650, width: 18, height: 8, depth: 8, gtin: '7891234560102', description: 'Caixa de som portátil 20W com Bluetooth 5.3, resistência IPX7 e bateria de 12h. Ideal para levar para qualquer lugar.', images: ['https://picsum.photos/seed/caixa1/400/400', 'https://picsum.photos/seed/caixa2/400/400', 'https://picsum.photos/seed/caixa3/400/400'], category: 'Eletrônicos > Áudio > Caixas de Som' },
];

interface ProductRow {
  key: string;
  product: Product;
  displayPrice: number;
  profit: number;
}

function computeDerived(product: Product): { displayPrice: number; profit: number } {
  const displayPrice = product.customPrice ?? calculateSuggestedPrice({
    cost: product.cost,
    shipping: product.mlShipping,
    mlFee: product.mlFee,
  }).suggestedPrice;
  const profit = displayPrice - product.cost - product.mlFee * displayPrice - product.mlShipping;
  return { displayPrice: Math.round(displayPrice * 100) / 100, profit: Math.round(profit * 100) / 100 };
}

const blingStatusColor: Record<BlingStatus, string> = { ativo: 'green', inativo: 'red' };
const blingStatusLabel: Record<BlingStatus, string> = { ativo: 'Ativo', inativo: 'Inativo' };
const mlStatusColor: Record<MLStatus, string> = { ativo: 'green', pausado: 'orange', sem_anuncio: 'default' };
const mlStatusLabel: Record<MLStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', sem_anuncio: 'Sem Anúncio' };

export default function ProductsPage() {
  const router = useRouter();
  const [products] = useState<Product[]>(mockProducts);
  const [search, setSearch] = useState('');
  const [filterBlingStatus, setFilterBlingStatus] = useState<BlingStatus | ''>('');
  const [filterMLStatus, setFilterMLStatus] = useState<MLStatus | ''>('');
  const [priceField, setPriceField] = useState<string>('cost');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [customPrices, setCustomPrices] = useState<Record<string, number | null>>({});

  const handlePriceChange = useCallback((productId: string, value: number | null) => {
    setCustomPrices(prev => ({ ...prev, [productId]: value }));
  }, []);

  const rows: ProductRow[] = useMemo(() => {
    return products.map(p => {
      const effectiveCustomPrice = p.customPrice !== null
        ? p.customPrice
        : (customPrices[p.id] !== undefined ? customPrices[p.id] : null);
      const productWithPrice = { ...p, customPrice: effectiveCustomPrice };
      const { displayPrice, profit } = computeDerived(productWithPrice);
      return { key: p.id, product: productWithPrice, displayPrice, profit };
    });
  }, [products, customPrices]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (search) {
        const q = search.toLowerCase();
        if (!r.product.name.toLowerCase().includes(q) && !r.product.sku.toLowerCase().includes(q)) return false;
      }
      if (filterBlingStatus && r.product.blingStatus !== filterBlingStatus) return false;
      if (filterMLStatus && r.product.mlStatus !== filterMLStatus) return false;
      if (priceMin !== null || priceMax !== null) {
        let val: number;
        switch (priceField) {
          case 'cost': val = r.product.cost; break;
          case 'blingPrice': val = r.product.blingPrice; break;
          case 'suggestedPrice': val = r.displayPrice; break;
          case 'profit': val = r.profit; break;
          default: val = 0;
        }
        if (priceMin !== null && val < priceMin) return false;
        if (priceMax !== null && val > priceMax) return false;
      }
      return true;
    });
  }, [rows, search, filterBlingStatus, filterMLStatus, priceField, priceMin, priceMax]);

  const handleToggleBling = (productId: string) => {
    console.log('Toggle Bling status for', productId);
  };

  const selectedProducts = useMemo(
    () => filtered.filter(r => selectedRowKeys.includes(r.key)),
    [filtered, selectedRowKeys],
  );

  const allBlingActive = selectedProducts.length > 0 && selectedProducts.every(r => r.product.blingStatus === 'ativo');
  const allBlingInactive = selectedProducts.length > 0 && selectedProducts.every(r => r.product.blingStatus === 'inativo');
  const hasNoML = selectedProducts.some(r => r.product.mlStatus === 'sem_anuncio');
  const showBulk = selectedRowKeys.length > 0;

  const handleBulkAction = (action: string) => {
    console.log(`Bulk ${action} for`, selectedRowKeys);
  };

  const columns: TableProps<ProductRow>['columns'] = [
    {
      title: 'ID', dataIndex: ['product', 'id'], key: 'id', width: 70,
      sorter: (a, b) => parseInt(a.product.id) - parseInt(b.product.id),
    },
    {
      title: 'SKU', dataIndex: ['product', 'sku'], key: 'sku', width: 110,
      sorter: (a, b) => a.product.sku.localeCompare(b.product.sku),
    },
    {
      title: 'Produto', dataIndex: ['product', 'name'], key: 'name',
      sorter: (a, b) => a.product.name.localeCompare(b.product.name),
      render: (name: string, record) => (
        <a
          onClick={() => router.push(`/produtos/${record.product.id}`)}
          style={{ color: '#1677ff', cursor: 'pointer' }}
        >
          {name}
        </a>
      ),
    },
    {
      title: 'Estoque', dataIndex: ['product', 'stock'], key: 'stock', width: 90,
      sorter: (a, b) => a.product.stock - b.product.stock,
      render: (stock: number) => (
        <span style={{ color: stock === 0 ? '#ff4d4f' : undefined }}>{stock}</span>
      ),
    },
    {
      title: 'Custo', dataIndex: ['product', 'cost'], key: 'cost', width: 110,
      sorter: (a, b) => a.product.cost - b.product.cost,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Preço Bling', dataIndex: ['product', 'blingPrice'], key: 'blingPrice', width: 130,
      sorter: (a, b) => a.product.blingPrice - b.product.blingPrice,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Taxa ML', dataIndex: ['product', 'mlFee'], key: 'mlFee', width: 90,
      sorter: (a, b) => a.product.mlFee - b.product.mlFee,
      render: (v: number) => formatPercent(v),
    },
    {
      title: 'Frete ML', dataIndex: ['product', 'mlShipping'], key: 'mlShipping', width: 110,
      sorter: (a, b) => a.product.mlShipping - b.product.mlShipping,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Sugerido', key: 'suggestedPrice', width: 160,
      sorter: (a, b) => a.displayPrice - b.displayPrice,
      render: (_, record) => {
        const val = record.product.customPrice;
        return (
          <InputNumber
            size="small"
            style={{ width: 140 }}
            value={val ?? record.displayPrice}
            onChange={v => handlePriceChange(record.product.id, v ?? null)}
            formatter={(v) => v !== undefined ? formatCurrency(typeof v === 'string' ? parseFloat(v) : v) : ''}
            parser={(v) => {
              if (!v) return 0;
              return parseFloat(v.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.'));
            }}
          />
        );
      },
    },
    {
      title: 'Lucro', key: 'profit', width: 130,
      sorter: (a, b) => a.profit - b.profit,
      render: (_, record) => (
        <span style={{ color: record.profit >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {formatCurrency(record.profit)}
        </span>
      ),
    },
    {
      title: 'Status Bling', dataIndex: ['product', 'blingStatus'], key: 'blingStatus', width: 120,
      sorter: (a, b) => a.product.blingStatus.localeCompare(b.product.blingStatus),
      render: (status: BlingStatus) => (
        <Tag color={blingStatusColor[status]}>{blingStatusLabel[status]}</Tag>
      ),
    },
    {
      title: 'Status ML', dataIndex: ['product', 'mlStatus'], key: 'mlStatus', width: 130,
      sorter: (a, b) => a.product.mlStatus.localeCompare(b.product.mlStatus),
      render: (status: MLStatus) => (
        <Tag color={mlStatusColor[status]}>{mlStatusLabel[status]}</Tag>
      ),
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const blingIsActive = record.product.blingStatus === 'ativo';
        const mlIsNone = record.product.mlStatus === 'sem_anuncio';
        return (
          <Dropdown
            menu={{
              items: [
                { key: 'updateBlingPrice', label: 'Atualizar preço no Bling' },
                { key: 'toggleBling', label: blingIsActive ? 'Desativar no Bling' : 'Ativar no Bling' },
                ...(mlIsNone ? [{ key: 'createML', label: 'Criar anúncio no ML' }] : []),
              ],
              onClick: ({ key }) => {
                if (key === 'toggleBling') handleToggleBling(record.product.id);
              },
            }}
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Produtos</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por nome ou SKU"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Status Bling"
              value={filterBlingStatus || undefined}
              onChange={v => setFilterBlingStatus(v as BlingStatus | '')}
              options={[{ value: '', label: 'Status Bling' }, ...blingStatusOptions]}
              style={{ width: 150 }}
              allowClear
              onClear={() => setFilterBlingStatus('')}
            />
          </Col>
          <Col>
            <Select
              placeholder="Status ML"
              value={filterMLStatus || undefined}
              onChange={v => setFilterMLStatus(v as MLStatus | '')}
              options={mlStatusOptions}
              style={{ width: 150 }}
              allowClear
              onClear={() => setFilterMLStatus('')}
            />
          </Col>
          <Col>
            <Space.Compact>
              <Select value={priceField} onChange={setPriceField} options={priceFieldOptions} style={{ width: 130 }} />
              <InputNumber placeholder="Mín" value={priceMin} onChange={v => setPriceMin(v ?? null)} style={{ width: 100 }} />
              <InputNumber placeholder="Máx" value={priceMax} onChange={v => setPriceMax(v ?? null)} style={{ width: 100 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>
      {showBulk && (
        <div
          style={{
            background: '#141414',
            border: '1px solid #1677ff',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ color: '#a0a0a0', fontSize: 14 }}>
            <strong style={{ color: '#e0e0e0' }}>{selectedRowKeys.length}</strong> produto{selectedRowKeys.length > 1 ? 's' : ''} selecionado{selectedRowKeys.length > 1 ? 's' : ''}
          </span>
          <div style={{ width: 1, height: 20, background: '#303030' }} />
          <Button size="small" onClick={() => handleBulkAction('updateBlingPrice')}>
            Atualizar preço no Bling
          </Button>
          {allBlingActive && (
            <Button size="small" onClick={() => handleBulkAction('deactivateBling')}>
              Desativar no Bling
            </Button>
          )}
          {allBlingInactive && (
            <Button size="small" onClick={() => handleBulkAction('activateBling')}>
              Ativar no Bling
            </Button>
          )}
          {hasNoML && (
            <Button size="small" onClick={() => handleBulkAction('createML')}>
              Criar anúncio no ML
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Button size="small" onClick={() => setSelectedRowKeys([])} type="text" style={{ color: '#ff4d4f' }}>
            Limpar seleção
          </Button>
        </div>
      )}
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Table<ProductRow>
          dataSource={filtered}
          columns={columns}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} produtos` }}
          scroll={{ x: 1400 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
