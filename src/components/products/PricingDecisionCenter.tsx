'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { BellOutlined, ReloadOutlined } from '@ant-design/icons';
import { CompetitivePricingSummary, PricingQuoteSummary } from './LivePricingQuote';
import type { ProductPricing } from '@/services/pricing-context';
import type { DecisionContext } from '@/services/pricing-decisions';
import type { CompetitiveAssessment } from '@/services/pricing-competition';

const labels: Record<string, string> = {
  open: 'Aberto',
  resolved: 'Resolvido',
  pending: 'Aguardando decisão',
  approved: 'Proposta aprovada',
  rejected: 'Rejeitado',
  deferred: 'Adiado',
  expired: 'Expirado',
  invalidated: 'Invalidado',
  alert_opened: 'Alerta aberto',
  alert_updated: 'Alerta atualizado',
  alert_resolved: 'Problema resolvido',
  alert_reopened: 'Problema reaberto',
  alert_merged: 'Vinculado ao grupo',
  decision_created: 'Proposta registrada',
  decision_approved: 'Proposta aprovada',
  decision_rejected: 'Proposta rejeitada',
  decision_deferred: 'Decisão adiada',
  decision_expired: 'Proposta expirada',
  decision_invalidated: 'Proposta invalidada',
  decision_consumed: 'Aprovação vinculada à operação',
  prepared: 'Na fila — ainda não enviado',
  requested: 'Enviado — aguardando conferência',
  confirmed: 'Aplicado e conferido no ML',
  inconclusive: 'Resultado inconclusivo — não reenviar',
  failed: 'Operação não concluída',
};
const date = (s?: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
const money = (c?: number | null) =>
  c == null ? 'Não calculado' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const blockerLabels: Record<string, string> = {
  GRUPO_NAO_CONFIRMADO: 'Vínculo/grupo ainda não confirmado',
  IDENTIDADE_OU_ELEGIBILIDADE_NAO_CONFIRMADA: 'Identidade ou elegibilidade do anúncio pendente',
  ECONOMIA_INCONCLUSIVA: 'Custo, tarifa, frete ou imposto inconclusivo',
  PRECO_JA_APLICADO: 'O preço consultado já é o preço atual',
  PRODUTO_LOCAL_ALTERADO: 'Produto ou oferta mudou durante a consulta',
  ANUNCIO_REMOTO_ALTERADO: 'Anúncio mudou durante a consulta',
  CONTA_ML_DIVERGENTE: 'Conta Mercado Livre divergente',
  IDENTIDADE_ANUNCIO_PENDENTE: 'SKU e identidade comercial pendentes',
  ANUNCIO_INELEGIVEL: 'Anúncio não elegível para alteração',
  GRUPO_ALTERADO: 'Composição do grupo mudou',
  CONCORRENCIA_ALTERADA: 'Referência competitiva mudou',
  INCONCLUSIVO_FONTE_ML_INDISPONIVEL: 'Fonte do Mercado Livre indisponível',
  CONTEXTO_ALTERADO: 'Os dados mudaram durante a consulta; atualize o diagnóstico novamente',
};
const severityLabels: Record<string, string> = {
  P0: 'Crítica', P1: 'Alta', P2: 'Atenção', INFO: 'Informativa',
};
type Decision = {
  id: string;
  evaluation_id: string;
  state: string;
  expires_at: string;
  deferred_until: string | null;
  context: DecisionContext;
  reason: string;
  created_at: string;
  operation_id: string | null;
};
type Row = {
  id: string;
  produto_id: string;
  title: string;
  reason: string;
  rule_id: string;
  severity: string;
  state: string;
  item_id: string | null;
  group_id: string | null;
  created_at: string;
  merged_into: string | null;
  product: { nome: string; sku: string };
  decisions: Decision[];
  issues?: Row[];
};
type Detail = {
  alert: Row;
  alerts: Row[];
  evaluation: { created_at: string; result: ProductPricing & {
    decisionContext?: DecisionContext;
    competitiveAssessment?: CompetitiveAssessment;
  } };
  history: Array<{ id: number; kind: string; actorName: string | null; reason: string; created_at: string }>;
  canManage: boolean;
  hasMore: boolean;
  executionBlocked: boolean;
  execution: {
    mode: 'disabled' | 'test_only' | 'production_controlled';
    enabled: boolean;
    target: 'test' | 'production' | null;
    allowedOperations: string[];
  };
};
const api = '/api/pricing/decisions';
async function read(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Central indisponível');
  return data;
}
function changed() {
  window.dispatchEvent(new Event('pricing-decisions-changed'));
}

export default function PricingDecisionCenter() {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'alerts' | 'decisions'>('alerts');
  const [state, setState] = useState('open');
  const [severity, setSeverity] = useState<string>();
  const [decisionFilter, setDecisionFilter] = useState<string>();
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const [command, setCommand] = useState<{
    decisionId: string;
    command: {
      commandId: string;
      action: 'approve' | 'reject' | 'defer';
      reason: string;
      deferredUntil?: string;
    };
  } | null>(null);
  const [action, setAction] = useState<'approve' | 'reject' | 'defer' | null>(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [executionConfirmationOpen, setExecutionConfirmationOpen] = useState(false);
  const executionCommand = useRef<{ decisionId: string; operationId: string } | null>(null);
  const [operation, setOperation] = useState<{ id: string; state: string } | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const list = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ state, search, page: String(page), view });
      if (severity) q.set('severity', severity);
      if (decisionFilter) q.set('decision', decisionFilter);
      const data = await read(`${api}?${q}`);
      if (request !== generation.current) return;
      setRows(data.data);
      setTotal(data.total);
      setCount(data.pendingCount);
    } catch (e) {
      if (request === generation.current) setError((e as Error).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [state, search, page, severity, decisionFilter, view]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void read(api)
        .then((d) => {
          if (live) setCount(d.pendingCount);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('pricing-decisions-changed', refresh);
    return () => {
      live = false;
      window.removeEventListener('pricing-decisions-changed', refresh);
    };
  }, []);
  useEffect(() => {
    if (open && !detail) void list();
  }, [open, detail, list]);
  async function show(id: string, p = 1, key: 'productId' | 'alertId' = 'productId') {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const d = await read(`${api}?${key}=${id}&page=${p}`);
      if (request === generation.current) {
        setDetail(d);
        setOperation(null);
        setExecutionConfirmationOpen(false);
        setHistoryPage(p);
        requestAnimationFrame(() => contentRef.current?.closest('.ant-drawer-body')?.scrollTo({ top: 0 }));
      }
    } catch (e) {
      if (request === generation.current) setError((e as Error).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  const current = detail?.alert.decisions
    ?.slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  useEffect(() => {
    const openProposal = (event: Event) => {
      const id = (event as CustomEvent<{ alertId?: string }>).detail?.alertId;
      if (!id) return;
      setOpen(true);
      void show(id, 1, 'alertId');
    };
    window.addEventListener('pricing-decision-open', openProposal);
    return () => window.removeEventListener('pricing-decision-open', openProposal);
  });
  async function checkOperation(id: string) {
    try { setOperation(await read(`${api}/execute?operationId=${encodeURIComponent(id)}`)); }
    catch (e) { message.error((e as Error).message); }
  }
  async function reanalyzeProduct() {
    if (!detail || reanalyzing) return;
    setReanalyzing(true);
    try {
      const result = await read(`${api}/reanalyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: detail.alert.produto_id, commandId: crypto.randomUUID() }) });
      if (result.state === 'completo') message.success('Diagnóstico atualizado. Nenhum preço foi alterado.');
      else message.info('A atualização foi enfileirada e será retomada automaticamente. Nenhum preço foi alterado.');
      changed();
      setDetail(null);
      await list();
    } catch (e) { message.error((e as Error).message); }
    finally { setReanalyzing(false); }
  }
  async function applyApproved() {
    if (!current || busy || detail?.executionBlocked) return false;
    if (executionCommand.current?.decisionId !== current.id)
      executionCommand.current = { decisionId: current.id, operationId: current.operation_id || crypto.randomUUID() };
    setBusy(true);
    try {
      const r = await read(`${api}/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(executionCommand.current) });
      message.info('Operação registrada na fila. O preço só será considerado aplicado após conferência no ML.');
      await show(detail!.alert.produto_id);
      await checkOperation(r.operationId);
      return true;
    } catch (e) { message.error((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  function requestApprovedExecution() {
    if (detail?.execution.target === 'production') setExecutionConfirmationOpen(true);
    else void applyApproved();
  }
  async function confirmProductionExecution() {
    if (await applyApproved()) setExecutionConfirmationOpen(false);
  }
  async function handleSubmit() {
    if (!current || !action || !reason.trim()) return;
    // The server owns the clock and checks that the requested date is future.
    if (action === 'defer' && (!until || !Number.isFinite(Date.parse(until)))) {
      message.error('Informe a data e a hora para rever a decisão');
      return;
    }
    const payload = command ?? {
      decisionId: current.id,
      command: {
        commandId: crypto.randomUUID(),
        action,
        reason: reason.trim(),
        ...(action === 'defer' ? { deferredUntil: new Date(until).toISOString() } : {}),
      },
    };
    setCommand(payload);
    setBusy(true);
    try {
      const r = await read(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      message.info(labels[r.state] || r.state);
      setAction(null);
      setCommand(null);
      changed();
      await show(detail!.alert.produto_id);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        icon={<BellOutlined />}
        onClick={() => {
          setDetail(null);
          setOpen(true);
        }}
      >
        Alertas e decisões{' '}
        <Badge
          count={count}
          showZero
          style={{ background: 'linear-gradient(120deg,#ffc400,#a87900)', color: '#15120b', marginLeft: 6 }}
        />
      </Button>
      <Drawer
        title="Alertas e decisões"
        width="min(96vw, 1000px)"
        open={open}
        destroyOnHidden
        onClose={() => {
          if (busy) return;
          generation.current++;
          setLoading(false);
          setOpen(false);
          setDetail(null);
          setExecutionConfirmationOpen(false);
          setError('');
        }}
      >
        <div ref={contentRef}>
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              action={
                <Button onClick={() => (detail ? void show(detail.alert.produto_id) : void list())}>
                  Tentar novamente
                </Button>
              }
            />
          )}
          {!detail ? (
            <>
              <Segmented
                value={view}
                options={[{ value: 'alerts', label: 'Alertas' }, { value: 'decisions', label: 'Decisões' }]}
                onChange={(value) => {
                  const next = value as 'alerts' | 'decisions';
                  setView(next);
                  setDecisionFilter(next === 'decisions' ? 'pending' : undefined);
                  setPage(1);
                }}
              />
              <Space wrap>
                <Input.Search
                  placeholder="SKU, produto ou anúncio"
                  allowClear
                  onSearch={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  style={{ width: 260 }}
                />
                <Select
                  value={state}
                  onChange={(v) => {
                    setState(v);
                    setPage(1);
                  }}
                  options={['open', 'resolved', 'all'].map((v) => ({
                    value: v,
                    label: labels[v] || 'Todos',
                  }))}
                />
                <Select
                  allowClear
                  placeholder="Gravidade"
                  value={severity}
                  style={{ width: 130 }}
                  onChange={(v) => {
                    setSeverity(v);
                    setPage(1);
                  }}
                  options={['P0', 'P1', 'P2', 'INFO'].map((value) => ({ value, label: value }))}
                />
                <Select
                  allowClear
                  placeholder="Decisão"
                  style={{ width: 210 }}
                  value={decisionFilter}
                  onChange={(v) => {
                    setDecisionFilter(v);
                    setPage(1);
                  }}
                  options={['pending', 'deferred', 'approved', 'rejected', 'expired', 'invalidated'].map(
                    (v) => ({ value: v, label: labels[v] }),
                  )}
                />
                <Button icon={<ReloadOutlined />} onClick={() => void list()}>
                  Atualizar
                </Button>
              </Space>
              <Table<Row>
                rowKey="id"
                dataSource={rows}
                loading={loading}
                pagination={false}
                scroll={{ x: 720 }}
                size="small"
                columns={[
                  {
                    title: 'Prioridade',
                    dataIndex: 'severity',
                    width: 95,
                    render: (v) => (
                      <Tag
                        color={v === 'P0' ? 'red' : v === 'P1' ? 'orange' : v === 'P2' ? 'gold' : 'default'}
                      >
                        {severityLabels[v] || v}
                      </Tag>
                    ),
                  },
                  {
                    title: 'Produto',
                    render: (_, r) => (
                      <>
                        <strong>{r.product?.nome}</strong>
                        <div>
                          <Typography.Text type="secondary">
                            {r.product?.sku} · {r.item_id}
                          </Typography.Text>
                        </div>
                      </>
                    ),
                  },
                  {
                    title: 'Problema',
                    render: (_, r) => (
                      <>
                        <strong>{r.issues?.length === 1 ? r.title : `${r.issues?.length || 1} pontos requerem atenção`}</strong>
                        <div>
                          <Typography.Text type="secondary">
                            {(r.issues || [r]).map(issue => issue.title).join(' · ')}
                          </Typography.Text>
                        </div>
                      </>
                    ),
                  },
                  { title: 'Aberto em', width: 135, render: (_, r) => date(r.created_at) },
                  {
                    title: 'Ação',
                    width: 110,
                    render: (_, r) => <Button onClick={() => void show(r.produto_id)}>
                      {r.decisions?.length ? 'Ver decisão' : 'Ver diagnóstico'}
                    </Button>,
                  },
                ]}
              />
              <Pagination
                current={page}
                pageSize={30}
                total={total}
                showSizeChanger={false}
                onChange={setPage}
              />
            </>
          ) : (
            <Spin spinning={loading}>
              <Space direction="vertical" size={20} style={{ width: '100%' }}>
                <Button
                  onClick={() => {
                    generation.current++;
                    setDetail(null);
                    setError('');
                  }}
                >
                  Voltar à lista
                </Button>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {detail.alert.title}
                </Typography.Title>
                <Typography.Text>
                  {detail.alert.product?.nome} · {detail.alert.product?.sku}
                </Typography.Text>
                {detail.alerts.length > 1 && (
                  <Alert type="warning" showIcon message={`${detail.alerts.length} pontos agrupados neste produto`}
                    description={detail.alerts.map(alert => `${severityLabels[alert.severity] || alert.severity}: ${alert.title}`).join(' · ')} />
                )}
                <Descriptions
                  column={2}
                  size="small"
                  items={[
                    { key: 'status', label: 'Estado', children: labels[detail.alert.state] },
                    { key: 'group', label: 'Vínculo', children:
                      detail.evaluation.result.decisionContext?.groupId ? 'Grupo sincronizado confirmado' : 'Confirmação pendente' },
                    { key: 'item', label: 'Anúncio', children: detail.alert.item_id || 'Novo — ID somente após criação confirmada' },
                    { key: 'reason', label: 'Motivo', children: detail.alert.reason },
                    ...(current
                      ? [
                          { key: 'decision', label: 'Decisão', children: labels[current.state] },
                          { key: 'expires', label: 'Validade econômica', children: date(current.expires_at) },
                          {
                            key: 'previous',
                            label: 'Preço observado',
                            children: money(current.context.previousPriceCents),
                          },
                          {
                            key: 'next',
                            label: 'Preço proposto',
                            children: money(current.context.priceCents),
                          },
                          { key: 'defer', label: 'Rever em', children: date(current.deferred_until) },
                        ]
                      : []),
                  ]}
                />
                {detail.evaluation.result.revalidation?.status === 'queried' ? (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert type="success" showIcon message="Diagnóstico comercial atualizado"
                      description={`Fontes conferidas em ${date(detail.evaluation.created_at)}. Esta leitura não cria proposta e não altera o anúncio.`} />
                    {detail.evaluation.result.competitiveAssessment
                      ? <CompetitivePricingSummary assessment={detail.evaluation.result.competitiveAssessment} />
                      : <PricingQuoteSummary pricing={detail.evaluation.result} />}
                  </Space>
                ) : (
                  <Alert type="warning" showIcon message="Diagnóstico comercial ainda não está pronto"
                    description={blockerLabels[detail.evaluation.result.revalidation?.code || '']
                      || (detail.evaluation.result.decisionContext?.reasons || [])
                        .map(code => blockerLabels[code]).find(Boolean)
                      || 'Uma das fontes necessárias ainda não foi confirmada. Atualize o diagnóstico; nenhuma proposta ou alteração será enviada.'} />
                )}
                {current && (
                  <Alert
                    type="info"
                    showIcon
                    message="Decidir não significa aplicar"
                    description={detail.execution.target === 'production' && detail.execution.enabled
                      ? 'A aprovação não envia nada. A operação real exige confirmação final e nova validação no servidor.'
                      : 'A proposta permanece sem efeito comercial enquanto a execução protegida não estiver disponível.'}
                  />
                )}
                {current?.state === 'approved' && (
                  <Space direction="vertical">
                    {detail.executionBlocked && <Alert type="info" message="Proposta aprovada; esta operação não está liberada no ambiente." />}
                    {detail.canManage && !current.operation_id && <Button type="primary" loading={busy}
                      disabled={detail.executionBlocked} onClick={requestApprovedExecution}>
                      {detail.execution.target === 'production' ? 'Aplicar no Mercado Livre' : 'Aplicar na conta de teste'}
                    </Button>}
                    {current.operation_id && <Button onClick={() => void checkOperation(current.operation_id!)}>Conferir operação</Button>}
                    {current.operation_id && detail.canManage && !detail.executionBlocked && operation
                      && ['requested', 'inconclusive'].includes(operation.state) && <Button loading={busy}
                        onClick={() => void applyApproved()}>Consultar ML novamente — sem reenviar</Button>}
                    {operation && <Alert type={operation.state === 'confirmed' ? 'success' : 'info'}
                      message={labels[operation.state] || operation.state} description={`Operação ${operation.id}`} />}
                  </Space>
                )}
                {current && detail.canManage && ['pending', 'deferred'].includes(current.state) && (
                  <Space wrap>
                    {(['approve', 'reject', 'defer'] as const).map((a) => (
                      <Button
                        key={a}
                        type={a === 'approve' ? 'primary' : 'default'}
                        onClick={() => {
                          setAction(a);
                          setReason('');
                          setUntil('');
                          setCommand(null);
                        }}
                      >
                        {a === 'approve' ? 'Aprovar proposta' : a === 'reject' ? 'Rejeitar' : 'Adiar'}
                      </Button>
                    ))}
                  </Space>
                )}
                {current?.state === 'expired' && (
                  <Alert
                    type="warning"
                    message="A validade econômica expirou. Reavalie e registre uma nova proposta antes de decidir."
                  />
                )}
                {detail.canManage && detail.alert.item_id && (
                  <Space wrap>
                    <Button icon={<ReloadOutlined />} loading={reanalyzing} onClick={() => void reanalyzeProduct()}>
                      Atualizar diagnóstico agora
                    </Button>
                    {detail.evaluation.result.revalidation?.status === 'queried' && <PricingProposalButton
                      productId={detail.alert.produto_id}
                      itemId={detail.alert.item_id}
                      priceCents={current?.context.priceCents}
                      clearance={current?.context.clearance}
                      label="Preparar proposta de preço"
                      onRecorded={() => void show(detail.alert.produto_id)}
                    />}
                  </Space>
                )}
                {!detail.canManage && (
                  <Typography.Text type="secondary">
                    Seu perfil permite consultar; decisões exigem administrador ou gerente.
                  </Typography.Text>
                )}
                <Typography.Title level={5} style={{ margin: 0 }}>
                  Histórico
                </Typography.Title>
                {detail.history.length ? (
                  <Timeline
                    items={detail.history.map((e) => ({
                      children: (
                        <>
                          <strong>{labels[e.kind] || e.kind}</strong>
                          <div>{e.reason}</div>
                          <Typography.Text type="secondary">
                            {date(e.created_at)} · {e.actorName || 'Sistema'}
                          </Typography.Text>
                        </>
                      ),
                    }))}
                  />
                ) : (
                  <Empty description="Sem eventos" />
                )}
                <Space>
                  <Button
                    disabled={historyPage === 1}
                    onClick={() => void show(detail.alert.produto_id, historyPage - 1)}
                  >
                    Mais recentes
                  </Button>
                  <Button
                    disabled={!detail.hasMore}
                    onClick={() => void show(detail.alert.produto_id, historyPage + 1)}
                  >
                    Mais antigos
                  </Button>
                </Space>
              </Space>
            </Spin>
          )}
        </Space>
        </div>
      </Drawer>
      <Modal
        open={executionConfirmationOpen && detail?.execution.target === 'production'}
        title={current?.context.operationKind === 'listing_create'
          ? 'Confirmar criação de anúncio real'
          : 'Confirmar alteração de preço real'}
        onCancel={() => {
          if (!busy) setExecutionConfirmationOpen(false);
        }}
        onOk={() => void confirmProductionExecution()}
        confirmLoading={busy}
        okText={current?.context.operationKind === 'listing_create' ? 'Criar anúncio real' : 'Alterar preço real'}
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="Esta operação produz efeito comercial real no Mercado Livre."
            description="A conta e as evidências serão revalidadas antes de um único envio. Resultado incerto será apenas consultado, nunca reenviado automaticamente."
          />
          <Descriptions
            column={1}
            size="small"
            items={[
              { key: 'product', label: 'Produto', children: detail?.alert.product?.nome || '—' },
              { key: 'sku', label: 'SKU', children: detail?.alert.product?.sku || '—' },
              { key: 'current', label: 'Preço observado', children: money(current?.context.previousPriceCents) },
              { key: 'proposed', label: 'Preço proposto', children: money(current?.context.priceCents) },
            ]}
          />
        </Space>
      </Modal>
      <Modal
        open={Boolean(action)}
        title={
          action === 'approve'
            ? 'Aprovar proposta de preço'
            : action === 'reject'
              ? 'Rejeitar proposta'
              : 'Adiar decisão'
        }
        onCancel={() => {
          if (!busy) {
            setAction(null);
            setCommand(null);
          }
        }}
        onOk={handleSubmit}
        confirmLoading={busy}
        okText="Registrar decisão"
        okButtonProps={{ disabled: !reason.trim() }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            message="Aprovação sujeita à revalidação; ela não executa a operação comercial."
          />
          <Input.TextArea
            aria-label="Motivo da decisão"
            placeholder="Motivo obrigatório"
            value={reason}
            maxLength={200}
            disabled={Boolean(command)}
            onChange={(e) => setReason(e.target.value)}
          />
          {action === 'defer' && (
            <Input
              aria-label="Rever em"
              type="datetime-local"
              value={until}
              disabled={Boolean(command)}
              onChange={(e) => setUntil(e.target.value)}
            />
          )}
        </Space>
      </Modal>
    </>
  );
}

export function PricingProposalButton({
  productId,
  itemId,
  priceCents,
  clearance,
  disabled = false,
  label = 'Preparar proposta',
  onRecorded,
}: {
  productId: string;
  itemId: string;
  priceCents?: number;
  clearance?: DecisionContext['clearance'];
  disabled?: boolean;
  label?: string;
  onRecorded?: () => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{
    evaluationId: string;
    pricing: ProductPricing;
    decisionContext: DecisionContext;
  } | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const generation = useRef(0);
  async function evaluate() {
    if (price == null) return;
    const req = ++generation.current;
    setBusy(true);
    setQuote(null);
    try {
      const q = await read('/api/ml/anuncio/preco-detalhe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: productId,
          mlItemId: itemId,
          priceCents: Math.round(price * 100),
          ...(clearance ? { clearance } : {}),
        }),
      });
      if (req === generation.current) setQuote(q);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      if (req === generation.current) setBusy(false);
    }
  }
  async function prepare() {
    if (!quote) return;
    const id = command ?? crypto.randomUUID();
    setCommand(id);
    setBusy(true);
    try {
      await read(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          commandId: id,
          evaluationId: quote.evaluationId,
          reason: reason.trim(),
        }),
      });
      message.success('Proposta registrada na central. Nenhum preço foi aplicado.');
      changed();
      setOpen(false);
      onRecorded?.();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          setPrice(priceCents == null ? null : priceCents / 100);
          setQuote(null);
          setReason('');
          setCommand(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Modal
        title="Preparar proposta de preço"
        open={open}
        width={780}
        footer={null}
        onCancel={() => {
          if (!busy) {
            generation.current++;
            setOpen(false);
          }
        }}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Alert
            type="info"
            message="Simular → registrar proposta → decidir"
            description="A aprovação é separada. Este fluxo não envia preços ao Mercado Livre."
          />
          <Space>
            <InputNumber
              aria-label="Preço proposto"
              prefix="R$"
              min={0.01}
              precision={2}
              value={price}
              disabled={busy || Boolean(command)}
              onChange={(v) => {
                setPrice(v);
                setQuote(null);
              }}
            />
            <Button
              loading={busy}
              disabled={price == null || Boolean(command)}
              onClick={() => void evaluate()}
            >
              Reavaliar preço
            </Button>
          </Space>
          {quote && (
            <>
              <PricingQuoteSummary pricing={quote.pricing} />
              {!quote.decisionContext?.executable && (
                <Alert
                  type="warning"
                  message="Proposta bloqueada"
                  description={quote.decisionContext?.reasons.join(' · ') || 'Vínculo não confirmado'}
                />
              )}
            </>
          )}
          <Input.TextArea
            aria-label="Motivo da proposta"
            placeholder="Motivo obrigatório"
            maxLength={200}
            value={reason}
            disabled={busy || Boolean(command)}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            type="primary"
            loading={busy}
            disabled={!quote?.decisionContext?.executable || !reason.trim()}
            onClick={() => void prepare()}
          >
            Registrar proposta
          </Button>
        </Space>
      </Modal>
    </>
  );
}
