'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, DatePicker, Space, Spin, Modal, message, Statistic, Divider,
} from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined, CarOutlined, WarningOutlined, UploadOutlined } from '@ant-design/icons';
import TrackingModal from '@/components/modals/TrackingModal';
import ProgressModal, { ProgressStep } from '@/components/modals/ProgressModal';
import { formatCurrency } from '@/lib/format';
import type { Database } from '@/types/database';
import type { Order, OrderStatus } from '@/types/order';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'aberto', label: 'Aberto' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'preparando', label: 'Preparando' },
  { value: 'pronto_envio', label: 'Pronto p/ envio' },
  { value: 'etiqueta_impressa', label: 'Etiqueta Impressa' },
  { value: 'coletado', label: 'Coletado' },
  { value: 'em_transito', label: 'Em Trânsito' },
  { value: 'saiu_entrega', label: 'Saiu para Entrega' },
  { value: 'dest_ausente', label: 'Dest. Ausente' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'faturado', label: 'Faturado' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'recusado', label: 'Recusado' },
  { value: 'devolvido', label: 'Devolvido' },
  { value: 'cancelado', label: 'Cancelado' },
];

const statusColor: Record<OrderStatus, string> = {
  aberto: 'blue',
  pendente: 'orange',
  preparando: 'processing',
  pronto_envio: 'cyan',
  etiqueta_impressa: 'blue',
  coletado: 'geekblue',
  em_transito: 'purple',
  saiu_entrega: 'cyan',
  dest_ausente: 'red',
  atendido: 'processing',
  faturado: 'purple',
  entregue: 'green',
  recusado: 'red',
  devolvido: 'magenta',
  cancelado: 'default',
};

const statusLabel: Record<OrderStatus, string> = {
  aberto: 'Aberto',
  pendente: 'Pendente',
  preparando: 'Preparando',
  pronto_envio: 'Pronto p/ envio',
  etiqueta_impressa: 'Etiqueta Impressa',
  coletado: 'Coletado',
  em_transito: 'Em Trânsito',
  saiu_entrega: 'Saiu para Entrega',
  dest_ausente: 'Dest. Ausente',
  atendido: 'Atendido',
  faturado: 'Faturado',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  cancelado: 'Cancelado',
};

function isValidDsliteId(val: string | null | undefined): string | null {
  if (!val || val === 'undefined' || val === 'null' || val.trim() === '') return null;
  return val;
}

function mapDBtoOrder(item: Database['public']['Tables']['pedidos']['Row']): Order {
  return {
    id: item.numero,
    dbId: item.id,
    numero: item.numero,
    numeroLoja: item.numero_loja || '',
    data: item.data || new Date().toISOString(),
    dataSaida: item.data_saida,
    dataPrevista: item.data_prevista,
    contato: {
      id: 0,
      nome: item.contato_nome || '',
      tipoPessoa: 'F',
      numeroDocumento: item.contato_documento || '',
    },
    totalProdutos: item.total || 0,
    total: item.total || 0,
    situacao: { id: 0, valor: item.situacao || 'aberto' },
    loja: { id: 1 },
    transporte: item.frete ? { frete: item.frete, prazoEntrega: null, contato: { nome: item.contato_nome || '' } } : null,
    notaFiscal: item.nota_fiscal_numero ? { numero: item.nota_fiscal_numero, emitida: item.nota_fiscal_emitida } : null,
    nfe_danfe_url: item.nfe_danfe_url,
    rastreio: item.rastreio,
    lucro: item.lucro ?? null,
    dslite_id: isValidDsliteId(item.dslite_id),
    dslite_etiqueta_enviada: item.dslite_etiqueta_enviada || false,
    ml_claim_id: item.ml_claim_id,
    ml_shipment_id: item.ml_shipment_id,
    ml_invoice_reported: item.ml_invoice_reported || false,
    ml_order_id: item.ml_order_id,
    ml_pack_id: item.ml_pack_id,
    nfe_status: item.nfe_status,
  };
}

interface SummaryData {
  count: number;
  total: number;
  lucroSum: number;
  ticket: number;
  margem: number;
  statusCounts: Record<string, number>;
}

export default function PedidosPage() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<SummaryData>({ count: 0, total: 0, lucroSum: 0, ticket: 0, margem: 0, statusCounts: {} });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState<string>('');
  const [trackingOrderStatus, setTrackingOrderStatus] = useState<OrderStatus>('aberto');

  const [dsliteProgressOpen, setDsliteProgressOpen] = useState(false);
  const dslitePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dsliteSteps, setDsliteSteps] = useState<ProgressStep[]>([
    { label: 'Emitindo NF no Mercado Livre', status: 'pending' },
    { label: 'Buscando NF/XML no Mercado Livre', status: 'pending' },
    { label: 'Buscando produto no catálogo DSLite', status: 'pending' },
    { label: 'Criando pedido na DSLite', status: 'pending' },
    { label: 'Vinculando fornecedor e produtos', status: 'pending' },
    { label: 'Enviando etiqueta para DSLite', status: 'pending' },
  ]);

  const [etiquetaProgressOpen, setEtiquetaProgressOpen] = useState(false);
  const [etiquetaSteps, setEtiquetaSteps] = useState<ProgressStep[]>([
    { label: 'Enviando etiqueta para DSLite', status: 'pending' },
  ]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    return params;
  }, [page, search, statusFilter, dateRange, priceMin, priceMax]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = buildParams();
    try {
      const [listRes, summaryRes] = await Promise.all([
        fetch(`/api/pedidos?${params}`),
        fetch(`/api/pedidos/resumo?${params}`),
      ]);

      if (listRes.ok) {
        const json = await listRes.json();
        setOrders((json.data || []).map(mapDBtoOrder));
        setTotal(json.total || 0);
      }

      if (summaryRes.ok) {
        const json = await summaryRes.json();
        setSummary({
          count: json.count || 0,
          total: json.total || 0,
          lucroSum: json.lucroSum || 0,
          ticket: json.ticket || 0,
          margem: json.margem || 0,
          statusCounts: json.statusCounts || {},
        });
      }
    } catch {}
    setLoading(false);
  }, [buildParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateRange, priceMin, priceMax]);

  useEffect(() => () => {
    if (dslitePollRef.current) clearTimeout(dslitePollRef.current);
  }, []);

  const criarPedidoDslite = async (order: Order) => {
    const steps: ProgressStep[] = [
      { label: 'Emitindo NF no Mercado Livre', status: 'loading' },
      { label: 'Buscando NF/XML no Mercado Livre', status: 'pending' },
      { label: 'Buscando produto no catálogo DSLite', status: 'pending' },
      { label: 'Criando pedido na DSLite', status: 'pending' },
      { label: 'Informando fornecedor', status: 'pending' },
      { label: 'Definindo transportadora (Correios)', status: 'pending' },
      { label: 'Enviando etiqueta para DSLite', status: 'pending' },
    ];
    setDsliteSteps(steps);
    setDsliteProgressOpen(true);

    try {
      const startRes = await fetch('/api/dslite/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: order.dbId,
          mlOrderId: order.ml_order_id,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData?.jobId) {
        throw new Error(startData?.error || 'Falha ao iniciar criação do pedido DSLite');
      }

      const poll = async () => {
        const res = await fetch(`/api/dslite/pedido/status?jobId=${encodeURIComponent(startData.jobId)}`);
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Falha ao consultar status do job DSLite');
        }

        const mapped: ProgressStep[] = (data.steps || []).map((s: any) => ({
          label: s.label,
          status: s.status,
          detail: s.detail,
          error: s.error,
        }));
        if (mapped.length) setDsliteSteps(mapped);

        const state = data.state as string;
        if (state === 'running') {
          dslitePollRef.current = setTimeout(() => {
            poll().catch((err) => {
              setDsliteSteps((prev) => {
                const updated = [...prev];
                const firstPending = updated.findIndex(s => s.status === 'pending' || s.status === 'loading');
                const idx = firstPending >= 0 ? firstPending : updated.length - 1;
                updated[idx] = { ...updated[idx], status: 'error', error: err.message || 'Erro ao acompanhar job' };
                return updated;
              });
            });
          }, 1500);
          return;
        }

        if (state === 'success' || state === 'warning') {
          const payload = data.data || {};
          if (payload.dsid) {
            setOrders(prev => prev.map(o =>
              o.id === order.id ? {
                ...o,
                dslite_id: String(payload.dsid),
                dslite_etiqueta_enviada: payload.etiquetaStatus === 'enviada'
              } : o
            ));
          }
          return;
        }

        if (state === 'error') {
          setDsliteSteps((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex(s => s.status === 'error');
            if (idx === -1) {
              const fallback = updated.findIndex(s => s.status === 'loading');
              const pos = fallback >= 0 ? fallback : updated.length - 1;
              updated[pos] = { ...updated[pos], status: 'error', error: (data.data?.error || 'Falha ao criar pedido DSLite') };
            }
            return updated;
          });
        }
      };

      await poll();
    } catch (err: any) {
      setDsliteSteps(prev => {
        const updated = [...prev];
        const firstPending = updated.findIndex(s => s.status === 'pending' || s.status === 'loading');
        const idx = firstPending >= 0 ? firstPending : updated.length - 1;
        updated[idx] = { label: updated[idx].label, status: 'error', error: err.message };
        return updated;
      });
    }
  };

  const pararPollingDslite = () => {
    if (dslitePollRef.current) {
      clearTimeout(dslitePollRef.current);
      dslitePollRef.current = null;
    }
  };

  const fecharModalDslite = () => {
    pararPollingDslite();
    setDsliteProgressOpen(false);
  };

  const tentarNovamenteDslite = () => {
    pararPollingDslite();
    setDsliteProgressOpen(false);
  };

  const enviarEtiquetaAutomatica = async (order: Order) => {
    if (!isValidDsliteId(order.dslite_id)) {
      messageApi.error('Crie o pedido na DSLite primeiro');
      return;
    }

    setEtiquetaSteps([
      { label: 'Baixando etiqueta do Mercado Livre', status: 'loading' },
      { label: 'Definindo transportadora (Correios)', status: 'pending' },
      { label: 'Enviando etiqueta para DSLite', status: 'pending' },
    ]);
    setEtiquetaProgressOpen(true);

    try {
      const res = await fetch('/api/dslite/etiqueta-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: order.dbId,
          dsid: order.dslite_id,
        }),
      });
      const data = await res.json();

      if (data.success) {
        const steps: ProgressStep[] = [
          { label: 'Baixando etiqueta do Mercado Livre', status: 'success', detail: `${data.data.etiquetaBytes?.toLocaleString('pt-BR')} bytes` },
        ];

        if (data.data.transportadoraDefinida) {
          steps.push({ label: 'Definindo transportadora (Correios)', status: 'success' });
        } else {
          steps.push({
            label: 'Definindo transportadora (Correios)',
            status: 'warning',
            detail: data.data.transportadoraMensagem || 'Transportadora não pôde ser definida, mas etiqueta foi enviada',
          });
        }

        steps.push({ label: 'Enviando etiqueta para DSLite', status: 'success' });

        setEtiquetaSteps(steps);
        setOrders(prev => prev.map(o =>
          o.id === order.id ? { ...o, dslite_etiqueta_enviada: true } : o
        ));
      } else {
        setEtiquetaSteps(prev => {
          const updated = [...prev];
          const firstPending = updated.findIndex(s => s.status === 'pending');
          const idx = firstPending >= 0 ? firstPending : updated.length - 1;
          updated[idx] = {
            label: updated[idx].label,
            status: 'error',
            error: data.error || 'Falha no envio automático de etiqueta',
          };
          return updated;
        });
      }
    } catch (err: any) {
      setEtiquetaSteps(prev => {
        const updated = [...prev];
        const firstPending = updated.findIndex(s => s.status === 'pending');
        const idx = firstPending >= 0 ? firstPending : updated.length - 1;
        updated[idx] = { label: updated[idx].label, status: 'error', error: err.message };
        return updated;
      });
    }
  };

  const columns: TableProps<Order>['columns'] = [
    {
      title: 'Número', dataIndex: 'numero', key: 'numero', width: 100,
      sorter: (a, b) => a.numero - b.numero,
      render: (num: number, record: Order) => (
        <a
          href={`https://www.mercadolivre.com.br/vendas/${record.ml_pack_id || num}/detalhe`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Order ID: ${record.ml_order_id || '—'} | Pack ID: ${record.ml_pack_id || '—'}`}
          style={{ fontFamily: 'monospace', color: '#1677ff', textDecoration: 'none' }}
        >
          #{String(num).padStart(6, '0')}
        </a>
      ),
    },
    {
      title: 'Pack', dataIndex: 'ml_pack_id', key: 'ml_pack_id', width: 180,
      render: (v: string | null | undefined) => <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span>,
    },
    {
      title: 'Data', dataIndex: 'data', key: 'data', width: 160,
      sorter: (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime(),
      render: (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    },
    {
      title: 'Cliente', dataIndex: ['contato', 'nome'], key: 'cliente',
      sorter: (a, b) => a.contato.nome.localeCompare(b.contato.nome),
    },
    {
      title: 'Total', dataIndex: 'total', key: 'total', width: 110,
      sorter: (a, b) => a.total - b.total,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Rastreio', dataIndex: 'rastreio', key: 'rastreio', width: 130,
      sorter: (a, b) => (a.rastreio ?? '').localeCompare(b.rastreio ?? ''),
      render: (v: string | null, record: Order) => {
        if (!v) return <span style={{ color: '#666' }}>—</span>;
        if (record.ml_shipment_id) {
          return (
            <Button
              type="link"
              size="small"
              style={{ fontFamily: 'monospace', fontSize: 13, padding: 0 }}
              onClick={() => {
                setTrackingOrderId(record.dbId);
                setTrackingOrderStatus(record.situacao.valor);
                setTrackingModalOpen(true);
              }}
            >
              {v}
            </Button>
          );
        }
        return <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{v}</span>;
      },
    },
    {
      title: 'Status', dataIndex: ['situacao', 'valor'], key: 'status', width: 140,
      sorter: (a, b) => a.situacao.valor.localeCompare(b.situacao.valor),
      render: (status: OrderStatus, record: Order) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>
          {(record as any).ml_claim_id && (
            <WarningOutlined style={{ color: '#faad14', fontSize: 14 }} title="Reclamação em andamento" />
          )}
        </div>
      ),
    },
    {
      title: 'Nota Fiscal', dataIndex: 'notaFiscal', key: 'notaFiscal', width: 120,
      sorter: (a, b) => {
        const na = a.notaFiscal?.numero ?? '';
        const nb = b.notaFiscal?.numero ?? '';
        return na.localeCompare(nb);
      },
      render: (nf: { numero: string; emitida: boolean } | null, record: Order) => {
        if (!nf) return <Tag>Não emitida</Tag>;
        const tag = <Tag color={nf.emitida ? 'green' : 'orange'}>{nf.numero}</Tag>;
        if (record.nfe_danfe_url) {
          return (
            <a href={record.nfe_danfe_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              {tag}
            </a>
          );
        }
        return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{tag}</div>;
      },
    },
    {
      title: 'Pedido Compra',
      key: 'pedidoCompra',
      dataIndex: 'dslite_id',
      width: 120,
      align: 'center',
      sorter: (a, b) => {
        const va = isValidDsliteId(a.dslite_id) ? 1 : 0;
        const vb = isValidDsliteId(b.dslite_id) ? 1 : 0;
        return va - vb;
      },
      render: (_: string | null, record: Order) => {
        const hasPurchaseOrder = !!isValidDsliteId(record.dslite_id);
        return hasPurchaseOrder
          ? <Tag color="green">SIM</Tag>
          : <Tag color="orange">NÃO</Tag>;
      },
    },
    {
      title: 'Lucro', dataIndex: 'lucro', key: 'lucro', width: 110,
      sorter: (a, b) => (a.lucro ?? -Infinity) - (b.lucro ?? -Infinity),
      render: (v: number | null) => {
        if (v === null) return <span style={{ color: '#666' }}>—</span>;
        return (
          <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            {formatCurrency(v)}
          </span>
        );
      },
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const items: { key: string; label: React.ReactNode; disabled?: boolean; icon?: React.ReactNode }[] = [
          { key: 'view', label: 'Visualizar Detalhes' },
        ];
        if (record.ml_shipment_id) {
          items.push({
            key: 'track',
            label: 'Rastrear Envio',
            icon: <CarOutlined />,
          });
        }
        const hasDsliteId = !!isValidDsliteId(record.dslite_id);
        if (!hasDsliteId && !['cancelado', 'entregue', 'devolvido', 'recusado'].includes(record.situacao.valor)) {
          items.push({
            key: 'dslite',
            label: 'Criar Pedido DSLite',
            icon: <CarOutlined />,
          });
        }
        if (hasDsliteId && !record.dslite_etiqueta_enviada) {
          items.push({
            key: 'etiqueta',
            label: 'Enviar Etiqueta DSLite',
            icon: <UploadOutlined />,
          });
        }
        return (
          <Dropdown
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === 'track') {
                  setTrackingOrderId(record.dbId);
                  setTrackingOrderStatus(record.situacao.valor);
                  setTrackingModalOpen(true);
                }
                if (key === 'dslite') criarPedidoDslite(record);
                if (key === 'etiqueta') enviarEtiquetaAutomatica(record);
              },
            }}
            trigger={['click']}
          >
            <Button type="text" size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Pedidos</Title>

      {/* Mini Dashboard */}
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Pedidos</span>}
              value={summary.count}
              valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Valor Vendido</span>}
              value={formatCurrency(summary.total)}
              valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Lucro Total</span>}
              value={formatCurrency(summary.lucroSum)}
              valueStyle={{ color: summary.lucroSum >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Margem Média</span>}
              value={`${summary.margem.toFixed(1)}%`}
              valueStyle={{ color: '#13c2c2', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
        <Divider style={{ borderColor: '#303030', margin: '12px 0' }} />
        <Row gutter={[8, 8]} align="middle">
          {Object.entries(summary.statusCounts).map(([status, count]) => (
            <Col key={status}>
              <Tag color={statusColor[status as OrderStatus]} style={{ fontSize: 13, padding: '4px 10px' }}>
                {statusLabel[status as OrderStatus]}: {count}
              </Tag>
            </Col>
          ))}
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por número ou cliente"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={v => setStatusFilter(v as OrderStatus | '')}
              options={statusOptions}
              style={{ width: 160 }}
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
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Valor mín" value={priceMin} onChange={v => setPriceMin(v ?? null)} style={{ width: 110 }} />
              <InputNumber placeholder="Valor máx" value={priceMax} onChange={v => setPriceMax(v ?? null)} style={{ width: 110 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>
      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<Order>
            storageKey="pedidos"
            dataSource={orders}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} pedidos`,
              onChange: (p) => setPage(p),
            }}
            scroll={{ x: 900 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
      <TrackingModal
        open={trackingModalOpen}
        onClose={() => setTrackingModalOpen(false)}
        orderId={trackingOrderId}
        orderStatus={trackingOrderStatus}
      />
      <ProgressModal
        open={dsliteProgressOpen}
        title="Criando Pedido DSLite"
        steps={dsliteSteps}
        onClose={() => {
          fecharModalDslite();
          fetchData();
        }}
        onCancel={tentarNovamenteDslite}
        showCloseButton={dsliteSteps.some(s => s.status === 'error' || s.status === 'success' || s.status === 'warning')}
      />
      <ProgressModal
        open={etiquetaProgressOpen}
        title="Enviando Etiqueta"
        steps={etiquetaSteps}
        onClose={() => {
          setEtiquetaProgressOpen(false);
          fetchData();
        }}
        showCloseButton={etiquetaSteps.some(s => s.status === 'error' || s.status === 'success')}
      />
    </div>
  );
}
