'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Card, Row, Col, Tag, Image, Typography, Button, Breadcrumb,
  Input, InputNumber,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { formatCurrency, currencyFormatter, currencyParser } from '@/lib/format';
import { calculateSuggestedPrice } from '@/services/pricing';
import type { Product, MLStatus } from '@/types/product';

const { Title, Text } = Typography;

const mockProducts = [
  { id: '1', sku: 'FONE-001', name: 'Fone Bluetooth X1', brand: 'TechSound', stock: 45, cost: 22.50, mlFee: 0.15, mlShipping: 8.50, customPrice: null, mlStatus: 'ativo' as MLStatus, netWeight: 0.150, grossWeight: 0.220, width: 8, height: 5, depth: 3, gtin: '7891234560010', description: 'Fone Bluetooth com drivers de 40mm, bateria com 20h de autonomia e alcance de 10m. Compatível com todos os dispositivos Bluetooth.', images: ['https://picsum.photos/seed/fone1/400/400', 'https://picsum.photos/seed/fone2/400/400', 'https://picsum.photos/seed/fone3/400/400'], category: 'Eletrônicos > Áudio > Fones de Ouvido' },
  { id: '2', sku: 'CAPA-002', name: 'Capa Silicone iPhone 15', brand: 'TechSound', stock: 120, cost: 8.30, mlFee: 0.13, mlShipping: 5.00, customPrice: 34.90, mlStatus: 'ativo' as MLStatus, netWeight: 0.035, grossWeight: 0.060, width: 16, height: 8, depth: 1, gtin: '7891234560027', description: 'Capa de silicone flexível para iPhone 15. Proteção contra quedas e arranhões. Disponível em diversas cores.', images: ['https://picsum.photos/seed/capa1/400/400', 'https://picsum.photos/seed/capa2/400/400'], category: 'Celulares > Capas > iPhone 15' },
  { id: '3', sku: 'CAR-003', name: 'Carregador USB-C 20W', brand: 'VoltPower', stock: 78, cost: 14.90, mlFee: 0.14, mlShipping: 6.50, customPrice: null, mlStatus: 'pausado' as MLStatus, netWeight: 0.060, grossWeight: 0.100, width: 6, height: 6, depth: 3, gtin: '7891234560034', description: 'Carregador USB-C com tecnologia GaN, 20W de potência e carregamento rápido para smartphones e tablets.', images: ['https://picsum.photos/seed/car1/400/400'], category: 'Eletrônicos > Carregadores > USB-C' },
  { id: '4', sku: 'PEL-004', name: 'Película Premium Z10', brand: 'GlassShield', stock: 200, cost: 3.50, mlFee: 0.17, mlShipping: 4.00, customPrice: 19.90, mlStatus: 'ativo' as MLStatus, netWeight: 0.010, grossWeight: 0.030, width: 18, height: 10, depth: 0.1, gtin: '7891234560041', description: 'Película de vidro temperado 9H para iPhone 15. Resistente a riscos e oleosidade. Fácil instalação.', images: ['https://picsum.photos/seed/pel1/400/400', 'https://picsum.photos/seed/pel2/400/400'], category: 'Celulares > Películas > iPhone 15' },
  { id: '5', sku: 'MOUSE-005', name: 'Mouse Gamer RGB', brand: 'GameX', stock: 0, cost: 35.00, mlFee: 0.14, mlShipping: 10.00, customPrice: null, mlStatus: 'sem_anuncio' as MLStatus, netWeight: 0.100, grossWeight: 0.180, width: 12, height: 6, depth: 4, gtin: '7891234560058', description: 'Mouse gamer com sensor óptico de 6400DPI, 6 botões programáveis e iluminação RGB personalizável.', images: ['https://picsum.photos/seed/mouse1/400/400'], category: undefined },
  { id: '6', sku: 'TEC-006', name: 'Teclado Mecânico TKL', brand: 'GameX', stock: 23, cost: 65.00, mlFee: 0.13, mlShipping: 12.00, customPrice: null, mlStatus: 'ativo' as MLStatus, netWeight: 0.700, grossWeight: 1.100, width: 36, height: 14, depth: 4, gtin: '7891234560065', description: 'Teclado mecânico Tenkeyless com switches Red, retroiluminado RGB e construção em alumínio escovado.', images: ['https://picsum.photos/seed/tec1/400/400', 'https://picsum.photos/seed/tec2/400/400', 'https://picsum.photos/seed/tec3/400/400'], category: 'Informática > Teclados > Mecânicos' },
  { id: '7', sku: 'MON-007', name: 'Suporte Articulado Monitor', brand: 'ErgoTech', stock: 15, cost: 42.00, mlFee: 0.12, mlShipping: 15.00, customPrice: 89.90, mlStatus: 'pausado' as MLStatus, netWeight: 0.800, grossWeight: 1.300, width: 20, height: 45, depth: 12, gtin: '7891234560072', description: 'Suporte articulado para monitor de 17" a 32". Movimento de rotação, inclinação e ajuste de altura com sistema a gás.', images: ['https://picsum.photos/seed/mon1/400/400'], category: 'Informática > Acessórios > Suportes' },
  { id: '8', sku: 'CAB-008', name: 'Cabo HDMI 2.1 2m', brand: 'VoltPower', stock: 90, cost: 11.00, mlFee: 0.16, mlShipping: 5.50, customPrice: null, mlStatus: 'sem_anuncio' as MLStatus, netWeight: 0.080, grossWeight: 0.120, width: 12, height: 8, depth: 2, gtin: '7891234560089', description: 'Cabo HDMI 2.1 de 2 metros com suporte a 4K@120Hz, HDR10+ e eARC. Compatível com TVs, monitores e consoles.', images: ['https://picsum.photos/seed/cab1/400/400'], category: undefined },
  { id: '9', sku: 'ADAP-009', name: 'Adaptador Bluetooth 5.3', brand: 'TechSound', stock: 55, cost: 9.50, mlFee: 0.15, mlShipping: 4.50, customPrice: null, mlStatus: 'ativo' as MLStatus, netWeight: 0.005, grossWeight: 0.020, width: 3, height: 1.5, depth: 0.8, gtin: '7891234560096', description: 'Adaptador Bluetooth 5.3 USB-A para PCs. Baixa latência, alcance de 30m e compatível com Windows, Linux e Mac.', images: ['https://picsum.photos/seed/adap1/400/400', 'https://picsum.photos/seed/adap2/400/400'], category: 'Informática > Acessórios > Adaptadores' },
  { id: '10', sku: 'CAIXA-010', name: 'Caixa Som Portátil 20W', brand: 'TechSound', stock: 32, cost: 28.00, mlFee: 0.14, mlShipping: 9.00, customPrice: null, mlStatus: 'ativo' as MLStatus, netWeight: 0.450, grossWeight: 0.650, width: 18, height: 8, depth: 8, gtin: '7891234560102', description: 'Caixa de som portátil 20W com Bluetooth 5.3, resistência IPX7 e bateria de 12h. Ideal para levar para qualquer lugar.', images: ['https://picsum.photos/seed/caixa1/400/400', 'https://picsum.photos/seed/caixa2/400/400', 'https://picsum.photos/seed/caixa3/400/400'], category: 'Eletrônicos > Áudio > Caixas de Som' },
];

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

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();

  const product = mockProducts.find(p => p.id === params.id);

  const [form, setForm] = useState<Product | null>(product ?? null);

  if (!form) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Title level={4} style={{ color: '#e0e0e0' }}>Produto não encontrado</Title>
        <Button type="primary" onClick={() => router.push('/produtos')}>Voltar para Produtos</Button>
      </div>
    );
  }

  const patch = (diff: Partial<typeof form>) => setForm(prev => prev ? { ...prev, ...diff } : prev);

  const displayPrice = form.customPrice ?? calculateSuggestedPrice({
    cost: form.cost,
    shipping: form.mlShipping,
    mlFee: form.mlFee,
  }).suggestedPrice;

  const profit = displayPrice - form.cost - form.mlFee * displayPrice - form.mlShipping;
  const categoryItems = form.category
    ? form.category.split(' > ').map((name, i, arr) => ({
        key: name,
        title: i < arr.length - 1 ? name : <Text style={{ color: '#a0a0a0' }}>{name}</Text>,
      }))
    : [];

  const inputStyle = { background: '#1f1f1f', border: '1px solid #303030', color: '#e0e0e0', borderRadius: 6 };
  const labelStyle: React.CSSProperties = { color: '#a0a0a0', fontSize: 13 };

  return (
    <div>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => router.push('/produtos')}
        style={{ color: '#a0a0a0', marginBottom: 16, padding: 0 }}
      >
        Voltar para Produtos
      </Button>

      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 24 }}>{form.name}</Title>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={10}>
          <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
            <Title level={5} style={sectionTitle}>Imagens</Title>
            <Image.PreviewGroup>
              <Row gutter={[6, 6]}>
                {form.images.map((url, i) => (
                  <Col key={i} span={8}>
                    <Image
                      src={url}
                      alt={`${form.name} ${i + 1}`}
                      style={{ borderRadius: 4, width: '100%', aspectRatio: '1', objectFit: 'cover' }}
                      preview={{ mask: null }}
                    />
                  </Col>
                ))}
              </Row>
            </Image.PreviewGroup>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginBottom: 24 }}>
            <Title level={5} style={sectionTitle}>Identificação</Title>
            <Row gutter={[16, 12]}>
              <Col span={24}>
                <div style={labelStyle}>SKU</div>
                <Input size="small" value={form.sku} onChange={e => patch({ sku: e.target.value })} style={inputStyle} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Marca</div>
                <Input size="small" value={form.brand} onChange={e => patch({ brand: e.target.value })} style={inputStyle} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>GTIN/EAN</div>
                <Input size="small" value={form.gtin} onChange={e => patch({ gtin: e.target.value })} style={inputStyle} />
              </Col>
              <Col span={24}>
                <div style={labelStyle}>Categoria</div>
                {form.category
                  ? <Breadcrumb items={categoryItems} style={{ marginTop: 4 }} />
                  : <Text type="secondary" style={{ fontSize: 13 }}>Sem categoria</Text>}
              </Col>
            </Row>
          </Card>

          <Card styles={{ body: { padding: 16 } }} style={{ ...cardStyle, marginBottom: 24 }}>
            <Title level={5} style={sectionTitle}>Status</Title>
            <Row gutter={[16, 12]}>
              <Col span={12}>
                <div style={labelStyle}>Status ML</div>
                <div style={{ marginTop: 4 }}>
                  <Tag color={mlStatusColor[form.mlStatus]}>{mlStatusLabel[form.mlStatus]}</Tag>
                </div>
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Estoque</div>
                <InputNumber
                  size="small"
                  value={form.stock}
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
                <InputNumber size="small" value={form.cost} onChange={v => patch({ cost: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} formatter={currencyFormatter} parser={currencyParser} step={0.50} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Frete ML</div>
                <InputNumber size="small" value={form.mlShipping} onChange={v => patch({ mlShipping: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} formatter={currencyFormatter} parser={currencyParser} step={0.50} />
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Taxa ML</div>
                <InputNumber size="small" suffix="%" value={form.mlFee * 100} onChange={v => patch({ mlFee: (v ?? 0) / 100 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={0} min={0} max={100} />
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
            <InputNumber size="small" suffix="kg" value={form.netWeight} onChange={v => patch({ netWeight: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={3} step={0.01} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Peso Bruto</div>
            <InputNumber size="small" suffix="kg" value={form.grossWeight} onChange={v => patch({ grossWeight: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={3} step={0.01} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Largura</div>
            <InputNumber size="small" suffix="cm" value={form.width} onChange={v => patch({ width: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={1} step={0.5} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Altura</div>
            <InputNumber size="small" suffix="cm" value={form.height} onChange={v => patch({ height: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={1} step={0.5} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div style={labelStyle}>Profundidade</div>
            <InputNumber size="small" suffix="cm" value={form.depth} onChange={v => patch({ depth: v ?? 0 })} style={{ ...inputStyle, width: '100%', marginTop: 4 }} precision={1} step={0.5} />
          </Col>
        </Row>
      </Card>

      <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
        <Title level={5} style={sectionTitle}>Descrição</Title>
        <Input.TextArea
          value={form.description}
          onChange={e => patch({ description: e.target.value })}
          rows={8}
          style={{ ...inputStyle, resize: 'vertical', fontSize: 14, lineHeight: 1.8 }}
        />
      </Card>
    </div>
  );
}
