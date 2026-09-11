'use client';

import { userSafeMessage } from '@/lib/user-feedback';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal,
  Progress, Select, Space, Table, Tabs, Tag, Timeline, Typography, message,
} from 'antd';
import {
  ToolOutlined, BarcodeOutlined, CheckCircleOutlined, CloseCircleOutlined,
  EyeOutlined, InboxOutlined, ReloadOutlined, SearchOutlined, SyncOutlined,
} from '@ant-design/icons';
import ReceiveNfeModal from '@/components/estoque/ReceiveNfeModal';
import { hasPermission, type VortekRole } from '@/lib/permissions';
import styles from './estoque.module.css';

const { Text, Title } = Typography;

type Position = {
  produto_id: string; sku: string; nome: string; fisico_util: number; reservado: number;
  disponivel: number; em_revisao: number; nao_aproveitavel: number; ultima_movimentacao_em: string | null;
  devolucoes_disponivel: number; compras_disponivel: number; ajustes_disponivel: number;
  fixture_produto_id?: string; is_homologation_fixture?: boolean;
};
type Receipt = {
  id: string; chave_nfe: string; numero: string | null; serie: string | null;
  emitente_nome: string; emitente_cnpj: string; emitida_em: string | null; valor_total: number;
  origem_xml: string | null; status: 'identificada' | 'aguardando_conferencia' | 'parcial' | 'conferido';
  created_at: string; confirmado_em: string | null; itens_esperados: number; itens_conferidos: number;
  snapshot_source: string;
};
type Movement = {
  id: string; produto_id: string; pedido_id: string | null; tipo: string; quantidade: number;
  motivo: string; situacao_estoque: string; status_devolucao: string; estado_envio_interno: string | null;
  created_at: string; despachado_em: string | null; estornada_em: string | null; estorno_motivo: string | null;
  recebimento_id: string | null; created_by: string | null;
  origem_estoque: 'devolucao_ml' | 'compra_nfe' | 'ajuste';
  snapshot_source: string;
  produtos: { sku: string; nome: string } | null;
  pedidos: { ml_order_id: string | null; ml_pack_id: string | null } | null;
  estoque_recebimentos_nfe: { chave_nfe: string; numero: string | null; serie: string | null; emitente_nome: string } | null;
};
type ReturnRow = {
  id: string; pedido_id: string; produto_id: string; quantidade: number; motivo: string;
  status_logistico: string; estado_operacional: 'em_transito' | 'entrega_informada' | 'aguardando_inspecao' | 'apto' | 'nao_apto' | 'encerrada_sem_recebimento';
  recebido_em: string | null; decidido_em: string | null; observado_em: string;
  created_at: string; updated_at: string;
  produtos: { sku: string; nome: string } | null;
  pedidos: { ml_order_id: string | null; ml_pack_id: string | null } | null;
};
type StockData = {
  positions: Position[]; receipts: Receipt[]; movements: Movement[]; returns: ReturnRow[];
  summary: {
    skus: number; fisico: number; disponivel: number; reservado: number; emConferencia: number;
    devolucoesCaminho: number; devolucoesReceber: number; devolucoesInspecao: number;
  };
  hasHomologationFixtures?: boolean;
};
type ProductOption = { id: string; sku: string; nome: string };

const EMPTY: StockData = {
  positions: [], receipts: [], movements: [], returns: [],
  summary: {
    skus: 0, fisico: 0, disponivel: 0, reservado: 0, emConferencia: 0,
    devolucoesCaminho: 0, devolucoesReceber: 0, devolucoesInspecao: 0,
  },
};
const positiveTypes = new Set(['entrada_devolucao', 'entrada_compra', 'ajuste_positivo']);

function formatDate(value: string | null, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return includeTime ? date.toLocaleString('pt-BR') : date.toLocaleDateString('pt-BR');
}

function receiptStatus(status: Receipt['status']) {
  if (status === 'conferido') return <Tag color="green">Conferido</Tag>;
  if (status === 'parcial') return <Tag color="blue">Conferência parcial</Tag>;
  if (status === 'identificada') return <Tag color="cyan">Detectada</Tag>;
  return <Tag color="gold">Aguardando conferência</Tag>;
}

function movementLabel(type: string, state: string | null) {
  if (type === 'entrada_compra') return 'Recebimento de compra';
  if (type === 'entrada_devolucao') return 'Entrada de devolução';
  if (type === 'ajuste_positivo') return 'Ajuste positivo';
  if (type === 'ajuste_negativo') return 'Ajuste negativo';
  if (type === 'saida_envio_interno' && state === 'reservado') return 'Reserva para venda';
  if (type === 'saida_envio_interno') return 'Saída de venda';
  return type.replaceAll('_', ' ');
}

function signedQuantity(row: Movement) {
  const positive = positiveTypes.has(row.tipo);
  return `${positive ? '+' : '−'}${Number(row.quantidade || 0)} un.`;
}

const RETURN_STATUS_LABELS: Record<string, string> = {
  pending: 'Devolução iniciada',
  label_generated: 'Etiqueta de devolução criada',
  ready_to_ship: 'Aguardando postagem',
  shipped: 'Em transporte',
  returning_to_sender: 'Voltando para a empresa',
  returned: 'Retorno concluído',
  delivered: 'Entrega informada pelo Mercado Livre',
  cancelled: 'Devolução cancelada',
  canceled: 'Devolução cancelada',
  expired: 'Prazo da devolução encerrado',
  not_delivered: 'Devolução não entregue',
};

function returnStatus(row: ReturnRow) {
  if (row.estado_operacional === 'aguardando_inspecao') return <Tag color="gold">Aguardando inspeção</Tag>;
  if (row.estado_operacional === 'entrega_informada') return <Tag color="blue">Confirmar recebimento</Tag>;
  if (row.estado_operacional === 'apto') return <Tag color="green">Apto para venda</Tag>;
  if (row.estado_operacional === 'nao_apto') return <Tag color="red">Não apto para venda</Tag>;
  if (row.estado_operacional === 'encerrada_sem_recebimento') return <Tag>Encerrada sem recebimento</Tag>;
  return <Tag color="cyan">A caminho</Tag>;
}

function stockOriginLabel(origin: Movement['origem_estoque']) {
  if (origin === 'devolucao_ml') return 'Devolução do Mercado Livre';
  if (origin === 'compra_nfe') return 'Compra por NF-e';
  return 'Ajuste de estoque';
}

export default function EstoquePage() {
  const [data, setData] = useState<StockData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('estoque');
  const [selectedProduct, setSelectedProduct] = useState<Position | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [returnActionId, setReturnActionId] = useState<string | null>(null);
  const [returnsSyncing, setReturnsSyncing] = useState(false);
  const [returnFilter, setReturnFilter] = useState('abertas');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [adjustForm] = Form.useForm<{ produtoId: string; quantidade: number; motivo: string }>();
  const [role, setRole] = useState<VortekRole | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const canManage = Boolean(role && hasPermission(role, 'inventory.manage'));

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => setRole(profile?.cargo || null))
      .catch(() => setRole(null));
  }, []);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch('/api/estoque', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao carregar o estoque.');
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (loadError: any) {
      setError(loadError?.message || 'Falha ao carregar o estoque.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const positions = useMemo(() => data.positions.filter((row) => (
    !normalizedSearch || `${row.sku} ${row.nome}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
  )), [data.positions, normalizedSearch]);
  const receipts = useMemo(() => data.receipts.filter((row) => (
    !normalizedSearch || `${row.chave_nfe} ${row.numero || ''} ${row.emitente_nome}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
  )), [data.receipts, normalizedSearch]);
  const movements = useMemo(() => data.movements.filter((row) => (
    !normalizedSearch || `${row.produtos?.sku || ''} ${row.produtos?.nome || ''} ${row.motivo}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
  )), [data.movements, normalizedSearch]);
  const returns = useMemo(() => data.returns.filter((row) => {
    const matchesSearch = !normalizedSearch || `${row.produtos?.sku || ''} ${row.produtos?.nome || ''} ${row.motivo} ${row.pedidos?.ml_order_id || ''} ${row.pedidos?.ml_pack_id || ''}`
      .toLocaleLowerCase('pt-BR').includes(normalizedSearch);
    if (!matchesSearch) return false;
    if (returnFilter === 'abertas') return ['em_transito', 'entrega_informada', 'aguardando_inspecao'].includes(row.estado_operacional);
    if (returnFilter === 'finalizadas') return ['apto', 'nao_apto', 'encerrada_sem_recebimento'].includes(row.estado_operacional);
    return row.estado_operacional === returnFilter;
  }), [data.returns, normalizedSearch, returnFilter]);

  const productMovements = selectedProduct
    ? data.movements.filter((movement) => movement.produto_id === (selectedProduct.fixture_produto_id || selectedProduct.produto_id))
    : [];

  const searchProducts = async (value: string) => {
    if (value.trim().length < 2) return;
    setProductSearching(true);
    try {
      const response = await fetch(`/api/estoque/produtos?q=${encodeURIComponent(value)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao buscar produtos.');
      setProductOptions(result.products || []);
    } catch (searchError: any) {
      messageApi.error(userSafeMessage(searchError?.message, 'Não foi possível buscar os produtos. Tente novamente.'));
    } finally {
      setProductSearching(false);
    }
  };

  const saveAdjustment = async () => {
    const values = await adjustForm.validateFields();
    setAdjustSaving(true);
    try {
      const response = await fetch('/api/estoque', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao salvar o ajuste.');
      result.mlSyncWarning ? messageApi.warning(userSafeMessage(result.mlSyncWarning, 'O ajuste foi salvo, mas ainda não foi enviado ao Mercado Livre.')) : messageApi.success('Ajuste registrado no histórico.');
      setAdjustOpen(false);
      adjustForm.resetFields();
      await load(false);
    } catch (saveError: any) {
      messageApi.error(userSafeMessage(saveError?.message, 'Não foi possível salvar o ajuste. Tente novamente.'));
    } finally {
      setAdjustSaving(false);
    }
  };

  const performReturnAction = async (
    row: ReturnRow,
    action: 'receber' | 'apto' | 'nao_apto',
  ) => {
    setReturnActionId(row.id);
    try {
      const response = await fetch(
        action === 'receber'
          ? `/api/estoque/devolucoes/${row.id}/receber`
          : `/api/estoque/devolucoes/${row.id}/decidir`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: action === 'receber' ? '{}' : JSON.stringify({ resultado: action }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'A ação não foi concluída.');
      if (result.mlSyncWarning) messageApi.warning(result.mlSyncWarning);
      else if (action === 'receber') messageApi.success('Recebimento confirmado. O produto está aguardando inspeção.');
      else if (action === 'apto') messageApi.success('Produto liberado para venda.');
      else messageApi.success('Produto marcado como não apto para venda.');
      await load(false);
    } catch (actionError: any) {
      messageApi.error(userSafeMessage(actionError?.message, 'Não foi possível concluir a ação.'));
    } finally {
      setReturnActionId(null);
    }
  };

  const syncReturns = async () => {
    setReturnsSyncing(true);
    try {
      const response = await fetch('/api/estoque/devolucoes/sincronizar', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Não foi possível atualizar as devoluções.');
      if (result.falhas) messageApi.warning('Algumas devoluções não puderam ser atualizadas agora.');
      else messageApi.success('Devoluções atualizadas.');
      await load(false);
    } catch (syncError: any) {
      messageApi.error(userSafeMessage(syncError?.message, 'Não foi possível atualizar as devoluções.'));
    } finally {
      setReturnsSyncing(false);
    }
  };

  return (
    <div className={styles.page}>
      {contextHolder}
      <header className={styles.header}>
        <div>
          <Title level={2} className={styles.title}>Estoque próprio</Title>
          <Text type="secondary">Recebimentos, posição disponível e rastreabilidade física.</Text>
          <Text type="secondary" className={styles.updatedAt}>{lastUpdated ? `Atualizado em ${lastUpdated.toLocaleTimeString('pt-BR')}` : 'Aguardando atualização'}</Text>
        </div>
        <Space wrap>
          {canManage && <Button icon={<ToolOutlined />} onClick={() => setAdjustOpen(true)}>Ajustar estoque</Button>}
          {canManage && <Button type="primary" icon={<BarcodeOutlined />} onClick={() => { setReceiptId(null); setReceiveOpen(true); }}>Receber NF-e</Button>}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>Atualizar</Button>
        </Space>
      </header>

      {error && <Alert showIcon type="error" message="Não foi possível atualizar o estoque" description={`${userSafeMessage(error, 'A consulta não foi concluída.')} Os dados anteriores foram preservados.`} action={<Button onClick={() => void load()}>Tentar novamente</Button>} />}
      {data.hasHomologationFixtures && <Alert showIcon type="info" message="Registros de demonstração protegidos" description="Os registros marcados como amostra permitem avaliar a tela. Eles não alteram o saldo operacional e não aceitam ações." />}

      <section className={styles.summaryBand} aria-label="Resumo do estoque próprio">
        {[
          ['SKUs com estoque', data.summary.skus, 'Produtos com posição física'],
          ['Físico utilizável', data.summary.fisico, 'Unidades conferidas'],
          ['Disponível', data.summary.disponivel, 'Livre para novas vendas'],
          ['Reservado', data.summary.reservado, 'Comprometido com pedidos'],
          ['Em devolução', data.summary.devolucoesCaminho + data.summary.devolucoesReceber, 'A caminho ou para receber'],
          ['Aguardando inspeção', data.summary.devolucoesInspecao, 'Recebidas e ainda sem decisão'],
        ].map(([label, value, hint]) => <div className={styles.summaryItem} key={String(label)}><span className={styles.summaryLabel}>{label}</span><strong className={styles.summaryValue}>{value} <small>un.</small></strong><span className={styles.summaryHint}>{hint}</span></div>)}
      </section>

      <div className={styles.toolbar}>
        <Input allowClear prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto, SKU, venda, NF-e ou fornecedor" className={styles.search} />
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'estoque', label: 'Estoque',
          children: <Table<Position>
            rowKey="produto_id" loading={loading} dataSource={positions} pagination={{ pageSize: 50, showSizeChanger: false }} scroll={{ x: 1120 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum produto com posição de estoque" /> }}
            columns={[
              { title: 'Produto', key: 'produto', width: 390, render: (_, row) => <button className={styles.productButton} onClick={() => setSelectedProduct(row)}><strong>{row.nome} {row.is_homologation_fixture && <Tag color="blue">Amostra</Tag>}</strong><span>SKU {row.sku}</span></button> },
              { title: 'Devoluções ML', dataIndex: 'devolucoes_disponivel', width: 135, render: (value) => <strong className={value > 0 ? styles.positiveValue : styles.mutedValue}>{value} un.</strong> },
              { title: 'Compras', dataIndex: 'compras_disponivel', width: 110, render: (value) => <strong>{value} un.</strong> },
              { title: 'Ajustes', dataIndex: 'ajustes_disponivel', width: 100, render: (value) => <span className={value ? undefined : styles.mutedValue}>{value} un.</span> },
              { title: 'Reservado', dataIndex: 'reservado', width: 120, render: (value) => <span className={value ? styles.warningValue : undefined}>{value} un.</span> },
              { title: 'Disponível', dataIndex: 'disponivel', width: 120, render: (value) => <strong className={value > 0 ? styles.positiveValue : styles.mutedValue}>{value} un.</strong> },
              { title: 'Último movimento', dataIndex: 'ultima_movimentacao_em', width: 170, render: (value) => formatDate(value) },
              { title: '', key: 'action', width: 54, render: (_, row) => <Button type="text" icon={<EyeOutlined />} aria-label="Ver produto" onClick={() => setSelectedProduct(row)} /> },
            ]}
          />,
        },
        {
          key: 'devolucoes',
          label: `Devoluções ML (${data.summary.devolucoesCaminho + data.summary.devolucoesReceber + data.summary.devolucoesInspecao})`,
          children: <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <div className={styles.returnToolbar}>
              <Select
                value={returnFilter}
                onChange={setReturnFilter}
                style={{ width: 220 }}
                options={[
                  { value: 'abertas', label: 'Abertas' },
                  { value: 'em_transito', label: 'A caminho' },
                  { value: 'entrega_informada', label: 'Para receber' },
                  { value: 'aguardando_inspecao', label: 'Aguardando inspeção' },
                  { value: 'finalizadas', label: 'Finalizadas' },
                ]}
              />
              {canManage && <Button icon={<SyncOutlined />} loading={returnsSyncing} onClick={() => void syncReturns()}>Atualizar pelo Mercado Livre</Button>}
            </div>
            <Table<ReturnRow>
              rowKey="id"
              loading={loading}
              dataSource={returns}
              pagination={{ pageSize: 30, showSizeChanger: false }}
              scroll={{ x: 1180 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma devolução nesta etapa" /> }}
              columns={[
                { title: 'Produto', width: 330, render: (_, row) => <Space direction="vertical" size={1}><strong>{row.produtos?.nome || 'Produto não encontrado'}</strong><Text type="secondary">SKU {row.produtos?.sku || '—'}</Text></Space> },
                { title: 'Venda', width: 185, render: (_, row) => <Space direction="vertical" size={1}><strong>#{row.pedidos?.ml_pack_id || row.pedidos?.ml_order_id || '—'}</strong>{row.pedidos?.ml_pack_id && row.pedidos?.ml_order_id && <Text type="secondary">Venda {row.pedidos.ml_order_id}</Text>}</Space> },
                { title: 'Quantidade', dataIndex: 'quantidade', width: 105, render: (value) => <strong>{value} un.</strong> },
                { title: 'Motivo', dataIndex: 'motivo', width: 190 },
                { title: 'Situação', width: 245, render: (_, row) => <Space direction="vertical" size={3}>{returnStatus(row)}<Text type="secondary">{RETURN_STATUS_LABELS[row.status_logistico] || 'Aguardando atualização do Mercado Livre'}</Text></Space> },
                { title: 'Atualização', dataIndex: 'updated_at', width: 165, render: (value) => formatDate(value) },
                { title: 'Próxima ação', width: 270, fixed: 'right', render: (_, row) => {
                  if (!canManage) return <Text type="secondary">Somente consulta</Text>;
                  if (['em_transito', 'entrega_informada'].includes(row.estado_operacional)) {
                    return <Button loading={returnActionId === row.id} icon={<InboxOutlined />} type={row.estado_operacional === 'entrega_informada' ? 'primary' : 'default'} onClick={() => void performReturnAction(row, 'receber')}>Confirmar recebimento</Button>;
                  }
                  if (row.estado_operacional === 'aguardando_inspecao') {
                    return <Space wrap><Button type="primary" loading={returnActionId === row.id} icon={<CheckCircleOutlined />} onClick={() => void performReturnAction(row, 'apto')}>Apto para venda</Button><Button danger disabled={returnActionId === row.id} icon={<CloseCircleOutlined />} onClick={() => void performReturnAction(row, 'nao_apto')}>Não apto</Button></Space>;
                  }
                  return <Text type="secondary">Concluída</Text>;
                } },
              ]}
            />
          </Space>,
        },
        {
          key: 'recebimentos', label: `Recebimentos (${data.receipts.filter((row) => row.status !== 'conferido').length})`,
          children: <Table<Receipt>
            rowKey="id" loading={loading} dataSource={receipts} pagination={{ pageSize: 30, showSizeChanger: false }} scroll={{ x: 920 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma NF-e recebida" /> }}
            columns={[
              { title: 'NF-e', width: 190, render: (_, row) => <Space direction="vertical" size={1}><strong>NF-e {row.numero || '—'}{row.serie ? ` · Série ${row.serie}` : ''}</strong><Text type="secondary">Chave …{row.chave_nfe.slice(-10)}</Text></Space> },
              { title: 'Fornecedor', dataIndex: 'emitente_nome', width: 260, render: (value, row) => <Space direction="vertical" size={1}><strong>{value} {row.snapshot_source === 'bnt_d05_inventory_mock' && <Tag color="blue">Amostra</Tag>}</strong><Text type="secondary">CNPJ {row.emitente_cnpj}</Text></Space> },
              { title: 'Emissão', dataIndex: 'emitida_em', width: 130, render: (value) => formatDate(value, false) },
              { title: 'Conferência', width: 230, render: (_, row) => { const percent = row.itens_esperados ? Math.round((row.itens_conferidos / row.itens_esperados) * 100) : 0; return <Space direction="vertical" size={3} style={{ width: '100%' }}>{receiptStatus(row.status)}<Progress percent={percent} size="small" format={() => `${row.itens_conferidos}/${row.itens_esperados} un.`} /></Space>; } },
              { title: 'Ação', width: 150, render: (_, row) => canManage ? <Button icon={<InboxOutlined />} disabled={row.status === 'conferido' || row.status === 'identificada' || row.snapshot_source === 'bnt_d05_inventory_mock'} title={row.snapshot_source === 'bnt_d05_inventory_mock' ? 'Registro de demonstração protegido' : undefined} onClick={() => { setReceiptId(row.id); setReceiveOpen(true); }}>{row.status === 'parcial' ? 'Continuar' : row.status === 'identificada' ? 'Obter XML' : 'Conferir itens'}</Button> : <Text type="secondary">Somente consulta</Text> },
            ]}
          />,
        },
        {
          key: 'movimentos', label: 'Movimentações',
          children: <Table<Movement>
            rowKey="id" loading={loading} dataSource={movements} pagination={{ pageSize: 50, showSizeChanger: false }} scroll={{ x: 1120 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma movimentação registrada" /> }}
            columns={[
              { title: 'Data', dataIndex: 'created_at', width: 170, render: (value) => formatDate(value) },
              { title: 'Produto', width: 330, render: (_, row) => <Space direction="vertical" size={1}><strong>{row.produtos?.nome || 'Produto não encontrado'}</strong><Text type="secondary">SKU {row.produtos?.sku || '—'}</Text></Space> },
              { title: 'Movimento', width: 180, render: (_, row) => <Space direction="vertical" size={2}><strong className={positiveTypes.has(row.tipo) ? styles.positiveValue : styles.negativeValue}>{signedQuantity(row)}</strong><Text type="secondary">{movementLabel(row.tipo, row.estado_envio_interno)}</Text></Space> },
              { title: 'Origem do estoque', width: 210, render: (_, row) => stockOriginLabel(row.origem_estoque) },
              { title: 'Referência', width: 220, render: (_, row) => row.estoque_recebimentos_nfe ? `NF-e ${row.estoque_recebimentos_nfe.numero || `…${row.estoque_recebimentos_nfe.chave_nfe.slice(-8)}`}` : row.pedidos ? `Venda #${row.pedidos.ml_pack_id || row.pedidos.ml_order_id || '—'}` : 'Ajuste operacional' },
              { title: 'Motivo', dataIndex: 'motivo', width: 300 },
              { title: 'Situação', width: 120, render: (_, row) => row.snapshot_source === 'bnt_d05_inventory_mock' ? <Tag color="blue">Demonstração</Tag> : row.estornada_em ? <Tag>Estornado</Tag> : <Tag color="green">Ativo</Tag> },
            ]}
          />,
        },
      ]} />

      <Drawer open={Boolean(selectedProduct)} onClose={() => setSelectedProduct(null)} width={760} title={selectedProduct ? `${selectedProduct.nome} · ${selectedProduct.sku}` : 'Produto'} destroyOnHidden>
        {selectedProduct && <Tabs items={[
          { key: 'position', label: 'Posição', children: <Descriptions bordered column={1} size="small"><Descriptions.Item label="Devoluções do Mercado Livre">{selectedProduct.devolucoes_disponivel} un.</Descriptions.Item><Descriptions.Item label="Compras por NF-e">{selectedProduct.compras_disponivel} un.</Descriptions.Item><Descriptions.Item label="Ajustes">{selectedProduct.ajustes_disponivel} un.</Descriptions.Item><Descriptions.Item label="Físico utilizável">{selectedProduct.fisico_util} un.</Descriptions.Item><Descriptions.Item label="Reservado">{selectedProduct.reservado} un.</Descriptions.Item><Descriptions.Item label="Disponível">{selectedProduct.disponivel} un.</Descriptions.Item><Descriptions.Item label="Aguardando inspeção">{selectedProduct.em_revisao} un.</Descriptions.Item><Descriptions.Item label="Não apto para venda">{selectedProduct.nao_aproveitavel} un.</Descriptions.Item></Descriptions> },
          { key: 'history', label: `Histórico (${productMovements.length})`, children: productMovements.length ? <Timeline items={productMovements.map((movement) => ({ color: positiveTypes.has(movement.tipo) ? 'green' : 'blue', children: <div><strong>{signedQuantity(movement)} · {movementLabel(movement.tipo, movement.estado_envio_interno)}</strong><br /><Text type="secondary">{formatDate(movement.created_at)} · {movement.motivo}</Text></div> }))} /> : <Empty description="Sem movimentações" /> },
        ]} />}
      </Drawer>

      <ReceiveNfeModal open={receiveOpen} initialReceiptId={receiptId} onClose={() => { setReceiveOpen(false); setReceiptId(null); }} onChanged={() => void load(false)} />

      <Modal open={adjustOpen} title="Ajustar estoque" okText="Registrar ajuste" cancelText="Cancelar" confirmLoading={adjustSaving} onOk={() => void saveAdjustment()} onCancel={() => setAdjustOpen(false)} destroyOnHidden>
        <Alert type="warning" showIcon message="O ajuste fica no histórico" description="Use quantidade positiva para entrada e negativa para baixa. Unidades reservadas nunca podem ser removidas." />
        <Form form={adjustForm} layout="vertical" className={styles.adjustForm}>
          <Form.Item name="produtoId" label="Produto" rules={[{ required: true, message: 'Selecione o produto.' }]}>
            <Select showSearch filterOption={false} placeholder="Busque por nome, SKU ou GTIN" loading={productSearching} onSearch={(value) => void searchProducts(value)} options={productOptions.map((product) => ({ value: product.id, label: `${product.sku} · ${product.nome}` }))} />
          </Form.Item>
          <Form.Item name="quantidade" label="Quantidade do ajuste" extra="Ex.: 3 para entrada; -2 para baixa." rules={[{ required: true, message: 'Informe a quantidade.' }]}><InputNumber precision={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="motivo" label="Motivo" rules={[{ required: true, min: 5, message: 'Explique o motivo do ajuste.' }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
