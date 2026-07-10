'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, Space, Spin, Statistic, message } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import QualidadeModal from '@/components/QualidadeModal';
import type { MenuProps, TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import { appendRemoteSortParams, getRemoteSortOrder, type RemoteSortState, resolveRemoteSortState } from '@/lib/remote-sort';

const { Title } = Typography;

type ListingStatus = 'ativo' | 'pausado';

interface Anuncio {
  id: string;
  produtoId: string | null;
  permalink: string | null;
  sku: string;
  produto: string;
  precoML: number;
  lucro: number | null;
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
    produtoId: item.produto_id || null,
    permalink: item.permalink || null,
    sku: item.sku || '',
    produto: item.titulo || '',
    precoML: item.preco_ml || 0,
    lucro: typeof item.lucro === 'number' ? item.lucro : null,
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
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'titulo', sortOrder: 'asc' });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ListingStatus | ''>('');
  const [mlMin, setMlMin] = useState<number | null>(null);
  const [mlMax, setMlMax] = useState<number | null>(null);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [updatingActionItemId, setUpdatingActionItemId] = useState<string | null>(null);
  const statusPollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    appendRemoteSortParams(params, sort);
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (mlMin !== null) params.set('priceMin', String(mlMin));
    if (mlMax !== null) params.set('priceMax', String(mlMax));
    return params;
  }, [page, sort, search, statusFilter, mlMin, mlMax]);

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

  const clearStatusPolling = useCallback(() => {
    if (statusPollingRef.current) {
      clearTimeout(statusPollingRef.current);
      statusPollingRef.current = null;
    }
  }, []);

  useEffect(() => () => clearStatusPolling(), [clearStatusPolling]);

  const applyLocalStatusChange = useCallback((record: Anuncio, nextStatus: ListingStatus) => {
    setData((prev) => prev.flatMap((item) => {
      if (item.id !== record.id) return [item];
      if (statusFilter && statusFilter !== nextStatus) return [];
      return [{ ...item, status: nextStatus }];
    }));

    setSummary((prev) => ({
      ...prev,
      ativos: Math.max(0, prev.ativos + (record.status === 'ativo' ? -1 : 1)),
      pausados: Math.max(0, prev.pausados + (record.status === 'pausado' ? -1 : 1)),
    }));

    if (statusFilter && statusFilter !== nextStatus) {
      setTotal((prev) => Math.max(0, prev - 1));
    }
  }, [statusFilter]);

  const pollStatusPublish = useCallback(async (outboxId: string) => {
    const response = await fetch(`/api/ml/anuncio/atualizar-preco/status?outboxId=${encodeURIComponent(outboxId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Falha ao consultar status da publicação.');
    }
    return payload as { status?: 'pending' | 'processing' | 'retry' | 'failed' | 'done'; last_error?: string | null };
  }, []);

  const scheduleStatusPolling = useCallback((outboxId: string) => {
    clearStatusPolling();
    statusPollingRef.current = setTimeout(async () => {
      try {
        const payload = await pollStatusPublish(outboxId);
        if (payload.status === 'done') {
          clearStatusPolling();
          await fetchData();
          return;
        }
        if (payload.status === 'failed') {
          clearStatusPolling();
          message.error(payload.last_error || 'Falha ao publicar alteração de status no Mercado Livre.');
          await fetchData();
          return;
        }
        scheduleStatusPolling(outboxId);
      } catch (error: any) {
        clearStatusPolling();
        message.error(error?.message || 'Falha ao acompanhar alteração de status do anúncio.');
        await fetchData();
      }
    }, 1500);
  }, [clearStatusPolling, fetchData, pollStatusPublish]);

  const handleViewOnMl = useCallback((record: Anuncio) => {
    if (!record.permalink) {
      message.warning('Link do anúncio no Mercado Livre indisponível para este registro.');
      return;
    }
    window.open(record.permalink, '_blank', 'noopener,noreferrer');
  }, []);

  const handleToggleStatus = useCallback(async (record: Anuncio) => {
    if (!record.produtoId) {
      message.warning('Este anúncio não possui vínculo local com produto para alterar o status.');
      return;
    }

    const nextStatus: ListingStatus = record.status === 'ativo' ? 'pausado' : 'ativo';
    setUpdatingActionItemId(record.id);

    try {
      const response = await fetch(`/api/produtos/${encodeURIComponent(record.produtoId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ml_status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || 'Falha ao enfileirar alteração de status do anúncio.');
      }

      message.success(
        nextStatus === 'ativo'
          ? 'Ativação do anúncio enfileirada para publicação no ML.'
          : 'Pausa do anúncio enfileirada para publicação no ML.',
      );

      if (payload?.warning) {
        message.warning(payload.warning);
      }

      const outboxId = String(payload?.outboxId || '').trim();
      if (payload?.queued_publish && outboxId) {
        applyLocalStatusChange(record, nextStatus);
        scheduleStatusPolling(outboxId);
      } else {
        await fetchData();
      }
    } catch (error: any) {
      message.error(error?.message || 'Falha ao alterar status do anúncio no Mercado Livre.');
    } finally {
      setUpdatingActionItemId(null);
    }
  }, [applyLocalStatusChange, fetchData, scheduleStatusPolling]);

  const columns: TableProps<Anuncio>['columns'] = [
    {
      title: 'SKU', dataIndex: 'sku', key: 'sku', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('sku', sort),
    },
    {
      title: 'Produto', dataIndex: 'produto', key: 'titulo',
      sorter: true,
      sortOrder: getRemoteSortOrder('titulo', sort),
    },
    {
      title: 'Preço ML', dataIndex: 'precoML', key: 'preco_ml', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('preco_ml', sort),
      render: (v: number) => v ? formatCurrency(v) : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Lucro', dataIndex: 'lucro', key: 'lucro', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('lucro', sort),
      render: (v: number | null) => {
        if (v === null) return <span style={{ color: '#666' }}>—</span>;
        const color = v > 0 ? '#52c41a' : v < 0 ? '#ff4d4f' : '#d9d9d9';
        return <span style={{ color, fontWeight: 600 }}>{formatCurrency(v)}</span>;
      },
    },
    {
      title: 'Vendidos', dataIndex: 'vendidos', key: 'vendidos', width: 90,
      sorter: true,
      sortOrder: getRemoteSortOrder('vendidos', sort),
    },
    {
      title: 'Visitas', dataIndex: 'visitas', key: 'visitas', width: 80,
      sorter: true,
      sortOrder: getRemoteSortOrder('visitas', sort),
    },
    {
      title: 'Qualidade', dataIndex: 'qualidade', key: 'qualidade', width: 100,
      sorter: true,
      sortOrder: getRemoteSortOrder('qualidade', sort),
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
      sorter: true,
      sortOrder: getRemoteSortOrder('status', sort),
      render: (s: ListingStatus) => (
        <Tag color={s === 'ativo' ? 'green' : 'orange'}>{s.charAt(0).toUpperCase() + s.slice(1)}</Tag>
      ),
    },
    {
      title: 'Catálogo', dataIndex: 'catalogo', key: 'catalogo', width: 90,
      sorter: true,
      sortOrder: getRemoteSortOrder('catalogo', sort),
      render: (v: boolean) => v
        ? <Tag color="green">SIM</Tag>
        : <Tag color="default">NÃO</Tag>,
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const isUpdatingCurrent = updatingActionItemId === record.id;
        const menuItems: MenuProps['items'] = [
          {
            key: 'view',
            label: 'Visualizar no ML',
            disabled: !record.permalink,
          },
          record.status === 'ativo'
            ? {
                key: 'pause',
                label: 'Pausar Anúncio',
                disabled: !record.produtoId || isUpdatingCurrent,
              }
            : {
                key: 'activate',
                label: 'Ativar Anúncio',
                disabled: !record.produtoId || isUpdatingCurrent,
              },
        ];

        return (
          <Dropdown
            menu={{
              items: menuItems,
              onClick: ({ key }) => {
                if (key === 'view') handleViewOnMl(record);
                if (key === 'pause' || key === 'activate') void handleToggleStatus(record);
              },
            }}
            trigger={['click']}
          >
            <Button
              type="text"
              size="small"
              icon={isUpdatingCurrent ? <LoadingOutlined spin /> : <EllipsisOutlined />}
              loading={isUpdatingCurrent}
              disabled={Boolean(updatingActionItemId && !isUpdatingCurrent)}
            />
          </Dropdown>
        );
      },
    },
  ];

  const handleTableChange: TableProps<Anuncio>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'titulo', sortOrder: 'asc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

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
            }}
            onChange={handleTableChange}
            scroll={{ x: 1310 }}
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
