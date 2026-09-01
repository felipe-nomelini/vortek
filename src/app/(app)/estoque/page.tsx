'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal,
  Progress, Select, Space, Table, Tabs, Tag, Timeline, Typography, message,
} from 'antd';
import {
  ToolOutlined, BarcodeOutlined, EyeOutlined, InboxOutlined,
  ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import ReceiveNfeModal from '@/components/estoque/ReceiveNfeModal';
import styles from './estoque.module.css';

const { Text, Title } = Typography;

type Position = {
  produto_id: string; sku: string; nome: string; fisico_util: number; reservado: number;
  disponivel: number; em_revisao: number; nao_aproveitavel: number; ultima_movimentacao_em: string | null;
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
  snapshot_source: string;
  produtos: { sku: string; nome: string } | null;
  pedidos: { ml_order_id: string | null; ml_pack_id: string | null } | null;
  estoque_recebimentos_nfe: { chave_nfe: string; numero: string | null; serie: string | null; emitente_nome: string } | null;
};
type StockData = {
  positions: Position[]; receipts: Receipt[]; movements: Movement[];
  summary: { skus: number; fisico: number; disponivel: number; reservado: number; emConferencia: number };
  hasHomologationFixtures?: boolean;
};
type ProductOption = { id: string; sku: string; nome: string };

const EMPTY: StockData = { positions: [], receipts: [], movements: [], summary: { skus: 0, fisico: 0, disponivel: 0, reservado: 0, emConferencia: 0 } };
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
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [adjustForm] = Form.useForm<{ produtoId: string; quantidade: number; motivo: string }>();
  const [messageApi, contextHolder] = message.useMessage();

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
      messageApi.error(searchError?.message || 'Falha ao buscar produtos.');
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
      result.mlSyncWarning ? messageApi.warning(result.mlSyncWarning) : messageApi.success('Ajuste registrado no histórico.');
      setAdjustOpen(false);
      adjustForm.resetFields();
      await load(false);
    } catch (saveError: any) {
      messageApi.error(saveError?.message || 'Falha ao salvar o ajuste.');
    } finally {
      setAdjustSaving(false);
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
          <Button icon={<ToolOutlined />} onClick={() => setAdjustOpen(true)}>Ajustar estoque</Button>
          <Button type="primary" icon={<BarcodeOutlined />} onClick={() => { setReceiptId(null); setReceiveOpen(true); }}>Receber NF-e</Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>Atualizar</Button>
        </Space>
      </header>

      {error && <Alert showIcon type="error" message="Não foi possível atualizar o estoque" description={`${error} Os dados anteriores foram preservados.`} action={<Button onClick={() => void load()}>Tentar novamente</Button>} />}
      {data.hasHomologationFixtures && <Alert showIcon type="info" message="Amostra protegida de homologação" description="Os registros marcados como amostra permitem avaliar todos os estados da tela. Eles estão estornados no ledger, não alteram o saldo operacional e não aceitam ações." />}

      <section className={styles.summaryBand} aria-label="Resumo do estoque próprio">
        {[
          ['SKUs com estoque', data.summary.skus, 'Produtos com posição física'],
          ['Físico utilizável', data.summary.fisico, 'Unidades conferidas'],
          ['Disponível', data.summary.disponivel, 'Livre para novas vendas'],
          ['Reservado', data.summary.reservado, 'Comprometido com pedidos'],
          ['Em conferência', data.summary.emConferencia, 'Aguardando conferência física'],
        ].map(([label, value, hint]) => <div className={styles.summaryItem} key={String(label)}><span className={styles.summaryLabel}>{label}</span><strong className={styles.summaryValue}>{value} <small>un.</small></strong><span className={styles.summaryHint}>{hint}</span></div>)}
      </section>

      <div className={styles.toolbar}>
        <Input allowClear prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto, SKU, NF-e ou fornecedor" className={styles.search} />
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'estoque', label: 'Estoque',
          children: <Table<Position>
            rowKey="produto_id" loading={loading} dataSource={positions} pagination={{ pageSize: 50, showSizeChanger: false }} scroll={{ x: 980 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum produto com posição de estoque" /> }}
            columns={[
              { title: 'Produto', key: 'produto', width: 390, render: (_, row) => <button className={styles.productButton} onClick={() => setSelectedProduct(row)}><strong>{row.nome} {row.is_homologation_fixture && <Tag color="blue">Amostra</Tag>}</strong><span>SKU {row.sku}</span></button> },
              { title: 'Físico', dataIndex: 'fisico_util', width: 110, render: (value) => <strong>{value} un.</strong> },
              { title: 'Reservado', dataIndex: 'reservado', width: 120, render: (value) => <span className={value ? styles.warningValue : undefined}>{value} un.</span> },
              { title: 'Disponível', dataIndex: 'disponivel', width: 120, render: (value) => <strong className={value > 0 ? styles.positiveValue : styles.mutedValue}>{value} un.</strong> },
              { title: 'Revisão', dataIndex: 'em_revisao', width: 100, render: (value) => `${value} un.` },
              { title: 'Inutilizável', dataIndex: 'nao_aproveitavel', width: 110, render: (value) => `${value} un.` },
              { title: 'Último movimento', dataIndex: 'ultima_movimentacao_em', width: 170, render: (value) => formatDate(value) },
              { title: '', key: 'action', width: 54, render: (_, row) => <Button type="text" icon={<EyeOutlined />} aria-label="Ver produto" onClick={() => setSelectedProduct(row)} /> },
            ]}
          />,
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
              { title: 'Ação', width: 150, render: (_, row) => <Button icon={<InboxOutlined />} disabled={row.status === 'conferido' || row.status === 'identificada' || row.snapshot_source === 'bnt_d05_inventory_mock'} title={row.snapshot_source === 'bnt_d05_inventory_mock' ? 'Amostra protegida de homologação' : undefined} onClick={() => { setReceiptId(row.id); setReceiveOpen(true); }}>{row.status === 'parcial' ? 'Continuar' : row.status === 'identificada' ? 'Obter XML' : 'Conferir itens'}</Button> },
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
              { title: 'Origem', width: 220, render: (_, row) => row.estoque_recebimentos_nfe ? `NF-e ${row.estoque_recebimentos_nfe.numero || `…${row.estoque_recebimentos_nfe.chave_nfe.slice(-8)}`}` : row.pedidos ? `Venda #${row.pedidos.ml_pack_id || row.pedidos.ml_order_id || '—'}` : 'Ajuste operacional' },
              { title: 'Motivo', dataIndex: 'motivo', width: 300 },
              { title: 'Estado', width: 120, render: (_, row) => row.snapshot_source === 'bnt_d05_inventory_mock' ? <Tag color="blue">Amostra inerte</Tag> : row.estornada_em ? <Tag>Estornado</Tag> : <Tag color="green">Ativo</Tag> },
            ]}
          />,
        },
      ]} />

      <Drawer open={Boolean(selectedProduct)} onClose={() => setSelectedProduct(null)} width={760} title={selectedProduct ? `${selectedProduct.nome} · ${selectedProduct.sku}` : 'Produto'} destroyOnHidden>
        {selectedProduct && <Tabs items={[
          { key: 'position', label: 'Posição', children: <Descriptions bordered column={1} size="small"><Descriptions.Item label="Físico utilizável">{selectedProduct.fisico_util} un.</Descriptions.Item><Descriptions.Item label="Reservado">{selectedProduct.reservado} un.</Descriptions.Item><Descriptions.Item label="Disponível">{selectedProduct.disponivel} un.</Descriptions.Item><Descriptions.Item label="Em revisão">{selectedProduct.em_revisao} un.</Descriptions.Item><Descriptions.Item label="Não aproveitável">{selectedProduct.nao_aproveitavel} un.</Descriptions.Item></Descriptions> },
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
