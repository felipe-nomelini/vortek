'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin, message, Modal, Statistic } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TablePaginationConfig, TableProps } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import { nfeTechnicalStatusLabel, type NfeTechnicalStatus } from '@/lib/fiscal/nfe-status';

const { Title } = Typography;
const { RangePicker } = DatePicker;

type NFStatus = NfeTechnicalStatus;
type SortOrder = 'asc' | 'desc';

interface NotaFiscalRow {
  id: string;
  pedido: number;
  cliente: string;
  data: string;
  numero: string;
  valor: number;
  status: NFStatus;
  ml_order_id: string | null;
  ml_pack_id: string | null;
  nfe_status?: string | null;
  contato_documento?: string | null;
  nfe_chave?: string | null;
  nfe_danfe_url?: string | null;
  danfe_available?: boolean;
}

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'autorizada', label: 'Autorizada' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'interrompida', label: 'Interrompida' },
  { value: 'rejeitada', label: 'Rejeitada' },
  { value: 'processando', label: 'Processando' },
  { value: 'outro', label: 'Outro' },
];

const statusColor: Record<NFStatus, string> = {
  autorizada: 'green',
  cancelada: 'red',
  pendente: 'orange',
  interrompida: 'gold',
  rejeitada: 'volcano',
  processando: 'blue',
  outro: 'default',
};

function resolveSerieFromNfeChave(chave: string | null | undefined): string | null {
  const normalized = String(chave || '').replace(/\D/g, '');
  if (normalized.length !== 44) return null;
  const serieRaw = normalized.slice(22, 25);
  if (!/^\d{3}$/.test(serieRaw)) return null;
  return String(Number(serieRaw));
}

function formatNumeroWithSerie(numero: string, nfeChave: string | null | undefined): string {
  const serie = resolveSerieFromNfeChave(nfeChave);
  return serie ? `NF ${numero} • Série ${serie}` : `NF ${numero}`;
}

export default function NotasFiscaisPage() {
  const PAGE_SIZE = 100;
  const POLLING_INTERVAL_MS = 5000;
  const [rows, setRows] = useState<NotaFiscalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NFStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [valorMin, setValorMin] = useState<number | null>(null);
  const [valorMax, setValorMax] = useState<number | null>(null);

  const [sortBy, setSortBy] = useState<string>('data');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingInFlightRef = useRef(false);
  const [sendingRowId, setSendingRowId] = useState<string | null>(null);
  const [actionRowId, setActionRowId] = useState<string | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<NotaFiscalRow | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<NotaFiscalRow | null>(null);
  const [cancelReason, setCancelReason] = useState('Cancelamento operacional da NF-e solicitada pelo usuário');
  const [cancelConfirmText, setCancelConfirmText] = useState('');
  const [cceModalOpen, setCceModalOpen] = useState(false);
  const [cceTarget, setCceTarget] = useState<NotaFiscalRow | null>(null);
  const [cceText, setCceText] = useState('');
  const [cceSeq, setCceSeq] = useState(1);
  const [summary, setSummary] = useState({
    total: 0,
    emitidas: 0,
    pendentes: 0,
    valor_total: 0,
    imposto_total: 0,
  });

  const resolvePdfUrl = useCallback(async (row: NotaFiscalRow): Promise<string | null> => {
    const res = await fetch(`/api/notas-fiscais/${row.id}/pdf`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.url) {
      messageApi.error(json?.error || 'Não foi possível localizar o PDF da nota fiscal');
      return null;
    }
    return String(json.url);
  }, [messageApi]);

  const handleViewPdf = useCallback(async (row: NotaFiscalRow) => {
    const url = await resolvePdfUrl(row);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [resolvePdfUrl]);

  const handleDownloadPdf = useCallback(async (row: NotaFiscalRow) => {
    const url = await resolvePdfUrl(row);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `danfe_${row.numero || row.pedido}.pdf`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [resolvePdfUrl]);

  const openEmailModal = useCallback((row: NotaFiscalRow) => {
    setEmailTarget(row);
    const pedidoFmt = String(row.pedido).padStart(6, '0');
    setEmailTo('');
    setEmailSubject(`NF-e ${row.numero} - Pedido #${pedidoFmt}`);
    setEmailBody(`Olá ${row.cliente},\n\nSegue em anexo a DANFE da NF-e ${row.numero}.\n\nMensagem automática Vortek.`);
    setEmailModalOpen(true);
  }, []);

  const handleSendEmail = useCallback(async () => {
    if (!emailTarget) return;
    setSendingRowId(emailTarget.id);
    try {
      const res = await fetch(`/api/notas-fiscais/${emailTarget.id}/enviar-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailTo || undefined,
          subject: emailSubject || undefined,
          message: emailBody || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.error || 'Falha ao enviar e-mail da nota fiscal');
        return;
      }
      messageApi.success(`NF enviada para ${json.to}`);
      setEmailModalOpen(false);
      setEmailTarget(null);
    } finally {
      setSendingRowId(null);
    }
  }, [emailTarget, emailTo, emailSubject, emailBody, messageApi]);

  const fetchNotas = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background === true;
    if (!background) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortBy,
        sortOrder,
      });

      if (lastSearch) params.set('search', lastSearch);
      if (statusFilter) params.set('status', statusFilter);
      if (dateRange[0]) params.set('dateFrom', dateRange[0]);
      if (dateRange[1]) params.set('dateTo', dateRange[1]);
      if (valorMin !== null) params.set('valorMin', String(valorMin));
      if (valorMax !== null) params.set('valorMax', String(valorMax));

      const serialized = params.toString();
      const listRes = await fetch(`/api/notas-fiscais?${serialized}`, { cache: 'no-store' });

      if (listRes.ok) {
        const json = await listRes.json();
        setRows(json.data || []);
        setTotal(json.total || 0);
      }

      const summaryRes = await fetch(`/api/notas-fiscais/resumo?${serialized}`, { cache: 'no-store' });
      if (summaryRes.ok) {
        const json = await summaryRes.json();
        setSummary({
          total: json.total || 0,
          emitidas: json.emitidas || 0,
          pendentes: json.pendentes || 0,
          valor_total: Number(json.valor_total || 0),
          imposto_total: Number(json.imposto_total || 0),
        });
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [page, sortBy, sortOrder, lastSearch, statusFilter, dateRange, valorMin, valorMax]);

  const openCancelModal = useCallback((row: NotaFiscalRow) => {
    setCancelTarget(row);
    setCancelReason('Cancelamento operacional da NF-e solicitada pelo usuário');
    setCancelConfirmText('');
    setCancelModalOpen(true);
  }, []);

  const submitCancelNfe = useCallback(async () => {
    if (!cancelTarget) return;
    if (cancelConfirmText.trim().toUpperCase() !== 'CANCELAR') {
      messageApi.error('Digite CANCELAR para confirmar.');
      return;
    }
    setActionRowId(cancelTarget.id);
    try {
      const res = await fetch(`/api/notas-fiscais/${cancelTarget.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa: cancelReason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.error || 'Falha ao cancelar nota fiscal');
        return;
      }
      setRows((prev) => prev.map((row) => (
        row.id === cancelTarget.id
          ? {
              ...row,
              status: 'cancelada',
              nfe_status: 'cancelada',
            }
          : row
      )));
      setSummary((prev) => ({
        ...prev,
        emitidas: Math.max(0, prev.emitidas - 1),
      }));
      messageApi.success(json?.alreadyCanceled ? 'Nota já estava cancelada.' : 'Nota fiscal cancelada com sucesso.');
      setCancelModalOpen(false);
      setCancelTarget(null);
      await fetchNotas({ background: true });
    } finally {
      setActionRowId(null);
    }
  }, [cancelTarget, cancelReason, cancelConfirmText, fetchNotas, messageApi]);

  const openCceModal = useCallback((row: NotaFiscalRow) => {
    setCceTarget(row);
    setCceText('');
    setCceSeq(1);
    setCceModalOpen(true);
  }, []);

  const submitCartaCorrecao = useCallback(async () => {
    if (!cceTarget) return;
    if (cceText.trim().length < 15) {
      messageApi.error('A correção deve ter no mínimo 15 caracteres.');
      return;
    }
    setActionRowId(cceTarget.id);
    try {
      const res = await fetch(`/api/notas-fiscais/${cceTarget.id}/carta-correcao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correcao: cceText,
          numeroSequencial: cceSeq,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.error || 'Falha ao enviar carta de correção');
        return;
      }
      messageApi.success(`Carta de correção enviada${json?.protocolo ? ` (protocolo ${json.protocolo})` : ''}.`);
      setCceModalOpen(false);
      setCceTarget(null);
      await fetchNotas();
    } finally {
      setActionRowId(null);
    }
  }, [cceTarget, cceText, cceSeq, fetchNotas, messageApi]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== lastSearch) {
        setPage(1);
        setLastSearch(search);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [search, lastSearch]);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const scheduleNextPoll = useCallback(() => {
    clearPolling();
    pollingRef.current = setTimeout(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        scheduleNextPoll();
        return;
      }
      if (pollingInFlightRef.current) {
        scheduleNextPoll();
        return;
      }
      pollingInFlightRef.current = true;
      try {
        await fetchNotas({ background: true });
      } finally {
        pollingInFlightRef.current = false;
        scheduleNextPoll();
      }
    }, POLLING_INTERVAL_MS);
  }, [clearPolling, fetchNotas]);

  useEffect(() => {
    fetchNotas();
    scheduleNextPoll();
    return () => clearPolling();
  }, [clearPolling, fetchNotas, scheduleNextPoll]);

  const columns: TableProps<NotaFiscalRow>['columns'] = [
    {
      title: 'Pedido',
      dataIndex: 'pedido',
      key: 'pedido',
      width: 110,
      sorter: true,
      render: (v: number, row: NotaFiscalRow) => (
        <a
          href={`https://www.mercadolivre.com.br/vendas/${row.ml_pack_id || v}/detalhe`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Order ID: ${row.ml_order_id || '—'} | Pack ID: ${row.ml_pack_id || '—'}`}
          style={{ fontFamily: 'monospace', color: '#1677ff', textDecoration: 'none' }}
        >
          #{String(v).padStart(6, '0')}
        </a>
      ),
    },
    {
      title: 'Número',
      dataIndex: 'numero',
      key: 'numero',
      width: 130,
      sorter: true,
      render: (v: string, row: NotaFiscalRow) => {
        if (!v || v === '—' || row.status === 'pendente' || row.status === 'processando') {
          return <span style={{ fontFamily: 'monospace' }}>—</span>;
        }
        const label = formatNumeroWithSerie(v, row.nfe_chave);
        return (
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontFamily: 'monospace' }}
            onClick={() => handleViewPdf(row)}
          >
            {label}
          </Button>
        );
      },
    },
    {
      title: 'Cliente',
      dataIndex: 'cliente',
      key: 'cliente',
      sorter: true,
    },
    {
      title: 'Data',
      dataIndex: 'data',
      key: 'data',
      width: 170,
      sorter: true,
      render: (d: string) => {
        if (!d) return <span style={{ color: '#666' }}>—</span>;
        const dt = new Date(d);
        if (Number.isNaN(dt.getTime())) return <span style={{ color: '#666' }}>—</span>;
        return dt.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      },
    },
    {
      title: 'Valor',
      dataIndex: 'valor',
      key: 'valor',
      width: 120,
      sorter: true,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      sorter: true,
      render: (s: NFStatus) => <Tag color={statusColor[s]}>{nfeTechnicalStatusLabel(s)}</Tag>,
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 60,
      fixed: 'right',
      render: (_, record: NotaFiscalRow) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Visualizar' },
              { key: 'download', label: 'Baixar PDF' },
              { key: 'email', label: 'Enviar por e-mail' },
              { type: 'divider' },
              { key: 'cancel', label: 'Cancelar NF-e', disabled: record.status === 'cancelada' || !record.nfe_chave },
              { key: 'cce', label: 'Enviar Carta de Correção', disabled: record.status !== 'autorizada' || !record.nfe_chave },
            ],
            onClick: ({ key }) => {
              if (key === 'view') handleViewPdf(record);
              if (key === 'download') handleDownloadPdf(record);
              if (key === 'email') openEmailModal(record);
              if (key === 'cancel') openCancelModal(record);
              if (key === 'cce') openCceModal(record);
            },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} loading={sendingRowId === record.id || actionRowId === record.id} />
        </Dropdown>
      ),
    },
  ];

  const handleTableChange = (
    pagination: TablePaginationConfig,
    _filters: Record<string, (React.Key | boolean)[] | null>,
    sorter: SorterResult<NotaFiscalRow> | SorterResult<NotaFiscalRow>[],
  ) => {
    if (pagination.current) setPage(pagination.current);

    if (Array.isArray(sorter)) return;
    if (!sorter.order || !sorter.field) return;

    setSortBy(String(sorter.field));
    setSortOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
  };

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Notas Fiscais</Title>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Total</span>}
              value={summary.total}
              valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Emitidas</span>}
              value={summary.emitidas}
              valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Pendentes</span>}
              value={summary.pendentes}
              valueStyle={{ color: '#faad14', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={12} lg={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Valor Total</span>}
              value={formatCurrency(summary.valor_total)}
              valueStyle={{ color: '#13c2c2', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={12} lg={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Imposto Total (4%)</span>}
              value={formatCurrency(summary.imposto_total)}
              valueStyle={{ color: '#cf1322', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (pedido, cliente, número NF ou ID ML)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 320 }}
              allowClear
              onClear={() => {
                setSearch('');
                setLastSearch('');
                setPage(1);
              }}
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={v => {
                setStatusFilter((v as NFStatus) || '');
                setPage(1);
              }}
              options={statusOptions}
              style={{ width: 150 }}
              allowClear
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(_, dateStrings) => {
                setDateRange([dateStrings[0] || null, dateStrings[1] || null]);
                setPage(1);
              }}
              format="DD/MM/YYYY"
              style={{ width: 240 }}
            />
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber
                placeholder="Valor mín"
                value={valorMin}
                onChange={v => {
                  setValorMin(v ?? null);
                  setPage(1);
                }}
                style={{ width: 110 }}
              />
              <InputNumber
                placeholder="Valor máx"
                value={valorMax}
                onChange={v => {
                  setValorMax(v ?? null);
                  setPage(1);
                }}
                style={{ width: 110 }}
              />
            </Space.Compact>
          </Col>
        </Row>
      </div>

      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<NotaFiscalRow>
            storageKey="notas-fiscais"
            dataSource={rows}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            onChange={handleTableChange}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} notas fiscais`,
            }}
            scroll={{ x: 920 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
      <Modal
        open={emailModalOpen}
        title="Enviar Nota Fiscal por e-mail"
        onCancel={() => {
          setEmailModalOpen(false);
          setEmailTarget(null);
        }}
        onOk={handleSendEmail}
        okText="Enviar"
        confirmLoading={!!sendingRowId}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Input
            placeholder="E-mail destinatário (fallback manual)"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
          />
          <Input
            placeholder="Assunto"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
          />
          <Input.TextArea
            rows={6}
            placeholder="Mensagem"
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        open={cancelModalOpen}
        title="Cancelar NF-e"
        onCancel={() => {
          setCancelModalOpen(false);
          setCancelTarget(null);
        }}
        onOk={submitCancelNfe}
        okText="Confirmar cancelamento"
        okButtonProps={{ danger: true }}
        confirmLoading={actionRowId === cancelTarget?.id}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Typography.Text type="danger">
            Esta ação é irreversível. Digite <b>CANCELAR</b> para confirmar.
          </Typography.Text>
          <Input.TextArea
            rows={4}
            placeholder="Justificativa do cancelamento"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <Input
            placeholder='Digite "CANCELAR"'
            value={cancelConfirmText}
            onChange={(e) => setCancelConfirmText(e.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        open={cceModalOpen}
        title="Enviar Carta de Correção"
        onCancel={() => {
          setCceModalOpen(false);
          setCceTarget(null);
        }}
        onOk={submitCartaCorrecao}
        okText="Enviar CC-e"
        confirmLoading={actionRowId === cceTarget?.id}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <InputNumber
            min={1}
            value={cceSeq}
            onChange={(v) => setCceSeq(Math.max(1, Number(v || 1)))}
            style={{ width: 160 }}
            placeholder="Seq. evento"
          />
          <Input.TextArea
            rows={6}
            placeholder="Descreva a correção (mínimo 15 caracteres)"
            value={cceText}
            onChange={(e) => setCceText(e.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
