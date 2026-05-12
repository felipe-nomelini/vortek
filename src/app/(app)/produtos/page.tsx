'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Input, Select, InputNumber, Tag, Typography, Space, Spin, Modal, Button, message, Dropdown,
} from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, LoadingOutlined, EllipsisOutlined } from '@ant-design/icons';
import { calculateSuggestedPrice } from '@/services/pricing';
import { formatCurrency, formatPercent } from '@/lib/format';
import { useRouter } from 'next/navigation';
import type { Product, MLStatus } from '@/types/product';
import ResizableTable from '@/components/ResizableTable';

const { Title, Text } = Typography;

const mlStatusOptions: { value: MLStatus | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'pausado', label: 'Pausado' },
  { value: 'sem_anuncio', label: 'Sem Anúncio' },
];

const estoqueOptions = [
  { value: 'todos', label: 'Todos' },
  { value: 'com_estoque', label: 'Com Estoque' },
  { value: 'sem_estoque', label: 'Sem Estoque' },
];

const priceFieldOptions = [
  { value: 'cost', label: 'Custo' },
  { value: 'suggestedPrice', label: 'Sugerido' },
  { value: 'profit', label: 'Lucro' },
];

const FORNECEDORES = ["FLORATTA JOIAS", "HAYAMAX-PR", "NOVA CENTER", "VITRINE OUTLET"];

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

const mlStatusColor: Record<MLStatus, string> = { ativo: 'green', pausado: 'orange', sem_anuncio: 'default' };
const mlStatusLabel: Record<MLStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', sem_anuncio: 'Sem Anúncio' };

function mapDBtoProduct(item: any): Product {
  return {
    id: item.id,
    sku: item.sku,
    name: item.nome,
    brand: item.marca || '',
    fornecedor: item.fornecedor || null,
    stock: item.estoque || 0,
    cost: item.custo || 0,
    mlFee: item.ml_fee || 0.15,
    mlShipping: item.ml_shipping || 0,
    customPrice: item.custom_price,
    mlStatus: item.ml_status || 'sem_anuncio',
    netWeight: item.peso_liq || 0,
    grossWeight: item.peso_bruto || 0,
    width: item.largura || 0,
    height: item.altura || 0,
    depth: item.profundidade || 0,
    gtin: item.gtin || '',
    description: item.descricao || '',
    images: item.imagens || [],
    category: item.categoria,
  };
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [inputSearch, setInputSearch] = useState('');
  const [filterMLStatus, setFilterMLStatus] = useState<MLStatus | ''>('');
  const [filterFornecedores, setFilterFornecedores] = useState<string[]>([]);
  const [fornecedorOptions, setFornecedorOptions] = useState<string[]>(FORNECEDORES);
  const [filterEstoque, setFilterEstoque] = useState<string>('todos');
  const [priceField, setPriceField] = useState<string>('cost');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const [mlModal, setMlModal] = useState<{ open: boolean; produtoId: string; nome: string; categorias: any[]; loading: boolean }>({ open: false, produtoId: '', nome: '', categorias: [], loading: false });

  const abrirCriarAnuncioML = async (productId: string, nome: string) => {
    setMlModal({ open: true, produtoId: productId, nome, categorias: [], loading: true });
    try {
      const res = await fetch('/api/ml/anuncio/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: productId }),
      });
      const data = await res.json();
      if (data.categorias) {
        setMlModal(prev => ({ ...prev, categorias: data.categorias, loading: false }));
      } else {
        messageApi.error(data.error || 'Erro ao buscar categorias');
        setMlModal(prev => ({ ...prev, open: false }));
      }
    } catch {
      messageApi.error('Erro ao conectar');
      setMlModal(prev => ({ ...prev, open: false }));
    }
  };

  const confirmarCriarAnuncio = async (categoriaId: string) => {
    setMlModal(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/ml/anuncio/criar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: mlModal.produtoId,
          categoriaId,
          listingType: 'gold_pro',
        }),
      });
      const data = await res.json();
      if (data.success) {
        messageApi.success(`Anúncio criado! ${data.anuncio.permalink}`);
        setMlModal(prev => ({ ...prev, open: false }));
      } else {
        messageApi.error(data.error || 'Erro ao criar anúncio');
        setMlModal(prev => ({ ...prev, loading: false }));
      }
    } catch {
      messageApi.error('Erro ao criar anúncio');
      setMlModal(prev => ({ ...prev, loading: false }));
    }
  };

  const fetchProducts = useCallback(async (p: number, s: string, f: string[]) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (s) params.set('search', s);
      if (f.length > 0) params.set('fornecedores', f.join(','));
      const res = await fetch(`/api/produtos?${params}`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data || [];
        setProducts(data.map(mapDBtoProduct));
        setTotal(json.total || 0);
        if (json.fornecedores?.length) setFornecedorOptions(json.fornecedores);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts(page, search, filterFornecedores);
  }, [page, search, filterFornecedores, fetchProducts]);

  const rows: ProductRow[] = useMemo(() => {
    return products.map(p => {
      const { displayPrice, profit } = computeDerived(p);
      return { key: p.id, product: p, displayPrice, profit };
    });
  }, [products]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterMLStatus && r.product.mlStatus !== filterMLStatus) return false;
      if (filterEstoque === 'com_estoque' && r.product.stock <= 0) return false;
      if (filterEstoque === 'sem_estoque' && r.product.stock > 0) return false;
      if (priceMin !== null || priceMax !== null) {
        let val: number;
        switch (priceField) {
          case 'cost': val = r.product.cost; break;
          case 'suggestedPrice': val = r.displayPrice; break;
          case 'profit': val = r.profit; break;
          default: val = 0;
        }
        if (priceMin !== null && val < priceMin) return false;
        if (priceMax !== null && val > priceMax) return false;
      }
      return true;
    });
  }, [rows, filterMLStatus, filterEstoque, priceField, priceMin, priceMax]);

  const columns: TableProps<ProductRow>['columns'] = [
    {
      title: 'SKU', dataIndex: ['product', 'sku'], key: 'sku', width: 130,
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
      title: 'Fornecedor', dataIndex: ['product', 'fornecedor'], key: 'fornecedor', width: 140,
      sorter: (a, b) => (a.product.fornecedor || '').localeCompare(b.product.fornecedor || ''),
      render: (v: string | null) => v
        ? <Tag color="default">{v}</Tag>
        : <span style={{ color: '#666' }}>—</span>,
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
            onChange={v => {
              const newProducts = products.map(p =>
                p.id === record.product.id ? { ...p, customPrice: v ?? null } : p
              );
              setProducts(newProducts);
            }}
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
      title: 'Status ML', dataIndex: ['product', 'mlStatus'], key: 'mlStatus', width: 130,
      sorter: (a, b) => a.product.mlStatus.localeCompare(b.product.mlStatus),
      render: (status: MLStatus) => (
        <Tag color={mlStatusColor[status]}>{mlStatusLabel[status]}</Tag>
      ),
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        record.product.mlStatus === 'sem_anuncio' ? (
          <Button
            type="link"
            size="small"
            onClick={() => abrirCriarAnuncioML(record.product.id, record.product.name)}
            style={{ fontSize: 12, padding: 0 }}
          >
            Criar ML
          </Button>
        ) : (
          <span style={{ color: '#666', fontSize: 11 }}>—</span>
        )
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Produtos</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Input
            placeholder="Buscar por nome ou SKU"
            prefix={<SearchOutlined />}
            value={inputSearch}
            onChange={e => setInputSearch(e.target.value)}
            onPressEnter={() => { setPage(1); setSearch(inputSearch); }}
            style={{ width: 220 }}
            allowClear
            onClear={() => { setInputSearch(''); setSearch(''); setPage(1); }}
          />
          <Select
            placeholder="Status ML"
            value={filterMLStatus || undefined}
            onChange={v => setFilterMLStatus(v as MLStatus | '')}
            options={mlStatusOptions}
            style={{ width: 150 }}
            allowClear
            onClear={() => setFilterMLStatus('')}
          />
          <Select
            mode="multiple"
            placeholder="Fornecedor"
            value={filterFornecedores}
            onChange={v => {
              if (v.includes('__all__')) setFilterFornecedores([]);
              else setFilterFornecedores(v);
            }}
            options={[
              ...(filterFornecedores.length === 0 ? [{ value: '__all__', label: 'Todos' }] : []),
              ...fornecedorOptions.map(f => ({ value: f, label: f })),
            ]}
            style={{ minWidth: 180, maxWidth: 250 }}
            maxTagCount={2}
            allowClear
            onClear={() => setFilterFornecedores([])}
          />
          <Select
            value={filterEstoque}
            onChange={v => setFilterEstoque(v)}
            options={estoqueOptions}
            style={{ width: 150 }}
          />
          <Space.Compact>
            <Select value={priceField} onChange={setPriceField} options={priceFieldOptions} style={{ width: 130 }} />
            <InputNumber placeholder="Mín" value={priceMin} onChange={v => setPriceMin(v ?? null)} style={{ width: 100 }} />
            <InputNumber placeholder="Máx" value={priceMax} onChange={v => setPriceMax(v ?? null)} style={{ width: 100 }} />
          </Space.Compact>
        </div>
      </div>
      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<ProductRow>
            storageKey="produtos"
            dataSource={filtered}
            columns={columns}
            rowKey="key"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} produtos`,
              onChange: (p) => setPage(p),
            }}
            scroll={{ x: 1200 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>

      <Modal
        title={`Criar Anúncio no ML — ${mlModal.nome}`}
        open={mlModal.open}
        onCancel={() => setMlModal(prev => ({ ...prev, open: false }))}
        footer={null}
        width={500}
      >
        {mlModal.loading && mlModal.categorias.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <LoadingOutlined style={{ fontSize: 24 }} />
            <p style={{ marginTop: 8, color: '#a0a0a0' }}>Buscando categorias...</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Text style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 8 }}>
              Selecione a categoria mais adequada para este anúncio:
            </Text>
            {mlModal.categorias.map((cat: any) => (
              <Button
                key={cat.id}
                block
                style={{
                  height: 'auto',
                  padding: '12px 16px',
                  textAlign: 'left',
                  background: '#1a1a1a',
                  border: '1px solid #303030',
                  borderRadius: 6,
                }}
                onClick={() => confirmarCriarAnuncio(cat.id)}
              >
                <div style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 14 }}>{cat.nome}</div>
                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{cat.dominio}</div>
              </Button>
            ))}
            {mlModal.loading && <Text style={{ color: '#1677ff', textAlign: 'center' }}>Criando anúncio...</Text>}
          </div>
        )}
      </Modal>
    </div>
  );
}
