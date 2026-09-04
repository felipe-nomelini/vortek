'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Skeleton,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  ExportOutlined,
  ReloadOutlined,
  SafetyCertificateFilled,
  ShopOutlined,
  TrophyFilled,
  WarningFilled,
} from '@ant-design/icons';
import {
  classifyReputationMetric,
  type ReputationBand,
  type ReputationMetric,
  type ReputationMetricKey,
  type ReputationMetricThresholds,
  type ReputationLevelId,
  type SellerReputationResponse,
} from '@/lib/ml/seller-reputation';
import styles from './reputacao.module.css';

const { Text, Title } = Typography;

const LEVELS: Array<{
  key: ReputationLevelId;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  { key: '1_red', label: 'Reputação vermelha', shortLabel: 'Vermelho', color: '#ff4d4f' },
  { key: '2_orange', label: 'Reputação laranja', shortLabel: 'Laranja', color: '#fa8c16' },
  { key: '3_yellow', label: 'Reputação amarela', shortLabel: 'Amarelo', color: '#f5c400' },
  { key: '4_light_green', label: 'Reputação verde-clara', shortLabel: 'Verde-claro', color: '#73d13d' },
  { key: '5_green', label: 'Reputação verde', shortLabel: 'Verde', color: '#38b000' },
];

const POWER_SELLER_LABELS: Record<string, string> = {
  silver: 'Mercado Líder',
  gold: 'Mercado Líder Gold',
  platinum: 'Mercado Líder Platinum',
};

const BAND_META: Record<ReputationBand, { label: string; color: string; weight: number }> = {
  leaders: { label: 'Meta Mercado Líder', color: '#ffd54a', weight: 0 },
  green: { label: 'Faixa verde', color: '#38b000', weight: 0 },
  yellow: { label: 'Faixa amarela', color: '#f5c400', weight: 1 },
  orange: { label: 'Faixa laranja', color: '#fa8c16', weight: 2 },
  red: { label: 'Faixa vermelha', color: '#ff4d4f', weight: 3 },
  unknown: { label: 'Sem classificação', color: '#8c8c8c', weight: 0 },
};

const METRIC_CONFIG: Record<ReputationMetricKey, {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}> = {
  claims: {
    title: 'Reclamações',
    description: 'Vendas com reclamação iniciada pelo comprador.',
    actionLabel: 'Ver reclamações',
    actionHref: '/reclamacoes',
  },
  delayed_handling_time: {
    title: 'Despachos atrasados',
    description: 'Vendas despachadas depois do prazo considerado pelo Mercado Livre.',
    actionLabel: 'Ver pedidos',
    actionHref: '/pedidos',
  },
  cancellations: {
    title: 'Cancelamentos',
    description: 'Cancelamentos feitos pelo vendedor sem reclamação associada.',
    actionLabel: 'Ver pedidos',
    actionHref: '/pedidos',
  },
};

function formatPercent(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR');
}

function formatRating(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatPercent(value * 100, 1);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatPeriod(value: string | null | undefined) {
  if (!value) return 'Não informado';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'historic') return 'Histórico';
  if (normalized === '60 days') return '60 dias';
  if (normalized === '365 days') return '365 dias';
  return value;
}

function normalizeLevel(level: ReputationLevelId | null | undefined) {
  return level === '4_light_blue' ? '4_light_green' : level;
}

function currentLevel(level: ReputationLevelId | null | undefined) {
  const normalized = normalizeLevel(level);
  return LEVELS.find((item) => item.key === normalized) || null;
}

function MetricScale({
  activeBand,
  thresholds,
}: {
  activeBand: ReputationBand;
  thresholds: ReputationMetricThresholds;
}) {
  const segments: Array<{ key: Exclude<ReputationBand, 'unknown'>; label: string; limit: string }> = [
    { key: 'leaders', label: 'Líder', limit: `≤ ${formatPercent(thresholds.leaders, 1)}` },
    { key: 'green', label: 'Verde', limit: `≤ ${formatPercent(thresholds.green, 1)}` },
    { key: 'yellow', label: 'Amarelo', limit: `≤ ${formatPercent(thresholds.yellow, 1)}` },
    { key: 'orange', label: 'Laranja', limit: `≤ ${formatPercent(thresholds.orange, 1)}` },
    { key: 'red', label: 'Vermelho', limit: `> ${formatPercent(thresholds.orange, 1)}` },
  ];

  return (
    <div className={styles.metricScale} aria-label={`Classificação atual: ${BAND_META[activeBand].label}`}>
      {segments.map((segment) => (
        <div
          className={`${styles.scaleSegment} ${activeBand === segment.key ? styles.scaleSegmentActive : ''}`}
          key={segment.key}
          style={{ '--segment-color': BAND_META[segment.key].color } as React.CSSProperties}
        >
          <span>{segment.label}</span>
          <small>{segment.limit}</small>
        </div>
      ))}
    </div>
  );
}

function MetricPanel({
  metricKey,
  metric,
  thresholds,
}: {
  metricKey: ReputationMetricKey;
  metric: ReputationMetric;
  thresholds: ReputationMetricThresholds | null;
}) {
  const config = METRIC_CONFIG[metricKey];
  const band = classifyReputationMetric(metric.percent, thresholds);
  const bandMeta = BAND_META[band];

  return (
    <article className={styles.metricPanel}>
      <div className={styles.metricHeading}>
        <div>
          <h3>{config.title}</h3>
          <p>{config.description}</p>
        </div>
        <Tag
          bordered={false}
          className={styles.bandTag}
          style={{ color: bandMeta.color, background: `${bandMeta.color}18` }}
        >
          {bandMeta.label}
        </Tag>
      </div>

      <div className={styles.metricValueRow}>
        <strong style={{ color: bandMeta.color }}>{formatPercent(metric.percent)}</strong>
        <span>{formatNumber(metric.value)} ocorrências</span>
        <span>Período: {formatPeriod(metric.period)}</span>
      </div>

      {thresholds ? (
        <MetricScale activeBand={band} thresholds={thresholds} />
      ) : (
        <div className={styles.noThreshold}>
          Limites não exibidos porque a conta não pertence ao site brasileiro MLB.
        </div>
      )}

      {metric.excluded && (
        <div className={styles.protectedMetric}>
          <SafetyCertificateFilled />
          <span>
            Durante a proteção, o ML informa o resultado real como {formatPercent(metric.excluded.real_percent)}
            {' '}({formatNumber(metric.excluded.real_value)} ocorrências).
          </span>
        </div>
      )}
    </article>
  );
}

function PageHeader({
  data,
  refreshing,
  onRefresh,
}: {
  data: SellerReputationResponse | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <span className={styles.eyebrow}>Mercado Livre</span>
        <Title level={2}>Reputação</Title>
        <Text>Entenda como a operação está sendo avaliada e o que merece atenção.</Text>
      </div>
      <div className={styles.headerActions}>
        {data?.user?.permalink && (
          <Button href={data.user.permalink} target="_blank" icon={<ExportOutlined />}>
            Ver perfil no ML
          </Button>
        )}
        <Button type="primary" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
          Atualizar
        </Button>
      </div>
    </header>
  );
}

export default function ReputacaoPage() {
  const [data, setData] = useState<SellerReputationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const response = await fetch('/api/ml/reputacao', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.erro || payload?.error || 'Falha ao carregar reputação do Mercado Livre.');
      }
      setData(payload as SellerReputationResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar reputação do Mercado Livre.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const metricEntries = useMemo(() => {
    if (!data?.metrics) return [];
    return (Object.keys(METRIC_CONFIG) as ReputationMetricKey[]).map((key) => {
      const metric = data.metrics?.[key] as ReputationMetric;
      const thresholds = data.thresholds?.metrics[key] || null;
      const band = classifyReputationMetric(metric.percent, thresholds);
      return { key, metric, thresholds, band, weight: BAND_META[band].weight };
    });
  }, [data]);

  const attentionItems = useMemo(
    () => metricEntries.filter((item) => item.weight > 0).sort((left, right) => right.weight - left.weight),
    [metricEntries],
  );

  const reputation = data?.seller_reputation;
  const level = currentLevel(reputation?.level_id);
  const realLevel = currentLevel(reputation?.real_level);
  const powerSeller = reputation?.power_seller_status
    ? POWER_SELLER_LABELS[reputation.power_seller_status] || reputation.power_seller_status
    : null;
  const transactions = data?.transactions;
  const ratings = transactions?.ratings;
  const hasSalesForReputation = (data?.metrics?.sales_completed || 0) > 0;

  if (loading) {
    return (
      <div className={styles.page}>
        <PageHeader data={null} refreshing={false} onRefresh={() => undefined} />
        <div className={styles.loadingSurface}><Skeleton active paragraph={{ rows: 9 }} /></div>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className={styles.page}>
        <PageHeader data={null} refreshing={refreshing} onRefresh={() => void load()} />
        <Alert type="error" showIcon message="Reputação indisponível" description={error} />
      </div>
    );
  }

  if (!data?.conectado || data.precisaReconectar) {
    return (
      <div className={styles.page}>
        <PageHeader data={data} refreshing={refreshing} onRefresh={() => void load()} />
        <section className={styles.emptyState}>
          <ShopOutlined />
          <h2>Mercado Livre desconectado</h2>
          <p>Conecte novamente a conta para consultar a reputação do vendedor.</p>
          <Button type="primary" href="/api/integracao/ml/connect">Conectar Mercado Livre</Button>
        </section>
      </div>
    );
  }

  if (data.indisponivel || !data.seller_reputation || !data.metrics) {
    return (
      <div className={styles.page}>
        <PageHeader data={data} refreshing={refreshing} onRefresh={() => void load()} />
        <section className={styles.emptyState}>
          <ClockCircleOutlined />
          <h2>Reputação ainda não disponível</h2>
          <p>O Mercado Livre não retornou histórico suficiente para classificar esta conta.</p>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void load()}>Atualizar</Button>
        </section>
      </div>
    );
  }

  const activeReputation = data.seller_reputation;

  return (
    <div className={styles.page}>
      <PageHeader data={data} refreshing={refreshing} onRefresh={() => void load()} />

      {data.visual_review && (
        <Alert
          type="info"
          showIcon
          message="Amostra visual protegida de homologação"
          description={`Dados sintéticos baseados no contrato oficial do Mercado Livre. Expira em ${formatDateTime(data.visual_review.expires_at)}.`}
          className={styles.reviewAlert}
        />
      )}

      {error && (
        <Alert type="warning" showIcon message="A atualização falhou" description={error} closable />
      )}

      <section className={styles.reputationHero}>
        <div className={styles.heroIdentity}>
          <div className={styles.heroIcon} style={{ color: level?.color || '#8c8c8c' }}>
            <TrophyFilled />
          </div>
          <div>
            <span className={styles.heroKicker}>Nível atual</span>
            <h2>{level?.label || 'Sem reputação'}</h2>
            <p>{data.user?.nickname || 'Conta Mercado Livre'} · {data.user?.site_id || 'Site não informado'}</p>
            {powerSeller && <Tag color="gold" bordered={false}>{powerSeller}</Tag>}
          </div>
        </div>

        <div className={styles.thermometerBlock}>
          <div className={styles.thermometerHeader}>
            <span>Termômetro Mercado Livre</span>
            <small>Atualizado em {formatDateTime(data.updated_at)}</small>
          </div>
          <div className={styles.thermometer}>
            {LEVELS.map((item) => (
              <div
                key={item.key}
                className={`${styles.thermometerLevel} ${normalizeLevel(activeReputation.level_id) === item.key ? styles.thermometerLevelActive : ''}`}
                style={{ '--level-color': item.color } as React.CSSProperties}
              >
                <span>{item.shortLabel}</span>
              </div>
            ))}
          </div>
          <div className={styles.heroFacts}>
            <span><strong>{formatNumber(data.metrics.sales_completed)}</strong> vendas avaliadas</span>
            <span><strong>{formatPeriod(data.metrics.period)}</strong> de apuração</span>
          </div>
        </div>
      </section>

      {activeReputation.protection_end_date && (
        <Alert
          type="warning"
          showIcon
          icon={<SafetyCertificateFilled />}
          message="Conta em período de proteção"
          description={`Nível exibido: ${level?.shortLabel || '—'}. Nível real: ${realLevel?.shortLabel || 'não informado'}. Proteção até ${formatDate(activeReputation.protection_end_date)}.`}
          className={styles.protectionAlert}
        />
      )}

      <section className={styles.metricsSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Fatores determinantes</span>
            <h2>O que forma sua reputação</h2>
          </div>
          <p>Valor atual e limites oficiais do site {data.thresholds?.site_id || data.user?.site_id || 'não informado'}.</p>
        </div>

        <div className={styles.metricsGrid}>
          {metricEntries.map((entry) => (
            <MetricPanel
              key={entry.key}
              metricKey={entry.key}
              metric={entry.metric}
              thresholds={entry.thresholds}
            />
          ))}
        </div>
      </section>

      <section className={styles.lowerGrid}>
        <div className={styles.attentionPanel}>
          <div className={styles.sectionHeadingCompact}>
            <div>
              <span className={styles.eyebrow}>Prioridade operacional</span>
              <h2>O que exige atenção agora</h2>
            </div>
          </div>

          {!hasSalesForReputation ? (
            <div className={styles.attentionEmpty}>
              <ClockCircleOutlined />
              <div>
                <strong>Histórico insuficiente</strong>
                <p>A conta ainda não possui vendas avaliadas para gerar uma orientação.</p>
              </div>
            </div>
          ) : attentionItems.length === 0 ? (
            <div className={styles.attentionEmpty}>
              <CheckCircleFilled />
              <div>
                <strong>Nenhuma métrica em faixa de atenção</strong>
                <p>As três métricas estão nas faixas Líder ou Verde.</p>
              </div>
            </div>
          ) : (
            <div className={styles.attentionList}>
              {attentionItems.map((item) => {
                const config = METRIC_CONFIG[item.key];
                return (
                  <div className={styles.attentionItem} key={item.key}>
                    <WarningFilled style={{ color: BAND_META[item.band].color }} />
                    <div>
                      <strong>{config.title} em {BAND_META[item.band].label.toLowerCase()}</strong>
                      <p>Índice atual de {formatPercent(item.metric.percent)} no período de {formatPeriod(item.metric.period).toLowerCase()}.</p>
                    </div>
                    <Button href={config.actionHref}>{config.actionLabel}</Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.basePanel}>
          <div className={styles.sectionHeadingCompact}>
            <div>
              <span className={styles.eyebrow}>Base histórica</span>
              <h2>Transações e avaliações</h2>
            </div>
            <small>{formatPeriod(transactions?.period)}</small>
          </div>

          <div className={styles.transactionNumbers}>
            <div><span>Total</span><strong>{formatNumber(transactions?.total)}</strong></div>
            <div><span>Concluídas</span><strong>{formatNumber(transactions?.completed)}</strong></div>
            <div><span>Canceladas</span><strong>{formatNumber(transactions?.canceled)}</strong></div>
          </div>

          <div className={styles.ratings}>
            <div className={styles.ratingBar} aria-label="Distribuição das avaliações">
              <span className={styles.positiveRating} style={{ width: `${Math.max(0, (ratings?.positive || 0) * 100)}%` }} />
              <span className={styles.neutralRating} style={{ width: `${Math.max(0, (ratings?.neutral || 0) * 100)}%` }} />
              <span className={styles.negativeRating} style={{ width: `${Math.max(0, (ratings?.negative || 0) * 100)}%` }} />
            </div>
            <div className={styles.ratingLegend}>
              <span><i className={styles.positiveDot} />Positivas {formatRating(ratings?.positive)}</span>
              <span><i className={styles.neutralDot} />Neutras {formatRating(ratings?.neutral)}</span>
              <span><i className={styles.negativeDot} />Negativas {formatRating(ratings?.negative)}</span>
            </div>
          </div>
        </div>
      </section>

      <Collapse
        className={styles.explanation}
        items={[{
          key: 'calculo',
          label: 'Como o Mercado Livre calcula estas métricas?',
          children: (
            <div className={styles.explanationContent}>
              <p><strong>Reclamações:</strong> vendas com reclamação divididas pelas vendas totais consideradas.</p>
              <p><strong>Despachos atrasados:</strong> vendas enviadas fora do prazo divididas pelas vendas despachadas pelo Mercado Envios.</p>
              <p><strong>Cancelamentos:</strong> cancelamentos feitos pelo vendedor, sem reclamação, divididos pelas vendas totais.</p>
              <p>O próprio Mercado Livre define a janela de avaliação conforme o volume de vendas da conta.</p>
              <Button
                type="link"
                href="https://developers.mercadolivre.com.br/reputacao-de-vendedores"
                target="_blank"
                icon={<ExportOutlined />}
              >
                Consultar critérios oficiais
              </Button>
            </div>
          ),
        }]}
      />
    </div>
  );
}
