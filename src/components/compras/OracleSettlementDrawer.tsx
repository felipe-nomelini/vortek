'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Empty, Input, InputNumber, List, Modal, Select, Space, Spin, Tag, Typography, Upload, message } from 'antd';
import { formatCurrency } from '@/lib/format';
import { userSafeMessage } from '@/lib/user-feedback';

const { Text, Title } = Typography;
type PreviewItem = { compraId: string; dsid: string; pedidoNumero: number | null; valor: number | null;
  abastecimento: string; etiqueta: string | null; reasons: Array<{ code: string; label: string }> };
type Account = { fornecedorId: string; fornecedor: string; cnpjMasked: string; pixKeyMasked: string;
  cnpj?: string; pixKey?: string;
  valid: boolean; included: PreviewItem[]; excluded: PreviewItem[]; totalBruto: number;
  creditoDisponivel: number; creditoSugerido: number };
type Settlement = { id: string; fornecedorId: string; fornecedor: string; cnpjMasked: string; pixKeyMasked: string;
  status: string; grossAmount: number; creditAmount: number; pixAmount: number; version: number;
  preparedAt: string; confirmedAt: string | null };
type Detail = { id: string; status: string; version: number; fornecedor: string; cnpjMasked: string;
  grossAmount: number; creditAmount: number; pixAmount: number; hasReceipt: boolean;
  communicationId: string | null;
  items: Array<{ id: string; dsid_snapshot: string; sale_number_snapshot: number; gross_amount: number;
    credit_amount: number; pix_amount: number }>;
  resumeEffects: Array<{ pedido_id: string; status: string; attempts: number; error_code: string | null }>;
  postprocess: { id: string; status: string } | null };
type Communication = { id: string; body: string; status: string; version: number; contactMasked: string;
  settlementIds: string[]; attempts: number; errorCode: string | null };

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.erro || 'Operação indisponível');
  return payload;
}

export default function OracleSettlementDrawer({ open, onClose, canOperate }: {
  open: boolean; onClose: () => void; canOperate: boolean;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [unassigned, setUnassigned] = useState<Array<{ compraId: string; dsid: string; reasons: Array<{ label: string }> }>>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementTotal, setSettlementTotal] = useState(0);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [credit, setCredit] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pixDone, setPixDone] = useState(false);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [contactCandidates, setContactCandidates] = useState<Settlement[]>([]);
  const [contactPage, setContactPage] = useState(1);
  const [contactTotal, setContactTotal] = useState(0);
  const [communicationIds, setCommunicationIds] = useState<string[]>([]);
  const [communication, setCommunication] = useState<Communication | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decision, setDecision] = useState<'sent' | 'not_sent' | 'done' | 'not_done'>('not_sent');

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [today, history] = await Promise.all([
        jsonRequest('/api/compras/liquidacoes/hoje'),
        jsonRequest('/api/compras/liquidacoes?page=1'),
      ]);
      setAccounts(today.data || []);
      setUnassigned(today.unassigned || []);
      setWritesEnabled(Boolean(today.writesEnabled));
      setSettlements(history.data || []);
      setSettlementPage(1); setSettlementTotal(history.total || 0);
    } catch (cause) {
      setError(userSafeMessage(cause instanceof Error ? cause.message : null, 'Falha ao consultar liquidações.'));
    } finally { setLoading(false); }
  }, []);

  const loadMore = async () => {
    try {
      const next = settlementPage + 1;
      const payload = await jsonRequest(`/api/compras/liquidacoes?page=${next}`);
      setSettlements((current) => [...current, ...(payload.data || [])]);
      setSettlementPage(next);
      setSettlementTotal(payload.total || 0);
    } catch (cause) { messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Falha ao carregar mais liquidações.')); }
  };

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  const writable = canOperate && writesEnabled;

  const selectAccount = (account: Account) => {
    setSelected(account);
    setSelectedIds(account.included.map((item) => item.compraId));
    setCredit(account.creditoSugerido);
    setDetail(null); setIdempotencyKey(null); setPixDone(false); setReference('');
    setNotes(''); setReceipt(null); setCommunication(null);
  };

  const readDetail = async (id: string) => {
    const payload = await jsonRequest(`/api/compras/liquidacoes/${id}`);
    setDetail(payload.data);
    if (payload.data.communicationId) {
      const current = await jsonRequest(`/api/compras/liquidacoes/comunicacoes/${payload.data.communicationId}`);
      setCommunication(current.data);
    } else setCommunication(null);
    const candidates = await jsonRequest(`/api/compras/liquidacoes?contactOf=${encodeURIComponent(id)}`);
    setContactCandidates(candidates.data || []);
    setContactPage(1); setContactTotal(candidates.total || 0);
    setCommunicationIds([id]);
  };

  const loadMoreContacts = async () => {
    if (!detail) return;
    try {
      const next = contactPage + 1;
      const payload = await jsonRequest(`/api/compras/liquidacoes?contactOf=${encodeURIComponent(detail.id)}&page=${next}`);
      setContactCandidates((current) => [...current, ...(payload.data || [])]);
      setContactPage(next); setContactTotal(payload.total || 0);
    } catch (cause) { messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Falha ao carregar liquidações do contato.')); }
  };

  const prepare = async () => {
    if (!selected || !selectedIds.length || !writable) return;
    const key = idempotencyKey || `oracle:${crypto.randomUUID()}`;
    setIdempotencyKey(key);
    setSaving(true);
    try {
      const payload = await jsonRequest('/api/compras/liquidacoes/preparar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fornecedorId: selected.fornecedorId, compraIds: selectedIds,
          creditoCentavos: Math.round(credit * 100), chaveIdempotencia: key }),
      });
      await readDetail(payload.data.id);
      messageApi.success('Liquidação preparada. Confira os valores antes de confirmar o PIX.');
      await refresh();
    } catch (cause) { messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Não foi possível preparar.')); }
    finally { setSaving(false); }
  };

  const confirm = async () => {
    if (!detail || !pixDone || !writable) return;
    setSaving(true);
    try {
      let version = detail.version;
      if (receipt && !detail.hasReceipt) {
        const form = new FormData();
        form.append('receipt', receipt);
        form.append('versaoEsperada', String(version));
        const attached = await jsonRequest(`/api/compras/liquidacoes/${detail.id}/comprovante`, { method: 'POST', body: form });
        version = attached.data.version;
      }
      await jsonRequest(`/api/compras/liquidacoes/${detail.id}/confirmar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versaoEsperada: version,
          referenciaPix: detail.pixAmount === 0 ? null : reference.trim() || null,
          observacoes: notes.trim() || null }),
      });
      await readDetail(detail.id); await refresh();
      messageApi.success('Liquidação confirmada. Efeitos externos serão acompanhados separadamente.');
    } catch (cause) {
      messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null,
        'Confirmação não comprovada. Atualize a liquidação antes de tentar novamente.'));
      await readDetail(detail.id).catch(() => undefined);
    } finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!detail || !writable || detail.status !== 'prepared') return;
    setSaving(true);
    try {
      await jsonRequest(`/api/compras/liquidacoes/${detail.id}/cancelar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versaoEsperada: detail.version }),
      });
      await readDetail(detail.id); await refresh();
      messageApi.success('Liquidação preparada cancelada; reserva liberada.');
    } catch (cause) { messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Não foi possível cancelar.')); }
    finally { setSaving(false); }
  };

  const createCommunication = async () => {
    if (!detail || !writable || !communicationIds.includes(detail.id)) return;
    setSaving(true);
    try {
      const payload = await jsonRequest(`/api/compras/liquidacoes/${detail.id}/comunicar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liquidacaoIds: communicationIds }),
      });
      const comm = await jsonRequest(`/api/compras/liquidacoes/comunicacoes/${payload.data.id}`);
      setCommunication(comm.data);
    } catch (cause) { messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Falha ao gerar comunicação.')); }
    finally { setSaving(false); }
  };

  const approveCommunication = async () => {
    if (!communication || !writable) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/compras/liquidacoes/comunicacoes/${communication.id}/aprovar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versaoEsperada: communication.version }),
      });
      const comm = await jsonRequest(`/api/compras/liquidacoes/comunicacoes/${communication.id}`);
      setCommunication(comm.data);
      messageApi.success('Mensagem aprovada e enfileirada.');
    } catch (cause) { messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Falha ao aprovar.')); }
    finally { setSaving(false); }
  };

  const resolveEffect = async (kind: 'communication' | 'resume', pedidoId?: string) => {
    if (!detail || !writable || decisionNote.trim().length < 10) return;
    setSaving(true);
    try {
      if (kind === 'communication' && communication) {
        await jsonRequest(`/api/compras/liquidacoes/comunicacoes/${communication.id}/resolver`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisao: decision === 'sent' ? 'sent' : 'not_sent', justificativa: decisionNote.trim() }),
        });
        const comm = await jsonRequest(`/api/compras/liquidacoes/comunicacoes/${communication.id}`);
        setCommunication(comm.data);
      } else if (pedidoId) {
        await jsonRequest(`/api/compras/liquidacoes/${detail.id}/retomadas/${pedidoId}/resolver`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisao: decision === 'done' ? 'already_occurred' : 'not_occurred', justificativa: decisionNote.trim() }),
        });
        await readDetail(detail.id);
      }
      setDecisionNote(''); messageApi.success('Decisão registrada.');
    } catch (cause) { messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Falha ao registrar decisão.')); }
    finally { setSaving(false); }
  };

  return <Drawer title="Liquidação de hoje" open={open} onClose={onClose} width="min(1080px, 96vw)" destroyOnHidden>
    {contextHolder}
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type={writesEnabled ? 'warning' : 'info'} showIcon message={writesEnabled ? 'Fechamento habilitado' : 'Fechamento consolidado ainda não ativado'}
        description="A Bentevi registra o PIX feito no banco; não executa transferência. Até a ORC-07, esta tela é somente leitura em produção." />
      <Button onClick={() => void refresh()} loading={loading}>Atualizar valores e estados</Button>
      {error && <Alert type="error" showIcon message={error} />}
      {loading && !accounts.length && <Spin />}
      {!loading && !accounts.length && !unassigned.length && <Empty description="Não há compras PIX pendentes neste momento." />}
      {unassigned.length > 0 && <Alert type="warning" showIcon message={`${unassigned.length} compra(s) sem fornecedor identificável`}
        description={unassigned.map((item) => `#${item.dsid}: ${item.reasons.map((reason) => reason.label).join(', ')}`).join(' · ')} />}
      {accounts.map((account) => <section key={account.fornecedorId} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
        <Space wrap><Title level={5} style={{ margin: 0 }}>{account.fornecedor}</Title>
          <Tag>{account.cnpjMasked}</Tag><Tag>PIX {account.pixKeyMasked}</Tag>
          {!account.valid && <Tag color="red">Cadastro financeiro inválido</Tag>}</Space>
        <div><Text strong>Bruto {formatCurrency(account.totalBruto)} · crédito sugerido {formatCurrency(account.creditoSugerido)} · PIX sugerido {formatCurrency(account.totalBruto - account.creditoSugerido)}</Text></div>
        <Text type="secondary">{account.included.length} pronta(s); {account.excluded.length} excluída(s)</Text>
        <List size="small" header="Incluídas" dataSource={account.included} locale={{ emptyText: 'Nenhuma compra pronta' }}
          renderItem={(item) => <List.Item>Compra DSLite #{item.dsid} · venda #{item.pedidoNumero || '—'} · {formatCurrency(Number(item.valor || 0))} · etiqueta {item.etiqueta || 'não informada'}</List.Item>} />
        <List size="small" header="Exceções" dataSource={account.excluded} locale={{ emptyText: 'Nenhuma exceção' }}
          renderItem={(item) => <List.Item>Compra DSLite #{item.dsid} · {item.reasons.map((reason) => reason.label).join(' · ')}</List.Item>} />
        <Button disabled={!account.valid || !account.included.length} onClick={() => selectAccount(account)}>Fechar pagamentos</Button>
      </section>)}
      <Title level={5}>Liquidações registradas</Title>
      <List dataSource={settlements} locale={{ emptyText: 'Nenhuma liquidação registrada' }}
        renderItem={(item) => <List.Item actions={[<Button key="open" onClick={() => void readDetail(item.id)}>Ver detalhes</Button>]}>
          <Space direction="vertical" size={0}><Text strong>{item.fornecedor} · {item.cnpjMasked}</Text>
            <Text>{formatCurrency(item.grossAmount)} bruto · {formatCurrency(item.creditAmount)} crédito · {formatCurrency(item.pixAmount)} PIX · {item.status}</Text></Space>
        </List.Item>} />
      {settlements.length < settlementTotal && <Button onClick={() => void loadMore()}>Carregar mais liquidações</Button>}
      {selected && !detail && <section style={{ borderTop: '1px solid #ddd', paddingTop: 16 }}>
        <Title level={5}>Preparar · {selected.fornecedor}</Title>
        <Checkbox.Group value={selectedIds} onChange={(values) => {
          const ids = values as string[];
          setSelectedIds(ids);
          const total = selected.included.filter((item) => ids.includes(item.compraId))
            .reduce((sum, item) => sum + Number(item.valor || 0), 0);
          setCredit((current) => Math.min(current, selected.creditoDisponivel, total));
          setIdempotencyKey(null);
        }}
          options={selected.included.map((item) => ({ label: `Compra #${item.dsid} · ${formatCurrency(Number(item.valor || 0))}`, value: item.compraId }))} />
        <div><Text>Crédito a utilizar (R$)</Text></div>
        <InputNumber min={0} max={Math.min(selected.creditoDisponivel, selected.included.filter((item) => selectedIds.includes(item.compraId)).reduce((sum, item) => sum + Number(item.valor || 0), 0))}
          precision={2} value={credit} onChange={(value) => { setCredit(Number(value || 0)); setIdempotencyKey(null); }} />
        <div><Text strong>PIX líquido: {formatCurrency(Math.max(0, selected.included.filter((item) => selectedIds.includes(item.compraId)).reduce((sum, item) => sum + Number(item.valor || 0), 0) - credit))}</Text></div>
        {writable && selected.pixKey && <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={`CNPJ ${selected.cnpj || selected.cnpjMasked} · PIX ${selected.pixKey}`} />
          <Button onClick={() => void navigator.clipboard.writeText(selected.pixKey || '')}>Copiar chave PIX</Button>
        </Space.Compact>}
        <Button type="primary" loading={saving} disabled={!writable || !selectedIds.length} onClick={() => void prepare()}>Preparar liquidação</Button>
        {!writesEnabled && <Text type="secondary">A revisão está disponível; o preparo será liberado somente na ORC-07.</Text>}
      </section>}
      {detail && <section style={{ borderTop: '1px solid #ddd', paddingTop: 16 }}>
        <Title level={5}>Liquidação · {detail.fornecedor} · {detail.status}</Title>
        <Text strong>Bruto {formatCurrency(detail.grossAmount)} · crédito {formatCurrency(detail.creditAmount)} · PIX {formatCurrency(detail.pixAmount)}</Text>
        <List size="small" dataSource={detail.items} renderItem={(item) => <List.Item>Compra #{item.dsid_snapshot} · venda #{item.sale_number_snapshot} · bruto {formatCurrency(item.gross_amount)} · crédito {formatCurrency(item.credit_amount)} · PIX {formatCurrency(item.pix_amount)}</List.Item>} />
        {detail.hasReceipt && <Button href={`/api/compras/liquidacoes/${detail.id}/comprovante`} target="_blank">Ver comprovante</Button>}
        {detail.status === 'prepared' && <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="warning" showIcon message={detail.pixAmount === 0 ? 'Compensação integral por crédito' : 'Confirme somente após fazer o PIX no banco'} />
          {detail.pixAmount > 0 && <Input value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} placeholder="Referência PIX (opcional)" />}
          <Input.TextArea value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} placeholder="Observações internas (opcional)" />
          {!detail.hasReceipt && <Upload maxCount={1} beforeUpload={(file) => { if (file.size > 10 * 1024 * 1024) { messageApi.error('Comprovante maior que 10 MB'); return Upload.LIST_IGNORE; } setReceipt(file as File); return false; }}
            onRemove={() => setReceipt(null)} fileList={receipt ? [{ uid: 'receipt', name: receipt.name, status: 'done' }] : []} accept="application/pdf,image/jpeg,image/png,image/webp">
            <Button>Comprovante opcional</Button></Upload>}
          <Checkbox checked={pixDone} onChange={(event) => setPixDone(event.target.checked)}>{detail.pixAmount === 0 ? 'Confirmo a compensação de crédito' : 'Confirmo que o PIX foi realizado no banco'}</Checkbox>
          <Space><Button type="primary" disabled={!writable || !pixDone} loading={saving} onClick={() => void confirm()}>Confirmar fechamento</Button>
            <Button danger disabled={!writable} loading={saving} onClick={() => Modal.confirm({ title: 'Cancelar liquidação preparada?', onOk: cancel })}>Cancelar preparo</Button></Space>
        </Space>}
        {detail.status === 'confirmed' && <Space direction="vertical" style={{ width: '100%' }}>
          <Text>Pós-processamento: {detail.postprocess?.status || 'não encontrado'}</Text>
          {detail.resumeEffects.map((effect) => <div key={effect.pedido_id}><Text>Venda {effect.pedido_id} · retomada {effect.status} · {effect.attempts} tentativa(s)</Text>
            {['uncertain', 'failed'].includes(effect.status) && <Space direction="vertical">
              <Select value={decision === 'done' ? 'done' : 'not_done'} onChange={setDecision} options={[{ value: 'done', label: 'Retomada comprovada' }, { value: 'not_done', label: 'Não ocorreu; liberar nova tentativa' }]} />
              <Input.TextArea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Evidência e justificativa (mín. 10 caracteres)" />
              <Button disabled={!writable || decisionNote.trim().length < 10} onClick={() => void resolveEffect('resume', effect.pedido_id)}>Registrar decisão</Button>
            </Space>}</div>)}
          {!detail.communicationId && <><Text>Selecione explicitamente as liquidações do mesmo contato para a mensagem:</Text>
            <Checkbox.Group value={communicationIds} onChange={(values) => {
              if (values.length > 20) { messageApi.warning('Selecione no máximo 20 liquidações.'); return; }
              setCommunicationIds(values as string[]);
            }}
              options={contactCandidates.map((item) => ({ label: `${item.fornecedor} · ${item.cnpjMasked} · PIX ${formatCurrency(item.pixAmount)}`, value: item.id }))} />
            {contactCandidates.length < contactTotal && <Button onClick={() => void loadMoreContacts()}>Carregar mais deste contato</Button>}
            <Button disabled={!writable || !communicationIds.includes(detail.id)} onClick={() => void createCommunication()}>Gerar mensagem para revisão</Button></>}
          {communication && <section><Tag>{communication.status}</Tag><Text>Contato {communication.contactMasked}</Text>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{communication.body}</pre>
            {communication.status === 'draft' && <Button type="primary" disabled={!writable} loading={saving}
              onClick={() => Modal.confirm({ title: 'Aprovar e enfileirar esta mensagem?', onOk: approveCommunication })}>Aprovar mensagem</Button>}
            {['uncertain', 'failed'].includes(communication.status) && <Space direction="vertical">
              <Select value={decision === 'sent' ? 'sent' : 'not_sent'} onChange={setDecision} options={[{ value: 'sent', label: 'Envio comprovado' }, { value: 'not_sent', label: 'Não enviado; liberar nova tentativa' }]} />
              <Input.TextArea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Evidência e justificativa (mín. 10 caracteres)" />
              <Button disabled={!writable || decisionNote.trim().length < 10} onClick={() => void resolveEffect('communication')}>Registrar decisão</Button>
            </Space>}</section>}
        </Space>}
      </section>}
    </Space>
  </Drawer>;
}
