'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Typography, theme } from 'antd';
import type { ProductPricing } from '@/services/pricing-context';
import type { EconomicIssue, EconomicMemory } from '@/types/pricing';
import { formatCurrency } from '@/lib/format';
import type { CompetitiveAssessment } from '@/services/pricing-competition';

const competitiveLabels: Record<CompetitiveAssessment['classification'], string> = {
  VIAVEL_NO_ALVO: 'Referência competitiva atende ao alvo', VIAVEL_ACIMA_DO_PISO: 'Referência competitiva atende ao piso',
  ABAIXO_DO_PISO_MAS_POSITIVO: 'Resultado positivo, mas abaixo do piso — revisar',
  EQUILIBRIO_SEM_MARGEM: 'Equilíbrio sem margem operacional — revisar',
  PREJUIZO_NO_PRECO_COMPETITIVO: 'Prejuízo projetado no preço competitivo', INCONCLUSIVO: 'Avaliação competitiva inconclusiva',
};

export function CompetitivePricingSummary({ assessment }: { assessment?: CompetitiveAssessment | null }) {
  if (!assessment) return null;
  const pricing: ProductPricing | null = assessment.references ? { ...assessment.references,
    current: assessment.current ?? { status: 'inconclusive', memory: null, reasons: [] },
    costCents: assessment.current?.memory?.cost.amountCents ?? null,
    currentPriceCents: assessment.current?.memory?.revenueCents ?? null,
    comparisons: assessment.competitive ? { competitive: assessment.competitive } : {},
    revalidation: { status: assessment.classification === 'INCONCLUSIVO' ? 'inconclusive' : 'queried',
      evaluatedAt: assessment.current?.memory?.evaluatedAt || assessment.evidence.observedAt, contextKey: assessment.current?.memory?.context.marketContextKey || '' },
  } : null;
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert showIcon type={assessment.classification === 'INCONCLUSIVO' ? 'warning'
      : assessment.buyBoxConflict ? 'warning' : 'info'} message={competitiveLabels[assessment.classification]}
      description={assessment.clearanceApplied ? 'Liquidação autorizada neste cenário interno; o impacto continua visível. Nenhuma alteração executada.'
        : 'Referência do Mercado Livre, não ordem de desconto nem garantia de vencer. Nenhum preço será aplicado nesta etapa.'} />
    <Typography.Text>Referência competitiva: {assessment.evidence.priceCents == null ? 'Não informada' : money(assessment.evidence.priceCents)} · Fonte: {assessment.evidence.condition === 'valid' ? 'ML consultado' : 'Sem evidência viva válida'}</Typography.Text>
    <Typography.Text type="secondary">Grupo: {assessment.group ? `${assessment.group.id} · versão ${assessment.group.version} · ${assessment.group.memberIds.join(', ')}` : 'Vínculo pendente'} · Override: {assessment.overrideActive === null ? 'não verificado' : assessment.overrideActive ? 'ativo' : 'não ativo'}</Typography.Text>
    {assessment.reasons.includes('GRUPO_REQUER_VALIDACAO') && <Typography.Text type="warning">Grupo precisa de validação. Economia favorável não libera publicação.</Typography.Text>}
    {pricing && <PricingQuoteSummary pricing={pricing} currentLabel="Preço atual" showContextAlert={false} />}
  </Space>;
}

const explanations: Partial<Record<EconomicIssue['code'], string>> = {
  INCONCLUSIVO_FONTE_ML_INDISPONIVEL: 'O Mercado Livre não forneceu uma cotação suficiente. Nenhuma decisão comercial foi executada.',
  CONTEXTO_ALTERADO: 'Produto, oferta, configuração ou anúncio mudou durante a consulta. Consulte novamente.',
  PRECIFICACAO_NAO_CONVERGIU: 'Preço e cotação não estabilizaram. É necessária uma análise antes de decidir.',
  COTACAO_INCOMPATIVEL: 'A cotação não comprova este cenário de preço e logística.',
  OFERTA_INELEGIVEL: 'Não há oferta elegível para calcular este preço.',
  PGDAS_NAO_COMPROVADO: 'A comprovação fiscal necessária está pendente.',
  DADO_AUSENTE: 'Há dados econômicos ainda não informados.',
};
const money = (cents: number | null) => formatCurrency(cents === null ? null : cents / 100);
const percent = (value: number) => `${(value * 100).toFixed(2).replace('.', ',')}%`;

/** Apresentação apenas: cada linha usa sua própria memória, sem fórmula no browser. */
export function PricingQuoteSummary({ pricing, currentLabel = 'Preço consultado', showContextAlert = true }: { pricing?: ProductPricing | null; currentLabel?: string; showContextAlert?: boolean }) {
  const { token } = theme.useToken();
  if (!pricing) return null;
  const rows: Array<{ key: string; label: string; memory: EconomicMemory | null; issues: string }> = [];
  const explain = (issues: readonly EconomicIssue[]) => issues.map(issue => explanations[issue.code] || issue.code).join(' ');
  if (pricing.currentPriceCents !== null) rows.push({ key: 'current', label: currentLabel,
    memory: pricing.current.memory, issues: pricing.current.status === 'inconclusive' ? explain(pricing.current.reasons) : '' });
  const competitive = pricing.comparisons?.competitive;
  if (competitive) rows.push({ key: 'competitive', label: 'Referência competitiva', memory: competitive.memory,
    issues: competitive.status === 'inconclusive' ? explain(competitive.reasons) : '' });
  for (const [key, label] of [['target', 'Alvo'], ['floor', 'Piso'], ['breakEven', 'Equilíbrio']] as const) {
    const result = pricing[key];
    rows.push({ key, label, memory: result.ok ? result.evaluation.memory : null, issues: result.ok ? '' : explain(result.reasons) });
  }
  const queried = pricing.revalidation?.status === 'queried';
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {showContextAlert && <Alert showIcon type={queried ? 'info' : 'warning'} message={queried ? 'Fontes consultadas no Mercado Livre' : 'Consulta econômica inconclusiva'}
      description={pricing.revalidation?.code ? explanations[pricing.revalidation.code as EconomicIssue['code']] || pricing.revalidation.code
        : 'Cotação sob demanda, não autorização para publicar. Frete é estimado; não é o custo realizado do shipment. Alterações automáticas continuam bloqueadas.'} />}
    <Typography.Text type="secondary">CMV: {money(pricing.costCents)} · Consulta: {pricing.revalidation ? new Date(pricing.revalidation.evaluatedAt).toLocaleString('pt-BR') : 'sem revalidação viva'}</Typography.Text>
    <Table size="small" pagination={false} dataSource={rows} rowKey="key" scroll={{ x: 810 }} onRow={() => ({ style: { color: token.colorText } })} columns={[
      { title: 'Referência', dataIndex: 'label', width: 130 },
      { title: 'Preço', key: 'price', render: (_, row) => money(row.memory?.revenueCents ?? null) },
      { title: 'Tarifa ML total', key: 'fee', render: (_, row) => <span>{money(row.memory?.fee.amountCents ?? null)}<br /><small>{row.memory?.fee.source === 'ml_live' ? 'ML vivo · inclui fixa' : row.memory ? 'Fallback estimado' : '—'}</small></span> },
      { title: 'Frete estimado', key: 'shipping', render: (_, row) => <span>{money(row.memory?.shipping.amountCents ?? null)}<br /><small>{row.memory?.shipping.source === 'ml_live' ? 'Cotação ML' : row.memory ? 'Configuração not_specified' : '—'}</small></span> },
      { title: 'Tributo', key: 'tax', render: (_, row) => <span>{money(row.memory?.tax.amountCents ?? null)}<br /><small>{row.memory ? row.memory.tax.status === 'confirmed' ? 'Confirmado' : 'Estimado' : '—'}</small></span> },
      { title: 'Resultado / margem', key: 'result', render: (_, row) => row.memory ? <Typography.Text type={row.memory.resultCents < 0 ? 'danger' : 'success'}>{money(row.memory.resultCents)}<br />{percent(row.memory.margin)}</Typography.Text> : '—' },
      { title: 'Piso / alvo / limite', key: 'band', render: (_, row) => row.memory ? `${percent(row.memory.band.floor)} / ${percent(row.memory.band.target)} / ${percent(row.memory.band.limit)}` : '—' },
    ]} />
    {rows.filter(row => row.issues).map(row => <Typography.Text key={row.key} type="warning">{row.label}: {row.issues}</Typography.Text>)}
    <Typography.Text type="secondary">O limite não é margem máxima. O piso orienta recuperação; o alvo é referência para preço novo. A consulta não reduz margem premium nem altera anúncios.</Typography.Text>
  </Space>;
}

type ContextValues = { categoryId: string; listingType: string; condition: string; mode: string; logisticType: string; freeShipping: 'yes' | 'no' };
type Values = ContextValues & { mlItemId?: string; price?: number };

export default function LivePricingQuote({ productId, listings, disabled }: {
  productId: string; listings: Array<{ itemId: string; type: string }>; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<ProductPricing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<Values>();
  const mode = Form.useWatch('mode', form);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const close = () => { pending.current?.abort(); pending.current = null; setLoading(false); setOpen(false); setPricing(null); setError(null); form.resetFields(); };
  const query = async (values: Values) => {
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(null); setPricing(null);
    try {
      const { mlItemId, price, ...context } = values;
      const response = await fetch('/api/ml/anuncio/preco-detalhe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', signal: controller.signal, body: JSON.stringify({ produtoId: productId,
          ...(listings.length ? { mlItemId } : { context: { ...context, freeShipping: context.freeShipping === 'yes' } }), ...(price != null ? { priceCents: Math.round(price * 100) } : {}) }) });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Consulta indisponível');
      if (!controller.signal.aborted) setPricing(payload.pricing);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Consulta indisponível'); }
    finally { if (pending.current === controller) { pending.current = null; setLoading(false); } }
  };
  return <>
    <Button onClick={() => setOpen(true)} disabled={disabled}>Consultar preço no ML</Button>
    <Modal title="Consulta econômica no Mercado Livre" open={open} onCancel={close} footer={null} width={1040} destroyOnHidden>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Typography.Text type="secondary">Consulta individual, sem salvar preço ou publicar anúncio. Para um novo anúncio, confirme o contexto de preparação; categoria e logística serão validadas no ML.</Typography.Text>
        <Form form={form} layout="vertical" preserve={false} disabled={loading} onFinish={query} validateMessages={{ required: 'Informe ${label}.' }} onValuesChange={() => { setPricing(null); setError(null); }}
          initialValues={listings.length === 1 ? { mlItemId: listings[0].itemId } : undefined}>
          {listings.length ? <Form.Item name="mlItemId" label="Anúncio a consultar" rules={[{ required: true }]}><Select options={listings.map(item => ({ value: item.itemId, label: `${item.itemId} · ${item.type === 'catalog' ? 'Catálogo' : 'Padrão'}` }))} /></Form.Item> : <>
            <Form.Item name="categoryId" label="Categoria ML (ID confirmado na preparação)" rules={[{ required: true, pattern: /^MLB\d+$/, message: 'Informe um ID de categoria MLB válido.' }]}><Input placeholder="MLB..." /></Form.Item>
            <Form.Item name="listingType" label="Tipo do anúncio" rules={[{ required: true }]}><Select options={[{ value: 'gold_special', label: 'Clássico' }, { value: 'gold_pro', label: 'Premium' }]} /></Form.Item>
            <Form.Item name="condition" label="Condição" rules={[{ required: true }]}><Select options={[{ value: 'new', label: 'Novo' }, { value: 'used', label: 'Usado' }, { value: 'not_specified', label: 'Não especificada' }]} /></Form.Item>
            <Form.Item name="mode" label="Modalidade de envio" rules={[{ required: true }]}><Select onChange={() => form.setFieldValue('logisticType', undefined)} options={[{ value: 'me2', label: 'Mercado Envios 2' }, { value: 'not_specified', label: 'A combinar (not_specified)' }]} /></Form.Item>
            <Form.Item name="logisticType" label="Logística habilitada na conta" rules={[{ required: true }]}><Select options={(mode === 'not_specified' ? ['not_specified'] : ['drop_off', 'xd_drop_off', 'cross_docking', 'fulfillment', 'self_service']).map(value => ({ value, label: value }))} /></Form.Item>
            <Form.Item name="freeShipping" label="Frete grátis ao comprador" rules={[{ required: true }]}><Select options={[{ value: 'yes', label: 'Sim' }, { value: 'no', label: 'Não' }]} /></Form.Item>
          </>}
          <Form.Item name="price" label="Preço para consultar (opcional)" extra="Sem informar, consulta o preço atual do anúncio e calcula alvo, piso e equilíbrio. Em produto novo, calcula somente as referências."><InputNumber min={0.01} precision={2} prefix="R$" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>Consultar fontes e calcular</Button>
        </Form>
        {error && <Alert type="warning" showIcon message={error} />}
        <PricingQuoteSummary pricing={pricing} />
      </Space>
    </Modal>
  </>;
}
