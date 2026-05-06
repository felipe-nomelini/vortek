'use client';

import { Card, Row, Col, Statistic, Tag, Typography, Table, Progress } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, TrophyFilled } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '@/lib/format';

const { Title, Text } = Typography;

const cardBg = { background: '#141414', border: '1px solid #303030', borderRadius: 8 };

const vendasChart = [
  { dia: '05/04', receita: 2800 }, { dia: '06/04', receita: 3200 }, { dia: '07/04', receita: 4100 },
  { dia: '08/04', receita: 2900 }, { dia: '09/04', receita: 3800 }, { dia: '10/04', receita: 5100 },
  { dia: '11/04', receita: 3500 }, { dia: '12/04', receita: 4200 }, { dia: '13/04', receita: 3800 },
  { dia: '14/04', receita: 4500 }, { dia: '15/04', receita: 2900 }, { dia: '16/04', receita: 3600 },
  { dia: '17/04', receita: 4800 }, { dia: '18/04', receita: 5200 }, { dia: '19/04', receita: 4900 },
  { dia: '20/04', receita: 5100 }, { dia: '21/04', receita: 4300 }, { dia: '22/04', receita: 3800 },
  { dia: '23/04', receita: 4600 }, { dia: '24/04', receita: 5300 }, { dia: '25/04', receita: 3800 },
  { dia: '26/04', receita: 4100 }, { dia: '27/04', receita: 3500 }, { dia: '28/04', receita: 3900 },
  { dia: '29/04', receita: 4400 }, { dia: '30/04', receita: 4500 }, { dia: '01/05', receita: 3200 },
  { dia: '02/05', receita: 4800 }, { dia: '03/05', receita: 5100 }, { dia: '04/05', receita: 4200 },
];

const orderStatus = [
  { status: 'Pago', qtd: 180, pct: 53, cor: '#52c41a' },
  { status: 'Processamento', qtd: 23, pct: 7, cor: '#1677ff' },
  { status: 'Enviado', qtd: 89, pct: 26, cor: '#faad14' },
  { status: 'Entregue', qtd: 42, pct: 12, cor: '#722ed1' },
  { status: 'Cancelado', qtd: 8, pct: 2, cor: '#ff4d4f' },
];

const topProdutos = [
  { rank: 1, nome: 'Fone Bluetooth X1', vendas: 45, receita: 2695.50 },
  { rank: 2, nome: 'Capa Silicone iPhone 15', vendas: 38, receita: 1136.20 },
  { rank: 3, nome: 'Carregador USB-C 20W', vendas: 32, receita: 1276.80 },
  { rank: 4, nome: 'Teclado Mecânico TKL', vendas: 18, receita: 2698.20 },
  { rank: 5, nome: 'Caixa Som Portátil 20W', vendas: 15, receita: 1348.50 },
];

const pedidosRecentes = [
  { key: '1', num: '#000342', cliente: 'Ana Ferreira', total: 89.90, status: 'Pago', cor: '#52c41a', data: '04/05 14:30' },
  { key: '2', num: '#000341', cliente: 'Carlos Lima', total: 161.90, status: 'Faturado', cor: '#722ed1', data: '04/05 16:00' },
  { key: '3', num: '#000340', cliente: 'Marina Costa', total: 29.90, status: 'Entregue', cor: '#52c41a', data: '04/05 09:00' },
  { key: '4', num: '#000339', cliente: 'Roberto Alves', total: 59.90, status: 'Pago', cor: '#52c41a', data: '03/05 09:30' },
  { key: '5', num: '#000338', cliente: 'Juliana Santos', total: 194.90, status: 'Faturado', cor: '#722ed1', data: '03/05 10:00' },
];

const topColumns = [
  {
    title: '', dataIndex: 'rank', key: 'rank', width: 36,
    render: (r: number) => r <= 3
      ? <TrophyFilled style={{ color: ['#ffd700', '#c0c0c0', '#cd7f32'][r - 1], fontSize: 16 }} />
      : <span style={{ color: '#666', fontSize: 13 }}>{r}º</span>,
  },
  { title: 'Produto', dataIndex: 'nome', key: 'nome', render: (n: string) => <span style={{ color: '#c0c0c0', fontSize: 13 }}>{n}</span> },
  { title: 'Vendas', dataIndex: 'vendas', key: 'vendas', width: 60, render: (v: number) => <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{v}</span> },
  { title: 'Receita', dataIndex: 'receita', key: 'receita', width: 90, render: (r: number) => <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{formatCurrency(r)}</span> },
];

const recentColumns = [
  { title: 'Pedido', dataIndex: 'num', key: 'num', width: 85, render: (n: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{n}</span> },
  { title: 'Cliente', dataIndex: 'cliente', key: 'cliente', render: (c: string) => <span style={{ fontSize: 13 }}>{c}</span> },
  { title: 'Total', dataIndex: 'total', key: 'total', width: 90, render: (t: number) => <span style={{ fontSize: 13 }}>{formatCurrency(t)}</span> },
  { title: 'Status', dataIndex: 'status', key: 'status', width: 100, render: (s: string, r: any) => <Tag color={r.cor} style={{ margin: 0 }}>{s}</Tag> },
  { title: 'Data', dataIndex: 'data', key: 'data', width: 100, render: (d: string) => <span style={{ color: '#a0a0a0', fontSize: 12 }}>{d}</span> },
];

function Trend({ value, label }: { value: number; label: string }) {
  const up = value >= 0;
  return (
    <span style={{ color: up ? '#52c41a' : '#ff4d4f', fontSize: 12, display: 'flex', alignItems: 'center', gap: 2 }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {Math.abs(value)}% {label}
    </span>
  );
}

export default function DashboardPage() {
  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 24 }}>Dashboard</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {[
          { title: 'Faturamento do Mês', value: 84750, prefix: 'R$', color: '#1677ff', trend: 12, trendLabel: 'vs abr' },
          { title: 'Total de Pedidos', value: 342, color: '#52c41a', trend: -3, trendLabel: 'vs abr' },
          { title: 'Produtos Ativos', value: 342, color: '#faad14', trend: 8, trendLabel: 'vs abr' },
          { title: 'Lucro Líquido', value: 24750.5, prefix: 'R$', color: '#ff4d4f', trend: 15, trendLabel: 'vs abr' },
        ].map(card => (
          <Col xs={12} lg={6} key={card.title}>
            <Card styles={{ body: { padding: '16px 20px' } }} style={cardBg}>
              <Statistic
                title={<span style={{ color: '#a0a0a0', fontSize: 12 }}>{card.title}</span>}
                value={card.value}
                precision={card.prefix ? 2 : 0}
                prefix={card.prefix ? <span style={{ fontSize: 16 }}>{card.prefix}</span> : undefined}
                valueStyle={{ color: '#e0e0e0', fontSize: 26, fontWeight: 700 }}
              />
              <Trend value={card.trend} label={card.trendLabel} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={14}>
          <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Vendas - Últimos 30 Dias
            </Title>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={vendasChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="dia" tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#1f1f1f', border: '1px solid #303030', borderRadius: 6 }}
                  labelStyle={{ color: '#a0a0a0' }}
                />
                <Bar dataKey="receita" fill="#5aab2c" radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Status dos Pedidos
            </Title>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {orderStatus.map(s => (
                <div key={s.status}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 5, background: s.cor }} />
                      <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{s.status}</Text>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{s.qtd}</Text>
                      <Text style={{ color: '#666', fontSize: 13 }}>{s.pct}%</Text>
                    </div>
                  </div>
                  <Progress percent={s.pct} strokeColor={s.cor} trailColor="#303030" size="small" showInfo={false} />
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={8}>
          <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 12, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Top Produtos
            </Title>
            <Table
              dataSource={topProdutos}
              columns={topColumns}
              rowKey="rank"
              pagination={false}
              size="small"
              style={{ background: 'transparent' }}
              showHeader={false}
            />
            <div style={{ marginTop: 8 }}>
              <a style={{ color: '#1677ff', fontSize: 12 }} href="/produtos">Ver todos os produtos →</a>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Saúde do Negócio
            </Title>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'Reclamações', rate: 0.8, max: 2, good: true },
                { label: 'Atraso na Entrega', rate: 4, max: 10, good: true },
                { label: 'Cancelamentos', rate: 1.2, max: 1.5, good: true },
              ].map(m => (
                <div key={m.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{m.label}</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{m.rate}%</Text>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: m.rate <= m.max ? '#52c41a' : '#ff4d4f' }} />
                    </div>
                  </div>
                  <Progress
                    percent={(m.rate / (m.max * 2)) * 100}
                    strokeColor={m.rate <= m.max ? '#5aab2c' : '#ff4d4f'}
                    trailColor="#303030"
                    size="small"
                    showInfo={false}
                  />
                </div>
              ))}
              <div style={{ borderTop: '1px solid #303030', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22, color: '#52c41a' }}>🏆</span>
                <div>
                  <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>Mercado Líder Gold</Text>
                  <br />
                  <Text style={{ color: '#808080', fontSize: 12 }}>Reputação verde · 94,8% positivas</Text>
                </div>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Integrações
            </Title>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Mercado Livre', status: 'Conectado', cor: '#1677ff', bg: '#111d2e', on: true },
                { label: 'Bling V3', status: 'Conectado', cor: '#52c41a', bg: '#162812', on: true },
                { label: 'DSLite', status: 'Desconectado', cor: '#555', bg: '#1a1a1a', on: false },
              ].map(i => (
                <div key={i.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 6, background: i.bg, border: `1px solid ${i.on ? i.cor : '#303030'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 5, background: i.on ? i.cor : '#555' }} />
                    <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{i.label}</Text>
                  </div>
                  <Tag color={i.on ? 'green' : 'default'} style={{ margin: 0, fontSize: 11 }}>{i.status}</Tag>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <a style={{ color: '#1677ff', fontSize: 12 }} href="/configuracoes">Gerenciar integrações →</a>
            </div>
          </Card>
        </Col>
      </Row>

      <Card styles={{ body: { padding: 20 } }} style={cardBg}>
        <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
          Pedidos Recentes
        </Title>
        <Table
          dataSource={pedidosRecentes}
          columns={recentColumns}
          rowKey="key"
          pagination={false}
          size="small"
          style={{ background: 'transparent' }}
        />
      </Card>
    </div>
  );
}
