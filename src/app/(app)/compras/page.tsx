'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Input, InputNumber, Select, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin, Modal, message, Statistic,
} from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import { appendRemoteSortParams, getRemoteSortOrder, type RemoteSortState, resolveRemoteSortState } from '@/lib/remote-sort';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

interface Compra {
  id: string;
  dsid: string;
  pedido_vendas_numero: number | null;
  status: string;
  status_dslite: string;
  nf_chave: string | null;
  nf_numero: string | null;
  valor_total: number;
  valor_frete: number;
  data_criacao: string;
  rastreio: string | null;
  fornecedor_nome: string | null;
  fornecedor_id: string | null;
  destinatario_nome: string | null;
  destinatario_documento: string | null;
  produto_descricao: string | null;
  produto_sku: string | null;
  quantidade: number;
  supplier_payment_mode: 'postpaid' | 'prepaid_pix' | 'balance_account' | null;
  supplier_payment_status: 'pending' | 'paid' | 'failed' | 'cancelled' | null;
  supplier_payment_amount: number | null;
  supplier_payment_reference: string | null;
  supplier_payment_receipt_url: string | null;
  supplier_payment_notes: string | null;
}

interface MercadoPagoPendingMovement {
  id: string;
  external_id: string;
  movement_date: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
  movement_type: string | null;
}

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: 'Aguardando Informações', label: 'Aguardando Informações' },
  { value: 'Aguardando Pagamento Fornecedor', label: 'Aguardando Pagamento Fornecedor' },
  { value: 'Iniciado', label: 'Iniciado' },
  { value: 'Aguardando Etiqueta', label: 'Aguardando Etiqueta' },
  { value: 'Solicitado', label: 'Solicitado' },
  { value: 'Confirmado', label: 'Confirmado' },
  { value: 'Faturado', label: 'Faturado' },
  { value: 'Cancelado', label: 'Cancelado' },
  { value: 'Revisão', label: 'Revisão' },
];

const statusColor: Record<string, string> = {
  'Aguardando Informações': 'orange',
  'Aguardando Pagamento Fornecedor': 'gold',
  'Iniciado': 'blue',
  'Aguardando Etiqueta': 'cyan',
  'Solicitado': 'geekblue',
  'Confirmado': 'green',
  'Faturado': 'purple',
  'Cancelado': 'default',
  'Revisão': 'magenta',
};

export default function ComprasPage() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'data_criacao', sortOrder: 'desc' });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);

  const [messageApi, contextHolder] = message.useMessage();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedCompra, setSelectedCompra] = useState<Compra | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentReceiptUrl, setPaymentReceiptUrl] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [hayamaxBalance, setHayamaxBalance] = useState<number | null>(null);
  const [hayamaxLowBalance, setHayamaxLowBalance] = useState(false);
  const [hayamaxLastTopup, setHayamaxLastTopup] = useState<{ amount: number; source: string; reference: string | null } | null>(null);
  const [hayamaxMpLastSync, setHayamaxMpLastSync] = useState<string | null>(null);
  const [hayamaxMpPending, setHayamaxMpPending] = useState<MercadoPagoPendingMovement[]>([]);
  const [approvingMpMovementId, setApprovingMpMovementId] = useState<string | null>(null);
  const [topupModalOpen, setTopupModalOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState<number | null>(1000);
  const [topupReference, setTopupReference] = useState('');
  const [topupNotes, setTopupNotes] = useState('');
  const [savingTopup, setSavingTopup] = useState(false);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [sendingWhatsappLabel, setSendingWhatsappLabel] = useState(false);
  const [whatsappCompra, setWhatsappCompra] = useState<Compra | null>(null);
  const [summary, setSummary] = useState({
    total: 0,
    pendentes: 0,
    faturado: 0,
    aguardando_informacoes: 0,
    cancelado: 0,
    revisao: 0,
    valor_total: 0,
  });

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    appendRemoteSortParams(params, sort);
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    return params;
  }, [page, sort, search, statusFilter, dateRange]);

  const buildSummaryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    return params;
  }, [search, statusFilter, dateRange]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, summaryRes] = await Promise.all([
        fetch(`/api/compras?${buildParams()}`),
        fetch(`/api/compras/resumo?${buildSummaryParams()}`),
      ]);

      if (listRes.ok) {
        const json = await listRes.json();
        setCompras(json.data || []);
        setTotal(json.total || 0);
      } else {
        messageApi.error('Erro ao carregar compras');
      }

      if (summaryRes.ok) {
        const json = await summaryRes.json();
        setSummary({
          total: Number(json.total || 0),
          pendentes: Number(json.pendentes || 0),
          faturado: Number(json.faturado || 0),
          aguardando_informacoes: Number(json.aguardando_informacoes || 0),
          cancelado: Number(json.cancelado || 0),
          revisao: Number(json.revisao || 0),
          valor_total: Number(json.valor_total || 0),
        });
      } else {
        messageApi.error('Erro ao carregar resumo de compras');
      }

      const balanceRes = await fetch('/api/fornecedores/saldo-hayamax');
      if (balanceRes.ok) {
        const json = await balanceRes.json();
        setHayamaxBalance(Number(json.balance || 0));
        setHayamaxLowBalance(Boolean(json.lowBalance));
        const lastTopup = (json.movements || []).find((movement: any) => movement?.movement_type === 'topup');
        setHayamaxLastTopup(lastTopup ? {
          amount: Number(lastTopup.amount || 0),
          source: String(lastTopup.created_by || '').startsWith('mercadopago') ? 'Mercado Pago' : 'Manual',
          reference: lastTopup.reference || null,
        } : null);
        setHayamaxMpLastSync(json.mercadoPago?.lastMovementDate || null);
        setHayamaxMpPending((json.mercadoPago?.pendingReview || []).map((movement: any) => ({
          ...movement,
          amount: Number(movement.amount || 0),
        })));
      }
    } catch {
      messageApi.error('Erro ao conectar');
    }
    setLoading(false);
  }, [buildParams, buildSummaryParams, messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateRange]);

  const openPaymentModal = (compra: Compra) => {
    setSelectedCompra(compra);
    setPaymentReference(compra.supplier_payment_reference || '');
    setPaymentReceiptUrl(compra.supplier_payment_receipt_url || '');
    setPaymentNotes(compra.supplier_payment_notes || '');
    setPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    if (confirmingPayment) return;
    setPaymentModalOpen(false);
    setSelectedCompra(null);
    setPaymentReference('');
    setPaymentReceiptUrl('');
    setPaymentNotes('');
  };

  const handleConfirmSupplierPayment = async () => {
    if (!selectedCompra) return;
    setConfirmingPayment(true);
    try {
      const res = await fetch(`/api/compras/${selectedCompra.id}/confirmar-pagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_payment_reference: paymentReference,
          supplier_payment_receipt_url: paymentReceiptUrl,
          supplier_payment_notes: paymentNotes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao confirmar pagamento do fornecedor');
      }
      messageApi.success(
        json.jobId
          ? `Pagamento confirmado. Fluxo DSLite retomado no job ${json.jobId}.`
          : 'Pagamento confirmado com sucesso.',
      );
      closePaymentModal();
      await fetchData();
    } catch (err: any) {
      messageApi.error(err.message || 'Erro ao confirmar pagamento do fornecedor');
    } finally {
      setConfirmingPayment(false);
    }
  };

  const handleRegisterHayamaxTopup = async () => {
    setSavingTopup(true);
    try {
      const res = await fetch('/api/fornecedores/saldo-hayamax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: topupAmount,
          reference: topupReference,
          notes: topupNotes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao registrar boleto Hayamax');
      setHayamaxBalance(Number(json.balance || 0));
      setHayamaxLowBalance(Number(json.balance || 0) < 1000);
      setTopupModalOpen(false);
      setTopupAmount(1000);
      setTopupReference('');
      setTopupNotes('');
      messageApi.success('Boleto Hayamax registrado.');
    } catch (err: any) {
      messageApi.error(err.message || 'Erro ao registrar boleto Hayamax');
    } finally {
      setSavingTopup(false);
    }
  };

  const handleApproveMercadoPagoMovement = async (movementId: string) => {
    setApprovingMpMovementId(movementId);
    try {
      const res = await fetch('/api/fornecedores/saldo-hayamax/aprovar-mercadopago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movementId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao aprovar crédito Mercado Pago');
      messageApi.success('Crédito Mercado Pago aprovado no saldo Hayamax.');
      await fetchData();
    } catch (err: any) {
      messageApi.error(err.message || 'Erro ao aprovar crédito Mercado Pago');
    } finally {
      setApprovingMpMovementId(null);
    }
  };

  const openWhatsappLabelModal = (compra: Compra) => {
    setWhatsappCompra(compra);
    setWhatsappModalOpen(true);
  };

  const closeWhatsappLabelModal = () => {
    if (sendingWhatsappLabel) return;
    setWhatsappModalOpen(false);
    setWhatsappCompra(null);
  };

  const handleSendWhatsappLabel = async () => {
    if (!whatsappCompra) return;
    const phoneNumber = whatsappPhone.replace(/\D/g, '');
    if (!phoneNumber) {
      messageApi.warning('Informe o número de WhatsApp do destinatário.');
      return;
    }

    setSendingWhatsappLabel(true);
    try {
      const res = await fetch(`/api/compras/${whatsappCompra.id}/enviar-etiqueta-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao enviar etiqueta por WhatsApp');
      messageApi.success(json.message || 'Etiqueta enviada por WhatsApp.');
      closeWhatsappLabelModal();
    } catch (err: any) {
      messageApi.error(err.message || 'Erro ao enviar etiqueta por WhatsApp');
    } finally {
      setSendingWhatsappLabel(false);
    }
  };

  const renderSupplierPaymentTag = (record: Compra) => {
    if (record.supplier_payment_mode === 'balance_account') {
      return <Tag color="blue">Saldo Hayamax</Tag>;
    }
    if (record.supplier_payment_mode !== 'prepaid_pix') {
      return <span style={{ color: '#666' }}>—</span>;
    }
    if (record.supplier_payment_status === 'paid') {
      return <Tag color="green">PIX pago</Tag>;
    }
    if (record.supplier_payment_status === 'failed') {
      return <Tag color="red">PIX falhou</Tag>;
    }
    if (record.supplier_payment_status === 'cancelled') {
      return <Tag color="default">PIX cancelado</Tag>;
    }
    return <Tag color="gold">PIX pendente</Tag>;
  };

  const columns: TableProps<Compra>['columns'] = [
    {
      title: 'Número', dataIndex: 'dsid', key: 'dsid', width: 100,
      sorter: true,
      sortOrder: getRemoteSortOrder('dsid', sort),
      render: (dsid: string) => (
        <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>
          #{String(dsid).padStart(6, '0')}
        </span>
      ),
    },
    {
      title: 'Pedido (vendas)', dataIndex: 'pedido_vendas_numero', key: 'pedido_vendas_numero', width: 140,
      sorter: true,
      sortOrder: getRemoteSortOrder('pedido_vendas_numero', sort),
      render: (numero: number | null) => numero ? (
        <a
          href={`https://www.mercadolivre.com.br/vendas/${numero}/detalhe`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: 'monospace', color: '#1677ff', fontWeight: 600, textDecoration: 'none' }}
        >
          #{String(numero).padStart(6, '0')}
        </a>
      ) : (
        <span style={{ color: '#666' }}>—</span>
      ),
    },
    {
      title: 'Data', dataIndex: 'data_criacao', key: 'data_criacao', width: 160,
      sorter: true,
      sortOrder: getRemoteSortOrder('data_criacao', sort),
      render: (d: string) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
    },
    {
      title: 'Destinatário', dataIndex: 'destinatario_nome', key: 'destinatario_nome',
      sorter: true,
      sortOrder: getRemoteSortOrder('destinatario_nome', sort),
      render: (nome: string, record: Compra) => (
        <div>
          <div style={{ color: '#e0e0e0', fontSize: 13 }}>{nome || '—'}</div>
          {record.destinatario_documento && (
            <div style={{ color: '#888', fontSize: 11 }}>{record.destinatario_documento}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Fornecedor', dataIndex: 'fornecedor_nome', key: 'fornecedor_nome', width: 180,
      render: (fornecedorNome: string | null, record: Compra) => (
        <div>
          <div style={{ color: '#e0e0e0', fontSize: 13 }}>{fornecedorNome || '—'}</div>
          {record.fornecedor_id && (
            <div style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
              fornecedor {record.fornecedor_id}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Produto', dataIndex: 'produto_descricao', key: 'produto_descricao',
      sorter: true,
      sortOrder: getRemoteSortOrder('produto_descricao', sort),
      render: (desc: string, record: Compra) => (
        <div>
          <div style={{ color: '#e0e0e0', fontSize: 13 }}>{desc || '—'}</div>
          {record.produto_sku && (
            <div style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>{record.produto_sku}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Qtd', dataIndex: 'quantidade', key: 'quantidade', width: 60,
      sorter: true,
      sortOrder: getRemoteSortOrder('quantidade', sort),
      render: (v: number) => <span style={{ color: '#e0e0e0' }}>{v || 1}</span>,
    },
    {
      title: 'Total', dataIndex: 'valor_total', key: 'valor_total', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('valor_total', sort),
      render: (v: number) => formatCurrency(v || 0),
    },
    {
      title: 'Pagto. Fornecedor', dataIndex: 'supplier_payment_status', key: 'supplier_payment_status', width: 170,
      render: (_: string | null, record: Compra) => (
        <div>
          {renderSupplierPaymentTag(record)}
          {(record.supplier_payment_mode === 'prepaid_pix' || record.supplier_payment_mode === 'balance_account') && (
            <div style={{ color: '#888', fontSize: 11 }}>
              {record.supplier_payment_amount ? formatCurrency(record.supplier_payment_amount) : 'Valor não informado'}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 140,
      sorter: true,
      sortOrder: getRemoteSortOrder('status', sort),
      render: (status: string) => (
        <Tag color={statusColor[status] || 'default'} style={{ fontSize: 12 }}>
          {status || '—'}
        </Tag>
      ),
    },
    {
      title: 'NF', dataIndex: 'nf_numero', key: 'nf_numero', width: 100,
      sorter: true,
      sortOrder: getRemoteSortOrder('nf_numero', sort),
      render: (nf: string | null) => nf ? (
        <Tag color="green" style={{ fontFamily: 'monospace', fontSize: 12 }}>{nf}</Tag>
      ) : (
        <span style={{ color: '#666' }}>—</span>
      ),
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const items = [
          { key: 'view', label: 'Ver Detalhes' },
          { key: 'track', label: 'Rastrear' },
          { key: 'send_whatsapp_label', label: 'Enviar etiqueta ML por WhatsApp' },
          ...(record.supplier_payment_mode === 'prepaid_pix' && record.supplier_payment_status === 'pending'
            ? [{ key: 'confirm_supplier_payment', label: 'Confirmar pagamento do fornecedor' }]
            : []),
        ];
        return (
          <Dropdown
            menu={{ items, onClick: ({ key }) => {
              if (key === 'track' && record.rastreio) {
                window.open(`https://www.linkcorreios.com.br/?id=${record.rastreio}`, '_blank');
              }
              if (key === 'confirm_supplier_payment') {
                openPaymentModal(record);
              }
              if (key === 'send_whatsapp_label') {
                openWhatsappLabelModal(record);
              }
            }}}
            trigger={['click']}
          >
            <Button type="text" size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  const handleTableChange: TableProps<Compra>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'data_criacao', sortOrder: 'desc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Compras DSLite</Title>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8} lg={6} xl={3}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Total</span>}
              value={summary.total}
              valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={6} xl={3}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Pendentes</span>}
              value={summary.pendentes}
              valueStyle={{ color: '#faad14', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={6} xl={3}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Faturado</span>}
              value={summary.faturado}
              valueStyle={{ color: '#722ed1', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={6} xl={3}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Aguard. Informações</span>}
              value={summary.aguardando_informacoes}
              valueStyle={{ color: '#13c2c2', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={6} xl={3}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Cancelado</span>}
              value={summary.cancelado}
              valueStyle={{ color: '#8c8c8c', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={6} xl={3}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Revisão</span>}
              value={summary.revisao}
              valueStyle={{ color: '#eb2f96', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={6} xl={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Valor Total</span>}
              value={formatCurrency(summary.valor_total)}
              valueStyle={{ color: '#73d13d', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: `1px solid ${hayamaxLowBalance ? '#faad14' : '#303030'}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Saldo Hayamax</span>}
              value={hayamaxBalance === null ? '—' : formatCurrency(hayamaxBalance)}
              valueStyle={{ color: hayamaxLowBalance ? '#faad14' : '#73d13d', fontWeight: 700, fontSize: 24 }}
            />
            {hayamaxLowBalance && (
              <Text style={{ color: '#faad14' }}>Saldo baixo. Pague boleto Hayamax de R$ 1.000 ou mais.</Text>
            )}
            {hayamaxLastTopup && (
              <div style={{ marginTop: 4 }}>
                <Text style={{ color: '#8c8c8c', fontSize: 12 }}>
                  Último crédito: {formatCurrency(hayamaxLastTopup.amount)} · Origem: {hayamaxLastTopup.source}
                  {hayamaxLastTopup.reference ? ` · ${hayamaxLastTopup.reference}` : ''}
                </Text>
              </div>
            )}
            <div style={{ marginTop: 4 }}>
              <Text style={{ color: '#8c8c8c', fontSize: 12 }}>
                Mercado Pago: {hayamaxMpLastSync ? `último movimento importado em ${new Date(hayamaxMpLastSync).toLocaleDateString('pt-BR')}` : 'sem importação recente'}
              </Text>
            </div>
          </Col>
          <Col>
            <Button type="primary" onClick={() => setTopupModalOpen(true)}>
              Registrar boleto Hayamax
            </Button>
          </Col>
        </Row>
        {hayamaxMpPending.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '1px solid #303030', paddingTop: 12 }}>
            <Text style={{ color: '#faad14', fontSize: 12, display: 'block', marginBottom: 8 }}>
              Mercado Pago tem {hayamaxMpPending.length} movimento(s) grande(s) pendente(s) de revisão.
            </Text>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {hayamaxMpPending.map((movement) => (
                <div
                  key={movement.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    background: '#1f1f1f',
                    border: '1px solid #303030',
                    borderRadius: 6,
                    padding: '8px 10px',
                  }}
                >
                  <div>
                    <Text style={{ color: '#e0e0e0', fontSize: 12 }}>
                      {formatCurrency(Math.abs(movement.amount))} · {movement.description || movement.reference || movement.external_id}
                    </Text>
                    <div>
                      <Text style={{ color: '#8c8c8c', fontSize: 11 }}>
                        {movement.movement_date ? new Date(movement.movement_date).toLocaleString('pt-BR') : 'sem data'} · confirmar se é boleto Hayamax
                      </Text>
                    </div>
                  </div>
                  <Button
                    size="small"
                    loading={approvingMpMovementId === movement.id}
                    onClick={() => void handleApproveMercadoPagoMovement(movement.id)}
                  >
                    Aprovar crédito
                  </Button>
                </div>
              ))}
            </Space>
          </div>
        )}
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por número, cliente ou produto"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={v => setStatusFilter(v)}
              options={statusOptions}
              style={{ width: 180 }}
              allowClear
              onClear={() => setStatusFilter('')}
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(_, dateStrings) => setDateRange([dateStrings[0] || null, dateStrings[1] || null])}
              format="DD/MM/YYYY"
              style={{ width: 240 }}
            />
          </Col>
        </Row>
      </div>

      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<Compra>
            storageKey="compras"
            dataSource={compras}
            columns={columns}
            rowKey="id"
            pagination={{
              current: page,
              pageSize: 50,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} compras`,
            }}
            onChange={handleTableChange}
            scroll={{ x: 910 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>

      <Modal
        title="Enviar etiqueta ML por WhatsApp"
        open={whatsappModalOpen}
        onCancel={closeWhatsappLabelModal}
        onOk={handleSendWhatsappLabel}
        okText="Enviar"
        cancelText="Cancelar"
        confirmLoading={sendingWhatsappLabel}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text style={{ color: '#a0a0a0' }}>
            Compra #{whatsappCompra?.dsid ? String(whatsappCompra.dsid).padStart(6, '0') : '—'}.
            Informe o número de WhatsApp do destinatário. Use DDD + número ou 55 + DDD + número.
          </Text>
          <Input
            placeholder="Ex.: 11999999999"
            value={whatsappPhone}
            onChange={(event) => setWhatsappPhone(event.target.value)}
            disabled={sendingWhatsappLabel}
          />
        </Space>
      </Modal>

      <Modal
        title="Confirmar pagamento do fornecedor"
        open={paymentModalOpen}
        onCancel={closePaymentModal}
        onOk={() => void handleConfirmSupplierPayment()}
        okText="Confirmar pagamento"
        cancelText="Cancelar"
        confirmLoading={confirmingPayment}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Compra</div>
            <div style={{ color: '#e0e0e0' }}>
              {selectedCompra ? `#${String(selectedCompra.dsid).padStart(6, '0')}` : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Fornecedor</div>
            <div style={{ color: '#e0e0e0' }}>{selectedCompra?.fornecedor_nome || '—'}</div>
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Valor esperado</div>
            <div style={{ color: '#e0e0e0' }}>
              {selectedCompra?.supplier_payment_amount ? formatCurrency(selectedCompra.supplier_payment_amount) : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Referência do pagamento</div>
            <Input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="Ex.: PIX 123456 / ID da transação"
            />
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>URL do comprovante</div>
            <Input
              value={paymentReceiptUrl}
              onChange={(e) => setPaymentReceiptUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Observações</div>
            <Input.TextArea
              rows={3}
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Observações internas do pagamento"
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title="Registrar boleto Hayamax"
        open={topupModalOpen}
        onCancel={() => setTopupModalOpen(false)}
        onOk={() => void handleRegisterHayamaxTopup()}
        okText="Registrar"
        cancelText="Cancelar"
        confirmLoading={savingTopup}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Valor pago</div>
            <InputNumber
              min={1000}
              value={topupAmount}
              onChange={(value) => setTopupAmount(Number(value || 0))}
              formatter={(value) => `R$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Referência do boleto</div>
            <Input value={topupReference} onChange={(event) => setTopupReference(event.target.value)} placeholder="Código, banco ou identificação" />
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 12, marginBottom: 4 }}>Observações</div>
            <Input.TextArea rows={3} value={topupNotes} onChange={(event) => setTopupNotes(event.target.value)} />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
