'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckOutlined,
  CloseOutlined,
  DollarOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';

const { Title, Text, Link } = Typography;

type Summary = {
  available: number;
  pending: number;
  used_month: number;
  suppliers_with_pending: number;
};

type SupplierCredit = {
  fornecedor_id: string;
  fornecedor_nome: string;
  ativo: boolean;
  status_dslite: string | null;
  available: number;
  pending: number;
  used_month: number;
  last_movement_at: string | null;
  pending_count: number;
};

type Movement = {
  id: string;
  fornecedor_id: string;
  fornecedor_nome: string | null;
  movement_type: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  status: string;
  source: string | null;
  ml_order_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
};

const emptySummary: Summary = {
  available: 0,
  pending: 0,
  used_month: 0,
  suppliers_with_pending: 0,
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function movementLabel(type: string): string {
  const labels: Record<string, string> = {
    cancellation_credit: 'Crédito por cancelamento',
    manual_credit: 'Crédito manual',
    credit_usage: 'Crédito utilizado',
    adjustment: 'Ajuste',
  };
  return labels[type] || type;
}

function statusTag(status: string) {
  if (status === 'confirmed') return <Tag color="green">Confirmado</Tag>;
  if (status === 'pending') return <Tag color="gold">A confirmar</Tag>;
  if (status === 'rejected') return <Tag color="red">Rejeitado</Tag>;
  return <Tag>Cancelado</Tag>;
}

export default function SupplierCreditsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [suppliers, setSuppliers] = useState<SupplierCredit[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierCredit | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/fornecedores/creditos', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Falha ao carregar créditos.');
      setSummary(json.summary || emptySummary);
      setSuppliers(json.suppliers || []);
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao carregar créditos.');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  const fetchMovements = useCallback(async (supplier: SupplierCredit) => {
    setDrawerLoading(true);
    try {
      const response = await fetch(`/api/fornecedores/creditos?fornecedor_id=${encodeURIComponent(supplier.fornecedor_id)}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Falha ao carregar extrato.');
      setMovements(json.movements || []);
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao carregar extrato.');
    } finally {
      setDrawerLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const filteredSuppliers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return suppliers;
    return suppliers.filter((supplier) =>
      supplier.fornecedor_nome.toLowerCase().includes(normalized)
      || supplier.fornecedor_id.toLowerCase().includes(normalized));
  }, [search, suppliers]);

  const openStatement = async (supplier: SupplierCredit) => {
    setSelectedSupplier(supplier);
    setMovements([]);
    await fetchMovements(supplier);
  };

  const reconcile = async () => {
    setReconciling(true);
    try {
      const response = await fetch('/api/fornecedores/creditos/reconciliar', { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Falha ao reanalisar cancelamentos.');
      messageApi.success(`${json.created || 0} nova(s) pendência(s) encontrada(s).`);
      await fetchSummary();
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao reanalisar cancelamentos.');
    } finally {
      setReconciling(false);
    }
  };

  const decideMovement = async (movement: Movement, status: 'confirmed' | 'rejected') => {
    setDecisionId(movement.id);
    try {
      const response = await fetch(`/api/fornecedores/creditos/${movement.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Falha ao analisar crédito.');
      messageApi.success(status === 'confirmed' ? 'Crédito confirmado.' : 'Pendência rejeitada.');
      await fetchSummary();
      if (selectedSupplier) await fetchMovements(selectedSupplier);
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao analisar crédito.');
    } finally {
      setDecisionId(null);
    }
  };

  const saveMovement = async () => {
    const values = await form.validateFields();
    setSavingMovement(true);
    try {
      const response = await fetch('/api/fornecedores/creditos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Falha ao registrar movimentação.');
      messageApi.success('Movimentação registrada.');
      setMovementModalOpen(false);
      form.resetFields();
      await fetchSummary();
      const currentSupplier = selectedSupplier;
      if (currentSupplier && currentSupplier.fornecedor_id === values.fornecedor_id) {
        await fetchMovements(currentSupplier);
      }
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao registrar movimentação.');
    } finally {
      setSavingMovement(false);
    }
  };

  const supplierColumns: ColumnsType<SupplierCredit> = [
    {
      title: 'Fornecedor',
      dataIndex: 'fornecedor_nome',
      sorter: (a, b) => a.fornecedor_nome.localeCompare(b.fornecedor_nome),
      render: (value, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{value}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>DSLite #{record.fornecedor_id}</Text>
        </Space>
      ),
    },
    {
      title: 'Crédito disponível',
      dataIndex: 'available',
      align: 'right',
      sorter: (a, b) => a.available - b.available,
      render: (value) => <Text style={{ color: value > 0 ? '#52c41a' : '#8c8c8c', fontWeight: 700 }}>{formatCurrency(value)}</Text>,
    },
    {
      title: 'A confirmar',
      dataIndex: 'pending',
      align: 'right',
      sorter: (a, b) => a.pending - b.pending,
      render: (value, record) => value > 0
        ? <Tag color="gold">{formatCurrency(value)} · {record.pending_count}</Tag>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Usado no mês',
      dataIndex: 'used_month',
      align: 'right',
      render: (value) => formatCurrency(value),
    },
    {
      title: 'Último movimento',
      dataIndex: 'last_movement_at',
      render: (value) => value ? new Date(value).toLocaleString('pt-BR') : '—',
    },
    {
      title: 'Status',
      render: (_, record) => <Tag color={record.ativo ? 'green' : 'default'}>{record.ativo ? 'Ativo' : 'Inativo'}</Tag>,
    },
    {
      title: 'Ações',
      width: 120,
      render: (_, record) => <Button size="small" icon={<HistoryOutlined />} onClick={() => void openStatement(record)}>Ver extrato</Button>,
    },
  ];

  const movementColumns: ColumnsType<Movement> = [
    {
      title: 'Data',
      dataIndex: 'created_at',
      width: 150,
      render: (value) => new Date(value).toLocaleString('pt-BR'),
    },
    {
      title: 'Movimento',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{movementLabel(record.movement_type)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.reference || record.notes || '—'}</Text>
          {record.ml_order_id && (
            <Link href={`https://www.mercadolivre.com.br/vendas/${record.ml_order_id}/detalhe`} target="_blank">
              Venda #{record.ml_order_id}
            </Link>
          )}
        </Space>
      ),
    },
    {
      title: 'Valor',
      dataIndex: 'amount',
      align: 'right',
      width: 130,
      render: (value) => <Text style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>{formatCurrency(value)}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 115,
      render: statusTag,
    },
    {
      title: 'Ações',
      width: 170,
      render: (_, record) => record.status === 'pending' ? (
        <Space>
          <Popconfirm title="Fornecedor confirmou este crédito?" onConfirm={() => void decideMovement(record, 'confirmed')}>
            <Button size="small" type="primary" icon={<CheckOutlined />} loading={decisionId === record.id}>Confirmar</Button>
          </Popconfirm>
          <Popconfirm title="Descartar esta pendência?" onConfirm={() => void decideMovement(record, 'rejected')}>
            <Button size="small" danger icon={<CloseOutlined />} disabled={decisionId === record.id} />
          </Popconfirm>
        </Space>
      ) : <Text type="secondary">—</Text>,
    },
  ];

  return (
    <div>
      {contextHolder}
      <Row justify="space-between" align="middle" gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col>
          <Title level={2} style={{ margin: 0 }}>Créditos de fornecedores</Title>
          <Text type="secondary">Saldo confirmado, cancelamentos pendentes e compensações futuras.</Text>
        </Col>
        <Col>
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={reconciling} onClick={() => void reconcile()}>Reanalisar cancelamentos</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setMovementModalOpen(true)}>Nova movimentação</Button>
          </Space>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        message="Cancelamento pago gera pendência, não saldo imediato. Confirme com fornecedor antes de liberar crédito."
        style={{ marginBottom: 16 }}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="Crédito disponível" value={summary.available} formatter={(value) => formatCurrency(Number(value))} valueStyle={{ color: '#52c41a' }} prefix={<DollarOutlined />} /></Card></Col>
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="A confirmar" value={summary.pending} formatter={(value) => formatCurrency(Number(value))} valueStyle={{ color: '#faad14' }} /></Card></Col>
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="Utilizado no mês" value={summary.used_month} formatter={(value) => formatCurrency(Number(value))} /></Card></Col>
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="Fornecedores pendentes" value={summary.suppliers_with_pending} /></Card></Col>
      </Row>

      <Card>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Buscar fornecedor ou código DSLite"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ maxWidth: 420, marginBottom: 16 }}
        />
        <Table<SupplierCredit>
          rowKey="fornecedor_id"
          loading={loading}
          columns={supplierColumns}
          dataSource={filteredSuppliers}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1000 }}
        />
      </Card>

      <Drawer
        title={selectedSupplier ? `Extrato — ${selectedSupplier.fornecedor_nome}` : 'Extrato'}
        open={Boolean(selectedSupplier)}
        width={980}
        onClose={() => setSelectedSupplier(null)}
      >
        {selectedSupplier && (
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col span={8}><Card size="small"><Statistic title="Disponível" value={selectedSupplier.available} formatter={(value) => formatCurrency(Number(value))} valueStyle={{ color: '#52c41a' }} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="A confirmar" value={selectedSupplier.pending} formatter={(value) => formatCurrency(Number(value))} valueStyle={{ color: '#faad14' }} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="Usado no mês" value={selectedSupplier.used_month} formatter={(value) => formatCurrency(Number(value))} /></Card></Col>
          </Row>
        )}
        <Table<Movement>
          rowKey="id"
          loading={drawerLoading}
          columns={movementColumns}
          dataSource={movements}
          pagination={{ pageSize: 15 }}
          scroll={{ x: 850 }}
        />
      </Drawer>

      <Modal
        title="Nova movimentação"
        open={movementModalOpen}
        onCancel={() => setMovementModalOpen(false)}
        onOk={() => void saveMovement()}
        confirmLoading={savingMovement}
        okText="Registrar"
      >
        <Form form={form} layout="vertical" initialValues={{ movement_type: 'manual_credit' }}>
          <Form.Item name="fornecedor_id" label="Fornecedor" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={suppliers.map((supplier) => ({ value: supplier.fornecedor_id, label: supplier.fornecedor_nome }))}
            />
          </Form.Item>
          <Form.Item name="movement_type" label="Tipo" rules={[{ required: true }]}>
            <Select options={[
              { value: 'manual_credit', label: 'Adicionar crédito confirmado' },
              { value: 'credit_usage', label: 'Registrar utilização de crédito' },
              { value: 'adjustment_credit', label: 'Ajuste positivo' },
              { value: 'adjustment_debit', label: 'Ajuste negativo' },
            ]} />
          </Form.Item>
          <Form.Item name="amount" label="Valor" rules={[{ required: true }]}>
            <InputNumber<number> min={0.01} precision={2} style={{ width: '100%' }} prefix="R$" />
          </Form.Item>
          <Form.Item name="reference" label="Referência">
            <Input placeholder="Ex.: confirmação do fornecedor, pedido ou protocolo" />
          </Form.Item>
          <Form.Item name="notes" label="Observação" rules={[{ required: true, min: 3 }]}>
            <Input.TextArea rows={3} placeholder="Explique a origem ou utilização do crédito" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
