'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Breadcrumb, Button, Card, Col, Input, Row, Space, Spin, Switch, Tag, Typography, message,
} from 'antd';
import { ArrowLeftOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons';
import type { Database } from '@/types/database';

const { Title, Text } = Typography;

type FornecedorRow = Database['public']['Tables']['fornecedores']['Row'];

const cardStyle = {
  background: '#141414',
  border: '1px solid #303030',
  borderRadius: 8,
};

const sectionTitle = {
  color: '#a0a0a0',
  marginBottom: 16,
  fontSize: 13,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
};

const inputStyle = {
  background: '#1f1f1f',
  border: '1px solid #303030',
  color: '#e0e0e0',
  borderRadius: 6,
};

const labelStyle: React.CSSProperties = { color: '#a0a0a0', fontSize: 13 };

function formatDate(date: string | null): string {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('pt-BR');
}

function statusColor(value: string | null | undefined): string {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('ativo') || normalized.includes('ok')) return 'green';
  if (normalized.includes('inativo') || normalized.includes('bloque')) return 'red';
  return 'blue';
}

export default function FornecedorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');

  const [fornecedor, setFornecedor] = useState<FornecedorRow | null>(null);
  const [original, setOriginal] = useState<FornecedorRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFornecedor = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fornecedores/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao buscar fornecedor');
      setFornecedor(json.data);
      setOriginal(json.data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar fornecedor');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void fetchFornecedor();
  }, [id, fetchFornecedor]);

  const patch = (diff: Partial<FornecedorRow>) => {
    setFornecedor((prev) => prev ? { ...prev, ...diff } : prev);
  };

  const hasChanges = JSON.stringify(fornecedor) !== JSON.stringify(original);

  const handleSave = async () => {
    if (!fornecedor) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/fornecedores/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ativo: fornecedor.ativo,
          apelido: fornecedor.apelido,
          nome: fornecedor.nome,
          cnpj: fornecedor.cnpj,
          email: fornecedor.email,
          telefone: fornecedor.telefone,
          endereco: fornecedor.endereco,
          status_dslite: fornecedor.status_dslite,
          crossdocking: fornecedor.crossdocking,
          dropshipping: fornecedor.dropshipping,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao salvar fornecedor');
      setFornecedor(json.data);
      setOriginal(json.data);
      message.success('Fornecedor salvo com sucesso');
    } catch (err: any) {
      message.error(err.message || 'Erro ao salvar fornecedor');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />} />
        <p style={{ marginTop: 16, color: '#a0a0a0' }}>Carregando fornecedor...</p>
      </div>
    );
  }

  if (error || !fornecedor) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Title level={4} style={{ color: '#e0e0e0' }}>{error || 'Fornecedor não encontrado'}</Title>
        <Button type="primary" onClick={() => router.push('/fornecedores')}>Voltar para Fornecedores</Button>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <a onClick={() => router.push('/fornecedores')}>Fornecedores</a> },
          { title: fornecedor.apelido || fornecedor.nome || fornecedor.dslite_id || 'Detalhes' },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push('/fornecedores')}
            style={{ color: '#a0a0a0', paddingLeft: 0, marginBottom: 8 }}
          >
            Voltar
          </Button>
          <Title level={3} style={{ color: '#e0e0e0', margin: 0 }}>
            {fornecedor.apelido || fornecedor.nome || 'Fornecedor'}
          </Title>
          <Space style={{ marginTop: 8 }} wrap>
            <Tag color={fornecedor.ativo === false ? 'red' : 'green'}>
              {fornecedor.ativo === false ? 'Inativo Vortek' : 'Ativo Vortek'}
            </Tag>
            <Tag color={statusColor(fornecedor.status_dslite)}>DSLite: {fornecedor.status_dslite || '—'}</Tag>
            <Tag color={statusColor(fornecedor.crossdocking)}>Cross: {fornecedor.crossdocking || '—'}</Tag>
            <Tag color={statusColor(fornecedor.dropshipping)}>Drop: {fornecedor.dropshipping || '—'}</Tag>
          </Space>
        </div>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!hasChanges}
        >
          Salvar Alterações
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card style={cardStyle}>
            <div style={sectionTitle}>Dados cadastrais</div>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <div style={labelStyle}>Apelido</div>
                <Input value={fornecedor.apelido} onChange={(e) => patch({ apelido: e.target.value })} style={inputStyle} />
              </Col>
              <Col xs={24} md={12}>
                <div style={labelStyle}>Razão social / Nome</div>
                <Input value={fornecedor.nome} onChange={(e) => patch({ nome: e.target.value })} style={inputStyle} />
              </Col>
              <Col xs={24} md={8}>
                <div style={labelStyle}>CNPJ</div>
                <Input value={fornecedor.cnpj} onChange={(e) => patch({ cnpj: e.target.value })} style={inputStyle} />
              </Col>
              <Col xs={24} md={8}>
                <div style={labelStyle}>E-mail</div>
                <Input value={fornecedor.email} onChange={(e) => patch({ email: e.target.value })} style={inputStyle} />
              </Col>
              <Col xs={24} md={8}>
                <div style={labelStyle}>Telefone / WhatsApp</div>
                <Input value={fornecedor.telefone} onChange={(e) => patch({ telefone: e.target.value })} style={inputStyle} />
              </Col>
              <Col xs={24}>
                <div style={labelStyle}>Endereço</div>
                <Input.TextArea
                  rows={3}
                  value={fornecedor.endereco}
                  onChange={(e) => patch({ endereco: e.target.value })}
                  style={inputStyle}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card style={cardStyle}>
            <div style={sectionTitle}>Operação</div>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <div style={labelStyle}>Status Vortek</div>
                <Switch
                  checked={fornecedor.ativo !== false}
                  checkedChildren="Ativo"
                  unCheckedChildren="Inativo"
                  onChange={(checked) => patch({ ativo: checked })}
                />
              </div>
              <div>
                <div style={labelStyle}>ID DSLite</div>
                <Input readOnly value={fornecedor.dslite_id || '—'} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Status DSLite</div>
                <Input value={fornecedor.status_dslite} onChange={(e) => patch({ status_dslite: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Crossdocking</div>
                <Input value={fornecedor.crossdocking} onChange={(e) => patch({ crossdocking: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Dropshipping</div>
                <Input value={fornecedor.dropshipping} onChange={(e) => patch({ dropshipping: e.target.value })} style={inputStyle} />
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24}>
          <Card style={cardStyle}>
            <div style={sectionTitle}>Auditoria</div>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Text style={labelStyle}>Criado em</Text>
                <div style={{ color: '#e0e0e0' }}>{formatDate(fornecedor.created_at)}</div>
              </Col>
              <Col xs={24} md={8}>
                <Text style={labelStyle}>Atualizado em</Text>
                <div style={{ color: '#e0e0e0' }}>{formatDate(fornecedor.updated_at)}</div>
              </Col>
              <Col xs={24} md={8}>
                <Text style={labelStyle}>Última sync DSLite</Text>
                <div style={{ color: '#e0e0e0' }}>{formatDate(fornecedor.dslite_ultima_sync)}</div>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
