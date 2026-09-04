'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type {
  ManualSupplierLedgerAction,
  SupplierLedgerMovementType,
} from '@/lib/supplier-ledger';
import type {
  SupplierCreditMovement,
  SupplierCreditPosition,
  SupplierCreditsSummary,
} from '@/lib/supplier-credits-visual-review';
import styles from './creditos.module.css';

const { Text, Title } = Typography;

type ManualMovementForm = {
  fornecedor_id: string;
  movement_type: ManualSupplierLedgerAction;
  amount: number;
  reference?: string | null;
  notes: string;
};

type ViewMode = 'operational' | 'historical';
type MovementStatusFilter = 'all' | 'pending' | 'confirmed' | 'rejected';
type VisualReviewMetadata = {
  enabled: true;
  source: 'production-read-only';
  capturedAt: string;
  expiresAt: string;
  supplierCount: number;
  movementCount: number;
};

type CreditsResponse = {
  summary?: SupplierCreditsSummary;
  suppliers?: SupplierCreditPosition[];
  pending_movements?: SupplierCreditMovement[];
  pending_count?: number;
  updated_at?: string;
  visualReview?: VisualReviewMetadata;
  error?: string;
};

const EMPTY_SUMMARY: SupplierCreditsSummary = {
  available: 0,
  pending: 0,
  used_month: 0,
  suppliers_with_pending: 0,
};

const MOVEMENT_LABELS: Record<SupplierLedgerMovementType, string> = {
  cancellation_credit: 'Crédito por cancelamento',
  manual_credit: 'Crédito registrado manualmente',
  credit_usage: 'Crédito utilizado',
  adjustment: 'Ajuste de saldo',
  topup: 'Crédito da antiga conta-saldo',
  purchase_debit: 'Débito de compra da antiga conta-saldo',
};

const SOURCE_LABELS: Record<string, string> = {
  ml_cancellation: 'Cancelamento de venda',
  manual: 'Lançamento manual',
  historical_reconciliation: 'Reconciliação histórica',
  legacy: 'Histórico importado',
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number(value || 0));
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Sem movimentação';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data inválida';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function relativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data desconhecida';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} dia${days === 1 ? '' : 's'}`;
}

function movementLabel(type: SupplierLedgerMovementType): string {
  return MOVEMENT_LABELS[type];
}

function sourceLabel(source: string | null): string {
  return source ? SOURCE_LABELS[source] || 'Registro do sistema' : 'Histórico anterior';
}

function statusTag(status: string) {
  if (status === 'confirmed') return <Tag color="green">Confirmado</Tag>;
  if (status === 'pending') return <Tag color="gold">A confirmar</Tag>;
  if (status === 'rejected') return <Tag color="red">Rejeitado</Tag>;
  return <Tag>Cancelado</Tag>;
}

function actionDescription(action: ManualSupplierLedgerAction | undefined): string {
  if (action === 'manual_credit') return 'O valor será somado ao crédito disponível do fornecedor.';
  if (action === 'credit_usage') return 'O valor será descontado do crédito disponível do fornecedor.';
  if (action === 'adjustment_credit') return 'A correção aumentará o saldo confirmado.';
  if (action === 'adjustment_debit') return 'A correção reduzirá o saldo confirmado.';
  return 'Escolha como este lançamento deve afetar o crédito do fornecedor.';
}

export default function SupplierCreditsPage() {
  const [messageApi, messageContextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const [form] = Form.useForm<ManualMovementForm>();
  const movementAction = Form.useWatch('movement_type', form);
  const movementSupplierId = Form.useWatch('fornecedor_id', form);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [summary, setSummary] = useState<SupplierCreditsSummary>(EMPTY_SUMMARY);
  const [suppliers, setSuppliers] = useState<SupplierCreditPosition[]>([]);
  const [pendingMovements, setPendingMovements] = useState<SupplierCreditMovement[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('operational');
  const [search, setSearch] = useState('');
  const [showAllPending, setShowAllPending] = useState(false);

  const [selectedSupplier, setSelectedSupplier] = useState<SupplierCreditPosition | null>(null);
  const [movements, setMovements] = useState<SupplierCreditMovement[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [movementStatus, setMovementStatus] = useState<MovementStatusFilter>('all');
  const [movementType, setMovementType] = useState<SupplierLedgerMovementType | 'all'>('all');

  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [decisionMovement, setDecisionMovement] = useState<SupplierCreditMovement | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionId, setDecisionId] = useState<string | null>(null);

  const selectedMovementSupplier = suppliers.find((supplier) => (
    supplier.fornecedor_id === movementSupplierId
  ));

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/fornecedores/creditos', { cache: 'no-store' });
      const json = await response.json().catch(() => ({})) as CreditsResponse;
      if (!response.ok) throw new Error(json.error || 'Não foi possível carregar os créditos');
      setSummary(json.summary || EMPTY_SUMMARY);
      setSuppliers(Array.isArray(json.suppliers) ? json.suppliers : []);
      setPendingMovements(Array.isArray(json.pending_movements) ? json.pending_movements : []);
      setPendingCount(Number(json.pending_count || 0));
      setUpdatedAt(json.updated_at || new Date().toISOString());
      setVisualReview(json.visualReview || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os créditos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const fetchMovements = useCallback(async (supplier: SupplierCreditPosition) => {
    setDrawerLoading(true);
    try {
      const response = await fetch(
        `/api/fornecedores/creditos?fornecedor_id=${encodeURIComponent(supplier.fornecedor_id)}`,
        { cache: 'no-store' },
      );
      const json = await response.json().catch(() => ({})) as {
        movements?: SupplierCreditMovement[];
        error?: string;
      };
      if (!response.ok) throw new Error(json.error || 'Não foi possível carregar o extrato');
      setMovements(Array.isArray(json.movements) ? json.movements : []);
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : 'Não foi possível carregar o extrato');
    } finally {
      setDrawerLoading(false);
    }
  }, [messageApi]);

  const operationalSuppliers = useMemo(() => suppliers.filter((supplier) => !supplier.read_only), [suppliers]);
  const historicalSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.read_only), [suppliers]);
  const visibleSuppliers = useMemo(() => {
    const source = viewMode === 'operational' ? operationalSuppliers : historicalSuppliers;
    const normalized = search.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return source;
    return source.filter((supplier) => (
      supplier.fornecedor_nome.toLocaleLowerCase('pt-BR').includes(normalized)
      || supplier.fornecedor_id.toLocaleLowerCase('pt-BR').includes(normalized)
    ));
  }, [historicalSuppliers, operationalSuppliers, search, viewMode]);

  const visiblePending = showAllPending ? pendingMovements : pendingMovements.slice(0, 5);

  const filteredMovements = useMemo(() => movements.filter((movement) => (
    (movementStatus === 'all' || movement.status === movementStatus)
    && (movementType === 'all' || movement.movement_type === movementType)
  )), [movementStatus, movementType, movements]);

  const openStatement = async (supplier: SupplierCreditPosition) => {
    setSelectedSupplier(supplier);
    setMovements([]);
    setMovementStatus('all');
    setMovementType('all');
    await fetchMovements(supplier);
  };

  const reconcile = async () => {
    if (visualReview) {
      messageApi.warning('Simulação visual: nenhuma pendência foi criada.');
      return;
    }
    setReconciling(true);
    try {
      const response = await fetch('/api/fornecedores/creditos/reconciliar', { method: 'POST' });
      const json = await response.json().catch(() => ({})) as { created?: number; error?: string };
      if (!response.ok) throw new Error(json.error || 'Não foi possível buscar os cancelamentos');
      messageApi.success(`${json.created || 0} nova(s) pendência(s) encontrada(s).`);
      await fetchSummary();
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : 'Não foi possível buscar os cancelamentos');
    } finally {
      setReconciling(false);
    }
  };

  const confirmReconciliation = () => {
    modalApi.confirm({
      title: 'Buscar créditos de cancelamentos?',
      content: 'O Vortek revisará vendas canceladas que já tiveram PIX pago ao fornecedor e criará somente as pendências ainda inexistentes.',
      okText: 'Buscar agora',
      cancelText: 'Cancelar',
      icon: <SyncOutlined />,
      onOk: reconcile,
    });
  };

  const decideMovement = async (status: 'confirmed' | 'rejected') => {
    if (!decisionMovement) return;
    if (visualReview || decisionMovement.isHomologationFixture) {
      messageApi.warning('Simulação visual: nenhuma decisão financeira foi gravada.');
      setDecisionMovement(null);
      setDecisionNotes('');
      return;
    }

    setDecisionId(decisionMovement.id);
    try {
      const response = await fetch(`/api/fornecedores/creditos/${decisionMovement.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes: decisionNotes.trim() || null }),
      });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(json.error || 'Não foi possível registrar a decisão');
      messageApi.success(status === 'confirmed' ? 'Crédito confirmado.' : 'Pendência rejeitada.');
      setDecisionMovement(null);
      setDecisionNotes('');
      await fetchSummary();
      if (selectedSupplier) await fetchMovements(selectedSupplier);
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : 'Não foi possível registrar a decisão');
    } finally {
      setDecisionId(null);
    }
  };

  const saveMovement = async () => {
    const values = await form.validateFields();
    if (visualReview) {
      messageApi.warning('Simulação visual: nenhuma movimentação financeira foi gravada.');
      return;
    }

    setSavingMovement(true);
    try {
      const response = await fetch('/api/fornecedores/creditos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(json.error || 'Não foi possível registrar a movimentação');
      messageApi.success('Movimentação registrada.');
      setMovementModalOpen(false);
      form.resetFields();
      await fetchSummary();
      if (selectedSupplier?.fornecedor_id === values.fornecedor_id) {
        await fetchMovements(selectedSupplier);
      }
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : 'Não foi possível registrar a movimentação');
    } finally {
      setSavingMovement(false);
    }
  };

  const supplierColumns: ColumnsType<SupplierCreditPosition> = [
    {
      key: 'supplier', title: 'Fornecedor', width: 270,
      sorter: (left, right) => left.fornecedor_nome.localeCompare(right.fornecedor_nome),
      render: (_, record) => (
        <div className={styles.supplierCell}>
          <strong>{record.fornecedor_nome}</strong>
          <span>DSLite #{record.fornecedor_id.replace('bnt-d17-', '')}</span>
          {!record.ativo && !record.read_only && <small>Cadastro inativo</small>}
        </div>
      ),
    },
    {
      key: 'available', title: viewMode === 'historical' ? 'Saldo contábil final' : 'Disponível',
      dataIndex: 'available', align: 'right', width: 165,
      sorter: (left, right) => left.available - right.available,
      render: (value, record) => (
        <div className={record.read_only ? styles.historicalValue : styles.availableValue}>
          <strong>{formatCurrency(value)}</strong>
          <small>{record.read_only ? 'registro encerrado' : 'crédito confirmado'}</small>
        </div>
      ),
    },
    ...(viewMode === 'operational' ? [{
      key: 'pending', title: 'A confirmar', dataIndex: 'pending' as const,
      align: 'right' as const, width: 165,
      sorter: (left: SupplierCreditPosition, right: SupplierCreditPosition) => left.pending - right.pending,
      render: (value: number, record: SupplierCreditPosition) => (
        <div className={styles.pendingValue}>
          <strong>{value > 0 ? formatCurrency(value) : '—'}</strong>
          <small>{record.pending_count > 0 ? `${record.pending_count} pendência${record.pending_count === 1 ? '' : 's'}` : 'sem pendências'}</small>
        </div>
      ),
    }, {
      key: 'used', title: 'Utilizado no mês', dataIndex: 'used_month' as const,
      align: 'right' as const, width: 165,
      render: (value: number) => (
        <div className={styles.neutralValue}>
          <strong>{formatCurrency(value)}</strong>
          <small>crédito compensado</small>
        </div>
      ),
    }] : [{
      key: 'movements', title: 'Movimentos', dataIndex: 'movement_count' as const,
      align: 'right' as const, width: 130,
      render: (value: number) => <Text>{value.toLocaleString('pt-BR')}</Text>,
    }]),
    {
      key: 'last', title: 'Último movimento', dataIndex: 'last_movement_at', width: 180,
      render: (value) => (
        <div className={styles.dateCell}>
          <strong>{formatDateTime(value)}</strong>
          {value && <small>há {relativeDate(value)}</small>}
        </div>
      ),
    },
    {
      key: 'actions', title: 'Ações', width: 125, fixed: 'right',
      render: (_, record) => (
        <Button size="small" icon={<HistoryOutlined />} onClick={() => void openStatement(record)}>Extrato</Button>
      ),
    },
  ];

  const movementColumns: ColumnsType<SupplierCreditMovement> = [
    {
      key: 'date', title: 'Data', dataIndex: 'created_at', width: 145,
      render: (value) => <span className={styles.movementDate}>{formatDateTime(value)}</span>,
    },
    {
      key: 'movement', title: 'Movimento', width: 330,
      render: (_, record) => (
        <div className={styles.movementCell}>
          <strong>{movementLabel(record.movement_type)}</strong>
          <span>{record.reference || 'Sem referência informada'}</span>
          <small>{sourceLabel(record.source)}{record.confirmed_by ? ` · ${record.confirmed_by}` : ''}</small>
        </div>
      ),
    },
    {
      key: 'in', title: 'Entrada', align: 'right', width: 135,
      render: (_, record) => record.amount > 0
        ? <strong className={styles.creditValue}><ArrowUpOutlined /> {formatCurrency(record.amount)}</strong>
        : <Text type="secondary">—</Text>,
    },
    {
      key: 'out', title: 'Saída', align: 'right', width: 135,
      render: (_, record) => record.amount < 0
        ? <strong className={styles.debitValue}><ArrowDownOutlined /> {formatCurrency(Math.abs(record.amount))}</strong>
        : <Text type="secondary">—</Text>,
    },
    { key: 'status', title: 'Situação', dataIndex: 'status', width: 120, render: statusTag },
    {
      key: 'action', title: 'Ações', width: 105,
      render: (_, record) => !selectedSupplier?.read_only && record.status === 'pending'
        ? <Button size="small" onClick={() => setDecisionMovement(record)}>Analisar</Button>
        : <Text type="secondary">—</Text>,
    },
  ];

  return (
    <div className={styles.page}>
      {messageContextHolder}
      {modalContextHolder}

      <header className={styles.header}>
        <div>
          <Title level={2}>Créditos de fornecedores</Title>
          <Text>Controle de créditos confirmados, compensações e cancelamentos aguardando decisão.</Text>
          <small>{updatedAt ? `Atualizado em ${formatDateTime(updatedAt)}` : 'Aguardando primeira atualização'}</small>
        </div>
        <div className={styles.headerActions}>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchSummary()}>Atualizar</Button>
          <Button icon={<SyncOutlined />} loading={reconciling} onClick={confirmReconciliation}>Buscar cancelamentos</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setMovementModalOpen(true)}>Novo movimento</Button>
        </div>
      </header>

      {visualReview && (
        <Alert showIcon type="info" icon={<SafetyCertificateOutlined />}
          message="Amostra financeira protegida de homologação"
          description="Os valores reproduzem cenários reais de forma anonimizada. Formulários e decisões podem ser avaliados, mas nenhuma ação será gravada." />
      )}

      {error && (
        <Alert showIcon type="error" message="Não foi possível carregar os créditos" description={error}
          action={<Button size="small" onClick={() => void fetchSummary()}>Tentar novamente</Button>} />
      )}

      <section className={styles.summary} aria-label="Resumo financeiro">
        <div className={styles.summaryHighlight}><span>Crédito disponível</span><strong>{formatCurrency(summary.available)}</strong><small>confirmado e pronto para compensar</small></div>
        <div><span>A confirmar</span><strong>{formatCurrency(summary.pending)}</strong><small>{pendingCount} pendência{pendingCount === 1 ? '' : 's'} aguardando decisão</small></div>
        <div><span>Utilizado no mês</span><strong>{formatCurrency(summary.used_month)}</strong><small>crédito já compensado</small></div>
        <div><span>Fornecedores pendentes</span><strong>{summary.suppliers_with_pending}</strong><small>exigem contato ou conferência</small></div>
      </section>

      <section className={styles.pendingPanel}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.eyebrow}>Fila prioritária</span><Title level={4}>Aguardando sua decisão</Title><Text>Mais antigas primeiro para reduzir créditos esquecidos.</Text></div>
          {pendingMovements.length > 5 && <Button type="text" onClick={() => setShowAllPending((current) => !current)}>{showAllPending ? 'Mostrar menos' : `Ver todas (${pendingCount})`}</Button>}
        </div>
        {loading && suppliers.length === 0 ? <div className={styles.loadingState}><Spin /></div>
          : visiblePending.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum crédito aguardando decisão" />
            : <div className={styles.pendingList}>{visiblePending.map((movement) => (
              <div className={styles.pendingRow} key={movement.id}>
                <span className={styles.pendingAge}><ClockCircleOutlined /> há {relativeDate(movement.created_at)}</span>
                <div className={styles.pendingIdentity}><strong>{movement.fornecedor_nome || 'Fornecedor'}</strong><span>{movement.reference || 'Cancelamento sem referência informada'}</span></div>
                <div className={styles.pendingAmount}><small>Crédito candidato</small><strong>{formatCurrency(movement.amount)}</strong></div>
                <Button type="primary" onClick={() => setDecisionMovement(movement)}>Analisar</Button>
              </div>
            ))}</div>}
      </section>

      <section className={styles.positionsPanel}>
        <div className={styles.positionsHeader}>
          <Segmented<ViewMode> value={viewMode} onChange={(value) => { setViewMode(value); setSearch(''); }} options={[
            { label: `Operação atual ${operationalSuppliers.length}`, value: 'operational' },
            { label: `Histórico aposentado ${historicalSuppliers.length}`, value: 'historical' },
          ]} />
          <Input allowClear prefix={<SearchOutlined />} placeholder="Buscar fornecedor ou código DSLite" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {viewMode === 'historical' && <Alert showIcon type="warning" message="Conta-saldo aposentada · Hayamax" description="Aposentado · somente leitura. Este histórico não participa dos totais operacionais e não permite novos movimentos, decisões ou reconciliações." />}
        <Table<SupplierCreditPosition> rowKey="fornecedor_id" loading={loading} columns={supplierColumns} dataSource={visibleSuppliers}
          pagination={{ pageSize: 15, hideOnSinglePage: true, showTotal: (total) => `${total} fornecedor${total === 1 ? '' : 'es'}` }}
          scroll={{ x: viewMode === 'operational' ? 1070 : 820 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum fornecedor neste recorte" /> }} />
      </section>

      <Drawer title={selectedSupplier?.read_only ? 'Histórico da antiga conta-saldo' : 'Extrato de créditos'}
        extra={selectedSupplier && <span className={styles.drawerSupplier}>{selectedSupplier.fornecedor_nome}</span>}
        open={Boolean(selectedSupplier)} width="min(1040px, 96vw)" loading={drawerLoading} destroyOnHidden onClose={() => setSelectedSupplier(null)}>
        {selectedSupplier?.read_only && <Alert type="warning" showIcon message="Somente leitura" description="Movimentos da antiga conta-saldo permanecem disponíveis apenas para auditoria histórica." className={styles.drawerAlert} />}
        {selectedSupplier && <div className={styles.drawerSummary}>
          <div><span>{selectedSupplier.read_only ? 'Saldo contábil final' : 'Disponível'}</span><strong>{formatCurrency(selectedSupplier.available)}</strong></div>
          <div><span>A confirmar</span><strong>{formatCurrency(selectedSupplier.pending)}</strong></div>
          <div><span>Utilizado no mês</span><strong>{formatCurrency(selectedSupplier.used_month)}</strong></div>
          <div><span>Movimentos</span><strong>{selectedSupplier.movement_count.toLocaleString('pt-BR')}</strong></div>
        </div>}
        <div className={styles.drawerFilters}>
          <Select<MovementStatusFilter> value={movementStatus} onChange={setMovementStatus} options={[
            { value: 'all', label: 'Todas as situações' }, { value: 'pending', label: 'A confirmar' },
            { value: 'confirmed', label: 'Confirmados' }, { value: 'rejected', label: 'Rejeitados' },
          ]} />
          <Select<SupplierLedgerMovementType | 'all'> value={movementType} onChange={setMovementType} options={[
            { value: 'all', label: 'Todos os movimentos' },
            ...Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label })),
          ]} />
        </div>
        <Table<SupplierCreditMovement> rowKey="id" columns={movementColumns} dataSource={filteredMovements}
          pagination={{ pageSize: 15, showSizeChanger: true }} scroll={{ x: 940 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum movimento neste filtro" /> }} />
      </Drawer>

      <Modal title="Novo movimento de crédito" open={movementModalOpen} destroyOnHidden confirmLoading={savingMovement}
        okText="Registrar movimento" cancelText="Cancelar" onCancel={() => setMovementModalOpen(false)} onOk={() => void saveMovement()}>
        <Form form={form} layout="vertical" preserve={false} initialValues={{ movement_type: 'manual_credit' }}>
          <Form.Item name="fornecedor_id" label="Fornecedor" rules={[{ required: true, message: 'Escolha um fornecedor' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Selecione o fornecedor" options={operationalSuppliers.map((supplier) => ({ value: supplier.fornecedor_id, label: supplier.fornecedor_nome }))} />
          </Form.Item>
          {selectedMovementSupplier && <div className={styles.balancePreview}><span>Crédito disponível agora</span><strong>{formatCurrency(selectedMovementSupplier.available)}</strong></div>}
          <Form.Item name="movement_type" label="Efeito do movimento" rules={[{ required: true }]}>
            <Select options={[
              { value: 'manual_credit', label: 'Adicionar crédito confirmado' }, { value: 'credit_usage', label: 'Registrar utilização de crédito' },
              { value: 'adjustment_credit', label: 'Corrigir saldo para mais' }, { value: 'adjustment_debit', label: 'Corrigir saldo para menos' },
            ]} />
          </Form.Item>
          <Alert showIcon type="info" message={actionDescription(movementAction)} className={styles.formAlert} />
          <Form.Item name="amount" label="Valor" rules={[{ required: true, message: 'Informe o valor' }]}><InputNumber<number> min={0.01} precision={2} style={{ width: '100%' }} prefix="R$" /></Form.Item>
          <Form.Item name="reference" label="Referência"><Input maxLength={200} placeholder="Pedido, protocolo ou confirmação do fornecedor" /></Form.Item>
          <Form.Item name="notes" label="Motivo do movimento" rules={[{ required: true, min: 3, message: 'Explique o motivo do movimento' }]}><Input.TextArea maxLength={1000} showCount rows={3} placeholder="Registre por que este crédito está sendo lançado ou utilizado" /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Analisar crédito candidato" open={Boolean(decisionMovement)} destroyOnHidden
        onCancel={() => { setDecisionMovement(null); setDecisionNotes(''); }} footer={[
          <Button key="cancel" onClick={() => setDecisionMovement(null)}>Cancelar</Button>,
          <Button key="reject" danger loading={decisionId === decisionMovement?.id} onClick={() => void decideMovement('rejected')}>Rejeitar crédito</Button>,
          <Button key="confirm" type="primary" loading={decisionId === decisionMovement?.id} onClick={() => void decideMovement('confirmed')}>Confirmar crédito</Button>,
        ]}>
        {decisionMovement && <div className={styles.decisionBody}>
          <div className={styles.decisionAmount}><span>{decisionMovement.fornecedor_nome || 'Fornecedor'}</span><strong>{formatCurrency(decisionMovement.amount)}</strong><small>{decisionMovement.reference || 'Sem referência informada'}</small></div>
          <Alert showIcon type="warning" message="Confirme somente depois de o fornecedor reconhecer o crédito. A confirmação libera o valor para compensações futuras; a rejeição mantém o saldo inalterado." />
          <label className={styles.decisionNotes}><span>Observação da decisão (opcional)</span><Input.TextArea maxLength={1000} showCount rows={3} value={decisionNotes} onChange={(event) => setDecisionNotes(event.target.value)} placeholder="Protocolo, contato realizado ou motivo da rejeição" /></label>
        </div>}
      </Modal>
    </div>
  );
}
