'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Card, Row, Col, Tag, Image, Typography, Button, Breadcrumb,
  Input, InputNumber, Spin, message, Select, Switch, Space,
  Table,
} from 'antd';
import { ArrowLeftOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons';
import { formatCurrency, currencyFormatter, currencyParser } from '@/lib/format';
import { calculateSuggestedPrice } from '@/services/pricing';
import type { Product, MLStatus } from '@/types/product';
import type { Database } from '@/types/database';

const { Title, Text } = Typography;

const mlStatusColor: Record<MLStatus, string> = { ativo: 'green', pausado: 'orange', sem_anuncio: 'default' };
const mlStatusLabel: Record<MLStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', sem_anuncio: 'Sem Anúncio' };

const cardStyle = {
  background: '#141414',
  border: '1px solid #303030',
  borderRadius: 8,
};

const sectionTitle = {
  color: '#a0a0a0',
  marginBottom: 16,
  fontSize: 13,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
};

type ProdutoRow = Database['public']['Tables']['produtos']['Row'];
type ProductSupplierOffer = Database['public']['Tables']['produto_fornecedor_ofertas']['Row'] & {
  preferred?: boolean;
};

function mapDBtoProduct(item: ProdutoRow): Product {
  return {
    id: item.id,
    active: item.ativo !== false,
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
    category: item.categoria || undefined,
    ncm: item.ncm || null,
    cest: item.cest || null,
  };
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [original, setOriginal] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [supplierOffers, setSupplierOffers] = useState<ProductSupplierOffer[]>([]);
  const [supplierOffersLoading, setSupplierOffersLoading] = useState(false);
  const [savingOfferId, setSavingOfferId] = useState<string | null>(null);

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/produtos/${id}`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Erro ao buscar produto');
      }
      const json = await res.json();
      const mapped = mapDBtoProduct(json.data);
      setProduct(mapped);
      setOriginal(mapped);
      setHasChanges(false);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar produto');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchSupplierOffers = useCallback(async () => {
    setSupplierOffersLoading(true);
    try {
      const res = await fetch(`/api/produtos/${id}/fornecedores`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Erro ao carregar fornecedores do produto');
      }
      const json = await res.json();
      setSupplierOffers(Array.isArray(json.data) ? json.data : []);
    } catch (err: any) {
      message.error(err.message || 'Erro ao carregar fornecedores do produto');
    } finally {
      setSupplierOffersLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  useEffect(() => {
    fetchSupplierOffers();
  }, [fetchSupplierOffers]);

  // Detectar mudanças comparando com original
  useEffect(() => {
    if (!product || !original) {
      setHasChanges(false);
      return;
    }
    const changed = JSON.stringify(product) !== JSON.stringify(original);
    setHasChanges(changed);
  }, [product, original]);

  const patch = (diff: Partial<Product>) => {
    setProduct(prev => prev ? { ...prev, ...diff } : prev);
  };

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/produtos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: product.sku,
          ativo: product.active,
          nome: product.name,
          marca: product.brand,
          gtin: product.gtin,
          estoque: product.stock,
          custo: product.cost,
          ml_shipping: product.mlShipping,
          ml_fee: product.mlFee,
          custom_price: product.customPrice,
          peso_liq: product.netWeight,
          peso_bruto: product.grossWeight,
          largura: product.width,
          altura: product.height,
          profundidade: product.depth,
          descricao: product.description,
          ncm: product.ncm,
          cest: product.cest,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Erro ao salvar');
      }

      const json = await res.json();
      const mapped = mapDBtoProduct(json.data);
      setProduct(mapped);
      setOriginal(mapped);
      setHasChanges(false);
      message.success('Produto salvo com sucesso');
    } catch (err: any) {
      message.error(err.message || 'Erro ao salvar produto');
    } finally {
      setSaving(false);
    }
  };

  const patchOffer = (offerId: string, diff: Partial<ProductSupplierOffer>) => {
    setSupplierOffers((prev) => prev.map((offer) => (
      offer.id === offerId ? { ...offer, ...diff } : offer
    )));
  };

  const persistOffer = async (offerId: string, diff: Partial<ProductSupplierOffer>) => {
    setSavingOfferId(offerId);
    try {
      const res = await fetch(`/api/produtos/${id}/fornecedores`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId,
          ativo: diff.ativo,
          prioridade: diff.prioridade,
          payment_mode: diff.payment_mode,
          preferred: diff.preferred,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao salvar oferta do fornecedor');
      }
      setSupplierOffers(Array.isArray(json.data) ? json.data : []);
      await fetchProduct();
      message.success('Oferta do fornecedor atualizada');
    } catch (err: any) {
      message.error(err.message || 'Erro ao salvar oferta do fornecedor');
      await fetchSupplierOffers();
    } finally {
      setSavingOfferId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />} />
        <p style={{ marginTop: 16, color: '#a0a0a0' }}>Carregando produto...</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Title level={4} style={{ color: '#e0e0e0' }}>{error || 'Produto não encontrado'}</Title>
        <Button type="primary" onClick={() => router.push('/produtos')}>Voltar para Produtos</Button>
      </div>
    );
  }

  const displayPrice = product.customPrice ?? calculateSuggestedPrice({
    cost: product.cost,
    shipping: product.mlShipping,
    mlFee: product.mlFee,
  }).suggestedPrice;

  const profit = displayPrice - product.cost - product.mlFee * displayPrice - product.mlShipping;

  const categoryItems = product.category
    ? product.category.split(' > ').map((name, i, arr) => ({
        key: name,
        title: i < arr.length - 1 ? name : <Text style={{ color: '#a0a0a0' }}>{name}</Text>,
      }))
    : [];

  const inputStyle = { background: '#1f1f1f', border: '1px solid #303030', color: '#e0e0e0', borderRadius: 6 };
  const labelStyle: React.CSSProperties = { color: '#a0a0a0', fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push('/produtos')}
          style={{ color: '#a0a0a0', padding: 0 }}
        >
          Voltar para Produtos
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!hasChanges}
        >
          Salvar Alterações
        </Button>
      </div>

      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 24 }}>{product.name}</Title>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={10}>
          <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
            <Title level={5} style={sectionTitle}>Imagens</Title>
            {product.images.length > 0 ? (
              <Image.PreviewGroup>
                <Row gutter={[6, 6]}>
                  {product.images.map((url, i) => (
                    <Col key={i} span={8}>
                      <Image
                        src={url}
                        alt={`${product.name} ${i + 1}`}
                        style={{ borderRadius: 4, width: '100%', aspectRatio: '1', objectFit: 'cover' }}
                        preview={{ mask: null }}
                      />
                    </Col>
                  ))}
                </Row>
              </Image.PreviewGroup>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Sem imagens cadastradas</div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginBottom: 24 }}>
            <Title level={5} style={sectionTitle}>Identificação</Title>
            <Row gutter={[16, 12]}>
              <Col span={24}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={labelStyle}>Produto ativo</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Inativo bloqueia uso novo e pausa o anúncio ML ao salvar.
                    </Text>
                  </div>
                  <Switch checked={product.active} onChange={checked => patch({ active: checked })} />
                </div>
              </Col>
              <Col span={24}>
                <div style={labelStyle}>SKU Vortek</div>
                <Input size="small" value={product.sku} onChange={e => patch({ sku: e.target.value })} style={inputStyle} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Marca</div>
                <Input size="small" value={product.brand} onChange={e => patch({ brand: e.target.value })} style={inputStyle} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>GTIN/EAN</div>
                <Input size="small" value={product.gtin} onChange={e => patch({ gtin: e.target.value })} style={inputStyle} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Fornecedor</div>
                <Text style={{ color: '#e0e0e0', fontSize: 13, display: 'block', marginTop: 4 }}>
                  {product.fornecedor || <span style={{ color: '#666' }}>—</span>}
                </Text>
              </Col>
              <Col span={24}>
                <div style={labelStyle}>Categoria</div>
                {product.category
                  ? <Breadcrumb items={categoryItems} style={{ marginTop: 4 }} />
                  : <Text type="secondary" style={{ fontSize: 13 }}>Sem categoria</Text>}
              </Col>
            </Row>
          </Card>

          <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginBottom: 24 }}>
            <Title level={5} style={sectionTitle}>Fornecedores do Produto</Title>
            <Spin spinning={supplierOffersLoading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
              {supplierOffers.length === 0 ? (
                <div style={{ color: '#666', padding: 16 }}>Nenhuma oferta de fornecedor vinculada a este produto.</div>
              ) : (
                <Table<ProductSupplierOffer>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={supplierOffers}
                  columns={[
                    {
                      title: 'Fornecedor',
                      key: 'fornecedor',
                      render: (_, offer) => (
                        <div>
                          <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{offer.fornecedor_nome || offer.dslite_fornecedor_id}</div>
                          <div style={{ color: '#888', fontSize: 12 }}>
                            SKU {offer.sku_oferta || '—'}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'Estoque',
                      dataIndex: 'estoque',
                      width: 100,
                      render: (value) => (
                        <span style={{ color: Number(value || 0) > 0 ? '#e0e0e0' : '#ff4d4f' }}>
                          {Number(value || 0)}
                        </span>
                      ),
                    },
                    {
                      title: 'Custo',
                      dataIndex: 'custo',
                      width: 120,
                      render: (value) => formatCurrency(Number(value || 0)),
                    },
                    {
                      title: 'Principal',
                      key: 'preferred',
                      width: 160,
                      render: (_, offer) => {
                        const isSavingOffer = savingOfferId === offer.id;
                        return offer.preferred ? (
                          <Tag color="green">Atual</Tag>
                        ) : (
                          <Button
                            size="small"
                            type="primary"
                            disabled={isSavingOffer}
                            loading={isSavingOffer}
                            onClick={() => { void persistOffer(offer.id, { preferred: true } as any); }}
                          >
                            Tornar principal
                          </Button>
                        );
                      },
                    },
                  ]}
                />
              )}
            </Spin>
          </Card>

          <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginBottom: 24 }}>
            <Title level={5} style={sectionTitle}>Status</Title>
            <Row gutter={[16, 12]}>
              <Col span={12}>
                <div style={labelStyle}>Status ML</div>
                <div style={{ marginTop: 4 }}>
                  <Tag color={mlStatusColor[product.mlStatus]}>{mlStatusLabel[product.mlStatus]}</Tag>
                </div>
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Estoque</div>
                <InputNumber
                  size="small"
                  value={product.stock}
                  onChange={v => patch({ stock: v ?? 0 })}
                  style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                  min={0}
                />
              </Col>
            </Row>
          </Card>

          <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
            <Title level={5} style={sectionTitle}>Precificação</Title>
            <Row gutter={[16, 12]}>
              <Col span={12}>
                <div style={labelStyle}>Custo</div>
                <InputNumber size="small" value={product.cost} onChange={v => patch({ cost: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} formatter={currencyFormatter} parser={currencyParser} step={0.50} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Frete ML</div>
                <InputNumber size="small" value={product.mlShipping} onChange={v => patch({ mlShipping: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} formatter={currencyFormatter} parser={currencyParser} step={0.50} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Taxa ML</div>
                <InputNumber size="small" suffix="%" value={product.mlFee * 100} onChange={v => patch({ mlFee: (v ?? 0) / 100 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={0} min={0} max={100} />
              </Col>
              <Col span={12}>
                <div style={{ color: '#1677ff', fontSize: 13 }}>Sugerido</div>
                <span style={{ color: '#1677ff', fontWeight: 600, fontSize: 15 }}>{formatCurrency(displayPrice)}</span>
              </Col>
              <Col span={12}>
                <div style={{ color: profit >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 13 }}>Lucro</div>
                <span style={{ color: profit >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600, fontSize: 15 }}>
                  {formatCurrency(profit)}
                </span>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginTop: 24, marginBottom: 24 }}>
        <Title level={5} style={sectionTitle}>Dimensões e Peso</Title>
        <Row gutter={[16, 12]}>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Peso Líquido</div>
            <InputNumber size="small" suffix="kg" value={product.netWeight} onChange={v => patch({ netWeight: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={3} step={0.01} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Peso Bruto</div>
            <InputNumber size="small" suffix="kg" value={product.grossWeight} onChange={v => patch({ grossWeight: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={3} step={0.01} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Largura</div>
            <InputNumber size="small" suffix="cm" value={product.width} onChange={v => patch({ width: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={1} step={0.5} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Altura</div>
            <InputNumber size="small" suffix="cm" value={product.height} onChange={v => patch({ height: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={1} step={0.5} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Profundidade</div>
            <InputNumber size="small" suffix="cm" value={product.depth} onChange={v => patch({ depth: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={1} step={0.5} />
          </Col>
        </Row>
      </Card>

      <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
        <Title level={5} style={sectionTitle}>Descrição</Title>
        <Input.TextArea
          value={product.description}
          onChange={e => patch({ description: e.target.value })}
          rows={8}
          style={{ ...inputStyle, resize: 'vertical', fontSize: 14, lineHeight: 1.8 }}
        />
      </Card>
    </div>
  );
}
