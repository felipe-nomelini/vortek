'use client';

import { userSafeMessage } from '@/lib/user-feedback';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, InputNumber, Modal, Select, Space, Spin, Typography } from 'antd';
import type { PricingClearanceCommand, PricingClearance, loadPricingClearances } from '@/services/pricing-clearances';

type State = Awaited<ReturnType<typeof loadPricingClearances>> & { canManage: boolean };
type Choice = { action: 'activate' | 'revoke' | 'complete'; groupId: string; groupVersion: number; clearanceId?: string };
type Event = { id: number; kind: string; created_at: string; reason: string };
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const names: Record<string, string> = { active: 'Autorizada', expired: 'Expirada', revoked: 'Revogada', completed: 'Encerrada',
  clearance_activated: 'Liquidação autorizada', clearance_revoked: 'Liquidação revogada', clearance_completed: 'Liquidação encerrada', clearance_transferred: 'Autorização compartilhada com grupo' };

export default function PricingClearanceControl({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loss, setLoss] = useState(0);
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [validity, setValidity] = useState<'date' | 'revocation' | null>(null);
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [command, setCommand] = useState<PricingClearanceCommand | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const generation = useRef(0);
  const historyGeneration = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/produtos/${encodeURIComponent(productId)}/pricing-clearances`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.status !== 'available') throw new Error('Não foi possível consultar a liquidação. Estado desconhecido, sem autorização de execução.');
      if (current === generation.current) setState(data);
    } catch (failure) { if (current === generation.current) { setState(null); setError(failure instanceof Error ? failure.message : 'Consulta indisponível'); } }
    finally { if (current === generation.current) setLoading(false); }
  }, [productId]);
  const invalidateRequests = useCallback(() => { generation.current++; historyGeneration.current++; }, []);
  useEffect(() => { if (!disabled) void load(); return invalidateRequests; }, [disabled, load, invalidateRequests]);
  function open(input: Choice) {
    setChoice(input); setReason(''); setQuantity(1); setLoss(0); setAcceptLoss(false); setValidity(null); setEndsAt(''); setCommand(null); setSaveError(null);
  }
  const valid = Boolean(reason.trim()) && (choice?.action !== 'activate' || (quantity > 0 && quantity <= (state?.stock.capacity ?? 0)
    && Number.isSafeInteger(quantity) && Number.isSafeInteger(quantity * Math.round(loss * 100)) && (loss === 0 || acceptLoss)
    && (validity === 'revocation' || (validity === 'date' && Number.isFinite(Date.parse(endsAt))))));
  async function save() {
    if (!choice || !state || saving || (!command && !valid)) return;
    if (!command && choice.action === 'activate' && validity === 'date' && Date.parse(endsAt) <= Date.now()) {
      setSaveError('O término deve estar no futuro.'); return;
    }
    const input: PricingClearanceCommand = command ?? (choice.action === 'activate'
      ? { commandId: crypto.randomUUID(), ...choice, action: 'activate', reason: reason.trim(), quantity, maxLossCents: Math.round(loss * 100), acceptLoss,
        endsAt: validity === 'date' ? new Date(endsAt).toISOString() : null, stockFingerprint: state.stock.fingerprint }
      : { commandId: crypto.randomUUID(), ...choice, action: choice.action, clearanceId: choice.clearanceId!, reason: reason.trim() });
    setCommand(input); setSaving(true); setSaveError(null);
    try {
      const response = await fetch(`/api/produtos/${encodeURIComponent(productId)}/pricing-clearances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha no registro');
      setChoice(null); setCommand(null); await load();
    } catch (failure) { setSaveError(userSafeMessage(failure instanceof Error ? failure.message : '', 'Não foi possível registrar a liquidação. Consulte novamente antes de repetir.')); await load(); }
    finally { setSaving(false); }
  }
  async function history(id: string, before?: string) {
    const current = ++historyGeneration.current;
    setHistoryId(id); setHistoryLoading(true); setHistoryError(false);
    if (!before) { setEvents([]); setCursor(null); }
    try {
      const params = new URLSearchParams({ clearanceId: id, limit: '20', ...(before ? { before } : {}) });
      const response = await fetch(`/api/produtos/${encodeURIComponent(productId)}/pricing-history?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error('history_failed');
      if (current === historyGeneration.current) { setEvents(rows => before ? [...rows, ...data.data] : data.data); setCursor(data.nextCursor); }
    } catch { if (current === historyGeneration.current) setHistoryError(true); }
    finally { if (current === historyGeneration.current) setHistoryLoading(false); }
  }
  function closeChoice(row: PricingClearance, action: 'revoke' | 'complete') {
    const group = row.groups[0];
    if (group) open({ action, clearanceId: row.id, groupId: group.id, groupVersion: group.version });
  }
  if (disabled) return <Alert style={{ marginTop: 24 }} type="info" showIcon message="Liquidação interna" description="Amostra protegida ou edição em andamento: gerenciamento indisponível." />;
  const memory = state?.pricing.current.memory;
  return <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 24 }}>
    <Typography.Title level={5} style={{ margin: 0 }}>Liquidação de estoque interno</Typography.Title>
    <Typography.Text type="secondary">Exceção limitada às unidades internas autorizadas. Não altera preços nem libera execução no Mercado Livre.</Typography.Text>
    {loading ? <Spin size="small" /> : error ? <Alert type="warning" showIcon message={error} action={<Button onClick={() => void load()}>Consultar novamente</Button>} /> : state && <>
      <Typography.Text>Disponível para nova autorização: <strong>{state.stock.capacity} unidade(s)</strong></Typography.Text>
      <Typography.Text type="secondary">Custo de referência: {state.pricing.costCents === null ? 'indisponível' : money(state.pricing.costCents)} · oferta ativa do fornecedor, não custo histórico de aquisição.</Typography.Text>
      {memory ? <Typography.Text>Resultado unitário de referência: {money(memory.resultCents)} · margem {(memory.margin * 100).toFixed(2)}% · tributo {memory.tax.status === 'confirmed' ? 'confirmado' : 'estimado'}</Typography.Text>
        : <Alert type="warning" showIcon message="Impacto econômico inconclusivo" description="A autorização administrativa pode ser registrada, mas não poderá ser aplicada sem economia e fontes válidas. Não é prova de prejuízo real." />}
      {state.canManage && <Space wrap>{state.groups.filter(g => g.state === 'verified').map(g => <Button key={g.id} disabled={state.stock.capacity === 0 || state.clearances.some(c => c.state === 'active' && c.groups.some(b => b.id === g.id))}
        onClick={() => open({ action: 'activate', groupId: g.id, groupVersion: g.version })}>Autorizar liquidação · {g.members.map(m => m.itemId).join(' / ')}</Button>)}</Space>}
      {!state.groups.length && <Typography.Text type="warning">Nenhum grupo comprovado disponível. Valide o vínculo dos anúncios.</Typography.Text>}
      {state.clearances.length ? state.clearances.map(row => <div key={row.id} style={{ borderLeft: '3px solid var(--bentevi-primary)', paddingLeft: 12 }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text strong>{names[row.state] || 'Situação não informada'} · {row.available}/{row.quantity} unidade(s) disponível(is)</Typography.Text>
          <Typography.Text>Perda máxima: {money(row.maxLossCents)}/un. · exposição total autorizada: {money(row.quantity * row.maxLossCents)}</Typography.Text>
          <Typography.Text>{userSafeMessage(row.reason, 'Motivo registrado pelo responsável.')}</Typography.Text>
          <Typography.Text type="secondary">{row.actorName || 'Responsável registrado'} · {new Date(row.startsAt).toLocaleString('pt-BR')} · {row.endsAt ? `Até ${new Date(row.endsAt).toLocaleString('pt-BR')}` : 'Até revogação manual'}</Typography.Text>
          <Typography.Text type="secondary">{row.groups.map(g => state.groups.find(p => p.id === g.id)?.members.map(m => m.itemId).join(' / ') || `Grupo ${g.id}`).join(' · ')} — quantidade compartilhada, não somar por anúncio.</Typography.Text>
          {row.groups.some(g => g.conflict || g.state !== 'verified') && <Typography.Text type="warning">Vínculo pendente ou conflito de autorizações: aplicação bloqueada.</Typography.Text>}
          {row.available === 0 && row.state === 'active' && <Typography.Text type="warning">Sem unidades elegíveis disponíveis. Reservas não encerram a liquidação automaticamente.</Typography.Text>}
          {row.economicDecision === 'loss_exceeded' && <Typography.Text type="danger">Resultado de referência excede a perda autorizada. Aplicação bloqueada.</Typography.Text>}
          {row.closeReason && <Typography.Text type="secondary">Encerramento: {row.closeReason}</Typography.Text>}
          <Space wrap>{state.canManage && ['active', 'expired'].includes(row.state) && <><Button onClick={() => closeChoice(row, 'revoke')}>Revogar liquidação</Button><Button onClick={() => closeChoice(row, 'complete')}>Encerrar liquidação</Button></>}
            <Button type="link" onClick={() => void history(row.id)}>Ver histórico</Button></Space>
        </Space>
      </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma liquidação registrada" />}
    </>}
    <Modal title={choice?.action === 'activate' ? 'Autorizar liquidação interna' : 'Encerrar autorização de liquidação'} open={Boolean(choice)} destroyOnHidden
      confirmLoading={saving} okText={command ? 'Reenviar o mesmo comando' : 'Confirmar autorização'} okButtonProps={{ disabled: !command && !valid }}
      onOk={() => void save()} onCancel={() => { if (!saving) setChoice(null); }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text>A decisão será auditada e compartilhada por todos os grupos vinculados. Nenhum preço será alterado.</Typography.Text>
        <label htmlFor="clearance-reason">Motivo obrigatório</label><Input.TextArea id="clearance-reason" value={reason} maxLength={200} showCount disabled={saving || Boolean(command)} onChange={e => setReason(e.target.value)} />
        {choice?.action === 'activate' && <>
          <label htmlFor="clearance-quantity">Quantidade interna autorizada</label><InputNumber id="clearance-quantity" min={1} max={state?.stock.capacity} precision={0} value={quantity} disabled={saving || Boolean(command)} onChange={v => setQuantity(v ?? 0)} />
          <label htmlFor="clearance-loss">Perda máxima por unidade (R$)</label><InputNumber id="clearance-loss" min={0} precision={2} value={loss} disabled={saving || Boolean(command)} onChange={v => setLoss(v ?? 0)} />
          <Typography.Text>Exposição máxima: {money(quantity * Math.round(loss * 100))}. Zero permite equilíbrio, sem prejuízo.</Typography.Text>
          {loss > 0 && <Checkbox checked={acceptLoss} disabled={saving || Boolean(command)} onChange={e => setAcceptLoss(e.target.checked)}>Autorizo explicitamente o prejuízo dentro destes limites.</Checkbox>}
          <Select aria-label="Vigência da liquidação" placeholder="Escolha a vigência" value={validity} style={{ width: '100%' }} disabled={saving || Boolean(command)} onChange={setValidity}
            options={[{ value: 'revocation', label: 'Até revogação manual' }, { value: 'date', label: 'Com data de término' }]} />
          {validity === 'date' && <Input aria-label="Data e hora de término" type="datetime-local" value={endsAt} disabled={saving || Boolean(command)} onChange={e => setEndsAt(e.target.value)} />}
          <Alert type="info" showIcon message="Somente o estoque interno atual" description="Reservas reduzem disponibilidade. Reposições futuras não herdam esta autorização. Valores e validade não podem ser ampliados automaticamente." />
        </>}
        {saveError && <Alert type="warning" showIcon message={saveError} description="O estado foi consultado novamente. O reenvio conserva o identificador; feche para preparar uma nova decisão." />}
      </Space>
    </Modal>
    <Modal title="Histórico da liquidação" open={Boolean(historyId)} footer={null} destroyOnHidden onCancel={() => { historyGeneration.current++; setHistoryId(null); }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>{events.map(event => <div key={event.id}><Typography.Text strong>{names[event.kind] || 'Atualização registrada'}</Typography.Text><br />{userSafeMessage(event.reason, 'Alteração registrada pelo responsável.')}<br /><Typography.Text type="secondary">{new Date(event.created_at).toLocaleString('pt-BR')}</Typography.Text></div>)}
        {historyError && <Alert type="warning" message="Histórico indisponível" />}{historyLoading && <Spin />}
        {cursor && historyId && <Button disabled={historyLoading} onClick={() => void history(historyId, cursor)}>Carregar anteriores</Button>}
      </Space>
    </Modal>
  </Space>;
}
