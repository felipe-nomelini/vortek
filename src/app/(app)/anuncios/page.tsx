'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, Space, Spin, Statistic } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import QualidadeModal from '@/components/QualidadeModal';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Title } = Typography;

type ListingStatus = 'ativo' | 'pausado';

interface Anuncio {
  id: string;
  sku: string;
  produto: string;
  precoML: number;
  vendidos: number;
  visitas: number;
  qualidade: number;
  qualidadeObj?: { total: number; itens: { nome: string; ok: boolean; pontos: number; max: number }[]; dica: string };
  status: ListingStatus;
  catalogo: boolean;
}

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'pausado', label: 'Pausado' },
];

function mapDBtoAnuncio(item: any): Anuncio {
  return {
    id: item.ml_item_id || '',
    sku: item.sku || '',
    produto: item.titulo || '',
    precoML: item.preco_ml || 0,
    vendidos: item.vendidos || 0,
    visitas: item.visitas || 0,
    qualidade: item.qualidade || 0,
    qualidadeObj: item.qualidade_info || undefined,
    status: item.status || 'ativo',
    catalogo: item.catalogo || false,
  };
}

export default function AnunciosPage() {
  const [data, setData] = useState<Anuncio[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ListingStatus | ''>('');
  const [mlMin, setMlMin] = useState<number | null>(null);
  const [mlMax, setMlMax] = useState<number | null>(null);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [modalQualidade, setModalQualidade] = useState<{ open: boolean; score: number; itens: any[]; dica: string; titulo: string }>({ open: false, score: 0, itens: [], dica: '', titulo: '' });
  const [summary, setSummary] = useState({
    total: 0,
    ativos: 0,
    pausados: 0,
    qualidade_baixa: 0,
    qualidade_alta: 0,
    qualidade_100: 0,
  });

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (mlMin !== null) params.set('priceMin', String(mlMin));
    if (mlMax !== null) params.set('priceMax', String(mlMax));
    return params;
  }, [page, search, statusFilter, mlMin, mlMax]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams().toString();
      const [listRes, summaryRes] = await Promise.all([
        fetch(`/api/anuncios?${params}`),
        fetch(`/api/anuncios/resumo?${params}`),
      ]);

      if (listRes.ok) {
        const json = await listRes.json();
        setData((json.data || []).map(mapDBtoAnuncio));
        setTotal(json.total || 0);
      }
      if (summaryRes.ok) {
        const json = await summaryRes.json();
        setSummary({
          total: json.total || 0,
          ativos: json.ativos || 0,
          pausados: json.pausados || 0,
          qualidade_baixa: json.qualidade_baixa || 0,
          qualidade_alta: json.qualidade_alta || 0,
          qualidade_100: json.qualidade_100 || 0,
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
  }, [search, statusFilter, mlMin, mlMax]);

  const columns: TableProps<Anuncio>['columns'] = [
    {
      title: 'SKU', dataIndex: 'sku', key: 'sku', width: 110,
      sorter: (a, b) => a.sku.localeCompare(b.sku),
    },
    {
      title: 'Produto', dataIndex: 'produto', key: 'produto',
      sorter: (a, b) => a.produto.localeCompare(b.produto),
    },
    {
      title: 'Preço ML', dataIndex: 'precoML', key: 'precoML', width: 110,
      sorter: (a, b) => a.precoML - b.precoML,
      render: (v: number) => v ? formatCurrency(v) : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Vendidos', dataIndex: 'vendidos', key: 'vendidos', width: 90,
      sorter: (a, b) => a.vendidos - b.vendidos,
    },
    {
      title: 'Visitas', dataIndex: 'visitas', key: 'visitas', width: 80,
      sorter: (a, b) => a.visitas - b.visitas,
    },
    {
      title: 'Qualidade', dataIndex: 'qualidade', key: 'qualidade', width: 100,
      sorter: (a, b) => a.qualidade - b.qualidade,
      render: (v: number, record: Anuncio) => (
        <a
          onClick={() => {
            const obj = record.qualidadeObj;
            setModalQualidade({
              open: true,
              score: v,
              itens: obj?.itens || [],
              dica: obj?.dica || '',
              titulo: record.produto,
            });
          }}
          style={{ cursor: 'pointer' }}
        >
          <Tag color={v >= 80 ? 'green' : v >= 50 ? 'orange' : 'red'} style={{ cursor: 'pointer', fontWeight: 600 }}>
            {v}%
          </Tag>
        </a>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (s: ListingStatus) => (
        <Tag color={s === 'ativo' ? 'green' : 'orange'}>{s.charAt(0).toUpperCase() + s.slice(1)}</Tag>
      ),
    },
    {
      title: 'Catálogo', dataIndex: 'catalogo', key: 'catalogo', width: 90,
      sorter: (a, b) => Number(a.catalogo) - Number(b.catalogo),
      render: (v: boolean) => v
        ? <Tag color="green">SIM</Tag>
        : <Tag color="default">NÃO</Tag>,
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Visualizar no ML' },
              ...(record.status === 'ativo' ? [{ key: 'pause', label: 'Pausar Anúncio' }] : [{ key: 'activate', label: 'Ativar Anúncio' }]),
              { key: 'updatePrice', label: 'Atualizar Preço' },
              { key: 'optimize', label: 'Otimizar com IA' },
            ],
            onClick: ({ key }) => { /* TODO: implementar ação */ },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Anúncios - Mercado Livre</Title>
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
              title={<span style={{ color: '#a0a0a0' }}>Ativos</span>}
              value={summary.ativos}
              valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Pausados</span>}
              value={summary.pausados}
              valueStyle={{ color: '#faad14', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Qualidade Baixa</span>}
              value={summary.qualidade_baixa}
              valueStyle={{ color: '#ff4d4f', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Qualidade Alta</span>}
              value={summary.qualidade_alta}
              valueStyle={{ color: '#73d13d', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Qualidade 100%</span>}
              value={summary.qualidade_100}
              valueStyle={{ color: '#13c2c2', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar por produto ou SKU"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220 }}
              allowClear
            />
          </Col>
          <Col>
            <Select placeholder="Status" value={statusFilter || undefined} onChange={v => setStatusFilter(v as ListingStatus | '')} options={statusOptions} style={{ width: 130 }} allowClear onClear={() => setStatusFilter('')} />
          </Col>
          <Col>
            <Space.Compact>
              <InputNumber placeholder="ML mín" value={mlMin} onChange={v => setMlMin(v ?? null)} style={{ width: 110 }} />
              <InputNumber placeholder="ML máx" value={mlMax} onChange={v => setMlMax(v ?? null)} style={{ width: 110 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>
      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          <ResizableTable<Anuncio>
            storageKey="anuncios"
            dataSource={data}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} anúncios`,
              onChange: (p) => setPage(p),
            }}
            scroll={{ x: 1200 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>
      <QualidadeModal
        open={modalQualidade.open}
        onClose={() => setModalQualidade(p => ({ ...p, open: false }))}
        score={modalQualidade.score}
        itens={modalQualidade.itens}
        dica={modalQualidade.dica}
        titulo={modalQualidade.titulo}
      />
    </div>
  );
}
