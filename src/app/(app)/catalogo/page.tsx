'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input, Select, InputNumber, Button, Dropdown, Tag, Typography, Row, Col, Space, Tabs, message, Spin } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Title } = Typography;

type TabKey = 'no_catalogo' | 'elegiveis';

type NoCatalogoRow = {
  ml_item_id: string;
  title: string;
  seller_sku: string | null;
  sku_local: string | null;
  produto_id: string | null;
  catalog_product_id: string | null;
  status: string | null;
  price: number;
  available_quantity: number;
  sold_quantity: number;
  permalink: string | null;
  thumbnail: string | null;
  category_id: string | null;
  domain_id: string | null;
  catalog_listing: boolean;
  item_relations: any[] | null;
  last_updated: string | null;
};

type ElegivelRow = {
  ml_item_id: string;
  title: string;
  seller_sku: string | null;
  status: string | null;
  price: number;
  permalink: string | null;
  thumbnail: string | null;
  category_id: string | null;
  domain_id: string | null;
  catalog_product_id: string | null;
  eligibility_status: string | null;
  buy_box_eligible: boolean;
  eligibility_reason: string | null;
  variation_eligibility: Array<{ id?: number; status?: string; buy_box_eligible?: boolean }>;
  last_updated: string | null;
};

const statusMlOptions = [
  { value: 'all', label: 'Todos os status ML' },
  { value: 'active', label: 'Ativo' },
  { value: 'paused', label: 'Pausado' },
  { value: 'closed', label: 'Fechado' },
];

const eligibilityStatusOptions = [
  { value: 'all', label: 'Todos os status' },
  { value: 'READY_FOR_OPTIN', label: 'Ready for opt-in' },
  { value: 'ALREADY_OPTED_IN', label: 'Already opted-in' },
  { value: 'NOT_ELIGIBLE', label: 'Not eligible' },
  { value: 'PRODUCT_INACTIVE', label: 'Product inactive' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'COMPETING', label: 'Competing' },
];

const eligibilityColor: Record<string, string> = {
  READY_FOR_OPTIN: 'green',
  ALREADY_OPTED_IN: 'blue',
  NOT_ELIGIBLE: 'red',
  PRODUCT_INACTIVE: 'orange',
  CLOSED: 'default',
  COMPETING: 'gold',
};

export default function CatalogoPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('no_catalogo');
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();

  const [search, setSearch] = useState('');
  const [statusMl, setStatusMl] = useState('all');
  const [eligibilityStatus, setEligibilityStatus] = useState('all');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);

  const [noCatalogoData, setNoCatalogoData] = useState<NoCatalogoRow[]>([]);
  const [elegiveisData, setElegiveisData] = useState<ElegivelRow[]>([]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (search.trim()) params.set('search', search.trim());
    if (statusMl !== 'all') params.set('statusMl', statusMl);
    if (priceMin !== null) params.set('priceMin', String(priceMin));
    if (priceMax !== null) params.set('priceMax', String(priceMax));
    if (activeTab === 'elegiveis' && eligibilityStatus !== 'all') params.set('eligibilityStatus', eligibilityStatus);
    return params.toString();
  }, [activeTab, eligibilityStatus, page, pageSize, priceMax, priceMin, search, statusMl]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = activeTab === 'no_catalogo' ? '/api/catalogo/no-catalogo' : '/api/catalogo/elegiveis';
      const res = await fetch(`${endpoint}?${buildParams()}`);
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        messageApi.error(json?.erro || 'Falha ao carregar catálogo');
        if (activeTab === 'no_catalogo') setNoCatalogoData([]);
        else setElegiveisData([]);
        setTotal(0);
        return;
      }

      if (activeTab === 'no_catalogo') setNoCatalogoData(json.data || []);
      else setElegiveisData(json.data || []);

      setTotal(Number(json.total || 0));
    } catch {
      messageApi.error('Erro de conexão ao carregar catálogo');
    } finally {
      setLoading(false);
    }
  }, [activeTab, buildParams, messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, search, statusMl, eligibilityStatus, priceMin, priceMax]);

  const handleOptin = useCallback(async (row: ElegivelRow) => {
    const catalogProductId = row.catalog_product_id || '';
    if (!catalogProductId) {
      messageApi.error('Item sem catalog_product_id. Opt-in não pode ser feito automaticamente.');
      return;
    }

    const variationId = Array.isArray(row.variation_eligibility)
      ? row.variation_eligibility.find((v) => String(v.status || '').toUpperCase() === 'READY_FOR_OPTIN' && v.buy_box_eligible)?.id
      : undefined;

    const res = await fetch('/api/catalogo/optin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: row.ml_item_id, catalogProductId, variationId }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      messageApi.error(json?.erro || 'Falha ao criar anúncio de catálogo');
      return;
    }

    messageApi.success('Opt-in de catálogo executado com sucesso');
    fetchData();
  }, [fetchData, messageApi]);

  const columnsNoCatalogo: TableProps<NoCatalogoRow>['columns'] = useMemo(() => ([
    { title: 'SKU Local', dataIndex: 'sku_local', key: 'sku_local', width: 130, render: (v) => v || '—' },
    { title: 'Seller SKU', dataIndex: 'seller_sku', key: 'seller_sku', width: 130, render: (v) => v || '—' },
    { title: 'ML Item', dataIndex: 'ml_item_id', key: 'ml_item_id', width: 130, render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: 'Título', dataIndex: 'title', key: 'title', width: 300 },
    { title: 'Status ML', dataIndex: 'status', key: 'status', width: 110, render: (v) => <Tag color={v === 'active' ? 'green' : v === 'paused' ? 'orange' : 'default'}>{v || '—'}</Tag> },
    { title: 'Preço', dataIndex: 'price', key: 'price', width: 110, render: (v) => formatCurrency(Number(v || 0)) },
    { title: 'Estoque', dataIndex: 'available_quantity', key: 'available_quantity', width: 90 },
    { title: 'Vendidos', dataIndex: 'sold_quantity', key: 'sold_quantity', width: 90 },
    { title: 'Category', dataIndex: 'category_id', key: 'category_id', width: 110, render: (v) => v || '—' },
    { title: 'Domain', dataIndex: 'domain_id', key: 'domain_id', width: 120, render: (v) => v || '—' },
    { title: 'Catalog Product', dataIndex: 'catalog_product_id', key: 'catalog_product_id', width: 150, render: (v) => v || '—' },
    { title: 'Relações', dataIndex: 'item_relations', key: 'item_relations', width: 90, render: (v) => Array.isArray(v) ? v.length : 0 },
    { title: 'Atualizado', dataIndex: 'last_updated', key: 'last_updated', width: 160, render: (v) => v ? new Date(v).toLocaleString('pt-BR') : '—' },
    {
      title: 'Link', dataIndex: 'permalink', key: 'permalink', width: 90,
      render: (v) => v ? <a href={v} target="_blank" rel="noopener noreferrer">Abrir</a> : '—',
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{ items: [{ key: 'view', label: 'Ver no ML' }], onClick: ({ key }) => { if (key === 'view' && record.permalink) window.open(record.permalink, '_blank'); } }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ]), []);

  const columnsElegiveis: TableProps<ElegivelRow>['columns'] = useMemo(() => ([
    { title: 'Seller SKU', dataIndex: 'seller_sku', key: 'seller_sku', width: 130, render: (v) => v || '—' },
    { title: 'ML Item', dataIndex: 'ml_item_id', key: 'ml_item_id', width: 130, render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: 'Título', dataIndex: 'title', key: 'title', width: 300 },
    { title: 'Status ML', dataIndex: 'status', key: 'status', width: 110, render: (v) => <Tag color={v === 'active' ? 'green' : v === 'paused' ? 'orange' : 'default'}>{v || '—'}</Tag> },
    { title: 'Preço', dataIndex: 'price', key: 'price', width: 110, render: (v) => formatCurrency(Number(v || 0)) },
    { title: 'Category', dataIndex: 'category_id', key: 'category_id', width: 110, render: (v) => v || '—' },
    { title: 'Domain', dataIndex: 'domain_id', key: 'domain_id', width: 120, render: (v) => v || '—' },
    { title: 'Catalog Product', dataIndex: 'catalog_product_id', key: 'catalog_product_id', width: 160, render: (v) => v || '—' },
    {
      title: 'Elegibilidade', dataIndex: 'eligibility_status', key: 'eligibility_status', width: 170,
      render: (v) => <Tag color={eligibilityColor[String(v || '').toUpperCase()] || 'default'}>{v || '—'}</Tag>,
    },
    { title: 'Buy Box', dataIndex: 'buy_box_eligible', key: 'buy_box_eligible', width: 90, render: (v) => <Tag color={v ? 'green' : 'red'}>{v ? 'SIM' : 'NÃO'}</Tag> },
    { title: 'Motivo', dataIndex: 'eligibility_reason', key: 'eligibility_reason', width: 220, render: (v) => v || '—' },
    { title: 'Variações aptas', dataIndex: 'variation_eligibility', key: 'variation_eligibility', width: 120, render: (v) => Array.isArray(v) ? v.filter((x) => String(x?.status || '').toUpperCase() === 'READY_FOR_OPTIN').length : 0 },
    { title: 'Atualizado', dataIndex: 'last_updated', key: 'last_updated', width: 160, render: (v) => v ? new Date(v).toLocaleString('pt-BR') : '—' },
    {
      title: 'Link', dataIndex: 'permalink', key: 'permalink', width: 90,
      render: (v) => v ? <a href={v} target="_blank" rel="noopener noreferrer">Abrir</a> : '—',
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              { key: 'view', label: 'Ver no ML' },
              { key: 'optin', label: 'Criar anúncio de catálogo' },
            ],
            onClick: ({ key }) => {
              if (key === 'view' && record.permalink) window.open(record.permalink, '_blank');
              if (key === 'optin') handleOptin(record);
            },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ]), [handleOptin]);

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Catálogo - Mercado Livre</Title>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (SKU, título, IDs)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              value={statusMl}
              onChange={setStatusMl}
              options={statusMlOptions}
              style={{ width: 180 }}
            />
          </Col>
          {activeTab === 'elegiveis' && (
            <Col>
              <Select
                value={eligibilityStatus}
                onChange={setEligibilityStatus}
                options={eligibilityStatusOptions}
                style={{ width: 210 }}
              />
            </Col>
          )}
          <Col>
            <Space.Compact>
              <InputNumber placeholder="Preço mín" value={priceMin} onChange={(v) => setPriceMin(v ?? null)} style={{ width: 120 }} />
              <InputNumber placeholder="Preço máx" value={priceMax} onChange={(v) => setPriceMax(v ?? null)} style={{ width: 120 }} />
            </Space.Compact>
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
          items={[
            {
              key: 'no_catalogo',
              label: 'No Catálogo',
              children: (
                <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 24, color: '#1677ff' }} spin />}>
                  <ResizableTable<NoCatalogoRow>
                    storageKey="catalogo-no-catalogo"
                    rowKey="ml_item_id"
                    dataSource={noCatalogoData}
                    columns={columnsNoCatalogo}
                    pagination={{
                      current: page,
                      pageSize,
                      total,
                      showSizeChanger: true,
                      onChange: (p, ps) => {
                        setPage(p);
                        setPageSize(ps || 50);
                      },
                      showTotal: (t) => `${t} anúncios`,
                    }}
                    scroll={{ x: 2000 }}
                    size="small"
                    style={{ background: 'transparent' }}
                  />
                </Spin>
              ),
            },
            {
              key: 'elegiveis',
              label: 'Elegíveis',
              children: (
                <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 24, color: '#1677ff' }} spin />}>
                  <ResizableTable<ElegivelRow>
                    storageKey="catalogo-elegiveis"
                    rowKey="ml_item_id"
                    dataSource={elegiveisData}
                    columns={columnsElegiveis}
                    pagination={{
                      current: page,
                      pageSize,
                      total,
                      showSizeChanger: true,
                      onChange: (p, ps) => {
                        setPage(p);
                        setPageSize(ps || 50);
                      },
                      showTotal: (t) => `${t} anúncios`,
                    }}
                    scroll={{ x: 2200 }}
                    size="small"
                    style={{ background: 'transparent' }}
                  />
                </Spin>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
