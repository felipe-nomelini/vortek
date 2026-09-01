'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert, Button, Card, DatePicker, Dropdown, Empty, Form, Input, InputNumber,
  Modal, Select, Space, Tabs, Tag, Typography, message,
} from 'antd';
import type { MenuProps, TableProps } from 'antd';
import {
  DeleteOutlined, EllipsisOutlined, EyeOutlined, PlusOutlined, ReloadOutlined,
  SearchOutlined, ShopOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import EstoqueDetailsDrawer, { type EstoqueDrawerItem } from '@/components/estoque/EstoqueDetailsDrawer';
import styles from './estoque.module.css';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

type SituacaoEstoque = 'revisao' | 'liberado' | 'nao_aproveitavel';
type StockQueue = 'revisao' | 'disponivel' | 'reservado' | 'nao_aproveitavel' | 'despachado';
type StockOrigin = 'manual' | 'devolucao' | 'venda_interna';

type ItemEstoque = {
  id: string;
  produto_id: string;
  pedido_id: string | null;
  sku: string;
  nome: string;
  quantidade: number;
  motivo: string;
  status_devolucao: string;
  situacao_estoque: SituacaoEstoque;
  created_at: string;
  ml_order_id: string | null;
  ml_pack_id: string | null;
};

type MovimentoSaida = {
  id: string;
  produto_id: string;
  pedido_id: string | null;
  sku: string;
  nome: string;
  quantidade: number;
  motivo: string;
  estado_envio_interno: 'reservado' | 'despachado';
  reservado_em: string;
  despachado_em: string | null;
  vendido_em?: string;
  ml_order_id: string | null;
  ml_pack_id: string | null;
};

type EstoqueResponse = {
  data: ItemEstoque[];
  revisao: number;
  liberado: number;
  nao_aproveitavel: number;
  reservados: MovimentoSaida[];
  reservadosQuantidade: number;
  vendidos: MovimentoSaida[];
  vendidosQuantidade: number;
};

type StockRow = {
  id: string;
  kind: EstoqueDrawerItem['kind'];
  produtoId: string;
  pedidoId: string | null;
  sku: string;
  nome: string;
  quantidade: number;
  origem: StockOrigin;
  origemLabel: string;
  motivo: string;
  statusCode: string;
  statusLabel: string;
  statusColor: string;
  statusHint: string;
  date: string | null;
  registeredAt: string | null;
  dispatchedAt: string | null;
  mlOrderId: string | null;
  mlPackId: string | null;
  entry?: ItemEstoque;
};

const initialData: EstoqueResponse = {
  data: [],
  revisao: 0,
  liberado: 0,
  nao_aproveitavel: 0,
  reservados: [],
  reservadosQuantidade: 0,
  vendidos: [],
  vendidosQuantidade: 0,
};

const validQueues: StockQueue[] = ['revisao', 'disponivel', 'reservado', 'nao_aproveitavel', 'despachado'];
const reviewReadyStatuses = new Set(['delivered', 'returned', 'manual']);

const returnStatuses: Record<string, { label: string; color: string; hint: string }> = {
  pending: { label: 'Devolução iniciada', color: 'blue', hint: 'Aguardando avanço da devolução no Mercado Livre.' },
  ready_to_ship: { label: 'Aguardando postagem', color: 'blue', hint: 'O cliente ainda precisa postar a devolução.' },
  label_generated: { label: 'Etiqueta gerada', color: 'blue', hint: 'Aguardando postagem da devolução.' },
  scheduled: { label: 'Coleta agendada', color: 'blue', hint: 'Aguardando coleta da devolução.' },
  shipped: { label: 'Em trânsito', color: 'processing', hint: 'A mercadoria ainda não chegou para conferência.' },
  pending_delivered: { label: 'Entrega a confirmar', color: 'processing', hint: 'Aguardando confirmação de recebimento.' },
  delivered_warehouse: { label: 'No centro de devoluções', color: 'orange', hint: 'Ainda não há entrega final confirmada à Bentevi.' },
  delivered: { label: 'Pronto para revisão', color: 'gold', hint: 'Entrega confirmada; escolha o destino físico do item.' },
  returned: { label: 'Pronto para revisão', color: 'gold', hint: 'Retorno confirmado; escolha o destino físico do item.' },
  not_delivered: { label: 'Entrega não realizada', color: 'red', hint: 'A devolução não chegou para conferência.' },
  cancelled: { label: 'Devolução cancelada', color: 'red', hint: 'Nenhuma decisão de estoque está liberada.' },
  failed: { label: 'Falha na devolução', color: 'red', hint: 'Revise a devolução no Mercado Livre.' },
  expired: { label: 'Devolução expirada', color: 'red', hint: 'Nenhuma decisão de estoque está liberada.' },
  return_to_buyer: { label: 'Retornando ao cliente', color: 'orange', hint: 'O item não está disponível para conferência.' },
  returning_to_sender: { label: 'Retornando ao remetente', color: 'processing', hint: 'Aguardando confirmação do retorno.' },
  lost: { label: 'Extraviado', color: 'red', hint: 'O item não pode ser liberado para venda.' },
  aguardando_confirmacao: { label: 'Aguardando confirmação', color: 'default', hint: 'A entrega da devolução ainda não foi confirmada.' },
  manual: { label: 'Entrada manual', color: 'blue', hint: 'Confira fisicamente o item antes de liberá-lo.' },
};

function parseQueue(value: string | null): StockQueue {
  return validQueues.includes(value as StockQueue) ? value as StockQueue : 'revisao';
}

function parsePositiveInteger(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function formatDateParts(value: string | null): { date: string; time: string } {
  if (!value) return { date: '—', time: '—' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: '—', time: '—' };
  return {
    date: parsed.toLocaleDateString('pt-BR'),
    time: parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

function matchesDateRange(value: string | null, range: [string | null, string | null]): boolean {
  if (!range[0] && !range[1]) return true;
  if (!value) return false;
  const parsed = dayjs(value);
  if (!parsed.isValid()) return false;
  if (range[0] && parsed.isBefore(dayjs(range[0]).startOf('day'))) return false;
  if (range[1] && parsed.isAfter(dayjs(range[1]).endOf('day'))) return false;
  return true;
}

function entryStatus(item: ItemEstoque): Pick<StockRow, 'statusCode' | 'statusLabel' | 'statusColor' | 'statusHint'> {
  if (item.situacao_estoque === 'liberado') {
    return { statusCode: 'disponivel', statusLabel: 'Disponível', statusColor: 'green', statusHint: 'Saldo livre para uma nova venda interna.' };
  }
  if (item.situacao_estoque === 'nao_aproveitavel') {
    return { statusCode: 'nao_aproveitavel', statusLabel: 'Não aproveitável', statusColor: 'red', statusHint: 'Item bloqueado para novas vendas.' };
  }
  const presentation = returnStatuses[item.status_devolucao] || {
    label: item.status_devolucao || 'Estado não informado',
    color: 'default',
    hint: 'Consulte a devolução para confirmar o estado atual.',
  };
  return {
    statusCode: item.status_devolucao || 'aguardando_confirmacao',
    statusLabel: presentation.label,
    statusColor: presentation.color,
    statusHint: presentation.hint,
  };
}

function entryToRow(item: ItemEstoque): StockRow {
  const manual = item.status_devolucao === 'manual';
  return {
    id: item.id,
    kind: 'entrada',
    produtoId: item.produto_id,
    pedidoId: item.pedido_id,
    sku: item.sku,
    nome: item.nome,
    quantidade: item.quantidade,
    origem: manual ? 'manual' : 'devolucao',
    origemLabel: manual ? 'Entrada manual' : 'Devolução Mercado Livre',
    motivo: item.motivo,
    ...entryStatus(item),
    date: item.created_at,
    registeredAt: item.created_at,
    dispatchedAt: null,
    mlOrderId: item.ml_order_id,
    mlPackId: item.ml_pack_id,
    entry: item,
  };
}

function movementToRow(item: MovimentoSaida, kind: 'reserva' | 'despacho'): StockRow {
  const dispatched = kind === 'despacho';
  return {
    id: item.id,
    kind,
    produtoId: item.produto_id,
    pedidoId: item.pedido_id,
    sku: item.sku,
    nome: item.nome,
    quantidade: item.quantidade,
    origem: 'venda_interna',
    origemLabel: 'Venda com estoque interno',
    motivo: item.motivo,
    statusCode: dispatched ? 'despachado' : 'reservado',
    statusLabel: dispatched ? 'Despachado' : 'Reservado',
    statusColor: dispatched ? 'cyan' : 'gold',
    statusHint: dispatched
      ? 'Saída física confirmada no fluxo da venda.'
      : 'Unidade comprometida com esta venda e indisponível para outra reserva.',
    date: dispatched ? (item.despachado_em || item.vendido_em || item.reservado_em) : item.reservado_em,
    registeredAt: item.reservado_em,
    dispatchedAt: item.despachado_em || item.vendido_em || null,
    mlOrderId: item.ml_order_id,
    mlPackId: item.ml_pack_id,
  };
}

export default function EstoquePage() {
  const [data, setData] = useState<EstoqueResponse>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeQueue, setActiveQueue] = useState<StockQueue>('revisao');
  const [search, setSearch] = useState('');
  const [origin, setOrigin] = useState<StockOrigin | undefined>();
  const [condition, setCondition] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [drawerRow, setDrawerRow] = useState<StockRow | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualProduct, setManualProduct] = useState<{ sku: string; nome: string } | null>(null);
  const [lookingUpProduct, setLookingUpProduct] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [mutationId, setMutationId] = useState<string | null>(null);
  const [manualForm] = Form.useForm<{ sku: string; quantidade: number }>();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setActiveQueue(parseQueue(params.get('fila')));
    setSearch(params.get('busca')?.trim() || '');
    const originParam = params.get('origem') as StockOrigin | null;
    setOrigin(['manual', 'devolucao'].includes(originParam || '') ? originParam as StockOrigin : undefined);
    setCondition(params.get('condicao') || undefined);
    setDateRange([params.get('dataDe'), params.get('dataAte')]);
    setPage(parsePositiveInteger(params.get('pagina')));
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    const params = new URLSearchParams();
    if (activeQueue !== 'revisao') params.set('fila', activeQueue);
    if (search.trim()) params.set('busca', search.trim());
    if (origin && ['revisao', 'disponivel', 'nao_aproveitavel'].includes(activeQueue)) params.set('origem', origin);
    if (condition && activeQueue === 'revisao') params.set('condicao', condition);
    if (dateRange[0]) params.set('dataDe', dateRange[0]);
    if (dateRange[1]) params.set('dataAte', dateRange[1]);
    if (page > 1) params.set('pagina', String(page));
    const next = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
  }, [activeQueue, condition, dateRange, filtersHydrated, origin, page, search]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch('/api/estoque', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao carregar o estoque interno.');
      setData({ ...initialData, ...result });
      setError(null);
      setLastUpdated(new Date());
    } catch (loadError: any) {
      setError(loadError?.message || 'Falha ao carregar o estoque interno.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load(false);
    const interval = window.setInterval(refresh, 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load]);

  const allRows = useMemo(() => ({
    revisao: data.data.filter((item) => item.situacao_estoque === 'revisao').map(entryToRow),
    disponivel: data.data.filter((item) => item.situacao_estoque === 'liberado').map(entryToRow),
    reservado: data.reservados.map((item) => movementToRow(item, 'reserva')),
    nao_aproveitavel: data.data.filter((item) => item.situacao_estoque === 'nao_aproveitavel').map(entryToRow),
    despachado: data.vendidos.map((item) => movementToRow(item, 'despacho')),
  }), [data]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return allRows[activeQueue].filter((row) => {
      if (normalizedSearch) {
        const searchable = [row.sku, row.nome, row.mlOrderId, row.mlPackId].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
        if (!searchable.includes(normalizedSearch)) return false;
      }
      if (origin && ['revisao', 'disponivel', 'nao_aproveitavel'].includes(activeQueue) && row.origem !== origin) return false;
      if (condition && activeQueue === 'revisao') {
        const isManual = row.statusCode === 'manual';
        const isReady = ['delivered', 'returned'].includes(row.statusCode);
        if (condition === 'manual' && !isManual) return false;
        if (condition === 'pronto' && !isReady) return false;
        if (condition === 'aguardando' && (isManual || isReady)) return false;
      }
      return matchesDateRange(row.date, dateRange);
    });
  }, [activeQueue, allRows, condition, dateRange, origin, search]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(filteredRows.length / 50));
    if (page > lastPage) setPage(lastPage);
  }, [filteredRows.length, page]);

  const showResultMessage = (result: any, success: string) => {
    if (result?.mlSyncWarning) messageApi.warning(result.mlSyncWarning);
    else messageApi.success(success);
  };

  const atualizarSituacao = async (item: ItemEstoque, situacao: Exclude<SituacaoEstoque, 'revisao'>) => {
    const operationId = `${item.id}:${situacao}`;
    setMutationId(operationId);
    try {
      const response = await fetch(`/api/estoque/${item.id}/situacao`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situacao }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao atualizar o item.');
      showResultMessage(result, situacao === 'liberado' ? 'Item liberado para venda.' : 'Item marcado como não aproveitável.');
      setDrawerRow(null);
      await load(false);
    } catch (mutationError: any) {
      messageApi.error(mutationError?.message || 'Falha ao atualizar o item.');
    } finally {
      setMutationId(null);
    }
  };

  const excluirEstoqueManual = async (item: ItemEstoque) => {
    setMutationId(`${item.id}:delete`);
    try {
      const response = await fetch(`/api/estoque/${item.id}/situacao`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao excluir a entrada manual.');
      showResultMessage(result, 'Entrada manual excluída.');
      setDrawerRow(null);
      await load(false);
    } catch (mutationError: any) {
      messageApi.error(mutationError?.message || 'Falha ao excluir a entrada manual.');
    } finally {
      setMutationId(null);
    }
  };

  const buscarProdutoManual = async () => {
    const sku = String(manualForm.getFieldValue('sku') || '').trim();
    if (!sku) {
      manualForm.setFields([{ name: 'sku', errors: ['Informe o SKU.'] }]);
      return;
    }
    setLookingUpProduct(true);
    setManualProduct(null);
    try {
      const response = await fetch(`/api/estoque/produto?sku=${encodeURIComponent(sku)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Produto não encontrado.');
      setManualProduct(result.produto);
      manualForm.setFieldsValue({ sku: result.produto.sku });
      manualForm.setFields([{ name: 'sku', errors: [] }]);
    } catch (lookupError: any) {
      manualForm.setFields([{ name: 'sku', errors: [lookupError?.message || 'Produto não encontrado.'] }]);
    } finally {
      setLookingUpProduct(false);
    }
  };

  const inserirEstoqueManual = async (values: { sku: string; quantidade: number }) => {
    if (!manualProduct) {
      manualForm.setFields([{ name: 'sku', errors: ['Busque e confirme o produto antes de inserir.'] }]);
      return;
    }
    setSavingManual(true);
    try {
      const response = await fetch('/api/estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao inserir o estoque interno.');
      messageApi.success('Entrada criada e enviada para revisão.');
      setManualModalOpen(false);
      setManualProduct(null);
      manualForm.resetFields();
      setActiveQueue('revisao');
      setPage(1);
      await load(false);
    } catch (saveError: any) {
      messageApi.error(saveError?.message || 'Falha ao inserir o estoque interno.');
    } finally {
      setSavingManual(false);
    }
  };

  const openDetails = (row: StockRow) => setDrawerRow(row);

  const renderSaleReferences = (row: StockRow) => (
    <div className={styles.identifiersCell}>
      {row.mlPackId && <span><b>Pack</b> #{row.mlPackId}</span>}
      {row.mlOrderId && <span><b>Venda</b> #{row.mlOrderId}</span>}
      {!row.mlPackId && !row.mlOrderId && <span className={styles.missingText}>Sem venda vinculada</span>}
    </div>
  );

  const secondaryActions = (row: StockRow): MenuProps['items'] => {
    const items: MenuProps['items'] = [{ key: 'details', label: 'Ver detalhes', icon: <EyeOutlined /> }];
    if (row.entry && row.entry.situacao_estoque === 'revisao' && reviewReadyStatuses.has(row.entry.status_devolucao)) {
      items.push({ key: 'unusable', label: 'Marcar não aproveitável' });
      if (row.entry.status_devolucao === 'manual') {
        items.push({ type: 'divider' });
        items.push({ key: 'delete', danger: true, label: 'Excluir entrada manual', icon: <DeleteOutlined /> });
      }
    }
    return items;
  };

  const handleSecondaryAction = (key: string, row: StockRow) => {
    if (key === 'details') openDetails(row);
    if (key === 'unusable' && row.entry) {
      Modal.confirm({
        title: 'Marcar item como não aproveitável?',
        content: 'O item ficará bloqueado para novas vendas. Confirme somente após a conferência física.',
        okText: 'Marcar não aproveitável',
        cancelText: 'Cancelar',
        okButtonProps: { danger: true },
        onOk: () => atualizarSituacao(row.entry!, 'nao_aproveitavel'),
      });
    }
    if (key === 'delete' && row.entry) {
      Modal.confirm({
        title: 'Excluir entrada manual?',
        content: 'Esta ação é permitida somente enquanto a entrada manual ainda está em revisão.',
        okText: 'Excluir entrada',
        cancelText: 'Cancelar',
        okButtonProps: { danger: true },
        onOk: () => excluirEstoqueManual(row.entry!),
      });
    }
  };

  const renderActions = (row: StockRow, compact = false) => {
    const canDecide = Boolean(row.entry && row.entry.situacao_estoque === 'revisao' && reviewReadyStatuses.has(row.entry.status_devolucao));
    if (canDecide && row.entry) {
      return (
        <Space size={6} wrap>
          <Button
            type="primary"
            size={compact ? 'small' : 'middle'}
            loading={mutationId === `${row.id}:liberado`}
            onClick={() => void atualizarSituacao(row.entry!, 'liberado')}
          >
            Liberar
          </Button>
          <Dropdown menu={{ items: secondaryActions(row), onClick: ({ key }) => handleSecondaryAction(key, row) }} trigger={['click']}>
            <Button size={compact ? 'small' : 'middle'} icon={<EllipsisOutlined />} aria-label="Outras ações" />
          </Dropdown>
        </Space>
      );
    }
    if ((row.kind === 'reserva' || row.kind === 'despacho') && row.pedidoId) {
      return (
        <Space size={6}>
          <Button size={compact ? 'small' : 'middle'} href={`/pedidos?venda=${encodeURIComponent(row.pedidoId)}`}>Ver venda</Button>
          <Dropdown menu={{ items: secondaryActions(row), onClick: ({ key }) => handleSecondaryAction(key, row) }} trigger={['click']}>
            <Button size={compact ? 'small' : 'middle'} icon={<EllipsisOutlined />} aria-label="Outras ações" />
          </Dropdown>
        </Space>
      );
    }
    return <Button size={compact ? 'small' : 'middle'} icon={<EyeOutlined />} onClick={() => openDetails(row)}>Ver detalhes</Button>;
  };

  const renderDrawerActions = (row: StockRow) => {
    const canDecide = Boolean(row.entry && row.entry.situacao_estoque === 'revisao' && reviewReadyStatuses.has(row.entry.status_devolucao));
    if (canDecide && row.entry) {
      const items = (secondaryActions(row) || []).filter((item) => item && 'key' in item && item.key !== 'details');
      return (
        <Space size={6}>
          <Button
            type="primary"
            loading={mutationId === `${row.id}:liberado`}
            onClick={() => void atualizarSituacao(row.entry!, 'liberado')}
          >
            Liberar
          </Button>
          <Dropdown menu={{ items, onClick: ({ key }) => handleSecondaryAction(key, row) }} trigger={['click']}>
            <Button icon={<EllipsisOutlined />} aria-label="Outras ações" />
          </Dropdown>
        </Space>
      );
    }
    if ((row.kind === 'reserva' || row.kind === 'despacho') && row.pedidoId) {
      return <Button href={`/pedidos?venda=${encodeURIComponent(row.pedidoId)}`}>Ver venda</Button>;
    }
    return undefined;
  };

  const columns: TableProps<StockRow>['columns'] = [
    {
      title: activeQueue === 'reservado' ? 'Reserva' : activeQueue === 'despachado' ? 'Despacho' : 'Entrada',
      key: 'date',
      width: 126,
      sorter: (a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime(),
      render: (_value, row) => {
        const value = formatDateParts(row.date);
        return <div className={styles.dateCell}><span>{value.date}</span><span className={styles.secondaryText}>{value.time}</span></div>;
      },
    },
    {
      title: 'Produto',
      key: 'product',
      width: 330,
      sorter: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
      render: (_value, row) => (
        <button type="button" className={styles.productButton} onClick={() => openDetails(row)}>
          <span className={styles.productName}>{row.nome}</span>
          <span className={styles.skuText}>SKU {row.sku}</span>
        </button>
      ),
    },
    {
      title: activeQueue === 'reservado' || activeQueue === 'despachado' ? 'Venda' : 'Origem',
      key: 'origin',
      width: 260,
      render: (_value, row) => (
        <div className={styles.originCell}>
          <span className={styles.primaryText}>{row.origemLabel}</span>
          {renderSaleReferences(row)}
        </div>
      ),
    },
    {
      title: 'Quantidade',
      key: 'quantity',
      width: 112,
      align: 'right',
      sorter: (a, b) => a.quantidade - b.quantidade,
      render: (_value, row) => <span className={styles.quantityText}>{row.quantidade} un.</span>,
    },
    {
      title: 'Condição',
      key: 'condition',
      width: 260,
      render: (_value, row) => (
        <div className={styles.conditionCell}>
          <Tag color={row.statusColor}>{row.statusLabel}</Tag>
          <span className={styles.conditionHint}>{row.statusHint}</span>
          {row.entry?.motivo && <span className={styles.reasonText}>{row.entry.motivo}</span>}
        </div>
      ),
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 154,
      fixed: 'right',
      render: (_value, row) => renderActions(row, true),
    },
  ];

  const summaryItems: Array<{ queue: StockQueue; label: string; value: number; hint: string }> = [
    { queue: 'revisao', label: 'Em revisão', value: data.revisao, hint: 'aguardando decisão física' },
    { queue: 'disponivel', label: 'Disponíveis', value: data.liberado, hint: 'livres para nova venda' },
    { queue: 'reservado', label: 'Reservadas', value: data.reservadosQuantidade, hint: 'comprometidas com vendas' },
    { queue: 'nao_aproveitavel', label: 'Não aproveitáveis', value: data.nao_aproveitavel, hint: 'bloqueadas para venda' },
    { queue: 'despachado', label: 'Saídas despachadas', value: data.vendidosQuantidade, hint: 'histórico de envios internos' },
  ];

  const tabItems = summaryItems.map((item) => ({
    key: item.queue,
    label: `${item.label} · ${item.value} un.`,
  }));

  const clearFilters = () => {
    setSearch('');
    setOrigin(undefined);
    setCondition(undefined);
    setDateRange([null, null]);
    setPage(1);
  };

  const hasFilters = Boolean(search.trim() || origin || condition || dateRange[0] || dateRange[1]);
  const hasPreviousData = data.data.length + data.reservados.length + data.vendidos.length > 0;
  const drawerItem: EstoqueDrawerItem | null = drawerRow ? {
    id: drawerRow.id,
    kind: drawerRow.kind,
    produtoId: drawerRow.produtoId,
    pedidoId: drawerRow.pedidoId,
    sku: drawerRow.sku,
    nome: drawerRow.nome,
    quantidade: drawerRow.quantidade,
    origem: drawerRow.origemLabel,
    motivo: drawerRow.motivo,
    statusLabel: drawerRow.statusLabel,
    statusColor: drawerRow.statusColor,
    statusHint: drawerRow.statusHint,
    mlOrderId: drawerRow.mlOrderId,
    mlPackId: drawerRow.mlPackId,
    registradoEm: drawerRow.registeredAt,
    despachadoEm: drawerRow.dispatchedAt,
  } : null;

  return (
    <>
      {contextHolder}
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <Title level={2} className={styles.title}>Estoque</Title>
            <Text type="secondary">Estoque interno, reservas e decisões após o recebimento de devoluções.</Text>
            <Text type="secondary" className={styles.updatedAt}>
              {lastUpdated ? `Atualizado em ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Aguardando primeira atualização'}
            </Text>
          </div>
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>Atualizar</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setManualModalOpen(true)}>Adicionar item</Button>
          </Space>
        </header>

        <section className={styles.summaryBand} aria-label="Resumo do estoque interno">
          {summaryItems.map((item) => (
            <button
              key={item.queue}
              type="button"
              className={`${styles.summaryItem} ${activeQueue === item.queue ? styles.summaryItemActive : ''}`}
              onClick={() => { setActiveQueue(item.queue); setPage(1); }}
            >
              <span className={styles.summaryLabel}>{item.label}</span>
              <strong className={styles.summaryValue}>{item.value} <small>un.</small></strong>
              <span className={styles.summaryHint}>{item.hint}</span>
            </button>
          ))}
        </section>

        {error && (
          <Alert
            type={hasPreviousData ? 'warning' : 'error'}
            showIcon
            message={hasPreviousData ? 'Não foi possível atualizar o estoque' : 'Estoque indisponível'}
            description={`${error}${hasPreviousData ? ' Os dados anteriores foram preservados.' : ''}`}
            action={<Button size="small" onClick={() => void load()}>Tentar novamente</Button>}
          />
        )}

        <Card className={styles.filterCard}>
          <Tabs
            activeKey={activeQueue}
            items={tabItems}
            onChange={(key) => { setActiveQueue(key as StockQueue); setPage(1); }}
          />
          <Space wrap className={styles.filterRow}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Buscar produto, SKU, Pack ou Venda"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              style={{ width: 320 }}
            />
            {['revisao', 'disponivel', 'nao_aproveitavel'].includes(activeQueue) && (
              <Select
                allowClear
                placeholder="Origem"
                value={origin}
                onChange={(value) => { setOrigin(value); setPage(1); }}
                style={{ width: 190 }}
                options={[
                  { value: 'devolucao', label: 'Devolução Mercado Livre' },
                  { value: 'manual', label: 'Entrada manual' },
                ]}
              />
            )}
            {activeQueue === 'revisao' && (
              <Select
                allowClear
                placeholder="Condição"
                value={condition}
                onChange={(value) => { setCondition(value); setPage(1); }}
                style={{ width: 190 }}
                options={[
                  { value: 'pronto', label: 'Pronto para revisão' },
                  { value: 'aguardando', label: 'Aguardando recebimento' },
                  { value: 'manual', label: 'Entrada manual' },
                ]}
              />
            )}
            <RangePicker
              value={[
                dateRange[0] ? dayjs(dateRange[0]) : null,
                dateRange[1] ? dayjs(dateRange[1]) : null,
              ]}
              format="DD/MM/YYYY"
              onChange={(range: null | [Dayjs | null, Dayjs | null]) => {
                setDateRange([range?.[0]?.format('YYYY-MM-DD') || null, range?.[1]?.format('YYYY-MM-DD') || null]);
                setPage(1);
              }}
            />
            {hasFilters && <Button onClick={clearFilters}>Limpar filtros</Button>}
          </Space>
        </Card>

        <Card className={styles.tableCard}>
          {!loading && !error && filteredRows.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={hasFilters ? 'Nenhum item encontrado com os filtros atuais.' : 'Nenhum item nesta fila.'}
            >
              {hasFilters && <Button onClick={clearFilters}>Limpar filtros</Button>}
            </Empty>
          ) : (
            <ResizableTable<StockRow>
              storageKey={`estoque-bentevi-${activeQueue}-v1`}
              rowKey="id"
              loading={loading}
              dataSource={filteredRows}
              columns={columns}
              scroll={{ x: 1240 }}
              pagination={{ current: page, pageSize: 50, showSizeChanger: false, showTotal: (total) => `${total} movimento(s)` }}
              onChange={(pagination) => setPage(pagination.current || 1)}
            />
          )}
        </Card>
      </div>

      <EstoqueDetailsDrawer
        item={drawerItem}
        open={Boolean(drawerRow)}
        actions={drawerRow ? renderDrawerActions(drawerRow) : undefined}
        onClose={() => setDrawerRow(null)}
      />

      <Modal
        title="Adicionar item ao estoque interno"
        open={manualModalOpen}
        onCancel={() => {
          setManualModalOpen(false);
          setManualProduct(null);
          manualForm.resetFields();
        }}
        onOk={() => manualForm.submit()}
        okText="Adicionar para revisão"
        confirmLoading={savingManual}
        okButtonProps={{ disabled: !manualProduct }}
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="A entrada não ficará disponível imediatamente"
            description="O item será criado em revisão e só poderá ser vendido após conferência e liberação explícita."
          />
          <Form form={manualForm} layout="vertical" onFinish={inserirEstoqueManual}>
            <Form.Item label="SKU" required>
              <Space.Compact block>
                <Form.Item name="sku" noStyle rules={[{ required: true, message: 'Informe o SKU.' }]}>
                  <Input
                    placeholder="Ex.: BNT001030"
                    onChange={() => setManualProduct(null)}
                    onPressEnter={(event) => { event.preventDefault(); void buscarProdutoManual(); }}
                  />
                </Form.Item>
                <Button icon={<SearchOutlined />} loading={lookingUpProduct} onClick={() => void buscarProdutoManual()}>Buscar</Button>
              </Space.Compact>
            </Form.Item>
            {manualProduct && (
              <Card size="small" className={styles.selectedProduct}>
                <Space>
                  <ShopOutlined />
                  <div>
                    <Text strong>{manualProduct.nome}</Text><br />
                    <Text type="secondary">SKU {manualProduct.sku}</Text>
                  </div>
                </Space>
              </Card>
            )}
            <Form.Item
              label="Quantidade"
              name="quantidade"
              rules={[{ required: true, message: 'Informe a quantidade.' }]}
              style={{ marginTop: 16 }}
            >
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </>
  );
}
