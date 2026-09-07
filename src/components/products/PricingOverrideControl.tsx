'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Space, Spin, Typography } from 'antd';
import type { PricingOverrideCommand, PricingOverrideGroup } from '@/services/pricing-overrides';

type State = { groups: PricingOverrideGroup[]; canManage: boolean };
type HistoryRow = { id: number; created_at: string; kind: string; reason: string; actor_id: string | null; source_override_ids?: string[] | null };
const eventNames: Record<string, string> = { override_activated: 'Proteção ativada', override_revoked: 'Proteção removida', override_propagated: 'Proteção propagada',
  baseline: 'Preço inicial observado', observed: 'Preço observado', projection_changed: 'Projeção alterada', requested: 'Alteração solicitada', confirmed: 'Alteração confirmada', failed: 'Falha confirmada', inconclusive: 'Resultado inconclusivo' };

export default function PricingOverrideControl({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PricingOverrideGroup | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [command, setCommand] = useState<PricingOverrideCommand | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyGroup, setHistoryGroup] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/produtos/${encodeURIComponent(productId)}/pricing-overrides`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.status !== 'available') throw new Error('Não foi possível consultar a proteção. Estado desconhecido; automação não está autorizada.');
      if (generation === loadGeneration.current) setState(payload);
    } catch (failure) { if (generation === loadGeneration.current) { setState(null); setError(failure instanceof Error ? failure.message : 'Proteção indisponível'); } }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [productId]);
  const invalidateRequests = useCallback(() => { loadGeneration.current++; historyGeneration.current++; }, []);
  useEffect(() => { if (!disabled) void load(); return invalidateRequests; }, [disabled, load, invalidateRequests]);
  const save = async () => {
    if (!selected || !reason.trim() || saving) return;
    const input: PricingOverrideCommand = command ?? { commandId: crypto.randomUUID(), groupId: selected.id, groupVersion: selected.version,
      action: selected.protection ? 'revoke' : 'activate', reason: reason.trim(), ...(selected.protection ? { overrideId: selected.protection.id } : {}) };
    setCommand(input); setSaving(true); setSaveError(null);
    try {
      const response = await fetch(`/api/produtos/${encodeURIComponent(productId)}/pricing-overrides`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível registrar a proteção');
      setSelected(null); setCommand(null); await load();
    } catch (failure) { setSaveError(failure instanceof Error ? failure.message : 'Resultado desconhecido. Consulte o estado.'); await load(); }
    finally { setSaving(false); }
  };
  const loadHistory = async (groupId: string, before?: string) => {
    const generation = ++historyGeneration.current;
    setHistoryGroup(groupId); setHistoryLoading(true); setHistoryError(null);
    if (!before) { setHistory([]); setCursor(null); }
    try {
      const params = new URLSearchParams({ groupId, limit: '20', ...(before ? { before } : {}) });
      const response = await fetch(`/api/produtos/${encodeURIComponent(productId)}/pricing-history?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error('Histórico indisponível');
      if (generation === historyGeneration.current) { setHistory(rows => before ? [...rows, ...payload.data] : payload.data); setCursor(payload.nextCursor); }
    } catch { if (generation === historyGeneration.current) setHistoryError('Não foi possível consultar o histórico.'); }
    finally { if (generation === historyGeneration.current) setHistoryLoading(false); }
  };
  if (disabled) return <Alert showIcon type="info" message="Proteção de preço" description="Amostra protegida ou edição em andamento: gerenciamento indisponível." />;
  return <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 24 }}>
    <Typography.Title level={5} style={{ margin: 0 }}>Proteção de preço</Typography.Title>
    <Typography.Text type="secondary">Válida até remoção manual. Não altera o preço atual nem impede consultas. Alterações comerciais continuam aguardando homologação.</Typography.Text>
    {loading ? <Spin size="small" /> : error ? <Alert showIcon type="warning" message={error} action={<Button onClick={() => void load()}>Consultar novamente</Button>} /> : state?.groups.length ? state.groups.map(group => <div key={group.id} style={{ borderLeft: '3px solid var(--bentevi-primary)', paddingLeft: 12 }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Typography.Text strong>{group.protection ? 'Protegido contra alterações automáticas' : 'Sem proteção manual'}{group.state === 'retired' ? ' · grupo arquivado' : ''}</Typography.Text>
        <Typography.Text type="secondary">{group.members.map(member => `${member.catalog ? 'Catálogo' : 'Padrão'} ${member.itemId}${member.variationId ? ` · variação ${member.variationId}` : ''}`).join(' / ') || `Grupo ${group.id}`}</Typography.Text>
        {group.protection && <><Typography.Text>{group.protection.reason}</Typography.Text><Typography.Text type="secondary">{group.protection.origin === 'propagated' ? 'Propagada automaticamente; origem registrada no histórico' : group.protection.actorName || 'Usuário registrado'} · {new Date(group.protection.createdAt).toLocaleString('pt-BR')}</Typography.Text></>}
        {group.state === 'unverified' && <Typography.Text type="warning">Composição pendente de validação. A proteção existente foi preservada.</Typography.Text>}
        {group.inFlight && <Typography.Text type="warning">Há uma operação já solicitada ou inconclusiva. A proteção não cancela efeitos em andamento; o resultado precisa ser reconciliado.</Typography.Text>}
        <Space wrap>
          {state.canManage && <Button disabled={!group.protection && group.state !== 'verified'} onClick={() => { setSelected(group); setReason(''); setCommand(null); setSaveError(null); }}>
            {group.protection ? 'Remover proteção' : 'Proteger contra alterações automáticas'}
          </Button>}
          <Button type="link" onClick={() => void loadHistory(group.id)}>Ver histórico</Button>
        </Space>
      </Space>
    </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum grupo comprovado disponível para proteger. Valide o vínculo dos anúncios." />}
    <Modal title={selected?.protection ? 'Remover proteção de preço' : 'Proteger contra alterações automáticas'} open={Boolean(selected)} confirmLoading={saving}
      okText={command ? 'Reenviar o mesmo comando' : 'Confirmar'} okButtonProps={{ disabled: !reason.trim() }} onOk={() => void save()} onCancel={() => { if (!saving) { setSelected(null); setCommand(null); } }} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text>{selected?.members.map(member => `${member.itemId}${member.variationId ? ` (${member.variationId})` : ''}`).join(' / ') || selected?.id}</Typography.Text>
        <Typography.Text>{selected?.protection ? 'Remove somente a proteção deste grupo. Não altera preço nem autoriza automação imediatamente.' : 'Protege este grupo até remoção manual. Se a composição mudar, os grupos resultantes também serão protegidos.'}</Typography.Text>
        <label htmlFor="pricing-override-reason">Motivo obrigatório</label>
        <Input.TextArea id="pricing-override-reason" maxLength={200} showCount value={reason} disabled={saving || Boolean(command)} onChange={event => setReason(event.target.value)} />
        {saveError && <Alert showIcon type="warning" message={saveError} description="O estado foi consultado novamente. Um reenvio usa o mesmo identificador para não duplicar a decisão." />}
      </Space>
    </Modal>
    <Modal title="Histórico do grupo" open={Boolean(historyGroup)} footer={null} onCancel={() => { historyGeneration.current++; setHistoryGroup(null); }} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {history.map(row => <div key={row.id}><Typography.Text strong>{eventNames[row.kind] || row.kind}</Typography.Text><br /><Typography.Text>{row.reason}</Typography.Text><br /><Typography.Text type="secondary">{new Date(row.created_at).toLocaleString('pt-BR')}</Typography.Text>{row.source_override_ids?.length ? <><br /><Typography.Text type="secondary">Proteções de origem: {row.source_override_ids.join(', ')}</Typography.Text></> : null}</div>)}
        {historyError && <Alert type="warning" message={historyError} />}
        {!historyLoading && !history.length && !historyError && <Empty description="Nenhum evento registrado" />}
        {historyLoading && <Spin />}
        {cursor && historyGroup && <Button disabled={historyLoading} onClick={() => void loadHistory(historyGroup, cursor)}>Carregar anteriores</Button>}
      </Space>
    </Modal>
  </Space>;
}
