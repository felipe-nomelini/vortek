'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert, Button, DatePicker, Descriptions, Drawer, Dropdown, Empty, Input,
  Modal, Progress, Select, Space, Table, Tabs, Tag, Timeline, Typography, message,
} from 'antd';
import {
  DownloadOutlined, EllipsisOutlined, EyeOutlined, InboxOutlined,
  ReloadOutlined, SearchOutlined, SyncOutlined,
} from '@ant-design/icons';
import ReceiveNfeModal from '@/components/estoque/ReceiveNfeModal';
import { formatCurrency } from '@/lib/format';
import styles from './IncomingInvoicesPanel.module.css';

const { Text } = Typography;
const { RangePicker } = DatePicker;

type IncomingItem = {
  id: string; numero_item: number; codigo_fornecedor: string | null; gtin: string | null;
  descricao: string; quantidade_esperada: number; quantidade_liberada: number;
  quantidade_nao_aproveitavel: number; produtos: { id: string; sku: string; nome: string } | null;
};
type Manifestation = {
  id: string; tipo_manifestacao: number; status: string; protocolo: string | null;
  motivo: string | null; justificativa: string | null; numero_sequencial: number | null;
  codigo_sefaz: number | null; requested_at: string; completed_at: string | null;
};
type IncomingInvoice = {
  id: string; chave_nfe: string; numero: string | null; serie: string | null;
  emitente_nome: string; emitente_cnpj: string; emitente_ie: string | null;
  emitida_em: string | null; recebida_em: string | null; valor_total: number; valor_icms: number | null;
  provider_status: number | null; numero_protocolo: string | null; cfops: string | null;
  status: 'identificada' | 'aguardando_conferencia' | 'parcial' | 'conferido';
  origem_xml: string | null; itens_esperados: number; itens_conferidos: number;
  itens: IncomingItem[]; manifestacoes: Manifestation[]; is_homologation_fixture: boolean;
};
type Summary = {
  detectadas: number; valorTotal: number; aguardandoRecebimento: number;
  emConferencia: number; conferidas: number; alertas: number;
};

const EMPTY_SUMMARY: Summary = { detectadas: 0, valorTotal: 0, aguardandoRecebimento: 0, emConferencia: 0, conferidas: 0, alertas: 0 };
const manifestationLabels: Record<number, string> = {
  1: 'Confirmação da operação', 2: 'Ciência da operação',
  3: 'Desconhecimento da operação', 4: 'Operação não realizada',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function fiscalStatus(value: number | null) {
  if (value === 1) return <Tag color="green">Autorizada</Tag>;
  if (value === 2) return <Tag color="red">Cancelada</Tag>;
  if (value === 3) return <Tag color="volcano">Uso denegado</Tag>;
  return <Tag>Não informado</Tag>;
}

function receiptLabel(row: IncomingInvoice) {
  if (row.status === 'conferido') return 'Conferida';
  if (row.status === 'parcial') return 'Conferência parcial';
  if (row.status === 'aguardando_conferencia') return 'Aguardando conferência';
  return 'Aguardando XML/recebimento';
}

export default function IncomingInvoicesPanel(props: { canManage: boolean }) {
  const { canManage } = props;
  const [rows, setRows] = useState<IncomingInvoice[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fiscalFilter, setFiscalFilter] = useState<string>('');
  const [receiptFilter, setReceiptFilter] = useState<string>('');
  const [manifestationFilter, setManifestationFilter] = useState<number | undefined>();
  const [selected, setSelected] = useState<IncomingInvoice | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<IncomingInvoice | null>(null);
  const [manifestTarget, setManifestTarget] = useState<IncomingInvoice | null>(null);
  const [manifestType, setManifestType] = useState<1 | 2 | 3 | 4>(2);
  const [manifestJustification, setManifestJustification] = useState('');
  const [manifesting, setManifesting] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncPeriod, setSyncPeriod] = useState<[Dayjs, Dayjs]>([dayjs().subtract(30, 'day'), dayjs()]);
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (fiscalFilter) params.set('fiscalStatus', fiscalFilter);
      if (receiptFilter) params.set('receiptStatus', receiptFilter);
      if (manifestationFilter) params.set('manifestationType', String(manifestationFilter));
      const response = await fetch(`/api/notas-fiscais/entradas?${params}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || 'Falha ao carregar NF-e de entrada.');
      setRows(result.data || []);
      setSummary(result.summary || EMPTY_SUMMARY);
      setSelected((current) => current ? (result.data || []).find((row: IncomingInvoice) => row.id === current.id) || current : null);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Falha ao carregar NF-e de entrada.');
    } finally {
      setLoading(false);
    }
  }, [fiscalFilter, manifestationFilter, receiptFilter, search]);

  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/notas-fiscais/entradas/sincronizar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inicio: syncPeriod[0].format('YYYY-MM-DD'), fim: syncPeriod[1].format('YYYY-MM-DD') }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || 'Falha ao sincronizar entradas.');
      messageApi.success(`${result.found} documentos consultados; ${result.inserted} novos e ${result.updated} atualizados.`);
      setSyncOpen(false);
      await load();
    } catch (syncError: any) {
      messageApi.error(syncError?.message || 'Falha ao sincronizar entradas.');
    } finally {
      setSyncing(false);
    }
  };

  const openManifest = (row: IncomingInvoice, type: 1 | 2 | 3 | 4) => {
    setManifestTarget(row);
    setManifestType(type);
    setManifestJustification('');
  };

  const sendManifest = async () => {
    if (!manifestTarget) return;
    setManifesting(true);
    try {
      const response = await fetch(`/api/notas-fiscais/entradas/${manifestTarget.id}/manifestacoes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: manifestType,
          justificativa: manifestJustification || undefined,
          confirmar: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || 'Falha ao enviar manifestação.');
      messageApi.success('Manifestação enviada e registrada no histórico.');
      setManifestTarget(null);
      await load();
    } catch (manifestError: any) {
      messageApi.error(manifestError?.message || 'Falha ao enviar manifestação.');
    } finally {
      setManifesting(false);
    }
  };

  const fixturePresent = useMemo(() => rows.some((row) => row.is_homologation_fixture), [rows]);

  return <div className={styles.panel}>
    {contextHolder}
    <div className={styles.actions}>
      <Text type="secondary">Notas emitidas por fornecedores contra o CNPJ da Bentevi.</Text>
      <Space wrap>
        {canManage && <Button icon={<SyncOutlined />} onClick={() => setSyncOpen(true)}>Sincronizar período</Button>}
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>Atualizar</Button>
      </Space>
    </div>
    {fixturePresent && <Alert showIcon type="info" message="Amostras protegidas de homologação" description="Documentos e eventos fiscais estão desabilitados nos registros de demonstração." />}
    {error && <Alert showIcon type="error" message="Falha ao carregar NF-e de entrada" description={error} action={<Button size="small" onClick={() => void load()}>Tentar novamente</Button>} />}

    <section className={styles.summary}>
      {[
        ['Detectadas', summary.detectadas, 'NF-e modelo 55 no período'],
        ['Valor total', formatCurrency(summary.valorTotal), 'Valor das entradas identificadas'],
        ['Aguardando', summary.aguardandoRecebimento, 'XML ou recebimento pendente'],
        ['Em conferência', summary.emConferencia, 'Conferência física iniciada'],
        ['Conferidas', summary.conferidas, 'Recebimento concluído'],
        ['Alertas', summary.alertas, 'Canceladas ou denegadas'],
      ].map(([label, value, hint]) => <div key={String(label)} className={styles.summaryItem}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}
    </section>

    <div className={styles.filters}>
      <Input allowClear prefix={<SearchOutlined />} placeholder="Fornecedor, CNPJ, chave ou número" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Select allowClear placeholder="Estado fiscal" value={fiscalFilter || undefined} onChange={(value) => setFiscalFilter(value || '')} options={[{ value: '1', label: 'Autorizada' }, { value: '2', label: 'Cancelada' }, { value: '3', label: 'Uso denegado' }]} />
      <Select allowClear placeholder="Recebimento" value={receiptFilter || undefined} onChange={(value) => setReceiptFilter(value || '')} options={[{ value: 'identificada', label: 'Aguardando XML/recebimento' }, { value: 'aguardando_conferencia', label: 'Aguardando conferência' }, { value: 'parcial', label: 'Conferência parcial' }, { value: 'conferido', label: 'Conferida' }]} />
      <Select allowClear placeholder="Manifestação" value={manifestationFilter} onChange={setManifestationFilter} options={Object.entries(manifestationLabels).map(([value, label]) => ({ value: Number(value), label }))} />
    </div>

    <Table<IncomingInvoice>
      rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 30, showSizeChanger: false }} scroll={{ x: 1360 }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma NF-e de entrada encontrada" /> }}
      columns={[
        { title: 'NF-e', width: 220, render: (_, row) => <div className={styles.stack}><button className={styles.link} onClick={() => setSelected(row)}>NF-e {row.numero || '—'} {row.is_homologation_fixture && <Tag color="blue">Amostra</Tag>}</button><span>Chave …{row.chave_nfe.slice(-12)}</span><span>{formatDate(row.emitida_em)}</span></div> },
        { title: 'Fornecedor', width: 290, render: (_, row) => <div className={styles.stack}><strong>{row.emitente_nome}</strong><span>CNPJ {row.emitente_cnpj}</span>{row.emitente_ie && <span>IE {row.emitente_ie}</span>}</div> },
        { title: 'Valor', width: 135, render: (_, row) => <div className={styles.stack}><strong>{formatCurrency(row.valor_total)}</strong>{row.valor_icms != null && <span>ICMS {formatCurrency(row.valor_icms)}</span>}</div> },
        { title: 'Estado fiscal', width: 145, render: (_, row) => fiscalStatus(row.provider_status) },
        { title: 'Manifestação', width: 220, render: (_, row) => { const event = row.manifestacoes[0]; return event ? <div className={styles.stack}><strong>{manifestationLabels[event.tipo_manifestacao] || 'Evento fiscal'}</strong><span>{event.status.replaceAll('_', ' ')}</span><span>{formatDate(event.requested_at)}</span></div> : <Text type="secondary">Nenhuma manifestação</Text>; } },
        { title: 'Recebimento', width: 250, render: (_, row) => { const percent = row.itens_esperados ? Math.round((row.itens_conferidos / row.itens_esperados) * 100) : 0; return <div className={styles.progress}><strong>{receiptLabel(row)}</strong><Progress percent={percent} size="small" format={() => row.itens_esperados ? `${row.itens_conferidos}/${row.itens_esperados} un.` : 'Aguardando XML'} /></div>; } },
        { title: 'Ações', width: 190, fixed: 'right', render: (_, row) => {
          const protectedRow = row.is_homologation_fixture;
          const canReceive = row.provider_status === 1 && row.status !== 'conferido' && !protectedRow;
          const menuItems = [
            { key: 'details', label: 'Ver detalhes', icon: <EyeOutlined /> },
            { key: 'xml', label: 'Baixar XML', icon: <DownloadOutlined />, disabled: protectedRow },
            { key: 'pdf', label: 'Abrir DANFE', icon: <DownloadOutlined />, disabled: protectedRow },
            ...(canManage ? Object.entries(manifestationLabels).map(([type, label]) => ({ key: `manifest-${type}`, label, disabled: protectedRow || row.provider_status !== 1 })) : []),
          ];
          const run = ({ key }: { key: string }) => {
            if (key === 'details') setSelected(row);
            if (key === 'xml') window.open(`/api/notas-fiscais/entradas/${row.id}/xml`, '_blank');
            if (key === 'pdf') window.open(`/api/notas-fiscais/entradas/${row.id}/pdf`, '_blank');
            if (key.startsWith('manifest-')) openManifest(row, Number(key.slice(9)) as 1 | 2 | 3 | 4);
          };
          return <Space.Compact><Button size="small" icon={<InboxOutlined />} disabled={!canReceive} title={protectedRow ? 'Amostra protegida' : undefined} onClick={() => setReceiveTarget(row)}>{row.status === 'parcial' ? 'Continuar' : 'Receber'}</Button><Dropdown trigger={['click']} menu={{ items: menuItems, onClick: run }}><Button size="small" icon={<EllipsisOutlined />} aria-label="Mais ações" /></Dropdown></Space.Compact>;
        } },
      ]}
    />

    <Drawer width={820} open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `NF-e de entrada ${selected.numero || `…${selected.chave_nfe.slice(-10)}`}` : 'NF-e de entrada'} destroyOnHidden>
      {selected && <Tabs items={[
        { key: 'overview', label: 'Visão geral', children: <Descriptions bordered size="small" column={1}><Descriptions.Item label="Fornecedor">{selected.emitente_nome}</Descriptions.Item><Descriptions.Item label="CNPJ">{selected.emitente_cnpj}</Descriptions.Item><Descriptions.Item label="Chave">{selected.chave_nfe}</Descriptions.Item><Descriptions.Item label="Emissão">{formatDate(selected.emitida_em)}</Descriptions.Item><Descriptions.Item label="Recebida pela Brasil NFe">{formatDate(selected.recebida_em)}</Descriptions.Item><Descriptions.Item label="Valor">{formatCurrency(selected.valor_total)}</Descriptions.Item><Descriptions.Item label="CFOPs">{selected.cfops || '—'}</Descriptions.Item><Descriptions.Item label="Estado fiscal">{fiscalStatus(selected.provider_status)}</Descriptions.Item><Descriptions.Item label="Recebimento">{receiptLabel(selected)}</Descriptions.Item></Descriptions> },
        { key: 'items', label: `Itens (${selected.itens.length})`, children: selected.itens.length ? <Table rowKey="id" size="small" pagination={false} dataSource={selected.itens} columns={[{ title: 'Item', render: (_, item) => <div className={styles.stack}><strong>{item.descricao}</strong><span>Cód. fornecedor {item.codigo_fornecedor || '—'} · GTIN {item.gtin || '—'}</span></div> }, { title: 'Produto Bentevi', render: (_, item) => item.produtos ? `${item.produtos.sku} · ${item.produtos.nome}` : <Text type="warning">Mapeamento pendente</Text> }, { title: 'Conferência', width: 150, render: (_, item) => `${item.quantidade_liberada + item.quantidade_nao_aproveitavel}/${item.quantidade_esperada} un.` }]} /> : <Empty description="O XML ainda não foi importado" /> },
        { key: 'documents', label: 'Documentos e eventos', children: <Space direction="vertical" size={18} style={{ width: '100%' }}><Space><Button icon={<DownloadOutlined />} disabled={selected.is_homologation_fixture} href={`/api/notas-fiscais/entradas/${selected.id}/xml`} target="_blank">Baixar XML</Button><Button icon={<DownloadOutlined />} disabled={selected.is_homologation_fixture} href={`/api/notas-fiscais/entradas/${selected.id}/pdf`} target="_blank">Abrir DANFE</Button></Space>{selected.manifestacoes.length ? <Timeline items={selected.manifestacoes.map((event) => ({ children: <div><strong>{manifestationLabels[event.tipo_manifestacao]}</strong><br /><Text type="secondary">{event.status.replaceAll('_', ' ')} · {formatDate(event.requested_at)}</Text>{event.motivo && <><br /><Text type="secondary">{event.motivo}</Text></>}</div> }))} /> : <Empty description="Nenhum evento fiscal registrado" />}</Space> },
      ]} />}
    </Drawer>

    <ReceiveNfeModal open={Boolean(receiveTarget)} initialReceiptId={receiveTarget?.status === 'identificada' ? null : receiveTarget?.id} initialKey={receiveTarget?.status === 'identificada' ? receiveTarget.chave_nfe : null} onClose={() => setReceiveTarget(null)} onChanged={() => void load()} />

    <Modal open={Boolean(manifestTarget)} title={manifestationLabels[manifestType]} okText="Confirmar e enviar" cancelText="Cancelar" confirmLoading={manifesting} okButtonProps={{ danger: manifestType >= 3, disabled: manifestType === 4 && manifestJustification.trim().length < 15 }} onOk={() => void sendManifest()} onCancel={() => setManifestTarget(null)} destroyOnHidden>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert showIcon type={manifestType >= 3 ? 'warning' : 'info'} message="Evento fiscal com efeito na SEFAZ" description="A ação será registrada no histórico e enviada uma única vez. Revise a NF-e antes de confirmar." />
        {manifestType === 4 && <Input.TextArea rows={4} maxLength={255} showCount placeholder="Justificativa obrigatória (mínimo 15 caracteres)" value={manifestJustification} onChange={(event) => setManifestJustification(event.target.value)} />}
      </Space>
    </Modal>

    <Modal open={syncOpen} title="Sincronizar NF-e de entrada" okText="Sincronizar" cancelText="Cancelar" confirmLoading={syncing} onOk={() => void sync()} onCancel={() => setSyncOpen(false)} destroyOnHidden>
      <Space direction="vertical" size={12} style={{ width: '100%' }}><Alert showIcon type="info" message="Consulta manual de recuperação" description="O webhook permanece como entrada principal. Use esta consulta para reconciliar no máximo 31 dias." /><RangePicker value={syncPeriod} format="DD/MM/YYYY" style={{ width: '100%' }} onChange={(range) => range?.[0] && range[1] && setSyncPeriod([range[0], range[1]])} /></Space>
    </Modal>
  </div>;
}
