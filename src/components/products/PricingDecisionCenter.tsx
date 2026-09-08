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
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { BellOutlined, ReloadOutlined } from '@ant-design/icons';
import { PricingQuoteSummary } from './LivePricingQuote';
import type { ProductPricing } from '@/services/pricing-context';
import type { DecisionContext } from '@/services/pricing-decisions';

const labels: Record<string, string> = {
  open: 'Aberto',
  resolved: 'Resolvido',
  pending: 'Aguardando decisão',
  approved: 'Aprovado — aplicação bloqueada pelo gate',
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
};
const date = (s?: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
const money = (c?: number | null) =>
  c == null ? 'Não calculado' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
type Decision = {
  id: string;
  state: string;
  expires_at: string;
  deferred_until: string | null;
  context: DecisionContext;
  reason: string;
  created_at: string;
};
type Row = {
  id: string;
  produto_id: string;
  title: string;
  reason: string;
  rule_id: string;
  severity: string;
  state: string;
  item_id: string;
  group_id: string | null;
  created_at: string;
  merged_into: string | null;
  product: { nome: string; sku: string };
  decisions: Decision[];
};
type Detail = {
  alert: Row;
  evaluation: { result: ProductPricing };
  history: Array<{ id: number; kind: string; actorName: string | null; reason: string; created_at: string }>;
  canManage: boolean;
  hasMore: boolean;
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
  const list = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ state, search, page: String(page) });
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
  }, [state, search, page, severity, decisionFilter]);
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
  async function show(id: string, p = 1) {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const d = await read(`${api}?alertId=${id}&page=${p}`);
      if (request === generation.current) {
        setDetail(d);
        setHistoryPage(p);
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
      await show(detail!.alert.id);
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
          setError('');
        }}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Decidir não significa aplicar"
            description="Nenhum preço será enviado ao Mercado Livre nesta etapa. Aprovações antigas não serão executadas quando o gate for liberado."
          />
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              action={
                <Button onClick={() => (detail ? void show(detail.alert.id) : void list())}>
                  Tentar novamente
                </Button>
              }
            />
          )}
          {!detail ? (
            <>
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
                        {v}
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
                        <strong>{r.title}</strong>
                        <div>
                          <Typography.Text type="secondary">{r.reason}</Typography.Text>
                        </div>
                      </>
                    ),
                  },
                  { title: 'Aberto em', width: 135, render: (_, r) => date(r.created_at) },
                  {
                    title: 'Ação',
                    width: 110,
                    render: (_, r) => <Button onClick={() => void show(r.id)}>Ver decisão</Button>,
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
                <Descriptions
                  column={2}
                  size="small"
                  items={[
                    { key: 'status', label: 'Estado', children: labels[detail.alert.state] },
                    { key: 'group', label: 'Grupo', children: detail.alert.group_id || 'Não confirmado' },
                    { key: 'item', label: 'Anúncio', children: detail.alert.item_id },
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
                <PricingQuoteSummary pricing={detail.evaluation.result} />
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
                {detail.canManage && (
                  <PricingProposalButton
                    productId={detail.alert.produto_id}
                    itemId={detail.alert.item_id}
                    priceCents={current?.context.priceCents}
                    clearance={current?.context.clearance}
                    label="Reavaliar / preparar proposta"
                    onRecorded={() => void show(detail.alert.id)}
                  />
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
                    onClick={() => void show(detail.alert.id, historyPage - 1)}
                  >
                    Mais recentes
                  </Button>
                  <Button
                    disabled={!detail.hasMore}
                    onClick={() => void show(detail.alert.id, historyPage + 1)}
                  >
                    Mais antigos
                  </Button>
                </Space>
              </Space>
            </Spin>
          )}
        </Space>
      </Drawer>
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
            message="Aprovação sujeita à revalidação; aplicação comercial permanece bloqueada."
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
