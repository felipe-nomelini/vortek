'use client';

import { userSafeMessage } from '@/lib/user-feedback';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Typography, theme } from 'antd';
import type { ProductPricing } from '@/services/pricing-context';
import type { EconomicIssue, EconomicMemory } from '@/types/pricing';
import { formatCurrency } from '@/lib/format';
import type { CompetitiveAssessment } from '@/services/pricing-competition';
import type { PricingListingValidation } from '@/services/pricing-detail';

const competitiveLabels: Record<CompetitiveAssessment['classification'], string> = {
  VIAVEL_NO_ALVO: 'Referência competitiva atende ao alvo', VIAVEL_ACIMA_DO_PISO: 'Referência competitiva atende ao piso',
  ABAIXO_DO_PISO_MAS_POSITIVO: 'Resultado positivo, mas abaixo do piso — revisar',
  EQUILIBRIO_SEM_MARGEM: 'Equilíbrio sem margem operacional — revisar',
  PREJUIZO_NO_PRECO_COMPETITIVO: 'Prejuízo projetado no preço competitivo', INCONCLUSIVO: 'Avaliação competitiva inconclusiva',
};

export function CompetitivePricingSummary({ assessment, pricing: sourcePricing }: {
  assessment?: CompetitiveAssessment | null;
  pricing?: ProductPricing | null;
}) {
  if (!assessment) return null;
  const pricing: ProductPricing | null = sourcePricing || (assessment.references ? { ...assessment.references,
    current: assessment.current ?? { status: 'inconclusive', memory: null, reasons: [] },
    costCents: assessment.current?.memory?.cost.amountCents ?? null,
    currentPriceCents: assessment.current?.memory?.revenueCents ?? null,
    comparisons: assessment.competitive ? { competitive: assessment.competitive } : {},
    revalidation: { status: assessment.classification === 'INCONCLUSIVO' ? 'inconclusive' : 'queried',
      evaluatedAt: assessment.current?.memory?.evaluatedAt || assessment.evidence.observedAt, contextKey: assessment.current?.memory?.context.marketContextKey || '' },
  } : null);
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert showIcon type={assessment.classification === 'INCONCLUSIVO' ? 'warning'
      : assessment.buyBoxConflict ? 'warning' : 'info'} message={competitiveLabels[assessment.classification]}
      description={assessment.clearanceApplied ? 'Liquidação autorizada neste cenário interno; o impacto continua visível. Nenhuma alteração executada.'
        : 'Referência do Mercado Livre, não ordem de desconto nem garantia de vencer. Nenhum preço será aplicado nesta etapa.'} />
    <Typography.Text>Referência competitiva: {assessment.evidence.priceCents == null ? 'Não informada' : money(assessment.evidence.priceCents)} · Fonte: {assessment.evidence.condition === 'valid' ? 'Mercado Livre' : 'Consulta indisponível'}</Typography.Text>
    <Typography.Text type="secondary">Vínculo dos anúncios: {assessment.group ? 'confirmado' : 'pendente'} · Proteção manual: {assessment.overrideActive === null ? 'não verificada' : assessment.overrideActive ? 'ativa' : 'inativa'}</Typography.Text>
    {assessment.reasons.includes('GRUPO_REQUER_VALIDACAO') && <Typography.Text type="warning">Grupo precisa de validação. Economia favorável não libera publicação.</Typography.Text>}
    {pricing && <PricingQuoteSummary pricing={pricing} currentLabel="Preço atual" showContextAlert={false} />}
  </Space>;
}

const explanations: Partial<Record<EconomicIssue['code'], string>> = {
  INCONCLUSIVO_FONTE_ML_INDISPONIVEL: 'O Mercado Livre não forneceu uma cotação suficiente. Nenhuma decisão comercial foi executada.',
  CONTEXTO_ALTERADO: 'Produto, oferta, configuração ou anúncio mudou durante a consulta. Consulte novamente.',
  PRODUTO_LOCAL_ALTERADO: 'Produto, oferta ou configuração comercial mudou durante a consulta. Consulte novamente.',
  ANUNCIO_REMOTO_ALTERADO: 'O anúncio mudou no Mercado Livre durante a consulta. Consulte novamente.',
  CONTA_ML_DIVERGENTE: 'A conta conectada não corresponde ao anúncio consultado.',
  IDENTIDADE_ANUNCIO_PENDENTE: 'SKU e identidade comercial do anúncio ainda não foram comprovados.',
  ANUNCIO_INELEGIVEL: 'O estado atual do anúncio não permite alteração de preço.',
  GRUPO_ALTERADO: 'A composição do grupo de anúncios mudou durante a consulta.',
  CONCORRENCIA_ALTERADA: 'A referência competitiva mudou durante a consulta. Consulte novamente.',
  PRECIFICACAO_NAO_CONVERGIU: 'Preço e cotação não estabilizaram. É necessária uma análise antes de decidir.',
  COTACAO_INCOMPATIVEL: 'A cotação não comprova este cenário de preço e logística.',
  OFERTA_INELEGIVEL: 'Não há oferta elegível para calcular este preço.',
  PGDAS_NAO_COMPROVADO: 'A comprovação fiscal necessária está pendente.',
  DADO_AUSENTE: 'Há dados econômicos ainda não informados.',
};
const money = (cents: number | null) => formatCurrency(cents === null ? null : cents / 100);
const percent = (value: number) => `${(value * 100).toFixed(2).replace('.', ',')}%`;

const validationReasonLabels: Record<string, string> = {
  ANUNCIO_INELEGIVEL: 'O estado atual do anúncio não permite operação.',
  COMPOSICAO_DO_KIT_NAO_COMPROVADA: 'A composição local do kit não pôde ser comprovada.',
  KIT_HETEROGENEO_NAO_E_VALIDADO_AUTOMATICAMENTE: 'O kit tem componentes diferentes e exige validação manual.',
  COMPONENTE_DO_KIT_ANINHADO_OU_NAO_COMPROVADO: 'O componente do kit é outro kit ou não pôde ser comprovado.',
  SKU_NAO_COHERENTE: 'O SKU local não coincide com o anúncio.',
  MARCA_NAO_COHERENTE: 'A marca local não coincide com o anúncio.',
  MARCAS_LOCAIS_CONTRADITORIAS: 'A marca do produto e a do componente são contraditórias.',
  FORMATO_DE_VENDA_DO_KIT_NAO_COMPROVADO: 'O Mercado Livre não confirmou o formato de venda como kit.',
  QUANTIDADE_DO_KIT_DIVERGENTE: 'A quantidade do kit diverge entre a composição local e o Mercado Livre.',
  NUMERO_DE_PACKS_DIVERGENTE: 'O número de packs informado no Mercado Livre é incompatível.',
  GTIN_DO_COMPONENTE_DIVERGENTE: 'O GTIN do componente diverge do anúncio.',
  IDENTIFICADOR_DO_COMPONENTE_NAO_COINCIDE: 'GTIN, modelo ou código do componente ainda não coincidem com o anúncio.',
  CONFLITO_COMERCIAL_CONFIRMADO: 'Foi encontrada uma divergência comercial confirmada.',
  FONTE_DE_IDENTIDADE_INDISPONIVEL: 'A fonte necessária para validar a identidade está indisponível.',
  VALIDACAO_DE_IDENTIDADE_NAO_EXECUTADA: 'A validação de identidade não pôde ser concluída nesta consulta.',
};
const validationFieldLabels: Record<string, string> = {
  SELLER_SKU: 'SKU', GTIN: 'GTIN', BRAND: 'Marca', MODEL: 'Modelo', MPN: 'MPN', PART_NUMBER: 'Código da peça',
  SALE_FORMAT: 'Formato de venda', UNITS_PER_PACK: 'Unidades por kit', PACKS_NUMBER: 'Número de packs',
  PACKAGES_NUMBER: 'Volumes', PACKAGING_BOXES_NUMBER: 'Caixas', COMPONENT_GTIN: 'GTIN do componente',
  COMPONENT_MODEL: 'Modelo do componente', COMPONENT_MPN: 'MPN do componente', COMPONENT_PART_NUMBER: 'Código do componente',
};

export function ListingValidationNotice({ validation }: { validation?: PricingListingValidation | null }) {
  if (!validation || validation.state === 'verified') return null;
  const comparisons = validation.items.flatMap(item => item.comparisons)
    .filter(comparison => comparison.status !== 'SEM_CONFLITO');
  const uniqueComparisons = [...new Map(comparisons.map(comparison => [
    `${comparison.field}:${comparison.local}:${comparison.remote}:${comparison.reason}`, comparison,
  ])).values()];
  const reasons = [...new Set(validation.reasons.map(reason => validationReasonLabels[reason]
    || (reason.includes(':') ? `${validationFieldLabels[reason.split(':')[0]] || reason.split(':')[0]} ainda não foi comprovado.` : reason)))];
  return <Alert showIcon type={validation.state === 'conflict' ? 'error' : 'warning'}
    message={validation.state === 'conflict' ? 'Identidade comercial divergente' : validation.state === 'ineligible' ? 'Anúncio sem operação disponível' : 'Identidade comercial pendente'}
    description={<Space direction="vertical" size={4}>
      <span>Preço observado, referência competitiva e CMV conhecido permanecem visíveis. Margens, preços de referência e proposta ficam bloqueados até a validação.</span>
      {reasons.map(reason => <span key={reason}>• {reason}</span>)}
      {uniqueComparisons.slice(0, 8).map(comparison => <span key={`${comparison.field}:${comparison.reason}`}>
        {validationFieldLabels[comparison.field] || comparison.field}: Bentevi {comparison.local || 'não informado'} · Mercado Livre {comparison.remote || 'não informado'}
      </span>)}
    </Space>} />;
}

/** Apresentação apenas: cada linha usa sua própria memória, sem fórmula no browser. */
export function PricingQuoteSummary({ pricing, currentLabel = 'Preço consultado', showContextAlert = true, presentation = 'live' }: {
  pricing?: ProductPricing | null; currentLabel?: string; showContextAlert?: boolean; presentation?: 'live' | 'simulation';
}) {
  const { token } = theme.useToken();
  if (!pricing) return null;
  const rows: Array<{ key: string; label: string; priceCents: number | null; memory: EconomicMemory | null; issues: string }> = [];
  const explain = (issues: readonly EconomicIssue[]) => issues.map(issue => explanations[issue.code] || 'Falta uma informação para concluir o cálculo.').join(' ');
  if (pricing.currentPriceCents !== null) rows.push({ key: 'current', label: currentLabel,
    priceCents: pricing.currentPriceCents, memory: pricing.current.memory,
    issues: pricing.current.status === 'inconclusive' ? explain(pricing.current.reasons) : '' });
  const competitive = pricing.comparisons?.competitive;
  if (competitive) rows.push({ key: 'competitive', label: 'Referência competitiva', priceCents: competitive.memory?.revenueCents ?? null, memory: competitive.memory,
    issues: competitive.status === 'inconclusive' ? explain(competitive.reasons) : '' });
  for (const [key, label] of [['target', 'Alvo'], ['floor', 'Piso'], ['breakEven', 'Equilíbrio']] as const) {
    const result = pricing[key];
    rows.push({ key, label, priceCents: result.ok ? result.evaluation.memory.revenueCents : null,
      memory: result.ok ? result.evaluation.memory : null, issues: result.ok ? '' : explain(result.reasons) });
  }
  const queried = pricing.revalidation?.status === 'queried';
  const simulated = presentation === 'simulation';
  const evaluatedAt = simulated ? rows.find(row => row.memory)?.memory?.evaluatedAt : pricing.revalidation?.evaluatedAt;
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {showContextAlert && <Alert showIcon type={simulated || queried ? 'info' : 'warning'} message={simulated ? 'Simulação hipotética — sem consulta ao Mercado Livre' : queried ? 'Fontes consultadas no Mercado Livre' : 'Consulta econômica inconclusiva'}
      description={simulated ? 'Custo, taxa e frete são entradas do cenário. Tributo vem do contexto fiscal central. Nenhuma configuração ou preço foi gravado; esta simulação não libera publicação.'
        : pricing.revalidation?.code ? explanations[pricing.revalidation.code as EconomicIssue['code']] || pricing.revalidation.code
        : 'Esta consulta não autoriza uma alteração. O frete é estimado e pode ser diferente do valor final da venda. Alterações automáticas continuam bloqueadas.'} />}
    <Typography.Text type="secondary">CMV: {money(pricing.costCents)} · {simulated ? 'Simulação' : 'Consulta'}: {evaluatedAt ? new Date(evaluatedAt).toLocaleString('pt-BR') : 'ainda não realizada'}</Typography.Text>
    <Table size="small" pagination={false} dataSource={rows} rowKey="key" scroll={{ x: 810 }} onRow={() => ({ style: { color: token.colorText } })} columns={[
      { title: 'Referência', dataIndex: 'label', width: 130 },
      { title: 'Preço', key: 'price', render: (_, row) => money(row.memory?.revenueCents ?? row.priceCents) },
      { title: simulated ? 'Taxa ML simulada' : 'Tarifa ML total', key: 'fee', render: (_, row) => <span>{money(row.memory?.fee.amountCents ?? null)}<br /><small>{simulated && row.memory ? 'Taxa do cenário' : row.memory?.fee.source === 'ml_live' ? 'Mercado Livre · inclui tarifa fixa' : row.memory ? 'Estimativa do sistema' : '—'}</small></span> },
      { title: 'Frete estimado', key: 'shipping', render: (_, row) => <span>{money(row.memory?.shipping.amountCents ?? null)}<br /><small>{simulated && row.memory ? 'Frete do cenário' : row.memory?.shipping.source === 'ml_live' ? 'Mercado Livre' : row.memory ? 'Não configurado' : '—'}</small></span> },
      { title: 'Tributo', key: 'tax', render: (_, row) => <span>{money(row.memory?.tax.amountCents ?? null)}<br /><small>{row.memory ? row.memory.tax.status === 'confirmed' ? 'Confirmado' : 'Estimado' : '—'}{simulated && row.memory?.tax.context.appliedRate != null ? ` · ${percent(row.memory.tax.context.appliedRate)}` : ''}</small></span> },
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
    } catch (failure) { if (!controller.signal.aborted) setError(userSafeMessage(failure instanceof Error ? failure.message : '', 'Não foi possível calcular o preço. Revise os dados e tente novamente.')); }
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
            <Form.Item name="mode" label="Modalidade de envio" rules={[{ required: true }]}><Select onChange={() => form.setFieldValue('logisticType', undefined)} options={[{ value: 'me2', label: 'Mercado Envios' }, { value: 'not_specified', label: 'A combinar' }]} /></Form.Item>
            <Form.Item name="logisticType" label="Forma de envio" rules={[{ required: true }]}><Select options={(mode === 'not_specified' ? [{ value: 'not_specified', label: 'A combinar' }] : [{ value: 'drop_off', label: 'Postagem em agência' }, { value: 'xd_drop_off', label: 'Ponto de despacho' }, { value: 'cross_docking', label: 'Coleta do Mercado Livre' }, { value: 'fulfillment', label: 'Estoque Full' }, { value: 'self_service', label: 'Envios Flex' }])} /></Form.Item>
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
