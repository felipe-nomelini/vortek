'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Drawer, Empty, Input, InputNumber, Modal, Segmented, Select, Space, Spin, Tag, Typography, Upload, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import { userSafeMessage } from '@/lib/user-feedback';
import styles from './OracleSettlementDrawer.module.css';

const { Text, Title } = Typography;
type PreviewItem = { compraId: string; dsid: string; pedidoNumero: number | null; valor: number | null;
  reasons: Array<{ code: string; label: string }> };
type Account = { fornecedorId: string; fornecedor: string; cnpjMasked: string; pixKeyMasked: string;
  cnpj?: string; pixKey?: string;
  valid: boolean; canPrepare: boolean; included: PreviewItem[]; excluded: PreviewItem[]; totalBruto: number;
  creditoDisponivel: number; creditoSugerido: number };
type Settlement = { id: string; fornecedorId: string; fornecedor: string; cnpjMasked: string; pixKeyMasked: string;
  status: string; grossAmount: number; creditAmount: number; pixAmount: number; version: number;
  preparedAt: string; confirmedAt: string | null };
type Detail = { id: string; status: string; version: number; canConfirmBatch: boolean; fornecedor: string; cnpjMasked: string;
  grossAmount: number; creditAmount: number; pixAmount: number; hasReceipt: boolean;
  communicationId: string | null;
  items: Array<{ id: string; dsid_snapshot: string; sale_number_snapshot: number; gross_amount: number;
    credit_amount: number; pix_amount: number }>;
  resumeEffects: Array<{ pedido_id: string; status: string; attempts: number; error_code: string | null }>;
  postprocess: { id: string; status: string } | null };
type Communication = { id: string; body: string; status: string; version: number; contactMasked: string;
  settlementIds: string[]; attempts: number; errorCode: string | null };
type View = 'today' | 'history' | 'prepare' | 'detail';

function settlementStatus(status: string) {
  if (status === 'prepared') return { label: 'Preparada', color: 'gold' };
  if (status === 'confirmed') return { label: 'Confirmada', color: 'green' };
  if (status === 'cancelled') return { label: 'Cancelada', color: 'default' };
  return { label: status.replaceAll('_', ' '), color: 'default' };
}

function formatUpdatedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('pt-BR');
}

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
  const [batchMode, setBatchMode] = useState<'disabled' | 'canary' | 'enabled'>('disabled');
  const [view, setView] = useState<View>('today');
  const [asOf, setAsOf] = useState<string | null>(null);
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
      setBatchMode(today.batchMode === 'canary' || today.batchMode === 'enabled' ? today.batchMode : 'disabled');
      setAsOf(today.asOf || null);
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
    setView('prepare');
  };

  const readDetail = async (id: string) => {
    const payload = await jsonRequest(`/api/compras/liquidacoes/${id}`);
    setPixDone(false); setReference(''); setNotes(''); setReceipt(null); setDecisionNote('');
    setDetail(payload.data);
    if (payload.data.communicationId) {
      const current = await jsonRequest(`/api/compras/liquidacoes/comunicacoes/${payload.data.communicationId}`);
      setCommunication(current.data);
    } else setCommunication(null);
    const candidates = await jsonRequest(`/api/compras/liquidacoes?contactOf=${encodeURIComponent(id)}`);
    setContactCandidates(candidates.data || []);
    setContactPage(1); setContactTotal(candidates.total || 0);
    setCommunicationIds([id]);
    setView('detail');
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
    if (!selected || !selectedIds.length || !writable || !selected.canPrepare) return;
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
    if (!detail || !pixDone || !writable || !detail.canConfirmBatch) return;
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

  const readyCount = accounts.reduce((sum, account) => sum + account.included.length, 0);
  const excludedCount = accounts.reduce((sum, account) => sum + account.excluded.length, unassigned.length);
  const grossTotal = accounts.reduce((sum, account) => sum + account.totalBruto, 0);
  const suggestedCredit = accounts.reduce((sum, account) => sum + account.creditoSugerido, 0);
  const selectedGross = selected?.included.filter((item) => selectedIds.includes(item.compraId))
    .reduce((sum, item) => sum + Number(item.valor || 0), 0) || 0;
  const detailStatus = detail ? settlementStatus(detail.status) : null;

  return <Drawer title="Liquidação de hoje" open={open} onClose={onClose} width="min(1080px, 96vw)" destroyOnHidden
    extra={<Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading} aria-label="Atualizar valores e estados">Atualizar</Button>}>
    {contextHolder}
    <div className={styles.page}>
      {view === 'prepare' || view === 'detail' ? <Button type="text" icon={<ArrowLeftOutlined />}
        className={styles.backButton} onClick={() => setView(view === 'prepare' ? 'today' : 'history')}>
        Voltar para {view === 'prepare' ? 'hoje' : 'liquidações registradas'}
      </Button> : <Segmented className={styles.viewSwitch} value={view} onChange={(value) => setView(value as View)}
        options={[{ label: 'Visão de hoje', value: 'today' }, { label: `Liquidações registradas (${settlementTotal})`, value: 'history' }]} />}

      {!writesEnabled && <Alert type="info" showIcon message="Fechamento consolidado em modo de leitura"
        description="Você pode revisar compras e valores. O preparo e a confirmação serão liberados na ORC-07; a Bentevi não executa o PIX no banco." />}
      {writesEnabled && !canOperate && <Alert type="info" showIcon message="Consulta disponível para seu perfil"
        description="Ações de fechamento exigem permissão de pagamento." />}
      {writesEnabled && canOperate && <Alert type="warning" showIcon message="O PIX é feito fora da Bentevi"
        description="Prepare e confira a liquidação antes de registrar aqui a transferência feita no banco." />}
      {writesEnabled && batchMode === 'disabled' && <Alert type="info" showIcon message="Fechamento em lote ainda não liberado"
        description="A confirmação individual usa o novo núcleo; o lote será liberado após o canário acompanhado." />}
      {writesEnabled && batchMode === 'canary' && <Alert type="info" showIcon message="Canário de liquidação ativo"
        description="Somente o fornecedor selecionado para o primeiro fechamento pode preparar um lote." />}
      {error && <Alert type="error" showIcon message={error} />}
      {loading && !accounts.length && <div className={styles.loading}><Spin tip="Carregando liquidações" /></div>}

      {view === 'today' && <>
        <div className={styles.sectionHeading}><div><Title level={4}>Visão de hoje</Title>
          <Text type="secondary">Compras PIX pendentes agrupadas por fornecedor</Text></div>
          {formatUpdatedAt(asOf) && <Text type="secondary" className={styles.updatedAt}>Atualizado em {formatUpdatedAt(asOf)}</Text>}
        </div>
        {!loading && readyCount === 0 && (accounts.length > 0 || unassigned.length > 0) &&
          <div className={styles.noReady}><Tag color="gold">Sem compras aptas</Tag>
            <strong>Nenhum fechamento disponível agora</strong>
            <span>{excludedCount} compra(s) não entram em um novo fechamento. Abra os motivos por fornecedor para entender cada caso.</span></div>}
        <div className={styles.summaryGrid} aria-label="Resumo da liquidação de hoje">
          <div className={styles.metric}><span>Fornecedores</span><strong>{accounts.length}</strong></div>
          <div className={styles.metric}><span>Compras prontas</span><strong>{readyCount}</strong></div>
          <div className={styles.metric}><span>Excluídas</span><strong>{excludedCount}</strong></div>
          <div className={`${styles.metric} ${styles.primaryMetric}`}><span>PIX sugerido</span>
            <strong>{readyCount > 0 ? formatCurrency(Math.max(0, grossTotal - suggestedCredit)) : '—'}</strong>
            {readyCount === 0 && <small>Sem valor fechável</small>}</div>
        </div>
        {!loading && !accounts.length && !unassigned.length &&
          <Empty description="Não há compras PIX pendentes neste momento." />}

        {unassigned.length > 0 && <Card className={styles.warningCard}>
          <div className={styles.cardHeader}><div><Title level={5}>Sem fornecedor identificado</Title>
            <Text type="secondary">Essas compras não podem ser agrupadas em uma conta financeira.</Text></div>
            <Tag color="orange">{unassigned.length} pendente(s)</Tag></div>
          <Collapse ghost items={[{ key: 'unassigned', label: 'Ver compras sem fornecedor', children:
            <div className={styles.purchaseList}>{unassigned.map((item) => <div className={styles.purchaseRow} key={item.compraId}>
              <strong>Compra DSLite #{item.dsid}</strong><Tag color="orange">Fornecedor não identificado</Tag>
            </div>)}</div> }]} />
        </Card>}

        <section aria-label="Fornecedores da liquidação" className={styles.supplierList}>
          {accounts.map((account) => <Card key={account.fornecedorId} className={styles.supplierCard}>
            <div className={styles.cardHeader}><div className={styles.supplierIdentity}>
              <Title level={5}>{account.fornecedor}</Title>
              <div className={styles.tagLine}><Tag>CNPJ {account.cnpjMasked}</Tag><Tag>PIX {account.pixKeyMasked}</Tag></div>
            </div><div className={styles.statusTags}>
              {!account.valid && <Tag color="red">Cadastro financeiro inválido</Tag>}
              <Tag color={account.included.length ? 'green' : 'gold'}>{account.included.length} pronta(s)</Tag>
              {account.excluded.length > 0 && <Tag color="orange">{account.excluded.length} excluída(s)</Tag>}
            </div></div>

            {account.included.length > 0 ? <>
              <div className={styles.amountGrid} aria-label={`Valores de ${account.fornecedor}`}>
                <div><span>Bruto apto</span><strong>{formatCurrency(account.totalBruto)}</strong></div>
                <div><span>Crédito sugerido</span><strong>{formatCurrency(account.creditoSugerido)}</strong></div>
                <div className={styles.pixAmount}><span>PIX sugerido</span><strong>{formatCurrency(Math.max(0, account.totalBruto - account.creditoSugerido))}</strong></div>
              </div>
              <div className={styles.listHeading}>Prontas para o fechamento</div>
              <div className={styles.purchaseList}>{account.included.map((item) => <div className={styles.purchaseRow} key={item.compraId}>
                <div><strong>Compra DSLite #{item.dsid}</strong><span>Venda #{item.pedidoNumero || '—'}</span></div>
                <strong>{formatCurrency(Number(item.valor || 0))}</strong>
              </div>)}</div>
            </> : <div className={styles.noAccountReady}>Nenhuma compra apta para fechar neste fornecedor.</div>}

            {account.excluded.length > 0 && <Collapse className={styles.exceptions} items={[{ key: 'exceptions',
              label: <span><strong>Compras fora do fechamento</strong> <Tag color="orange">{account.excluded.length}</Tag></span>,
              children: <div className={styles.exceptionList}>{account.excluded.map((item) =>
                <div className={styles.exceptionRow} key={item.compraId}>
                  <strong>Compra DSLite #{item.dsid}</strong>
                  <span>{item.reasons[0]?.label}</span>
                </div>)}</div> }]} />}
            {writable && account.canPrepare && account.valid && account.included.length > 0 && <div className={styles.cardAction}>
              <Button type="primary" onClick={() => selectAccount(account)}>Preparar liquidação</Button>
            </div>}
          </Card>)}
        </section>
      </>}

      {view === 'history' && <section className={styles.history} aria-label="Liquidações registradas">
        <div className={styles.sectionHeading}><div><Title level={4}>Liquidações registradas</Title>
          <Text type="secondary">Consulte valores, comprovantes e acompanhamento de cada fechamento.</Text></div></div>
        {!loading && settlements.length === 0 && <Empty description="Nenhuma liquidação registrada." />}
        {settlements.map((item) => { const status = settlementStatus(item.status); return <Card key={item.id} className={styles.historyCard}>
          <div className={styles.cardHeader}><div><strong>{item.fornecedor}</strong><div className={styles.muted}>{item.cnpjMasked}</div></div>
            <Tag color={status.color}>{status.label}</Tag></div>
          <div className={styles.historyValues}><span>Bruto <b>{formatCurrency(item.grossAmount)}</b></span>
            <span>Crédito <b>{formatCurrency(item.creditAmount)}</b></span>
            <span>PIX <b>{formatCurrency(item.pixAmount)}</b></span></div>
          <div className={styles.cardAction}><Text type="secondary">{formatUpdatedAt(item.confirmedAt || item.preparedAt)}</Text>
            <Button onClick={() => void readDetail(item.id).catch((cause) => messageApi.error(userSafeMessage(cause instanceof Error ? cause.message : null, 'Falha ao carregar liquidação.')))}>Ver detalhes</Button></div>
        </Card>; })}
        {settlements.length < settlementTotal && <Button onClick={() => void loadMore()}>Carregar mais liquidações</Button>}
      </section>}

      {view === 'prepare' && selected && <section className={styles.flow} aria-label="Preparar liquidação">
        <div className={styles.sectionHeading}><div><Title level={4}>Preparar · {selected.fornecedor}</Title>
          <Text type="secondary">Selecione as compras e confira o crédito antes de criar o fechamento.</Text></div></div>
        <Card className={styles.flowCard} title="Compras incluídas">
          <Checkbox.Group className={styles.checkboxList} value={selectedIds} onChange={(values) => {
            const ids = values as string[];
            setSelectedIds(ids);
            const total = selected.included.filter((item) => ids.includes(item.compraId))
              .reduce((sum, item) => sum + Number(item.valor || 0), 0);
            setCredit((current) => Math.min(current, selected.creditoDisponivel, total));
            setIdempotencyKey(null);
          }}>
            {selected.included.map((item) => <Checkbox key={item.compraId} value={item.compraId}>
              Compra #{item.dsid} · venda #{item.pedidoNumero || '—'} · {formatCurrency(Number(item.valor || 0))}
            </Checkbox>)}
          </Checkbox.Group>
        </Card>
        <Card className={styles.flowCard} title="Composição do pagamento">
          <div className={styles.amountGrid}><div><span>Bruto selecionado</span><strong>{formatCurrency(selectedGross)}</strong></div>
            <div><span>Crédito disponível</span><strong>{formatCurrency(selected.creditoDisponivel)}</strong></div>
            <div className={styles.pixAmount}><span>PIX líquido</span><strong>{formatCurrency(Math.max(0, selectedGross - credit))}</strong></div></div>
          <label className={styles.fieldLabel} htmlFor="oracle-credit">Crédito a utilizar (R$)</label>
          <InputNumber id="oracle-credit" min={0} max={Math.min(selected.creditoDisponivel, selectedGross)}
            precision={2} value={credit} onChange={(value) => { setCredit(Number(value || 0)); setIdempotencyKey(null); }} />
          {writable && selected.pixKey && <Space.Compact className={styles.pixKey}>
            <Input readOnly value={`CNPJ ${selected.cnpj || selected.cnpjMasked} · PIX ${selected.pixKey}`} />
            <Button onClick={() => void navigator.clipboard.writeText(selected.pixKey || '')}>Copiar chave PIX</Button>
          </Space.Compact>}
        </Card>
        <Button type="primary" loading={saving} disabled={!writable || !selectedIds.length} onClick={() => void prepare()}>Preparar liquidação</Button>
      </section>}

      {view === 'detail' && detail && <section className={styles.flow} aria-label="Detalhe da liquidação">
        <div className={styles.sectionHeading}><div><Title level={4}>{detail.fornecedor}</Title>
          <Text type="secondary">Liquidação registrada · CNPJ {detail.cnpjMasked}</Text></div>
          {detailStatus && <Tag color={detailStatus.color}>{detailStatus.label}</Tag>}</div>
        <div className={styles.amountGrid}><div className={styles.metric}><span>Bruto</span><strong>{formatCurrency(detail.grossAmount)}</strong></div>
          <div className={styles.metric}><span>Crédito</span><strong>{formatCurrency(detail.creditAmount)}</strong></div>
          <div className={`${styles.metric} ${styles.primaryMetric}`}><span>PIX</span><strong>{formatCurrency(detail.pixAmount)}</strong></div></div>
        <Card className={styles.flowCard} title="Compras deste fechamento">
          <div className={styles.purchaseList}>{detail.items.map((item) => <div className={styles.purchaseRow} key={item.id}>
            <div><strong>Compra #{item.dsid_snapshot}</strong><span>Venda #{item.sale_number_snapshot}</span></div>
            <div className={styles.itemAmounts}><span>Bruto {formatCurrency(item.gross_amount)}</span><span>Crédito {formatCurrency(item.credit_amount)}</span>
              <strong>PIX {formatCurrency(item.pix_amount)}</strong></div>
          </div>)}</div>
          {detail.hasReceipt && <Button href={`/api/compras/liquidacoes/${detail.id}/comprovante`} target="_blank">Ver comprovante</Button>}
        </Card>
        {detail.status === 'prepared' && <Card className={styles.flowCard} title="Conferir e confirmar">
          <div className={styles.stack}><Alert type="warning" showIcon message={detail.pixAmount === 0 ? 'Compensação integral por crédito' : 'Confirme somente após fazer o PIX no banco'} />
            {detail.pixAmount > 0 && <Input value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} placeholder="Referência PIX (opcional)" />}
            <Input.TextArea value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} placeholder="Observações internas (opcional)" />
            {!detail.hasReceipt && <Upload maxCount={1} beforeUpload={(file) => { if (file.size > 10 * 1024 * 1024) { messageApi.error('Comprovante maior que 10 MB'); return Upload.LIST_IGNORE; } setReceipt(file as File); return false; }}
              onRemove={() => setReceipt(null)} fileList={receipt ? [{ uid: 'receipt', name: receipt.name, status: 'done' }] : []} accept="application/pdf,image/jpeg,image/png,image/webp">
              <Button>Comprovante opcional</Button></Upload>}
            <Checkbox checked={pixDone} onChange={(event) => setPixDone(event.target.checked)}>{detail.pixAmount === 0 ? 'Confirmo a compensação de crédito' : 'Confirmo que o PIX foi realizado no banco'}</Checkbox>
            <Space wrap><Button type="primary" disabled={!writable || !detail.canConfirmBatch || !pixDone} loading={saving} onClick={() => void confirm()}>Confirmar fechamento</Button>
              <Button danger disabled={!writable} loading={saving} onClick={() => Modal.confirm({ title: 'Cancelar liquidação preparada?', onOk: cancel })}>Cancelar preparo</Button></Space>
          </div>
        </Card>}
        {detail.status === 'confirmed' && <>
          <Card className={styles.flowCard} title="Acompanhamento das vendas">
            <Text>Pós-processamento: <Tag>{detail.postprocess?.status || 'não encontrado'}</Tag></Text>
            <div className={styles.stack}>{detail.resumeEffects.map((effect) => <div className={styles.effectRow} key={effect.pedido_id}>
              <strong>Venda {effect.pedido_id}</strong><Tag>{effect.status}</Tag><Text type="secondary">{effect.attempts} tentativa(s)</Text>
              {['uncertain', 'failed'].includes(effect.status) && <div className={styles.stack}>
                <Select value={decision === 'done' ? 'done' : 'not_done'} onChange={setDecision} options={[{ value: 'done', label: 'Retomada comprovada' }, { value: 'not_done', label: 'Não ocorreu; liberar nova tentativa' }]} />
                <Input.TextArea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Evidência e justificativa (mín. 10 caracteres)" />
                <Button disabled={!writable || decisionNote.trim().length < 10} onClick={() => void resolveEffect('resume', effect.pedido_id)}>Registrar decisão</Button>
              </div>}</div>)}</div>
          </Card>
          <Card className={styles.flowCard} title="Comunicação ao fornecedor">
            {!detail.communicationId && <div className={styles.stack}><Text>Selecione explicitamente as liquidações do mesmo contato para a mensagem:</Text>
              <Checkbox.Group className={styles.checkboxList} value={communicationIds} onChange={(values) => {
                if (values.length > 20) { messageApi.warning('Selecione no máximo 20 liquidações.'); return; }
                setCommunicationIds(values as string[]);
              }} options={contactCandidates.map((item) => ({ label: `${item.fornecedor} · ${item.cnpjMasked} · PIX ${formatCurrency(item.pixAmount)}`, value: item.id }))} />
              {contactCandidates.length < contactTotal && <Button onClick={() => void loadMoreContacts()}>Carregar mais deste contato</Button>}
              <Button disabled={!writable || !communicationIds.includes(detail.id)} onClick={() => void createCommunication()}>Gerar mensagem para revisão</Button>
            </div>}
            {communication && <div className={styles.stack}><div><Tag>{communication.status}</Tag><Text>Contato {communication.contactMasked}</Text></div>
              <pre className={styles.messagePreview}>{communication.body}</pre>
              {communication.status === 'draft' && <Button type="primary" disabled={!writable} loading={saving}
                onClick={() => Modal.confirm({ title: 'Aprovar e enfileirar esta mensagem?', onOk: approveCommunication })}>Aprovar mensagem</Button>}
              {['uncertain', 'failed'].includes(communication.status) && <div className={styles.stack}>
                <Select value={decision === 'sent' ? 'sent' : 'not_sent'} onChange={setDecision} options={[{ value: 'sent', label: 'Envio comprovado' }, { value: 'not_sent', label: 'Não enviado; liberar nova tentativa' }]} />
                <Input.TextArea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Evidência e justificativa (mín. 10 caracteres)" />
                <Button disabled={!writable || decisionNote.trim().length < 10} onClick={() => void resolveEffect('communication')}>Registrar decisão</Button>
              </div>}</div>}
          </Card>
        </>}
      </section>}
    </div>
  </Drawer>;
}
