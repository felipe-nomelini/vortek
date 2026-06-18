'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Card, Row, Col, Tag, Image, Typography, Button, Spin, Space, Breadcrumb, InputNumber, Switch, Select, message,
} from 'antd';
import { ArrowLeftOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { Database } from '@/types/database';

const { Title, Text, Paragraph } = Typography;

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

type OfferRow = Database['public']['Tables']['produto_fornecedor_ofertas']['Row'];
type ProductRow = Database['public']['Tables']['produtos']['Row'];

type OfferDetailResponse = {
  offer: OfferRow;
  product: ProductRow;
  preferred: boolean;
  siblingOffers: Array<{
    id: string;
    nome: string;
    fornecedor_nome: string | null;
    sku_oferta: string;
    dslite_fornecedor_id: string;
    dslite_produto_id: string;
    ativo: boolean;
    prioridade: number;
    payment_mode: string;
    preferred: boolean;
  }>;
};

function asImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

export default function ProductOfferDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<OfferDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/produtos/ofertas/${id}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || 'Erro ao carregar oferta');
      }
      setDetail(json.data || null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar oferta');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const persistOffer = async (patch: Partial<OfferRow>) => {
    if (!detail) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/produtos/${detail.product.id}/fornecedores`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: detail.offer.id,
          ativo: patch.ativo,
          prioridade: patch.prioridade,
          payment_mode: patch.payment_mode,
          preferred: (patch as any).preferred,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || 'Erro ao salvar oferta');
      }
      message.success('Oferta atualizada');
      await fetchDetail();
    } catch (err: any) {
      message.error(err.message || 'Erro ao salvar oferta');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />} />
        <p style={{ marginTop: 16, color: '#a0a0a0' }}>Carregando oferta...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Title level={4} style={{ color: '#e0e0e0' }}>{error || 'Oferta não encontrada'}</Title>
        <Button type="primary" onClick={() => router.push('/produtos')}>Voltar para Produtos</Button>
      </div>
    );
  }

  const { offer, product, preferred, siblingOffers } = detail;
  const images = asImageList(offer.imagens);
  const salePrice = Number(product.custom_price || 0);

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
        <Button type="primary" onClick={() => router.push(`/produtos/${product.id}`)}>
          Abrir Produto Principal
        </Button>
      </div>

      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 8 }}>{offer.nome}</Title>
      <Space wrap style={{ marginBottom: 24 }}>
        <Tag color={preferred ? 'green' : 'default'}>
          {preferred ? 'Oferta preferencial atual' : 'Oferta alternativa'}
        </Tag>
        <Tag color={offer.ativo ? 'blue' : 'default'}>
          {offer.ativo ? 'Ativa' : 'Inativa'}
        </Tag>
        <Tag color={offer.payment_mode === 'balance_account' ? 'blue' : offer.payment_mode === 'prepaid_pix' ? 'orange' : 'default'}>
          {offer.payment_mode === 'balance_account' ? 'Saldo Hayamax' : offer.payment_mode === 'prepaid_pix' ? 'PIX antecipado' : 'Pós-pago'}
        </Tag>
        <Tag color="default">{offer.fornecedor_nome || offer.dslite_fornecedor_id}</Tag>
      </Space>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={10}>
          <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
            <Title level={5} style={sectionTitle}>Imagens da Oferta</Title>
            {images.length > 0 ? (
              <Image.PreviewGroup>
                <Row gutter={[6, 6]}>
                  {images.map((url, index) => (
                    <Col key={index} span={8}>
                      <Image
                        src={url}
                        alt={`${offer.nome} ${index + 1}`}
                        style={{ borderRadius: 4, width: '100%', aspectRatio: '1', objectFit: 'cover' }}
                        preview={{ mask: null }}
                      />
                    </Col>
                  ))}
                </Row>
              </Image.PreviewGroup>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Sem imagens na oferta</div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginBottom: 24 }}>
            <Title level={5} style={sectionTitle}>Dados da Oferta</Title>
            <Row gutter={[16, 12]}>
              <Col xs={24} md={12}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>SKU Fornecedor</div>
                <Text style={{ color: '#e0e0e0' }}>{offer.sku_oferta}</Text>
              </Col>
              <Col xs={24} md={12}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>SKU do Fornecedor</div>
                <Text style={{ color: '#e0e0e0' }}>{offer.sku_fornecedor || '—'}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Custo</div>
                <Text style={{ color: '#e0e0e0' }}>{formatCurrency(Number(offer.custo || 0))}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Estoque</div>
                <Text style={{ color: Number(offer.estoque || 0) > 0 ? '#e0e0e0' : '#ff4d4f' }}>
                  {Number(offer.estoque || 0)}
                </Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Marca</div>
                <Text style={{ color: '#e0e0e0' }}>{offer.marca || '—'}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>GTIN</div>
                <Text style={{ color: '#e0e0e0' }}>{offer.gtin || '—'}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>NCM</div>
                <Text style={{ color: '#e0e0e0' }}>{offer.ncm || '—'}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>CEST</div>
                <Text style={{ color: '#e0e0e0' }}>{offer.cest || '—'}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Prioridade</div>
                <InputNumber
                  size="small"
                  min={0}
                  value={offer.prioridade}
                  disabled={saving}
                  onChange={(value) => setDetail((prev) => prev ? { ...prev, offer: { ...prev.offer, prioridade: Number(value || 0) } } : prev)}
                  onBlur={() => { void persistOffer({ prioridade: offer.prioridade }); }}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Ativo</div>
                <div style={{ paddingTop: 6 }}>
                  <Switch
                    checked={offer.ativo}
                    disabled={saving}
                    onChange={(checked) => {
                      setDetail((prev) => prev ? { ...prev, offer: { ...prev.offer, ativo: checked } } : prev);
                      void persistOffer({ ativo: checked });
                    }}
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Pagamento</div>
                <Select
                  size="small"
                  value={offer.payment_mode}
                  disabled={saving}
                  onChange={(value) => {
                    setDetail((prev) => prev ? { ...prev, offer: { ...prev.offer, payment_mode: value } } : prev);
                    void persistOffer({ payment_mode: value });
                  }}
                  style={{ width: '100%' }}
                    options={[
                      { value: 'balance_account', label: 'Saldo Hayamax' },
                      { value: 'postpaid', label: 'Pós-pago' },
                      { value: 'prepaid_pix', label: 'PIX antecipado' },
                    ]}
                />
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Preferencial</div>
                <Button
                  size="small"
                  disabled={saving || preferred}
                  type={preferred ? 'default' : 'primary'}
                  onClick={() => { void persistOffer({ preferred: true } as any); }}
                >
                  {preferred ? 'Oferta atual' : 'Tornar preferencial'}
                </Button>
              </Col>
            </Row>
          </Card>

          <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginBottom: 24 }}>
            <Title level={5} style={sectionTitle}>Produto Principal e Anúncio ML</Title>
            <Row gutter={[16, 12]}>
              <Col xs={24} md={12}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Produto principal</div>
                <Text style={{ color: '#e0e0e0' }}>{product.nome}</Text>
              </Col>
              <Col xs={24} md={12}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>SKU Vortek</div>
                <Text style={{ color: '#e0e0e0' }}>{product.sku}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Status ML</div>
                <Text style={{ color: '#e0e0e0' }}>{product.ml_status || 'sem_anuncio'}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>ML Item</div>
                <Text style={{ color: '#e0e0e0' }}>{product.ml_item_id || '—'}</Text>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Preço customizado</div>
                <Text style={{ color: '#e0e0e0' }}>{salePrice > 0 ? formatCurrency(salePrice) : '—'}</Text>
              </Col>
              <Col xs={24} md={6}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Taxa ML</div>
                <Text style={{ color: '#e0e0e0' }}>{formatPercent(Number(product.ml_fee || 0))}</Text>
              </Col>
              <Col xs={24} md={6}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Frete ML</div>
                <Text style={{ color: '#e0e0e0' }}>{formatCurrency(Number(product.ml_shipping || 0))}</Text>
              </Col>
              <Col xs={24} md={6}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Fornecedor preferencial atual</div>
                <Text style={{ color: '#e0e0e0' }}>{product.fornecedor || '—'}</Text>
              </Col>
              <Col xs={24} md={6}>
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>Último sync DSLite</div>
                <Text style={{ color: '#e0e0e0' }}>
                  {offer.last_sync_at ? new Date(offer.last_sync_at).toLocaleString('pt-BR') : '—'}
                </Text>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginTop: 24, marginBottom: 24 }}>
        <Title level={5} style={sectionTitle}>Descrição da Oferta</Title>
        <Paragraph style={{ color: '#d9d9d9', whiteSpace: 'pre-wrap', marginBottom: 0 }}>
          {offer.descricao || 'Sem descrição na oferta.'}
        </Paragraph>
      </Card>

      <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
        <Title level={5} style={sectionTitle}>Ofertas Relacionadas do Mesmo Produto</Title>
        <Breadcrumb
          items={siblingOffers.map((item) => ({
            title: (
              <a
                onClick={() => router.push(`/produtos/ofertas/${item.id}`)}
                style={{ color: item.id === offer.id ? '#e0e0e0' : '#1677ff' }}
              >
                {item.fornecedor_nome || item.dslite_fornecedor_id} · {item.sku_oferta}
              </a>
            ),
          }))}
        />
      </Card>
    </div>
  );
}
