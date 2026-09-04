'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  ClockCircleOutlined,
  ExclamationCircleFilled,
  ExportOutlined,
  MessageOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningFilled,
} from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import ResizableTable from '@/components/ResizableTable';
import {
  claimActionLabel,
  claimRoleLabel,
  type ClaimDetailResponse,
  type ClaimListItem,
  type ClaimPriority,
  type ClaimsListResponse,
} from '@/lib/ml/claims';
import styles from './reclamacoes.module.css';

const { Paragraph, Text, Title } = Typography;

const PRIORITY_META: Record<ClaimPriority, { label: string; color: string; icon: React.ReactNode }> = {
  overdue: { label: 'Prazo vencido', color: 'red', icon: <ExclamationCircleFilled /> },
  due_today: { label: 'Vence hoje', color: 'orange', icon: <ClockCircleOutlined /> },
  seller_action: { label: 'Sua ação', color: 'gold', icon: <WarningFilled /> },
  waiting: { label: 'Aguardando', color: 'blue', icon: <ClockCircleOutlined /> },
  closed: { label: 'Concluída', color: 'default', icon: <ClockCircleOutlined /> },
  unknown: { label: 'A confirmar', color: 'default', icon: <ClockCircleOutlined /> },
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Não informado';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDueDate(value: string | null | undefined) {
  if (!value) return 'Sem prazo informado';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Sem prazo informado';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function resolutionText(value: Record<string, unknown> | null) {
  if (!value) return 'Ainda sem resolução registrada.';
  const reason = value.reason || value.reason_name;
  const closedBy = value.closed_by || value.role;
  return [reason, closedBy ? `Encerrada por ${claimRoleLabel(String(closedBy))}` : null]
    .filter(Boolean)
    .map(String)
    .join(' · ') || 'Resolução registrada pelo Mercado Livre.';
}

function reputationText(detail: ClaimDetailResponse['affects_reputation']) {
  if (!detail?.affects_reputation) return 'Informação não disponível';
  if (detail.affects_reputation === 'affected') return 'Afeta a reputação';
  if (detail.affects_reputation === 'not_affected') return 'Não afeta a reputação';
  if (detail.affects_reputation === 'not_applies') return 'Não se aplica';
  return detail.affects_reputation;
}

function Priority({ value }: { value: ClaimPriority }) {
  const meta = PRIORITY_META[value] || PRIORITY_META.unknown;
  return <Tag color={meta.color} icon={meta.icon} className={styles.priorityTag}>{meta.label}</Tag>;
}

function Status({ claim }: { claim: ClaimListItem }) {
  const color = claim.status === 'opened' ? (claim.stage === 'dispute' ? 'magenta' : 'gold') : 'default';
  return <Tag color={color}>{claim.status_label}</Tag>;
}

export default function ReclamacoesPage() {
  const [data, setData] = useState<ClaimsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('opened');
  const [type, setType] = useState('');
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [activeClaim, setActiveClaim] = useState<ClaimListItem | null>(null);
  const [detail, setDetail] = useState<ClaimDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (initial = false) => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);

    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status });
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (stage) params.set('stage', stage);

    try {
      const response = await fetch(`/api/ml/reclamacoes?${params}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.erro || 'Falha ao carregar reclamações.');
      setData(payload as ClaimsListResponse);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar reclamações.');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page, pageSize, search, stage, status, type]);

  useEffect(() => {
    void load(true);
    return () => listRequest.current?.abort();
  }, [load]);

  const openClaim = useCallback(async (claim: ClaimListItem) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setActiveClaim(claim);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/ml/reclamacoes/${encodeURIComponent(claim.id)}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.erro || 'Falha ao carregar o detalhe da reclamação.');
      setDetail(payload as ClaimDetailResponse);
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setDetailError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o detalhe da reclamação.');
      }
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }, []);

  useEffect(() => () => detailRequest.current?.abort(), []);

  const columns = useMemo<ColumnsType<ClaimListItem>>(() => [
    {
      title: 'Prioridade', key: 'priority', width: 130,
      render: (_, claim) => <Priority value={claim.priority} />,
    },
    {
      title: 'Reclamação / venda', key: 'claim', width: 210,
      render: (_, claim) => <div className={styles.primaryCell}>
        <button type="button" className={styles.linkButton} onClick={() => void openClaim(claim)}>
          Reclamação #{claim.id}
        </button>
        <strong>Venda #{claim.order_id}</strong>
        <small>Aberta em {formatDateTime(claim.date_created)}</small>
      </div>,
    },
    {
      title: 'Contexto', key: 'context', width: 250,
      render: (_, claim) => claim.context_available ? <div className={styles.contextCell}>
        <strong>{claim.customer_name || 'Comprador não identificado'}</strong>
        <span>{claim.item_title || 'Produto não informado'}</span>
        {claim.item_count > 1 && <small>+ {claim.item_count - 1} {claim.item_count === 2 ? 'item' : 'itens'} na venda</small>}
      </div> : <Text type="secondary">Contexto da venda indisponível</Text>,
    },
    {
      title: 'Motivo', key: 'reason', width: 220,
      render: (_, claim) => <div className={styles.stackCell}>
        <strong>{claim.type_label}</strong>
        <span>{claim.problem || claim.detail_title || 'Motivo detalhado não informado'}</span>
      </div>,
    },
    {
      title: 'Andamento', key: 'status', width: 155,
      render: (_, claim) => <div className={styles.stackCell}>
        <Status claim={claim} />
        <span>{claim.stage_label}</span>
      </div>,
    },
    {
      title: 'Responsável / prazo', key: 'due', width: 185,
      render: (_, claim) => <div className={styles.stackCell}>
        <strong>{claim.responsible_label}</strong>
        <span className={claim.priority === 'overdue' ? styles.dangerText : undefined}>{formatDueDate(claim.due_date)}</span>
      </div>,
    },
    {
      title: 'Atualização', dataIndex: 'last_updated', key: 'last_updated', width: 145,
      render: (value) => <span>{formatDateTime(value)}</span>,
    },
    {
      title: 'Ações', key: 'actions', width: 125, fixed: 'right',
      render: (_, claim) => <Button size="small" onClick={() => void openClaim(claim)}>Ver detalhes</Button>,
    },
  ], [openClaim]);

  const history = useMemo(() => {
    if (!detail) return [];
    const actions = detail.actions_history.map((entry, index) => ({
      key: `action-${index}`,
      date: entry.date_created,
      title: entry.action_name ? claimActionLabel(entry.action_name) : 'Ação registrada',
      detail: [claimRoleLabel(entry.player_role), entry.claim_stage, entry.claim_status].filter(Boolean).join(' · '),
    }));
    const statuses = detail.status_history.map((entry, index) => ({
      key: `status-${index}`,
      date: entry.date,
      title: `Estado alterado para ${entry.status || 'não informado'}`,
      detail: [entry.stage, entry.change_by ? `por ${claimRoleLabel(entry.change_by)}` : null].filter(Boolean).join(' · '),
    }));
    return [...actions, ...statuses].sort((left, right) => Date.parse(right.date || '') - Date.parse(left.date || ''));
  }, [detail]);

  const closeDrawer = () => {
    detailRequest.current?.abort();
    setActiveClaim(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage(pagination.current || 1);
    setPageSize(pagination.pageSize || 30);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatus('opened');
    setType('');
    setStage('');
    setPage(1);
  };

  const submitSearch = (value: string) => {
    setSearchInput(value);
    setSearch(value.trim());
    setPage(1);
  };

  if (loading && !data) {
    return <div className={styles.page}><Skeleton active paragraph={{ rows: 12 }} /></div>;
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>Pós-venda Mercado Livre</span>
        <Title level={2}>Reclamações</Title>
        <Text type="secondary">Priorize prazos, entenda o caso e continue a tratativa no canal oficial.</Text>
        <Text type="secondary" className={styles.updatedAt}>
          {data?.updated_at ? `Atualizado em ${formatDateTime(data.updated_at)}` : 'Aguardando atualização'}
        </Text>
      </div>
      <Button type="primary" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void load()}>
        Atualizar
      </Button>
    </header>

    {data?.visual_review && <Alert
      type="info"
      showIcon
      message="Amostra sintética protegida para homologação"
      description={`Os casos representam contratos oficiais do Mercado Livre e não executam ações externas. Amostra válida até ${formatDateTime(data.visual_review.expires_at)}.`}
    />}

    {error && <Alert
      type="error"
      showIcon
      message="Não foi possível atualizar as reclamações"
      description={`${error}${data?.items.length ? ' Os dados anteriores foram preservados.' : ''}`}
      action={<Button size="small" onClick={() => void load()}>Tentar novamente</Button>}
    />}

    {data?.partial && <Alert
      type="warning"
      showIcon
      message="Algumas informações estão temporariamente indisponíveis"
      description="A fila foi mantida. Abra o caso no Mercado Livre antes de tomar uma decisão com base em um campo ausente."
    />}

    {data && (!data.conectado || data.precisaReconectar) ? <section className={styles.emptyState}>
      <MessageOutlined />
      <h2>Mercado Livre desconectado</h2>
      <p>{data.erro || 'Reconecte a conta para consultar as reclamações.'}</p>
      <Button type="primary" href="/api/integracao/ml/connect">Conectar Mercado Livre</Button>
    </section> : <>
      <section className={styles.summaryBand} aria-label="Resumo de reclamações">
        <div><span>Abertas</span><strong>{data?.summary.opened ?? '—'}</strong><small>Fila ativa no Mercado Livre</small></div>
        <div><span>Com prazo nesta página</span><strong>{data?.summary.due_on_page ?? '—'}</strong><small>Casos com vencimento informado</small></div>
        <div><span>Em mediação</span><strong>{data?.summary.dispute ?? '—'}</strong><small>Mercado Livre envolvido</small></div>
        <div><span>Atualizadas hoje</span><strong>{data?.summary.updated_today ?? '—'}</strong><small>Movimentações no dia</small></div>
      </section>

      <section className={styles.filters} aria-label="Filtros da fila">
        <Input.Search
          className={styles.search}
          aria-label="Buscar reclamação ou venda"
          prefix={<SearchOutlined />}
          placeholder="ID da reclamação ou da venda"
          value={searchInput}
          allowClear
          enterButton="Buscar"
          onChange={(event) => setSearchInput(event.target.value)}
          onSearch={submitSearch}
        />
        <Select aria-label="Filtrar situação" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[
          { value: 'opened', label: 'Abertas' },
          { value: 'closed', label: 'Encerradas' },
          { value: 'all', label: 'Todas as situações' },
        ]} />
        <Select aria-label="Filtrar tipo" value={type || undefined} allowClear placeholder="Todos os tipos" onChange={(value) => { setType(value || ''); setPage(1); }} options={[
          { value: 'mediations', label: 'Reclamação' },
          { value: 'return', label: 'Devolução' },
          { value: 'fulfillment', label: 'Envio Full' },
          { value: 'ml_case', label: 'Caso Mercado Livre' },
          { value: 'cancel_sale', label: 'Cancelamento pelo vendedor' },
          { value: 'cancel_purchase', label: 'Cancelamento pelo comprador' },
          { value: 'change', label: 'Troca' },
          { value: 'service', label: 'Serviço' },
        ]} />
        <Select aria-label="Filtrar etapa" value={stage || undefined} allowClear placeholder="Todas as etapas" onChange={(value) => { setStage(value || ''); setPage(1); }} options={[
          { value: 'claim', label: 'Negociação' },
          { value: 'dispute', label: 'Mediação' },
          { value: 'recontact', label: 'Recontato' },
          { value: 'stale', label: 'Tratativa Mercado Livre' },
          { value: 'none', label: 'Não se aplica' },
        ]} />
        {(search || status !== 'opened' || type || stage) && <Button type="link" onClick={clearFilters}>Limpar filtros</Button>}
      </section>

      <section className={styles.tableCard}>
        {!loading && !error && data?.items.length === 0 ? <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Nenhuma reclamação encontrada com os filtros atuais."
        ><Button onClick={clearFilters}>Limpar filtros</Button></Empty> : <ResizableTable<ClaimListItem>
          storageKey="bnt-d19-reclamacoes"
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={loading}
          onChange={handleTableChange}
          pagination={{
            current: data?.paging.page || page,
            pageSize: data?.paging.page_size || pageSize,
            total: data?.paging.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [15, 30, 50, 100],
            showTotal: (count) => `${count} reclamaç${count === 1 ? 'ão' : 'ões'}`,
          }}
          scroll={{ x: 1420 }}
          size="small"
        />}
      </section>
    </>}

    <Drawer
      open={Boolean(activeClaim)}
      width="min(96vw, 820px)"
      onClose={closeDrawer}
      destroyOnHidden
      title={activeClaim ? <div className={styles.drawerTitle}>
        <span>Reclamação #{activeClaim.id}</span>
        <Status claim={activeClaim} />
      </div> : 'Detalhe da reclamação'}
      extra={activeClaim && <Button
        icon={<ExportOutlined />}
        href={activeClaim.is_homologation_fixture ? undefined : `https://www.mercadolivre.com.br/vendas/${activeClaim.order_id}/detalhe`}
        target={activeClaim.is_homologation_fixture ? undefined : '_blank'}
        disabled={activeClaim.is_homologation_fixture}
      >Abrir no ML</Button>}
    >
      {detailLoading && <Skeleton active paragraph={{ rows: 10 }} />}
      {detailError && <Alert type="error" showIcon message="Detalhe indisponível" description={detailError} action={<Button size="small" onClick={() => activeClaim && void openClaim(activeClaim)}>Tentar novamente</Button>} />}
      {detail && <>
        {detail.visual_review && <Alert className={styles.drawerAlert} type="info" showIcon message="Amostra somente para avaliação visual" />}
        {detail.unavailable_sections.length > 0 && <Alert className={styles.drawerAlert} type="warning" showIcon message="Detalhe parcialmente disponível" description="Consulte o caso no Mercado Livre para confirmar as seções ausentes." />}
        <Tabs items={[
          {
            key: 'overview',
            label: 'Visão geral',
            children: <div className={styles.drawerSection}>
              {detail.claim.status === 'opened' && <Alert
                type={detail.claim.action_responsible === 'seller' ? 'warning' : 'info'}
                showIcon
                message={detail.claim.action_responsible === 'seller' ? 'Este caso precisa da sua ação' : `Aguardando ${detail.claim.responsible_label.toLowerCase()}`}
                description={detail.claim.due_date ? `Prazo informado: ${formatDueDate(detail.claim.due_date)}.` : 'O Mercado Livre não informou prazo para esta etapa.'}
              />}
              <Descriptions bordered size="small" column={2} items={[
                { key: 'claim', label: 'Reclamação', children: `#${detail.claim.id}` },
                { key: 'order', label: 'Venda', children: `#${detail.claim.order_id}` },
                { key: 'customer', label: 'Comprador', children: detail.claim.customer_name || 'Não informado' },
                { key: 'product', label: 'Produto', children: detail.claim.item_title || 'Não informado', span: 2 },
                { key: 'type', label: 'Tipo', children: detail.claim.type_label },
                { key: 'stage', label: 'Etapa', children: detail.claim.stage_label },
                { key: 'responsible', label: 'Responsável', children: detail.claim.responsible_label },
                { key: 'due', label: 'Prazo', children: formatDueDate(detail.claim.due_date) },
                { key: 'created', label: 'Aberta em', children: formatDateTime(detail.claim.date_created) },
                { key: 'updated', label: 'Atualizada em', children: formatDateTime(detail.claim.last_updated) },
              ]} />
              <article className={styles.detailBlock}>
                <h3>Motivo informado</h3>
                <strong>{detail.reason?.name || detail.claim.problem || detail.claim.detail_title || 'Não informado'}</strong>
                <Paragraph>{detail.reason?.detail || detail.claim.detail_description || 'Sem descrição adicional.'}</Paragraph>
              </article>
              <article className={styles.detailBlock}>
                <h3>Ações disponíveis no Mercado Livre</h3>
                {detail.claim.available_actions.length > 0 ? <ul>
                  {detail.claim.available_actions.map((action) => <li key={`${action.action}-${action.due_date || ''}`}>
                    <strong>{claimActionLabel(action.action)}</strong>
                    {action.due_date && <span> até {formatDueDate(action.due_date)}</span>}
                    {action.mandatory && <small> Obrigatória</small>}
                  </li>)}
                </ul> : <Text type="secondary">Nenhuma ação pendente informada.</Text>}
                <Text type="secondary">A execução permanece no Mercado Livre para preservar o fluxo oficial.</Text>
              </article>
              <article className={styles.detailBlock}>
                <h3>Conclusão e reputação</h3>
                <p>{resolutionText(detail.claim.resolution)}</p>
                <p>{reputationText(detail.affects_reputation)}</p>
              </article>
            </div>,
          },
          {
            key: 'conversation',
            label: `Conversa (${detail.messages.length})`,
            children: detail.claim.type === 'return' ? <Alert
              type="info"
              showIcon
              message="Devoluções não possuem conversa neste recurso"
              description="O acompanhamento continua pelo fluxo de devolução do Mercado Livre."
            /> : detail.messages.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma mensagem disponível." /> : <div className={styles.messages}>
              {detail.messages.map((message, index) => <article className={styles.message} key={message.hash || `${message.date_created}-${index}`}>
                <div><strong>{claimRoleLabel(message.sender_role)}</strong><span>{formatDateTime(message.date_created)}</span></div>
                <Paragraph>{message.message || 'Mensagem sem conteúdo textual.'}</Paragraph>
                {message.attachments.length > 0 && <div className={styles.attachments}>
                  {message.attachments.map((attachment) => <span key={attachment.filename}>{attachment.original_filename || attachment.filename}</span>)}
                </div>}
              </article>)}
            </div>,
          },
          {
            key: 'history',
            label: 'Histórico',
            children: history.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum evento de histórico disponível." /> : <Timeline items={history.map((event) => ({
              children: <div className={styles.timelineItem}><strong>{event.title}</strong><span>{event.detail}</span><small>{formatDateTime(event.date)}</small></div>,
            }))} />,
          },
        ]} />
      </>}
    </Drawer>
  </div>;
}
