'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  CheckCircleOutlined,
  EllipsisOutlined,
  MailOutlined,
  PhoneOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import { hasPermission, type VortekRole } from '@/lib/permissions';
import {
  appendRemoteSortParams,
  getRemoteSortOrder,
  resolveRemoteSortState,
  type RemoteSortState,
} from '@/lib/remote-sort';
import type {
  FornecedorListItem,
  FornecedoresFilterOptions,
  FornecedoresListResponse,
  FornecedoresSummary,
} from '@/types/fornecedores';
import styles from './fornecedores.module.css';

const { Text, Title } = Typography;

type OperationalStatus = 'active' | 'inactive' | 'all';
type FreshnessFilter = '' | 'healthy' | 'attention';
type SyncFeedback = {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description: string;
} | null;

const VALID_ROLES: VortekRole[] = ['admin', 'gerente', 'operador', 'visualizador'];
const EMPTY_SUMMARY: FornecedoresSummary = {
  total: 0,
  active: 0,
  inactive: 0,
  sync_attention: 0,
  last_sync_at: null,
};
const EMPTY_OPTIONS: FornecedoresFilterOptions = {
  status_dslite: [],
  crossdocking: [],
  dropshipping: [],
};

function supplierLabel(supplier: FornecedorListItem): string {
  return supplier.apelido || supplier.nome || supplier.dslite_id || 'Fornecedor';
}

function formatDocument(value: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value?.trim() || 'CNPJ não informado';
}

function formatExactDate(value: string | null): string {
  if (!value) return 'Sincronização ainda não registrada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data de sincronização inválida';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function relativeDate(value: string | null): string {
  if (!value) return 'Nunca sincronizado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data desconhecida';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Há ${days} dia${days === 1 ? '' : 's'}`;
}

function updatedAtLabel(value: Date | null): string {
  if (!value) return 'Aguardando primeira atualização';
  return `Dados atualizados às ${value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function isEnabled(value: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('ativo') || normalized === 'sim' || normalized === 'true';
}

function modalityLine(label: string, value: string | null) {
  const enabled = isEnabled(value);
  return (
    <span className={enabled ? styles.modalityEnabled : styles.modalityDisabled}>
      {enabled ? <CheckCircleOutlined /> : <StopOutlined />}
      <strong>{label}</strong>
      <small>{value || 'Não informado'}</small>
    </span>
  );
}

export default function FornecedoresPage() {
  const [messageApi, messageContextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [suppliers, setSuppliers] = useState<FornecedorListItem[]>([]);
  const [summary, setSummary] = useState<FornecedoresSummary>(EMPTY_SUMMARY);
  const [filterOptions, setFilterOptions] = useState<FornecedoresFilterOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'apelido', sortOrder: 'asc' });
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [operationalStatus, setOperationalStatus] = useState<OperationalStatus>('active');
  const [crossdocking, setCrossdocking] = useState('');
  const [dropshipping, setDropshipping] = useState('');
  const [freshness, setFreshness] = useState<FreshnessFilter>('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [role, setRole] = useState<VortekRole | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const canManage = Boolean(role && hasPermission(role, 'suppliers.manage'));

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => {
        const cargo = profile?.cargo as VortekRole | undefined;
        setRole(cargo && VALID_ROLES.includes(cargo) ? cargo : null);
      })
      .catch(() => setRole(null));
  }, []);

  const fetchSuppliers = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        ativo: operationalStatus,
      });
      appendRemoteSortParams(params, sort);
      if (committedSearch) params.set('search', committedSearch);
      if (crossdocking) params.set('crossdocking', crossdocking);
      if (dropshipping) params.set('dropshipping', dropshipping);
      if (freshness) params.set('freshness', freshness);

      const response = await fetch(`/api/fornecedores?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as Partial<FornecedoresListResponse> & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os fornecedores');
      if (!Array.isArray(payload.data) || !payload.summary || !payload.filters) {
        throw new Error('A consulta de fornecedores retornou um formato inválido');
      }

      if (requestId !== requestSequence.current) return;
      setSuppliers(payload.data);
      setTotal(Number(payload.total || 0));
      setSummary(payload.summary);
      setFilterOptions(payload.filters);
      setUpdatedAt(new Date());
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os fornecedores');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [committedSearch, crossdocking, dropshipping, freshness, operationalStatus, page, pageSize, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== committedSearch) {
        setPage(1);
        setCommittedSearch(search.trim());
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [committedSearch, search]);

  useEffect(() => {
    void fetchSuppliers();
  }, [fetchSuppliers]);

  const clearFilters = () => {
    setSearch('');
    setCommittedSearch('');
    setOperationalStatus('active');
    setCrossdocking('');
    setDropshipping('');
    setFreshness('');
    setPage(1);
  };

  const selectSummary = (key: 'active' | 'inactive' | 'attention') => {
    setPage(1);
    if (key === 'attention') {
      setOperationalStatus('all');
      setFreshness('attention');
      return;
    }
    setOperationalStatus(key);
    setFreshness('');
  };

  const syncSuppliers = useCallback(async () => {
    setSyncing(true);
    setSyncFeedback({
      type: 'info',
      title: 'Sincronização DSLite em andamento',
      description: 'Aguarde a confirmação antes de iniciar outra atualização.',
    });
    try {
      const response = await fetch('/api/fornecedores/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.errors?.[0]?.message || 'Falha ao sincronizar fornecedores');

      const records = payload?.records || {};
      const errorCount = Array.isArray(payload?.errors) ? payload.errors.length : 0;
      const description = `${Number(records.inserted || 0)} incluídos, ${Number(records.updated || 0)} atualizados e ${Number(records.deactivated || 0)} inativados.`;
      setSyncFeedback({
        type: errorCount > 0 || payload?.success === false ? 'warning' : 'success',
        title: errorCount > 0 || payload?.success === false ? 'Sincronização concluída com atenção' : 'Sincronização concluída',
        description: errorCount > 0 ? `${description} ${errorCount} ocorrência(s) exigem revisão.` : description,
      });
      await fetchSuppliers();
    } catch (cause) {
      setSyncFeedback({
        type: 'error',
        title: 'Não foi possível sincronizar os fornecedores',
        description: cause instanceof Error ? cause.message : 'Falha inesperada na sincronização DSLite.',
      });
    } finally {
      setSyncing(false);
    }
  }, [fetchSuppliers]);

  const executeStatusChange = useCallback(async (supplier: FornecedorListItem, ativo: boolean) => {
    setStatusChangingId(supplier.id);
    try {
      const response = await fetch(`/api/fornecedores/${supplier.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) {
        throw new Error(payload?.error || 'Não foi possível alterar o fornecedor');
      }
      messageApi.success(`${supplierLabel(supplier)} foi ${ativo ? 'ativado' : 'inativado'}.`);
      await fetchSuppliers();
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : 'Não foi possível alterar o fornecedor');
    } finally {
      setStatusChangingId(null);
    }
  }, [fetchSuppliers, messageApi]);

  const confirmStatusChange = useCallback(async (supplier: FornecedorListItem, ativo: boolean) => {
    if (ativo) {
      const confirmed = await modal.confirm({
        title: `Ativar ${supplierLabel(supplier)}?`,
        content: 'Os produtos vinculados continuarão inativos até uma ativação manual.',
        okText: 'Ativar fornecedor',
        cancelText: 'Cancelar',
      });
      if (confirmed) await executeStatusChange(supplier, true);
      return;
    }

    setStatusChangingId(supplier.id);
    try {
      const response = await fetch(`/api/fornecedores/${supplier.id}/status`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível calcular o impacto');
      const impact = payload?.impact || {};
      const confirmed = await modal.confirm({
        title: `Inativar ${supplierLabel(supplier)}?`,
        content: (
          <div className={styles.impactSummary}>
            <p>A operação afeta o catálogo vinculado e não deve ser usada apenas para ocultar um cadastro.</p>
            <dl>
              <div><dt>Produtos ativos</dt><dd>{Number(impact.products_active || 0)}</dd></div>
              <div><dt>Ofertas ativas</dt><dd>{Number(impact.supplier_offers_active || 0)}</dd></div>
              <div><dt>Mantidos pelo estoque interno</dt><dd>{Number(impact.products_kept_only_by_internal_stock || 0)}</dd></div>
              <div><dt>Sem fonte disponível</dt><dd>{Number(impact.products_without_available_source || 0)}</dd></div>
              <div><dt>Anúncios a pausar</dt><dd>{Number(impact.ml_pause_candidates || 0)}</dd></div>
            </dl>
            <strong>Anúncios ativos sem fornecedor alternativo nem estoque interno serão pausados com estoque zero, preservando o vínculo para retomada.</strong>
          </div>
        ),
        okText: 'Inativar fornecedor',
        okButtonProps: { danger: true },
        cancelText: 'Cancelar',
      });
      if (confirmed) await executeStatusChange(supplier, false);
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : 'Não foi possível calcular o impacto');
    } finally {
      setStatusChangingId(null);
    }
  }, [executeStatusChange, messageApi, modal]);

  const columns: TableProps<FornecedorListItem>['columns'] = [
    {
      title: 'Fornecedor',
      key: 'apelido',
      width: 310,
      sorter: true,
      sortOrder: getRemoteSortOrder('apelido', sort),
      render: (_, supplier) => (
        <div className={styles.supplierCell}>
          <Link href={`/fornecedores/${supplier.id}`}>{supplierLabel(supplier)}</Link>
          <span>{supplier.nome || 'Razão social não informada'}</span>
          <small>{formatDocument(supplier.cnpj)} · DSLite {supplier.dslite_id || 'sem ID'}</small>
        </div>
      ),
    },
    {
      title: 'Modalidades',
      key: 'modalities',
      width: 245,
      render: (_, supplier) => (
        <div className={styles.modalitiesCell}>
          {modalityLine('Cross-docking', supplier.crossdocking)}
          {modalityLine('Dropshipping', supplier.dropshipping)}
        </div>
      ),
    },
    {
      title: 'Situação',
      key: 'ativo',
      width: 190,
      sorter: true,
      sortOrder: getRemoteSortOrder('ativo', sort),
      render: (_, supplier) => (
        <div className={styles.statusCell}>
          <Tag color={supplier.ativo === false ? 'default' : 'green'}>
            {supplier.ativo === false ? 'Inativo' : 'Operacional'}
          </Tag>
          <span>DSLite: {supplier.status_dslite || 'não informado'}</span>
          {supplier.activation_blocked && <small>Histórico · reativação bloqueada</small>}
        </div>
      ),
    },
    {
      title: 'Contato',
      key: 'contact',
      width: 245,
      render: (_, supplier) => supplier.email || supplier.telefone ? (
        <div className={styles.contactCell}>
          {supplier.telefone && <span><PhoneOutlined />{supplier.telefone}</span>}
          {supplier.email && <span><MailOutlined />{supplier.email}</span>}
        </div>
      ) : <span className={styles.missing}>Contato não informado</span>,
    },
    {
      title: 'Última sincronização',
      key: 'dslite_ultima_sync',
      width: 190,
      sorter: true,
      sortOrder: getRemoteSortOrder('dslite_ultima_sync', sort),
      render: (_, supplier) => (
        <Tooltip title={formatExactDate(supplier.dslite_ultima_sync)}>
          <div className={styles.syncCell}>
            <Badge status={supplier.sync_health === 'healthy' ? 'success' : supplier.sync_health === 'attention' ? 'warning' : 'default'} />
            <span>{relativeDate(supplier.dslite_ultima_sync)}</span>
            <small>{supplier.sync_health === 'healthy' ? 'Dentro da frequência' : 'Sincronização requer atenção'}</small>
          </div>
        </Tooltip>
      ),
    },
    {
      title: 'Ações',
      key: 'actions',
      width: canManage ? 180 : 145,
      fixed: 'right',
      render: (_, supplier) => (
        <div className={styles.actionsCell}>
          <Link href={`/fornecedores/${supplier.id}`}>
            <Button size="small" icon={<RightOutlined />} iconPosition="end">Ver fornecedor</Button>
          </Link>
          {canManage && (
            <Dropdown
              trigger={['click']}
              menu={{
                items: [{
                  key: supplier.ativo === false ? 'activate' : 'deactivate',
                  label: supplier.ativo === false
                    ? supplier.activation_blocked ? 'Reativação bloqueada' : 'Ativar fornecedor'
                    : 'Inativar fornecedor',
                  danger: supplier.ativo !== false,
                  disabled: supplier.ativo === false && supplier.activation_blocked,
                }],
                onClick: ({ key }) => void confirmStatusChange(supplier, key === 'activate'),
              }}
            >
              <Button
                aria-label={`Outras ações de ${supplierLabel(supplier)}`}
                size="small"
                icon={<EllipsisOutlined />}
                loading={statusChangingId === supplier.id}
              />
            </Dropdown>
          )}
        </div>
      ),
    },
  ];

  const handleTableChange: TableProps<FornecedorListItem>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'apelido', sortOrder: 'asc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPageSize(pagination.pageSize || 20);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

  const hasSecondaryFilters = Boolean(
    committedSearch || operationalStatus !== 'active' || crossdocking || dropshipping || freshness,
  );

  return (
    <div className={styles.page}>
      {messageContextHolder}
      {modalContextHolder}
      <header className={styles.header}>
        <div>
          <Title level={2}>Fornecedores</Title>
          <Text>Capacidades, disponibilidade operacional e saúde da integração DSLite.</Text>
          <small>{updatedAtLabel(updatedAt)} · Última sincronização: {relativeDate(summary.last_sync_at)}</small>
        </div>
        <div className={styles.headerActions}>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchSuppliers()}>
            Atualizar dados
          </Button>
          {canManage && (
            <Button type="primary" icon={<SyncOutlined />} loading={syncing} onClick={() => void syncSuppliers()}>
              Sincronizar DSLite
            </Button>
          )}
        </div>
      </header>

      {syncFeedback && (
        <Alert
          showIcon
          closable={syncFeedback.type !== 'info'}
          type={syncFeedback.type}
          message={syncFeedback.title}
          description={syncFeedback.description}
          onClose={() => setSyncFeedback(null)}
        />
      )}

      <section className={styles.summary} aria-label="Resumo de fornecedores">
        {[
          { key: 'active' as const, label: 'Operacionais', value: summary.active, hint: 'fornecedores disponíveis' },
          { key: 'inactive' as const, label: 'Inativos', value: summary.inactive, hint: 'cadastros históricos' },
          { key: 'attention' as const, label: 'Sincronização com atenção', value: summary.sync_attention, hint: 'fora da frequência prevista' },
        ].map((item) => {
          const selected = item.key === 'attention'
            ? freshness === 'attention'
            : operationalStatus === item.key && freshness !== 'attention';
          return (
            <button
              key={item.key}
              type="button"
              className={selected ? styles.summaryActive : undefined}
              aria-pressed={selected}
              onClick={() => selectSummary(item.key)}
            >
              <span>{item.label}</span>
              <strong>{item.value.toLocaleString('pt-BR')}</strong>
              <small>{item.hint}</small>
            </button>
          );
        })}
      </section>

      <section className={styles.filterBar} aria-label="Filtros de fornecedores">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Buscar por fornecedor, razão social, CNPJ ou ID DSLite"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => { setSearch(''); setCommittedSearch(''); setPage(1); }}
        />
        <Select
          value={operationalStatus}
          aria-label="Filtrar situação operacional"
          options={[
            { value: 'active', label: 'Somente operacionais' },
            { value: 'inactive', label: 'Somente inativos' },
            { value: 'all', label: 'Todos os cadastros' },
          ]}
          onChange={(value: OperationalStatus) => { setOperationalStatus(value); setPage(1); }}
        />
        <Select
          value={crossdocking || undefined}
          allowClear
          placeholder="Cross-docking"
          options={filterOptions.crossdocking.map((value) => ({ value, label: value }))}
          onChange={(value) => { setCrossdocking(value || ''); setPage(1); }}
        />
        <Select
          value={dropshipping || undefined}
          allowClear
          placeholder="Dropshipping"
          options={filterOptions.dropshipping.map((value) => ({ value, label: value }))}
          onChange={(value) => { setDropshipping(value || ''); setPage(1); }}
        />
        <Select
          value={freshness || undefined}
          allowClear
          placeholder="Saúde da sincronização"
          options={[
            { value: 'healthy', label: 'Dentro da frequência' },
            { value: 'attention', label: 'Requer atenção' },
          ]}
          onChange={(value: FreshnessFilter | undefined) => { setFreshness(value || ''); setPage(1); }}
        />
        {hasSecondaryFilters && <Button onClick={clearFilters}>Limpar filtros</Button>}
      </section>

      {error && (
        <Alert
          type="error"
          showIcon
          message="Não foi possível carregar os fornecedores"
          description={error}
          action={<Button size="small" onClick={() => void fetchSuppliers()}>Tentar novamente</Button>}
        />
      )}

      <section className={styles.tableCard}>
        <Spin spinning={loading}>
          <ResizableTable<FornecedorListItem>
            storageKey="fornecedores-bentevi-v1"
            rowKey="id"
            dataSource={suppliers}
            columns={columns}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (value) => `${value.toLocaleString('pt-BR')} fornecedor${value === 1 ? '' : 'es'}`,
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={hasSecondaryFilters
                    ? 'Nenhum fornecedor corresponde aos filtros'
                    : 'Nenhum fornecedor cadastrado'}
                />
              ),
            }}
            onChange={handleTableChange}
            scroll={{ x: 1360 }}
            size="middle"
          />
        </Spin>
      </section>
    </div>
  );
}
