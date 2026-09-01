'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Descriptions, Drawer, Dropdown, Empty, Input, InputNumber,
  Modal, Space, Table, Tag, Timeline, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  DownloadOutlined, EllipsisOutlined, EyeOutlined, FilePdfOutlined,
  MailOutlined, ReloadOutlined, SyncOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import { FISCAL_RETURN_TYPE_LABELS, type FiscalReturnType } from '@/lib/fiscal/nfe-return';
import { formatCurrency } from '@/lib/format';
import { getFiscalStatusPresentation } from '@/components/fiscal/NotaFiscalDetailsDrawer';
import type { NfeTechnicalStatus } from '@/lib/fiscal/nfe-status';

type FiscalReturnRow = {
  id: string;
  pedido_id: string;
  tipo_retorno: FiscalReturnType;
  escopo: 'total' | 'parcial';
  motivo: string;
  status: NfeTechnicalStatus;
  status_persistido: string;
  created_at: string;
  valor_total: number;
  quantidade_itens: number;
  quantidade_total: number;
  nfe_original_chave: string;
  nfe_original_numero: string | null;
  nfe_numero: string | null;
  nfe_serie: string | null;
  nfe_chave: string | null;
  nfe_protocolo: string | null;
  nfe_external_id: string | null;
  nfe_danfe_url: string | null;
  xml_available: boolean;
  erro: string | null;
  itens: Array<Record<string, any>>;
  pedido: { numero: number; ml_order_id: string | null; ml_pack_id: string | null; cliente: string } | null;
  history?: Array<{ id: string; evento: string; status_resultante: string | null; created_at: string }>;
};

type Props = {
  canManage: boolean;
  refreshToken: number;
};

function dateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function FiscalReturnsPanel({ canManage, refreshToken }: Props) {
  const [rows, setRows] = useState<FiscalReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<FiscalReturnRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionTarget, setActionTarget] = useState<FiscalReturnRow | null>(null);
  const [actionType, setActionType] = useState<'email' | 'cancel' | 'cce' | null>(null);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('Cancelamento da NF-e de devolução solicitado pelo usuário');
  const [confirmText, setConfirmText] = useState('');
  const [correction, setCorrection] = useState('');
  const [sequence, setSequence] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' });
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/notas-fiscais/retornos?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha ao carregar devoluções fiscais');
      setRows(payload.data || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao carregar devoluções fiscais');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void fetchRows(); }, [fetchRows, refreshToken]);

  const openDetail = useCallback(async (row: FiscalReturnRow) => {
    setDetail(row);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/notas-fiscais/retornos/${row.id}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha ao carregar o detalhe');
      setDetail(payload.data);
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : 'Falha ao carregar o detalhe');
    } finally {
      setDetailLoading(false);
    }
  }, [messageApi]);

  const openDanfe = useCallback(async (row: FiscalReturnRow) => {
    setActionLoading(row.id);
    try {
      const response = await fetch(`/api/notas-fiscais/retornos/${row.id}/pdf`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw new Error(payload.error || 'DANFE não disponível');
      window.open(payload.url, '_blank', 'noopener,noreferrer');
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : 'DANFE não disponível');
    } finally {
      setActionLoading(null);
    }
  }, [messageApi]);

  const reconcile = useCallback(async (row: FiscalReturnRow) => {
    setActionLoading(row.id);
    try {
      const response = await fetch(`/api/notas-fiscais/retornos/${row.id}/reconciliar`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha ao atualizar o status');
      messageApi.success('Situação fiscal atualizada.');
      await fetchRows();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : 'Falha ao atualizar o status');
    } finally {
      setActionLoading(null);
    }
  }, [fetchRows, messageApi]);

  const downloadXml = useCallback((row: FiscalReturnRow) => {
    const anchor = document.createElement('a');
    anchor.href = `/api/notas-fiscais/retornos/${row.id}/xml`;
    anchor.download = `nfe_retorno_${row.nfe_numero || row.id}.xml`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const submitModalAction = useCallback(async () => {
    if (!actionTarget || !actionType) return;
    setActionLoading(actionTarget.id);
    try {
      const endpoints = {
        email: 'enviar-email', cancel: 'cancelar', cce: 'carta-correcao',
      } as const;
      const body = actionType === 'email'
        ? { to: email || undefined }
        : actionType === 'cancel'
          ? { justificativa: reason }
          : { correcao: correction, numeroSequencial: sequence };
      const response = await fetch(`/api/notas-fiscais/retornos/${actionTarget.id}/${endpoints[actionType]}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Ação fiscal rejeitada');
      messageApi.success(actionType === 'email' ? `Documento enviado para ${payload.to}.` : 'Ação fiscal concluída.');
      setActionType(null);
      setActionTarget(null);
      await fetchRows();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : 'Ação fiscal rejeitada');
    } finally {
      setActionLoading(null);
    }
  }, [actionTarget, actionType, correction, email, fetchRows, messageApi, reason, sequence]);

  const openAction = useCallback((type: 'email' | 'cancel' | 'cce', row: FiscalReturnRow) => {
    setActionTarget(row);
    setActionType(type);
    setEmail('');
    setReason('Cancelamento da NF-e de devolução solicitado pelo usuário');
    setConfirmText('');
    setCorrection('');
    setSequence(1);
  }, []);

  const columns = useMemo<TableProps<FiscalReturnRow>['columns']>(() => [
    { title: 'Data', dataIndex: 'created_at', key: 'date', width: 145, render: dateTime },
    {
      title: 'Tipo', dataIndex: 'tipo_retorno', key: 'type', width: 195,
      render: (value: FiscalReturnType, row) => <div><strong>{FISCAL_RETURN_TYPE_LABELS[value]}</strong><br /><Typography.Text type="secondary">{row.escopo === 'total' ? 'Retorno total' : 'Retorno parcial'}</Typography.Text></div>,
    },
    {
      title: 'Venda original', key: 'sale', width: 190,
      render: (_, row) => <div><strong>{row.pedido?.ml_pack_id ? `Pack ${row.pedido.ml_pack_id}` : `Venda ${row.pedido?.ml_order_id || row.pedido?.numero || '—'}`}</strong><br /><Typography.Text type="secondary">NF-e {row.nfe_original_numero || '—'}</Typography.Text></div>,
    },
    {
      title: 'NF-e de retorno', dataIndex: 'nfe_numero', key: 'invoice', width: 160,
      render: (value, row) => value ? <div><strong>NF-e {value}</strong><br /><Typography.Text type="secondary">{row.nfe_serie ? `Série ${row.nfe_serie}` : 'Série não informada'}</Typography.Text></div> : <Typography.Text type="secondary">Ainda não autorizada</Typography.Text>,
    },
    {
      title: 'Itens', key: 'items', width: 105,
      render: (_, row) => <div><strong>{row.quantidade_itens}</strong><br /><Typography.Text type="secondary">{row.quantidade_total} un.</Typography.Text></div>,
    },
    { title: 'Valor', dataIndex: 'valor_total', key: 'value', width: 125, render: formatCurrency },
    {
      title: 'Estado fiscal', key: 'status', width: 205,
      render: (_, row) => {
        const presentation = getFiscalStatusPresentation({ status: row.status, nfe_status: row.status_persistido } as any);
        return <div><Tag color={presentation.color}>{presentation.label}</Tag>{row.erro && <Typography.Text type="danger" ellipsis style={{ display: 'block', maxWidth: 185 }}>{row.erro}</Typography.Text>}</div>;
      },
    },
    {
      title: 'Ações', key: 'actions', width: 170, fixed: 'right',
      render: (_, row) => {
        const authorized = row.status === 'autorizada';
        const actions = [
          { key: 'details', label: 'Ver detalhes', icon: <EyeOutlined /> },
          authorized ? { key: 'danfe', label: 'Abrir DANFE', icon: <FilePdfOutlined /> } : null,
          authorized && row.xml_available ? { key: 'xml', label: 'Baixar XML', icon: <DownloadOutlined /> } : null,
          canManage && authorized ? { key: 'email', label: 'Enviar por e-mail', icon: <MailOutlined /> } : null,
          canManage && authorized ? { key: 'cce', label: 'Emitir CC-e' } : null,
          canManage && authorized ? { key: 'cancel', label: 'Cancelar NF-e', danger: true } : null,
          canManage && row.nfe_external_id && !['autorizada', 'cancelada'].includes(row.status) ? { key: 'reconcile', label: 'Atualizar status', icon: <SyncOutlined /> } : null,
        ].filter(Boolean) as Array<{ key: string; label: string; icon?: React.ReactNode; danger?: boolean }>;
        return <Space.Compact>
          <Button size="small" icon={authorized ? <FilePdfOutlined /> : <EyeOutlined />} loading={actionLoading === row.id} onClick={() => authorized ? void openDanfe(row) : void openDetail(row)}>{authorized ? 'DANFE' : 'Detalhes'}</Button>
          <Dropdown menu={{ items: actions, onClick: ({ key }) => {
            if (key === 'details') void openDetail(row);
            if (key === 'danfe') void openDanfe(row);
            if (key === 'xml') downloadXml(row);
            if (key === 'email' || key === 'cancel' || key === 'cce') openAction(key, row);
            if (key === 'reconcile') void reconcile(row);
          } }}><Button size="small" icon={<EllipsisOutlined />} aria-label="Mais ações" /></Dropdown>
        </Space.Compact>;
      },
    },
  ], [actionLoading, canManage, downloadXml, openAction, openDanfe, openDetail, reconcile]);

  return <div>
    {contextHolder}
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
      <Input.Search value={search} onChange={(event) => setSearch(event.target.value)} onSearch={() => void fetchRows()} allowClear placeholder="NF-e original, retorno ou identificador" style={{ width: 380 }} />
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchRows()}>Atualizar retornos</Button>
    </Space>
    {error && <Alert type="error" showIcon message="Falha ao carregar devoluções" description={error} style={{ marginBottom: 12 }} />}
    {!loading && !error && rows.length === 0 ? <Empty description="Nenhuma devolução ou retorno fiscal emitido." /> : <ResizableTable<FiscalReturnRow>
      storageKey="notas-fiscais-retornos-bentevi-v1" rowKey="id" dataSource={rows} columns={columns} loading={loading}
      pagination={{ pageSize: 100, showSizeChanger: false, showTotal: (count) => `${count} retornos` }}
      scroll={{ x: 1300 }} size="small"
    />}

    <Drawer title={detail ? `Retorno fiscal ${detail.nfe_numero || detail.id.slice(0, 8)}` : 'Detalhes do retorno'} open={Boolean(detail)} width={720} onClose={() => setDetail(null)} loading={detailLoading}>
      {detail && <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Tipo">{FISCAL_RETURN_TYPE_LABELS[detail.tipo_retorno]}</Descriptions.Item>
          <Descriptions.Item label="Escopo">{detail.escopo === 'total' ? 'Total' : 'Parcial'}</Descriptions.Item>
          <Descriptions.Item label="NF-e original">{detail.nfe_original_numero || '—'}</Descriptions.Item>
          <Descriptions.Item label="NF-e retorno">{detail.nfe_numero || '—'}</Descriptions.Item>
          <Descriptions.Item label="Chave original" span={2}>{detail.nfe_original_chave}</Descriptions.Item>
          <Descriptions.Item label="Chave retorno" span={2}>{detail.nfe_chave || 'Ainda não autorizada'}</Descriptions.Item>
          <Descriptions.Item label="Motivo" span={2}>{detail.motivo}</Descriptions.Item>
        </Descriptions>
        <Table rowKey="pedido_item_id" size="small" pagination={false} dataSource={detail.itens} columns={[
          { title: 'Produto', dataIndex: 'titulo' },
          { title: 'Item original', dataIndex: 'nitem_original', width: 105 },
          { title: 'Quantidade', dataIndex: 'quantidade_retorno', width: 105 },
          { title: 'Valor', dataIndex: 'valor_total', width: 120, render: formatCurrency },
        ]} />
        <div>
          <Typography.Title level={5}>Histórico fiscal</Typography.Title>
          <Timeline items={(detail.history || []).map((event) => ({ children: <><strong>{event.evento}</strong><br /><Typography.Text type="secondary">{dateTime(event.created_at)} · {event.status_resultante || 'sem estado'}</Typography.Text></> }))} />
        </div>
      </Space>}
    </Drawer>

    <Modal
      title={actionType === 'email' ? 'Enviar por e-mail' : actionType === 'cancel' ? 'Cancelar NF-e de retorno' : 'Emitir carta de correção'}
      open={Boolean(actionType)} onCancel={() => setActionType(null)}
      onOk={() => void submitModalAction()}
      okText={actionType === 'email' ? 'Enviar e-mail' : actionType === 'cancel' ? 'Cancelar NF-e' : 'Enviar CC-e'}
      okButtonProps={{ danger: actionType === 'cancel', disabled: actionType === 'cancel' ? confirmText.toUpperCase() !== 'CANCELAR' : actionType === 'cce' ? correction.trim().length < 15 : false }}
      confirmLoading={Boolean(actionLoading)} destroyOnHidden
    >
      {actionType === 'email' && <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail (opcional se cadastrado)" />}
      {actionType === 'cancel' && <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="error" showIcon message="O cancelamento será enviado ao provedor fiscal." />
        <Input.TextArea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
        <Input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder='Digite "CANCELAR"' />
      </Space>}
      {actionType === 'cce' && <Space direction="vertical" style={{ width: '100%' }}>
        <InputNumber min={1} max={20} value={sequence} onChange={(value) => setSequence(Number(value || 1))} addonBefore="Sequência" />
        <Input.TextArea rows={5} value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="Descreva a correção" />
      </Space>}
    </Modal>
  </div>;
}
