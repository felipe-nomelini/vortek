'use client';

import { Card, Row, Col, Statistic, Progress, Tag, Typography, Divider } from 'antd';
import {
  StarFilled, TrophyFilled, RocketFilled, CheckCircleFilled,
  ThunderboltFilled, LikeFilled, DislikeFilled,
} from '@ant-design/icons';

const { Title, Text } = Typography;

const repData = {
  levelId: '5_green' as const,
  powerSeller: 'gold' as const,
  positive: 1480,
  neutral: 45,
  negative: 35,
  completed: 1480,
  canceled: 35,
  total: 1560,
  responseTimeAvg: '1h 12min',
  sixMonths: { vendidas: 420, canceladas: 8, reclamacoes: 3 },
  twelveMonths: { vendidas: 890, canceladas: 15, reclamacoes: 7 },
  metrics: {
    claims: { rate: 0.008, value: 2 },
    delayedHandling: { rate: 0.04, value: 10 },
    cancellations: { rate: 0.012, value: 3 },
    period: '60 dias',
    salesCompleted: 244,
  },
};

const levelConfig = {
  '5_green': { color: '#5aab2c', bg: '#162312', label: 'Verde', icon: <StarFilled /> },
  '4_light_blue': { color: '#73d13d', bg: '#162812', label: 'Verde Claro', icon: <StarFilled /> },
  '3_yellow': { color: '#faad14', bg: '#2a1f0a', label: 'Amarelo', icon: <StarFilled /> },
  '2_orange': { color: '#fa8c16', bg: '#2a1706', label: 'Laranja', icon: <StarFilled /> },
  '1_red': { color: '#ff4d4f', bg: '#2a0d0e', label: 'Vermelho', icon: <StarFilled /> },
};

const psConfig = {
  platinum: { label: 'Platinum', color: '#a0a0a0', bg: '#1a1919' },
  gold: { label: 'Gold', color: '#faad14', bg: '#2a1f0a' },
  silver: { label: 'Silver', color: '#a0a0a0', bg: '#141414' },
  bronze: { label: 'Bronze', color: '#cd7f32', bg: '#1f150e' },
};

const levelOrder = ['1_red', '2_orange', '3_yellow', '4_light_blue', '5_green'] as const;

const softRed = '#ff4d4f';
const softOrange = '#fa8c16';
const softYellow = '#faad14';
const softBlue = '#1677ff';
const softGreen = '#5aab2c';

function metricInfo(rate: number, thresholds: [number, number, number, number]): { color: string; label: string } {
  if (rate <= thresholds[0]) return { color: softGreen, label: 'Excelente' };
  if (rate <= thresholds[1]) return { color: softGreen, label: 'Excelente' };
  if (rate <= thresholds[2]) return { color: softYellow, label: 'Bom' };
  if (rate <= thresholds[3]) return { color: softOrange, label: 'Atenção' };
  return { color: softRed, label: 'Crítico' };
}

export default function ReputacaoPage() {
  const lvl = levelConfig[repData.levelId];
  const ps = psConfig[repData.powerSeller];
  const totalRatings = repData.positive + repData.neutral + repData.negative;
  const pctPositive = Math.round((repData.positive / totalRatings) * 100);
  const pctNeutral = Math.round((repData.neutral / totalRatings) * 100);
  const pctNegative = Math.round((repData.negative / totalRatings) * 100);
  const cancelRate = ((repData.canceled / repData.total) * 100).toFixed(1);
  const psLabel = repData.powerSeller ? `Mercado Líder ${ps.label}` : '';

  const cardBg = { background: '#141414', border: '1px solid #303030', borderRadius: 8 };
  const m = repData.metrics;

  const claimsTh: [number, number, number, number] = [0.01, 0.02, 0.045, 0.08];
  const handlingTh: [number, number, number, number] = [0.06, 0.10, 0.18, 0.22];
  const cancelTh: [number, number, number, number] = [0.005, 0.015, 0.035, 0.04];

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 20 }}>Reputação - Mercado Livre</Title>

      <Card styles={{ body: { padding: 24 } }} style={{ ...cardBg, marginBottom: 20 }}>
        <Row align="middle" gutter={24}>
          <Col>
            <div style={{
              width: 72, height: 72, borderRadius: 36,
              background: lvl.bg, color: lvl.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 36,
            }}>
              {lvl.icon}
            </div>
          </Col>
          <Col flex="auto">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#e0e0e0' }}>VORTEKTECNOLOGIA</span>
              {psLabel && <Tag color={ps.color} style={{ margin: 0, fontWeight: 600 }}>{psLabel}</Tag>}
              {(() => {
                const greenTag = lvl.color === softGreen;
                return (
                  <Tag
                    color={greenTag ? undefined : lvl.color}
                    style={{ margin: 0, fontWeight: 600, ...(greenTag ? { color: softGreen, background: '#162312', borderColor: softGreen } : {}) }}
                  >
                    {lvl.label}
                  </Tag>
                );
              })()}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 10, maxWidth: 400 }}>
              {levelOrder.map(key => {
                const lc = levelConfig[key];
                const active = repData.levelId === key;
                return (
                  <div key={key} style={{
                    flex: 1, height: 12, borderRadius: 4,
                    background: active ? lc.color : '#252525',
                    transition: 'all .3s',
                  }} />
                );
              })}
            </div>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} lg={6}>
          <Card styles={{ body: { padding: 20 } }} style={cardBg}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Vendas Concluídas</span>} value={repData.completed} prefix={<LikeFilled style={{ color: softGreen }} />} valueStyle={{ color: '#e0e0e0' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card styles={{ body: { padding: 20 } }} style={cardBg}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Cancelamentos</span>} value={repData.canceled} suffix={<span style={{ fontSize: 14, color: '#a0a0a0' }}>({cancelRate}%)</span>} prefix={<DislikeFilled style={{ color: softRed }} />} valueStyle={{ color: '#e0e0e0' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card styles={{ body: { padding: 20 } }} style={cardBg}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Total Transações</span>} value={repData.total} prefix={<StarFilled style={{ color: softBlue }} />} valueStyle={{ color: '#e0e0e0' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card styles={{ body: { padding: 20 } }} style={cardBg}>
            <Statistic title={<span style={{ color: '#a0a0a0' }}>Tempo Médio Resposta</span>} value={repData.responseTimeAvg} prefix={<ThunderboltFilled style={{ color: softYellow }} />} valueStyle={{ color: '#e0e0e0' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={12}>
          <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Métricas de Qualidade · {m.period}
            </Title>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[
                { label: 'Reclamações', value: m.claims.value, rate: m.claims.rate, thresholds: claimsTh },
                { label: 'Atraso na Entrega', value: m.delayedHandling.value, rate: m.delayedHandling.rate, thresholds: handlingTh },
                { label: 'Cancelamentos', value: m.cancellations.value, rate: m.cancellations.rate, thresholds: cancelTh },
              ].map(item => {
                const pct = item.rate * 100;
                const info = metricInfo(item.rate, item.thresholds);
                return (
                  <div key={item.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{item.label}</Text>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: '#a0a0a0', fontSize: 12 }}>{item.value} ocorrências</Text>
                        {(() => {
                          const greenTag = info.color === softGreen;
                          return (
                            <Tag
                              color={greenTag ? undefined : info.color}
                              style={{ margin: 0, fontWeight: 600, fontSize: 11, ...(greenTag ? { color: softGreen, background: '#162312', borderColor: softGreen } : {}) }}
                            >
                              {info.label}
                            </Tag>
                          );
                        })()}
                      </div>
                    </div>
                    <Progress
                      percent={parseFloat(pct.toFixed(2))}
                      strokeColor={info.color}
                      trailColor="#303030"
                      format={() => `${pct.toFixed(1)}%`}
                      size="small"
                    />
                  </div>
                );
              })}
            </div>
            <Divider style={{ borderColor: '#303030', margin: '16px 0' }} />
            <Text style={{ color: '#666', fontSize: 12 }}>Vendas no período: {m.salesCompleted}</Text>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card styles={{ body: { padding: 20 } }} style={{ ...cardBg, height: '100%' }}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Avaliações
            </Title>
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 32, marginBottom: 12 }}>
              {pctPositive > 0 && <div style={{ flex: pctPositive, background: softGreen, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 13 }}>{pctPositive}%</div>}
              {pctNeutral > 0 && <div style={{ flex: pctNeutral, background: softBlue, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 13 }}>{pctNeutral}%</div>}
              {pctNegative > 0 && <div style={{ flex: pctNegative, background: softRed, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 13 }}>{pctNegative}%</div>}
            </div>
            <Row gutter={24} style={{ marginBottom: 20 }}>
              <Col><Text style={{ color: softGreen }}>{repData.positive} positivos ({pctPositive}%)</Text></Col>
              <Col><Text style={{ color: softBlue }}>{repData.neutral} neutros ({pctNeutral}%)</Text></Col>
              <Col><Text style={{ color: softRed }}>{repData.negative} negativos ({pctNegative}%)</Text></Col>
            </Row>

            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 12, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Selos & Conquistas
            </Title>
            <Row gutter={[12, 12]}>
              {[
                ...(psLabel ? [{ icon: <TrophyFilled />, color: ps.color, label: psLabel, desc: 'Reconhecimento por alto volume de vendas' }] : []),
                { icon: <CheckCircleFilled />, color: softGreen, label: `${pctPositive}% Avaliações Positivas`, desc: `${repData.completed} vendas concluídas com sucesso` },
                { icon: <RocketFilled />, color: lvl.color, label: `Nível ${lvl.label}`, desc: pctPositive >= 94 ? 'Termômetro no nível máximo' : 'Continue melhorando' },
                { icon: <ThunderboltFilled />, color: softYellow, label: 'Resposta Rápida', desc: `Média de ${repData.responseTimeAvg} para responder perguntas` },
              ].map((badge, i) => (
                <Col xs={24} sm={12} key={i}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 8, background: '#1a1a1a', border: '1px solid #303030' }}>
                    <div style={{ fontSize: 24, color: badge.color, flexShrink: 0 }}>{badge.icon}</div>
                    <div>
                      <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{badge.label}</Text>
                      <br />
                      <Text style={{ color: '#808080', fontSize: 12 }}>{badge.desc}</Text>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>

      <Card styles={{ body: { padding: 20 } }} style={cardBg}>
        <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
          Comparativo
        </Title>
        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={14}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #252525' }}>
              <Text style={{ color: '#808080', fontSize: 12, flex: 1 }}>Métrica</Text>
              <Text style={{ color: '#a0a0a0', fontSize: 12, width: 80, textAlign: 'center' }}>6 meses</Text>
              <Text style={{ color: '#a0a0a0', fontSize: 12, width: 80, textAlign: 'center' }}>12 meses</Text>
            </div>
            {[
              { label: 'Vendas realizadas', six: repData.sixMonths.vendidas, twelve: repData.twelveMonths.vendidas },
              { label: 'Cancelamentos', six: repData.sixMonths.canceladas, twelve: repData.twelveMonths.canceladas },
              { label: 'Reclamações', six: repData.sixMonths.reclamacoes, twelve: repData.twelveMonths.reclamacoes },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < 2 ? '1px solid #252525' : 'none' }}>
                <Text style={{ color: '#c0c0c0', fontSize: 13, flex: 1 }}>{row.label}</Text>
                <Text style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600, width: 80, textAlign: 'center' }}>{row.six}</Text>
                <Text style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600, width: 80, textAlign: 'center' }}>{row.twelve}</Text>
              </div>
            ))}
          </Col>
          <Col xs={24} md={10}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 4, height: 24 }}>
                {levelOrder.map(key => {
                  const lc = levelConfig[key];
                  const active = repData.levelId === key;
                  return (
                    <div key={key} style={{
                      flex: 1, borderRadius: 4,
                      background: active ? lc.color : '#252525',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 11, color: active ? '#fff' : 'transparent',
                      transition: 'all .3s',
                    }}>
                      {active ? lc.label : ''}
                    </div>
                  );
                })}
              </div>
              <Text style={{ color: '#666', fontSize: 12, textAlign: 'center' }}>
                🔴 🟠 🟡 💚 🟢 — Seu nível: {lvl.label}
              </Text>
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  );
}
