'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, Row, Col, Input, Tag, Typography, Button, Table, Spin, Select, Space, message } from 'antd';
import type { TableProps } from 'antd';
import { ArrowLeftOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import type { Database } from '@/types/database';

const { Title, Text } = Typography;

const statusColor: Record<string, string> = {
  aberto: 'blue', atendido: 'processing', faturado: 'purple', entregue: 'green', cancelado: 'red',
};

const statusLabel: Record<string, string> = {
  aberto: 'Aberto', atendido: 'Atendido', faturado: 'Faturado', entregue: 'Entregue', cancelado: 'Cancelado',
};

const ddiOptions = [
  { value: '+55', label: '+55 Brasil' },
  { value: '+1', label: '+1 EUA' },
  { value: '+54', label: '+54 Argentina' },
  { value: '+351', label: '+351 Portugal' },
  { value: '+56', label: '+56 Chile' },
  { value: '+57', label: '+57 Colômbia' },
];

const cardStyle = { background: '#141414', border: '1px solid #303030', borderRadius: 8 };
const inputStyle = { background: '#1f1f1f', border: '1px solid #303030', color: '#e0e0e0', borderRadius: 6 };
const labelStyle: React.CSSProperties = { color: '#a0a0a0', fontSize: 13 };

function formatDoc(doc: string): string {
  if (!doc) return '—';
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').substring(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '');
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type ClienteRow = Database['public']['Tables']['clientes']['Row'];

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [cliente, setCliente] = useState<ClienteRow | null>(null);
  const [originalCliente, setOriginalCliente] = useState<ClienteRow | null>(null);
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const [ddi, setDdi] = useState('+55');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${id}`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Erro ao buscar cliente');
      }
      const json = await res.json();
      setCliente(json.cliente);
      setOriginalCliente(json.cliente);
      setPedidos(json.pedidos || []);

      // Parse existing phone to extract DDI if present
      const tel = json.cliente?.telefone || '';
      if (tel.startsWith('+')) {
        const match = tel.match(/^\+(\d+)\s/);
        if (match) {
          const extractedDdi = `+${match[1]}`;
          if (ddiOptions.some(o => o.value === extractedDdi)) {
            setDdi(extractedDdi);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar cliente');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const patch = (diff: Partial<ClienteRow>) => {
    setCliente(prev => prev ? { ...prev, ...diff } : prev);
  };

  const hasChanges = cliente && originalCliente && (
    cliente.email !== originalCliente.email ||
    cliente.telefone !== originalCliente.telefone
  );

  const emailValid = !cliente?.email || isValidEmail(cliente.email);

  const handleSave = async () => {
    if (!cliente || !hasChanges) return;
    if (!emailValid) {
      messageApi.error('E-mail inválido');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/clientes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cliente.email,
          telefone: cliente.telefone ? `${ddi} ${cliente.telefone}` : '',
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Erro ao salvar');
      }

      const json = await res.json();
      setOriginalCliente(json.data);
      messageApi.success('Cliente salvo com sucesso');
    } catch (err: any) {
      messageApi.error(err.message || 'Erro ao salvar cliente');
    } finally {
      setSaving(false);
    }
  };

  const pedidosColumns: TableProps<any>['columns'] = [
    {
      title: 'Pedido', dataIndex: 'numero', key: 'numero', width: 110,
      render: (v: number) => (
        <a
          href={`https://www.mercadolivre.com.br/vendas/${v}/detalhe`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: 'monospace', color: '#1677ff', textDecoration: 'none' }}
        >
          #{String(v).padStart(6, '0')}
        </a>
      ),
    },
    {
      title: 'Data', dataIndex: 'data', key: 'data', width: 160,
      render: (d: string) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
    },
    {
      title: 'Valor', dataIndex: 'total', key: 'total', width: 110,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Status', dataIndex: 'situacao', key: 'situacao', width: 110,
      render: (s: string) => <Tag color={statusColor[s] || 'default'}>{statusLabel[s] || s}</Tag>,
    },
    {
      title: 'Rastreio', dataIndex: 'rastreio', key: 'rastreio', width: 140,
      render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> : <span style={{ color: '#666' }}>—</span>,
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />} />
        <p style={{ marginTop: 16, color: '#a0a0a0' }}>Carregando cliente...</p>
      </div>
    );
  }

  if (error || !cliente) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Title level={4} style={{ color: '#e0e0e0' }}>{error || 'Cliente não encontrado'}</Title>
        <Button type="primary" onClick={() => router.push('/clientes')}>Voltar para Clientes</Button>
      </div>
    );
  }

  return (
    <div>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push('/clientes')}
          style={{ color: '#a0a0a0', padding: 0 }}
        >
          Voltar para Clientes
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!hasChanges || !emailValid}
        >
          Salvar Alterações
        </Button>
      </div>

      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 24 }}>{cliente.nome}</Title>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Dados do Cliente
            </Title>
            <Row gutter={[16, 12]}>
              <Col span={24}>
                <div style={labelStyle}>Nome</div>
                <Text style={{ color: '#e0e0e0', fontSize: 14 }}>{cliente.nome}</Text>
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Nickname (ML)</div>
                <Text style={{ color: '#c0c0c0', fontSize: 14 }}>{cliente.ml_nickname || '—'}</Text>
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Tipo</div>
                <Tag color={cliente.tipo_pessoa === 'J' ? 'purple' : 'blue'}>
                  {cliente.tipo_pessoa === 'J' ? 'PJ' : cliente.tipo_pessoa === 'F' ? 'PF' : '—'}
                </Tag>
              </Col>
              <Col span={24}>
                <div style={labelStyle}>Documento</div>
                <Text style={{ fontFamily: 'monospace', fontSize: 14, color: '#e0e0e0' }}>{formatDoc(cliente.documento)}</Text>
              </Col>
              <Col span={24}>
                <div style={labelStyle}>Endereço</div>
                <Text style={{ color: '#e0e0e0', fontSize: 14 }}>{cliente.endereco || '—'}</Text>
              </Col>
              <Col span={24}>
                <div style={labelStyle}>E-mail</div>
                <Input
                  value={cliente.email || ''}
                  onChange={e => patch({ email: e.target.value })}
                  style={{ ...inputStyle, borderColor: cliente.email && !emailValid ? '#ff4d4f' : undefined }}
                  placeholder="email@exemplo.com"
                />
                {cliente.email && !emailValid && (
                  <Text style={{ color: '#ff4d4f', fontSize: 12 }}>E-mail inválido</Text>
                )}
              </Col>
              <Col span={24}>
                <div style={labelStyle}>Telefone</div>
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    value={ddi}
                    onChange={setDdi}
                    options={ddiOptions}
                    style={{ width: 140 }}
                  />
                  <Input
                    value={cliente.telefone || ''}
                    onChange={e => patch({ telefone: maskPhone(e.target.value) })}
                    style={inputStyle}
                    placeholder="(11) 99999-9999"
                    maxLength={15}
                  />
                </Space.Compact>
              </Col>
              <Col span={12}>
                <div style={labelStyle}>Total de Pedidos</div>
                <Text style={{ color: '#1677ff', fontWeight: 600, fontSize: 20 }}>{pedidos.length}</Text>
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card styles={{ body: { padding: 16 } }} style={cardStyle}>
            <Title level={5} style={{ color: '#a0a0a0', marginBottom: 16, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Histórico de Pedidos
            </Title>
            {pedidos.length === 0 ? (
              <Text type="secondary" style={{ color: '#666' }}>Nenhum pedido encontrado para este cliente.</Text>
            ) : (
              <Table
                dataSource={pedidos}
                columns={pedidosColumns}
                rowKey="id"
                pagination={{ pageSize: 10, showSizeChanger: false }}
                size="small"
                style={{ background: 'transparent' }}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
