'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Typography } from 'antd';
import { warrantyCommandSchema, warrantyLabels, type WarrantyCommand, type WarrantyEvidence } from '@/lib/product-warranty';
import type { loadProductWarranty } from '@/services/product-warranty';

type State = Omit<Awaited<ReturnType<typeof loadProductWarranty>>, 'context'> & { canManage: boolean };
const legalUrl = 'https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html';
const kinds = [{ value: 'manufacturer', label: 'Fabricante' }, { value: 'supplier', label: 'Fornecedor' }, { value: 'legal', label: 'Legal — classificação documentada' }];
export default function ProductWarrantyControl({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const [state, setState] = useState<State | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [action, setAction] = useState<'review' | 'source' | 'revoke' | null>(null), [history, setHistory] = useState(false);
  const [saving, setSaving] = useState(false), [pending, setPending] = useState<WarrantyCommand | null>(null);
  const [form] = Form.useForm(); const generation = useRef(0);
  const kind = Form.useWatch('kind', form);
  const load = useCallback(async () => {
    const current = ++generation.current; setLoading(true);
    try { const r = await fetch(`/api/produtos/${productId}/warranty`, { cache: 'no-store' }); const data = await r.json();
      if (!r.ok) throw Error('Não foi possível consultar a garantia.');
      if (current === generation.current) { setState(data); setError(''); }
    } catch { if (current === generation.current) setError('Garantia indisponível. Consulte novamente.'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [productId]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { if (!disabled) void load(); return invalidate; }, [disabled, load, invalidate]);
  async function submit(command: WarrantyCommand) {
    setSaving(true); setPending(command); setError('');
    try {
      const r = await fetch(`/api/produtos/${productId}/warranty`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      const data = await r.json(); if (!r.ok) throw Error(data.error || 'Não foi possível concluir');
      setState(data); setAction(null); setPending(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Resultado desconhecido'); }
    finally { setSaving(false); }
  }
  function open(next: 'review' | 'source' | 'revoke') {
    form.resetFields(); setPending(null); setAction(next);
    form.setFieldsValue({ kind: 'manufacturer', unit: 'meses', state: 'approved', brazil: false, coversKit: false });
  }
  async function save() {
    if (pending) { await submit(pending); return; }
    if (!state || !action) return;
    const v = await form.validateFields();
    const common = { action, commandId: crypto.randomUUID(), fingerprint: state.fingerprint, reason: v.reason };
    let raw: unknown = common;
    if (action === 'source') raw = { ...common, kind: v.kind, url: v.url, state: v.state };
    if (action === 'review') {
      const evidence: WarrantyEvidence = { kind: v.kind, duration: v.kind === 'legal' ? (v.classification === 'durable' ? 90 : 30) : v.duration,
        unit: v.kind === 'legal' ? 'dias' : v.unit, url: v.kind === 'legal' ? legalUrl : v.url, excerpt: v.excerpt, identity: v.identity,
        classification: v.kind === 'legal' ? v.classification : null, brazil: v.brazil, coversKit: v.coversKit };
      raw = { ...common, evidence };
    }
    const parsed = warrantyCommandSchema.safeParse(raw);
    if (!parsed.success) { setError('Confira fonte HTTPS pública, trecho, identificação, prazo e motivo.'); return; }
    await submit(parsed.data);
  }
  if (disabled) return <Space direction="vertical" style={{ width: '100%', marginTop: 24 }}>
    <Typography.Title level={5} style={{ margin: 0 }}>Garantia</Typography.Title>
    <Alert type="info" showIcon message="Amostra protegida ou edição em andamento" description="Pesquisa e decisões estão desabilitadas. Nenhum prazo deste exemplo é evidência para o produto." />
    <WarrantyExamples />
  </Space>;
  return <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 24 }}>
    <Typography.Title level={5} style={{ margin: 0 }}>Garantia</Typography.Title>
    <Typography.Text type="secondary">Comprovação por produto. Nenhuma pesquisa ou revisão altera anúncios existentes.</Typography.Text>
    {error && <Alert type="warning" showIcon message={error} action={<Button onClick={() => void load()}>Consultar novamente</Button>} />}
    {loading && <Spin size="small" />}
    {state && <>
      <Typography.Text strong>{warrantyLabels[state.resolution.status]}</Typography.Text>
      <Typography.Text>{state.resolution.reason}</Typography.Text>
      {state.researchWarning && <Alert type="warning" showIcon message={state.researchWarning} />}
      {!state.researchAvailable && <Alert type="info" message="Pesquisa indisponível" description={`${state.researchUnavailableReason || 'Configuração de pesquisa indisponível.'} A revisão documentada permanece disponível.`} />}
      {state.researchProvider === 'codex' && <Typography.Text type="secondary">Extração: ChatGPT/Codex · piloto individual local. Coleta: Firecrawl.</Typography.Text>}
      {state.resolution.candidates.map((e, i) => <div key={`${e.url}-${i}`} style={{ borderLeft: '3px solid var(--bentevi-primary)', paddingLeft: 12 }}>
        <Space direction="vertical" size={4}>
          <Typography.Text strong>{kinds.find(k => k.value === e.kind)?.label} · {e.duration} {e.unit}</Typography.Text>
          <Typography.Text>{e.identity}</Typography.Text>
          <Typography.Text type="secondary">{e.excerpt}</Typography.Text>
          {e.url.startsWith('vortek:offer:') ? <Typography.Text copyable type="secondary">{e.url}</Typography.Text> : <Typography.Link href={e.url} target="_blank" rel="noopener noreferrer">Consultar fonte</Typography.Link>}
          <Typography.Text type="secondary">Coleta: {new Date(e.collectedAt).toLocaleString('pt-BR')} · {e.reviewed ? 'Revisada' : 'Pesquisa automática'}</Typography.Text>
        </Space>
      </div>)}
      {!state.resolution.candidates.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma evidência aplicável registrada" />}
      <Space wrap>
        {state.canManage && <><Button loading={saving} disabled={!state.researchAvailable || saving} onClick={() => void submit({ action: 'research', commandId: crypto.randomUUID(), fingerprint: state.fingerprint, reason: 'Pesquisa solicitada no produto' })}>Pesquisar garantia</Button>
          <Button disabled={saving} onClick={() => open('review')}>Revisar evidência</Button><Button disabled={saving} onClick={() => open('source')}>Validar fonte oficial</Button>
          <Button disabled={saving || !state.currentId} onClick={() => open('revoke')}>Revogar evidência</Button></>}
        <Button onClick={() => setHistory(true)}>Ver histórico</Button>
      </Space>
      <Typography.Text type="secondary">Garantia legal e contratual são distintas. Os prazos não extinguem todos os direitos do consumidor.</Typography.Text>
    </>}
    <Modal title={action === 'source' ? 'Validar domínio oficial' : action === 'revoke' ? 'Revogar evidência' : 'Revisar garantia do produto'} open={!!action} destroyOnHidden confirmLoading={saving}
      onCancel={() => { if (!saving) { setAction(null); setPending(null); } }} onOk={() => void save()} okText={pending ? 'Reenviar mesmo comando' : 'Registrar decisão'}>
      <Form form={form} layout="vertical" disabled={saving || !!pending}>
        {action !== 'revoke' && <>
          <Form.Item name="kind" label={action === 'source' ? 'Domínio pertence a' : 'Quem concede a garantia'} rules={[{ required: true }]}><Select options={action === 'source' ? kinds.slice(0, 2) : kinds} /></Form.Item>
          {(action === 'source' || kind !== 'legal') && <Form.Item name="url" label={action === 'source' ? 'URL oficial pública (sem parâmetros)' : 'URL oficial ou referência da oferta exibida acima'} rules={[{ required: true }]}><Input /></Form.Item>}
        </>}
        {action === 'source' && <><Alert type="info" message="Aprovar domínio não aprova prazos" description="Confirme que o site pertence à marca deste produto ou ao fornecedor da oferta preferencial. A decisão será reutilizada somente para essa identidade." />
          <Space direction="vertical" style={{ marginBlock: 12 }}>{state?.sources.map(source => <Typography.Text key={source.id}>{source.host} · {source.scope.startsWith('manufacturer:') ? 'Fabricante' : 'Fornecedor'} · {source.state === 'approved' ? 'Aprovado' : 'Revogado'} — {source.reason}</Typography.Text>)}</Space>
          <Form.Item name="state" label="Decisão" rules={[{ required: true }]}><Select options={[{ value: 'approved', label: 'Aprovar domínio' }, { value: 'revoked', label: 'Revogar domínio' }]} /></Form.Item></>}
        {action === 'review' && <>
          {kind === 'legal' ? <Form.Item name="classification" label="Classificação documentada" rules={[{ required: true }]}><Select options={[{ value: 'durable', label: 'Durável — 90 dias' }, { value: 'non_durable', label: 'Não durável — 30 dias' }]} /></Form.Item>
            : <Space align="start"><Form.Item name="duration" label="Prazo comprovado" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item><Form.Item name="unit" label="Unidade" rules={[{ required: true }]}><Select style={{ width: 120 }} options={['dias','meses','anos'].map(value => ({ value, label: value }))} /></Form.Item></Space>}
          <Form.Item name="identity" label="Produto/modelo/GTIN comprovado" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="excerpt" label="Trecho que comprova garantia e prazo (ou classificação legal)" rules={[{ required: true }]}><Input.TextArea rows={3} maxLength={3000} /></Form.Item>
          <Form.Item name="brazil" valuePropName="checked"><Checkbox>Aplicação ao produto vendido no Brasil comprovada</Checkbox></Form.Item>
          <Form.Item name="coversKit" valuePropName="checked"><Checkbox>A evidência cobre o conjunto completo, caso seja um kit</Checkbox></Form.Item>
          <Alert type="info" message="Revisão substitui a avaliação atual, preservando o histórico" description="Explique no motivo como eventuais fontes divergentes foram resolvidas. Não cadastre um prazo apenas para preencher o anúncio." />
        </>}
        <Form.Item name="reason" label="Motivo e comprovação da decisão" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={200} showCount /></Form.Item>
      </Form>
    </Modal>
    <Modal title="Histórico da garantia — últimas 50 decisões" open={history} onCancel={() => setHistory(false)} footer={null}>
      <Space direction="vertical">{state?.history.map(row => <div key={row.id}><Typography.Text strong>{({ research: 'Pesquisa', review: 'Revisão', source: 'Fonte oficial', revoke: 'Revogação' } as Record<string,string>)[row.action]}</Typography.Text><br />{row.reason}<br /><Typography.Text type="secondary">{new Date(row.createdAt).toLocaleString('pt-BR')} · {row.actorName} · {row.state}</Typography.Text></div>)}</Space>
    </Modal>
  </Space>;
}
function WarrantyExamples() {
  const [example, setExample] = useState('comprovada');
  return <><Select aria-label="Exemplo visual de garantia" value={example} onChange={setExample} options={Object.entries(warrantyLabels).map(([value,label]) => ({ value, label }))} />
    <Typography.Text strong>Demonstração visual: {warrantyLabels[example as keyof typeof warrantyLabels]}</Typography.Text>
    <Typography.Text>{({ comprovada: 'Fabricante · 6 meses · fonte e trecho do manual aparecerão aqui.', legal: 'Produto durável documentado · 90 dias · direitos legais preservados.', pendente_validacao: 'Domínio ainda não aprovado ou cobertura do produto não comprovada.', conflito: 'Duas fontes apresentam prazos diferentes. Revisão necessária.', inconclusiva: 'Pesquisa indisponível ou sem evidência suficiente.' } as Record<string,string>)[example]}</Typography.Text></>;
}
