'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Image,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { DescriptionsProps, TableProps } from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  ExportOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SaveOutlined,
  StarFilled,
  StopOutlined,
} from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import type { ProductMlListing } from '@/lib/ml/product-listings';
import type { SupplierOfferListRow, SupplierOfferStatus } from '@/lib/products/supplier-offers';
import styles from './oferta.module.css';

const { Title, Text, Paragraph } = Typography;

type OfferDetail = {
  offer: {
    id: string;
    productId: string;
    name: string;
    supplierSku: string;
    supplierInternalSku: string | null;
    supplierProductId: string;
    supplierDsliteId: string;
    supplierName: string;
    cost: number;
    stock: number;
    leadTimeDays: number | null;
    paymentMode: string;
    active: boolean;
    priority: number;
    lastSyncAt: string | null;
    images: string[];
    description: string;
    brand: string | null;
    gtin: string | null;
    ncm: string | null;
    cest: string | null;
    status: SupplierOfferStatus;
    preferred: boolean;
    preferenceMode: 'manual' | 'automatic';
    lowestEligibleCost: number | null;
    costDeltaAmount: number | null;
    costDeltaPercent: number | null;
  };
  supplier: {
    id: string | null;
    name: string;
    legalName: string | null;
    dsliteId: string;
    active: boolean;
    statusDslite: string | null;
    dropshipping: string | null;
    crossdocking: string | null;
    lastSyncAt: string | null;
  };
  product: {
    id: string;
    sku: string;
    name: string;
    active: boolean;
    brand: string | null;
    gtin: string | null;
    ncm: string | null;
    cest: string | null;
    csosn: string | null;
    fiscalOrigin: string | null;
    originState: string | null;
    preferredOfferId: string | null;
    preferenceMode: 'manual' | 'automatic';
    mlListings: ProductMlListing[];
  };
  relatedOffers: SupplierOfferListRow[];
  sources: {
    synchronized: string;
    operational: string;
    derived: string;
    master: string;
  };
  readOnly: boolean;
  readOnlyReason: string | null;
  visualReview: Record<string, unknown> | null;
};

type OfferDraft = {
  active: boolean;
  priority: number;
  paymentMode: string;
};

type FiscalComparison = {
  key: string;
  label: string;
  offerValue: string | null;
  productValue: string | null;
};

const statusPresentation: Record<SupplierOfferStatus, { label: string; color: string; description: string }> = {
  eligible: { label: 'Elegível', color: 'success', description: 'Custo e estoque válidos para operação.' },
  out_of_stock: { label: 'Sem estoque', color: 'warning', description: 'A oferta não possui disponibilidade agora.' },
  invalid_cost: { label: 'Custo inválido', color: 'error', description: 'O custo precisa ser maior que zero.' },
  product_inactive: { label: 'Produto inativo', color: 'default', description: 'O produto mestre está inativo.' },
  offer_inactive: { label: 'Oferta inativa', color: 'default', description: 'A oferta foi desativada.' },
  historical: { label: 'Histórica', color: 'default', description: 'Registro preservado somente para consulta.' },
};

const paymentLabels: Record<string, string> = {
  prepaid_pix: 'PIX antecipado',
  postpaid: 'Pós-pago',
  balance_account: 'Conta-saldo aposentada',
};

function formatDateTime(value: string | null) {
  if (!value) return 'Não informado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(parsed);
}

function displayValue(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || 'Não informado';
}

function sameValue(left: string | null, right: string | null) {
  const normalize = (value: string | null) => String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!normalize(left) || !normalize(right)) return null;
  return normalize(left) === normalize(right);
}

function sourceLabel(label: string) {
  return <span className={styles.sourceLabel}>{label}</span>;
}

export default function ProductOfferDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const [detail, setDetail] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [activeTab, setActiveTab] = useState('offer');

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/produtos/ofertas/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Não foi possível carregar a oferta');
      setDetail(json.data || null);
      setEditing(false);
      setDraft(null);
    } catch (fetchError: any) {
      setError(fetchError?.message || 'Não foi possível carregar a oferta');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void fetchDetail();
  }, [fetchDetail, id]);

  const beginEditing = () => {
    if (!detail || detail.readOnly) return;
    setDraft({
      active: detail.offer.active,
      priority: detail.offer.priority,
      paymentMode: detail.offer.paymentMode,
    });
    setActiveTab('offer');
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(null);
    setEditing(false);
  };

  const hasChanges = Boolean(detail && draft && (
    draft.active !== detail.offer.active
    || draft.priority !== detail.offer.priority
    || draft.paymentMode !== detail.offer.paymentMode
  ));

  const persistChanges = async () => {
    if (!detail || !draft || !hasChanges) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { offerId: detail.offer.id };
      if (draft.active !== detail.offer.active) payload.ativo = draft.active;
      if (draft.priority !== detail.offer.priority) payload.prioridade = draft.priority;
      if (draft.paymentMode !== detail.offer.paymentMode) payload.payment_mode = draft.paymentMode;
      const response = await fetch(`/api/produtos/${encodeURIComponent(detail.product.id)}/fornecedores`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Não foi possível atualizar a oferta');
      const pricingErrors = Array.isArray(json?.automatic_pricing?.errors) ? json.automatic_pricing.errors.length : 0;
      if (response.status === 207 || pricingErrors > 0) {
        message.warning(`Oferta atualizada, mas ${pricingErrors || 1} atualização automática de preço ficou pendente.`);
      } else {
        message.success('Oferta atualizada com sucesso.');
      }
      await fetchDetail();
    } catch (saveError: any) {
      message.error(saveError?.message || 'Não foi possível atualizar a oferta');
    } finally {
      setSaving(false);
    }
  };

  const confirmSave = () => {
    if (!detail || !draft || !hasChanges) return;
    const effects: string[] = [];
    if (draft.active !== detail.offer.active) effects.push('reavaliar a oferta preferencial e seu snapshot operacional');
    if (draft.paymentMode !== detail.offer.paymentMode) effects.push('usar a nova modalidade nas próximas compras');
    if (draft.priority !== detail.offer.priority) effects.push('alterar o desempate entre ofertas de mesmo custo');
    Modal.confirm({
      title: 'Salvar configurações da oferta?',
      content: effects.length > 0 ? `Esta alteração pode ${effects.join(' e ')}.` : 'Confirme a atualização da oferta.',
      okText: 'Salvar alterações',
      cancelText: 'Revisar',
      onOk: persistChanges,
    });
  };

  const fiscalRows = useMemo<FiscalComparison[]>(() => detail ? [
    { key: 'brand', label: 'Marca', offerValue: detail.offer.brand, productValue: detail.product.brand },
    { key: 'gtin', label: 'GTIN / EAN', offerValue: detail.offer.gtin, productValue: detail.product.gtin },
    { key: 'ncm', label: 'NCM', offerValue: detail.offer.ncm, productValue: detail.product.ncm },
    { key: 'cest', label: 'CEST', offerValue: detail.offer.cest, productValue: detail.product.cest },
  ] : [], [detail]);

  if (loading) return (
    <div className={styles.centerState}>
      <Spin indicator={<LoadingOutlined className={styles.loadingIcon} spin />} />
      <Text type="secondary">Carregando oferta...</Text>
    </div>
  );

  if (error || !detail) return (
    <div className={styles.centerState}>
      <StopOutlined className={styles.errorIcon} />
      <Title level={4}>{error || 'Oferta não encontrada'}</Title>
      <div className={styles.stateActions}>
        <Button onClick={fetchDetail} icon={<ReloadOutlined />}>Tentar novamente</Button>
        <Button type="primary" onClick={() => router.push('/produtos/ofertas')}>Voltar para Ofertas</Button>
      </div>
    </div>
  );

  const { offer, product, supplier, relatedOffers, sources } = detail;
  const status = statusPresentation[offer.status];
  const isFixture = Boolean(detail.visualReview);
  const costComparison = offer.lowestEligibleCost == null
    ? 'Sem outra oferta elegível para comparação'
    : Number(offer.costDeltaAmount || 0) <= 0
      ? 'Menor custo elegível'
      : `+${formatCurrency(offer.costDeltaAmount || 0)} · ${Number(offer.costDeltaPercent || 0).toLocaleString('pt-BR')}%`;

  const offerItems: DescriptionsProps['items'] = [
    { key: 'sku', label: 'SKU externo', children: displayValue(offer.supplierSku) },
    { key: 'internalSku', label: 'SKU no fornecedor', children: displayValue(offer.supplierInternalSku) },
    { key: 'supplierProduct', label: 'ID do produto DSLite', children: displayValue(offer.supplierProductId) },
    { key: 'stock', label: 'Estoque', children: `${offer.stock.toLocaleString('pt-BR')} unidades` },
    { key: 'cost', label: 'Custo', children: formatCurrency(offer.cost) },
    { key: 'lead', label: 'Prazo', children: offer.leadTimeDays == null ? 'Não informado' : `${offer.leadTimeDays} ${offer.leadTimeDays === 1 ? 'dia' : 'dias'}` },
    { key: 'active', label: 'Uso operacional', children: offer.active ? 'Oferta ativa' : 'Oferta inativa' },
    { key: 'priority', label: 'Prioridade', children: `${offer.priority} · usada somente no desempate` },
    { key: 'payment', label: 'Pagamento', children: paymentLabels[offer.paymentMode] || offer.paymentMode },
    { key: 'preference', label: 'Preferência', children: offer.preferred ? `Preferencial ${offer.preferenceMode === 'manual' ? 'manual' : 'automática'}` : 'Alternativa' },
    { key: 'sync', label: 'Última sincronização', span: 2, children: formatDateTime(offer.lastSyncAt) },
  ];

  const relatedColumns: TableProps<SupplierOfferListRow>['columns'] = [
    {
      title: 'Fornecedor e SKU', key: 'supplier', render: (_, row) => (
        <button
          className={styles.rowLink}
          type="button"
          disabled={row.offerId === offer.id}
          onClick={() => router.push(`/produtos/ofertas/${row.offerId}`)}
        >
          <strong>{row.supplierName}{row.offerId === offer.id ? ' · esta oferta' : ''}</strong>
          <span>{row.supplierSku || 'SKU não informado'}</span>
        </button>
      ),
    },
    {
      title: 'Disponibilidade', key: 'stock', width: 155, render: (_, row) => (
        <div className={styles.tableStack}>
          <strong className={row.stock > 0 ? styles.positive : styles.negative}>{row.stock} un.</strong>
          <span>{row.leadTimeDays == null ? 'Prazo não informado' : `${row.leadTimeDays} ${row.leadTimeDays === 1 ? 'dia' : 'dias'}`}</span>
        </div>
      ),
    },
    {
      title: 'Custo comparado', key: 'cost', width: 170, render: (_, row) => (
        <div className={styles.tableStack}>
          <strong>{formatCurrency(row.cost)}</strong>
          <span className={Number(row.costDeltaAmount || 0) > 0 ? styles.negative : styles.positive}>
            {row.lowestEligibleCost == null ? 'Sem base elegível' : Number(row.costDeltaAmount || 0) <= 0 ? 'Menor custo' : `+${formatCurrency(row.costDeltaAmount || 0)}`}
          </span>
        </div>
      ),
    },
    {
      title: 'Situação', key: 'status', width: 185, render: (_, row) => (
        <div className={styles.tableStack}>
          <Tag color={statusPresentation[row.status].color}>{statusPresentation[row.status].label}</Tag>
          <span className={row.preferred ? styles.preferred : undefined}>
            {row.preferred && <StarFilled />} {row.preferred ? `Preferencial ${row.preferenceMode === 'manual' ? 'manual' : 'automática'}` : 'Alternativa'}
          </span>
        </div>
      ),
    },
  ];

  const listingColumns: TableProps<ProductMlListing>['columns'] = [
    { title: 'Anúncio', dataIndex: 'itemId', key: 'itemId', render: (value, row) => <div className={styles.tableStack}><strong>{value}</strong><span>{row.type === 'catalog' ? 'Catálogo' : 'Padrão'}</span></div> },
    { title: 'Estado', dataIndex: 'status', key: 'status', width: 120, render: displayValue },
    { title: 'Preço', dataIndex: 'price', key: 'price', width: 130, render: (value) => Number(value || 0) > 0 ? formatCurrency(Number(value)) : 'Não informado' },
    { title: 'Catálogo', dataIndex: 'catalogStatus', key: 'catalogStatus', width: 145, render: (value, row) => row.type === 'catalog' ? displayValue(value) : 'Não se aplica' },
    { title: '', key: 'link', width: 52, render: (_, row) => row.permalink && !isFixture ? <Tooltip title="Abrir no Mercado Livre"><Button type="text" href={row.permalink} target="_blank" icon={<ExportOutlined />} /></Tooltip> : null },
  ];

  const fiscalColumns: TableProps<FiscalComparison>['columns'] = [
    { title: 'Campo', dataIndex: 'label', key: 'label', width: 150 },
    { title: <span>Oferta <small className={styles.columnSource}>{sources.synchronized}</small></span>, dataIndex: 'offerValue', key: 'offer', render: displayValue },
    { title: <span>Produto mestre <small className={styles.columnSource}>{sources.master}</small></span>, dataIndex: 'productValue', key: 'product', render: displayValue },
    { title: 'Comparação', key: 'comparison', width: 135, render: (_, row) => {
      const matches = sameValue(row.offerValue, row.productValue);
      if (matches === null) return <span className={styles.muted}>Incompleta</span>;
      return <span className={matches ? styles.positive : styles.negative}>{matches ? 'Coincide' : 'Divergente'}</span>;
    } },
  ];

  const tabs = [
    {
      key: 'offer',
      label: 'Oferta',
      children: <section className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div><Title level={4}>Dados da oferta</Title><Text type="secondary">Identidade e disponibilidade recebidas do fornecedor; controles operacionais ficam separados.</Text></div>
          <div className={styles.sources}>{sourceLabel(sources.synchronized)}{sourceLabel(sources.operational)}</div>
        </div>
        {editing && draft ? (
          <div className={styles.editGrid}>
            <div className={styles.readField}><span>SKU externo</span><strong>{displayValue(offer.supplierSku)}</strong><small>{sources.synchronized}</small></div>
            <div className={styles.readField}><span>Custo</span><strong>{formatCurrency(offer.cost)}</strong><small>{sources.synchronized}</small></div>
            <label className={styles.switchField}><span>Oferta ativa</span><Switch checked={draft.active} onChange={(active) => setDraft((current) => current ? { ...current, active } : current)} /><small>Pode alterar a fonte preferencial do produto.</small></label>
            <label><span>Prioridade de desempate</span><InputNumber min={0} precision={0} value={draft.priority} onChange={(priority) => setDraft((current) => current ? { ...current, priority: Number(priority ?? 100) } : current)} /><small>Usada depois do custo, apenas no desempate.</small></label>
            <label><span>Forma de pagamento</span><Select value={draft.paymentMode} onChange={(paymentMode) => setDraft((current) => current ? { ...current, paymentMode } : current)} options={[...(offer.paymentMode === 'balance_account' ? [{ value: 'balance_account', label: 'Saldo Hayamax (histórico)', disabled: true }] : []), { value: 'prepaid_pix', label: 'PIX antecipado' }, { value: 'postpaid', label: 'Pós-pago' }]} /><small>Aplicada às próximas compras desta oferta.</small></label>
          </div>
        ) : <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 3 }} items={offerItems} />}
      </section>,
    },
    {
      key: 'supplier',
      label: 'Fornecedor',
      children: <section className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div><Title level={4}>Fornecedor da oferta</Title><Text type="secondary">Situação cadastral e operacional vinculada ao identificador DSLite.</Text></div>
          {supplier.id && <Button onClick={() => router.push(`/fornecedores/${supplier.id}`)}>Abrir fornecedor</Button>}
        </div>
        <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 3 }} items={[
          { key: 'name', label: 'Nome', children: supplier.name },
          { key: 'legal', label: 'Razão social', children: displayValue(supplier.legalName) },
          { key: 'dslite', label: 'ID DSLite', children: supplier.dsliteId },
          { key: 'active', label: 'Uso operacional', children: supplier.active ? 'Ativo' : 'Inativo ou histórico' },
          { key: 'status', label: 'Estado DSLite', children: displayValue(supplier.statusDslite) },
          { key: 'sync', label: 'Última sincronização', children: formatDateTime(supplier.lastSyncAt) },
          { key: 'drop', label: 'Dropshipping', children: displayValue(supplier.dropshipping) },
          { key: 'cross', label: 'Crossdocking', children: displayValue(supplier.crossdocking) },
          { key: 'payment', label: 'Pagamento da oferta', children: paymentLabels[offer.paymentMode] || offer.paymentMode },
        ]} />
      </section>,
    },
    {
      key: 'product',
      label: 'Produto e Mercado Livre',
      children: <div className={styles.tabStack}>
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}><div><Title level={4}>Produto mestre Bentevi</Title><Text type="secondary">Cadastro interno ao qual esta oferta está vinculada.</Text></div><Button type="primary" onClick={() => router.push(`/produtos/${product.id}`)}>Abrir produto</Button></div>
          <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 3 }} items={[
            { key: 'name', label: 'Produto', span: 2, children: product.name },
            { key: 'sku', label: 'SKU Bentevi', children: product.sku },
            { key: 'active', label: 'Situação', children: product.active ? 'Ativo' : 'Inativo' },
            { key: 'preference', label: 'Regra de fornecimento', children: product.preferenceMode === 'manual' ? 'Preferência manual' : 'Automática por menor custo' },
            { key: 'current', label: 'Esta oferta', children: offer.preferred ? 'É a fonte preferencial atual' : 'É uma fonte alternativa' },
          ]} />
        </section>
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}><div><Title level={4}>Anúncios vinculados</Title><Text type="secondary">Anúncios padrão e de catálogo já persistidos para o produto mestre.</Text></div>{sourceLabel(sources.master)}</div>
          {product.mlListings.length > 0 ? <Table className={styles.detailTable} rowKey="itemId" pagination={false} columns={listingColumns} dataSource={product.mlListings} scroll={{ x: 700 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum anúncio Mercado Livre vinculado" />}
        </section>
      </div>,
    },
    {
      key: 'fiscal',
      label: 'Fiscal',
      children: <div className={styles.tabStack}>
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}><div><Title level={4}>Oferta × produto mestre</Title><Text type="secondary">Divergência é exibida para revisão; esta tela não escolhe nem sobrescreve a fonte fiscal.</Text></div></div>
          <Table className={styles.detailTable} rowKey="key" pagination={false} columns={fiscalColumns} dataSource={fiscalRows} scroll={{ x: 720 }} />
        </section>
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}><div><Title level={4}>Configuração fiscal do produto</Title><Text type="secondary">Dados mantidos no cadastro mestre da Bentevi.</Text></div>{sourceLabel(sources.master)}</div>
          <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 3 }} items={[
            { key: 'csosn', label: 'CSOSN', children: displayValue(product.csosn) },
            { key: 'origin', label: 'Origem fiscal', children: displayValue(product.fiscalOrigin) },
            { key: 'state', label: 'UF de origem', children: displayValue(product.originState) },
          ]} />
        </section>
      </div>,
    },
    {
      key: 'description',
      label: 'Descrição',
      children: <section className={styles.sectionCard}>
        <div className={styles.sectionHeader}><div><Title level={4}>Descrição recebida</Title><Text type="secondary">Conteúdo bruto específico desta oferta externa.</Text></div>{sourceLabel(sources.synchronized)}</div>
        <Paragraph className={styles.description}>{offer.description || 'A oferta não possui descrição.'}</Paragraph>
      </section>,
    },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Button className={styles.backButton} type="text" icon={<ArrowLeftOutlined />} onClick={() => router.push('/produtos/ofertas')}>Ofertas</Button>
          <Title level={2} className={styles.title}>{offer.name || 'Oferta sem nome'}</Title>
          <Text type="secondary">SKU externo {offer.supplierSku || 'não informado'} · produto {product.sku}</Text>
        </div>
        <div className={styles.headerActions}>
          <Button onClick={() => router.push(`/produtos/${product.id}`)}>Abrir produto Bentevi</Button>
          {detail.readOnly ? <Tooltip title={detail.readOnlyReason}><Button icon={<EditOutlined />} disabled>Editar</Button></Tooltip> : <Button type="primary" icon={<EditOutlined />} onClick={beginEditing} disabled={editing}>Editar</Button>}
        </div>
      </header>

      {detail.visualReview && <Alert type="warning" showIcon message="Amostra real protegida para homologação" description="Os dados foram preservados somente para avaliação visual. Navegação interna está liberada; alterações e links externos continuam bloqueados." />}
      {offer.status === 'historical' && <Alert type="info" showIcon message="Histórico somente leitura" description={detail.readOnlyReason || 'Esta oferta não aceita ações operacionais.'} />}

      {editing && draft && <section className={styles.editBar}>
        <div><strong>Editando configurações operacionais</strong><span>Nenhuma alteração é salva automaticamente.</span></div>
        <div><Button onClick={cancelEditing} disabled={saving}>Cancelar</Button><Button type="primary" icon={<SaveOutlined />} onClick={confirmSave} loading={saving} disabled={!hasChanges}>Salvar</Button></div>
      </section>}

      <section className={styles.hero}>
        <div className={styles.gallery}>
          {offer.images.length > 0 ? <Image.PreviewGroup>
            <Image className={styles.mainImage} src={offer.images[0]} alt={offer.name} />
            {offer.images.length > 1 && <div className={styles.thumbnails}>{offer.images.slice(1, 5).map((image, index) => <Image key={`${image}-${index}`} src={image} alt={`${offer.name} ${index + 2}`} />)}</div>}
          </Image.PreviewGroup> : <div className={styles.noImage}>Sem imagem</div>}
        </div>
        <div className={styles.heroContent}>
          <div className={styles.statusLine}><Tag color={status.color}>{status.label}</Tag><span className={offer.preferred ? styles.preferred : styles.muted}>{offer.preferred && <StarFilled />} {offer.preferred ? `Preferencial ${offer.preferenceMode === 'manual' ? 'manual' : 'automática'}` : 'Oferta alternativa'}</span><span className={styles.sourceLabel}>{sources.derived}</span></div>
          <div><span className={styles.eyebrow}>Fornecedor</span><Title level={3}>{offer.supplierName}</Title><Text type="secondary">{status.description}</Text></div>
          <div className={styles.metrics}>
            <div><span>Estoque</span><strong className={offer.stock > 0 ? styles.positive : styles.negative}>{offer.stock.toLocaleString('pt-BR')} un.</strong><small>{offer.leadTimeDays == null ? 'prazo não informado' : `${offer.leadTimeDays} ${offer.leadTimeDays === 1 ? 'dia' : 'dias'} de prazo`}</small></div>
            <div><span>Custo</span><strong>{formatCurrency(offer.cost)}</strong><small className={Number(offer.costDeltaAmount || 0) > 0 ? styles.negative : styles.positive}>{costComparison}</small></div>
            <div><span>Pagamento</span><strong className={styles.textMetric}>{paymentLabels[offer.paymentMode] || offer.paymentMode}</strong><small>{sources.operational}</small></div>
            <div><span>Sincronização</span><strong className={styles.textMetric}>{formatDateTime(offer.lastSyncAt)}</strong><small>{sources.synchronized}</small></div>
          </div>
        </div>
      </section>

      <Tabs className={styles.tabs} activeKey={activeTab} onChange={setActiveTab} items={tabs} />

      <section className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div><Title level={4}>Ofertas relacionadas</Title><Text type="secondary">Compare as fontes do mesmo produto sem perder o contexto da oferta atual.</Text></div>
          <span className={styles.relatedCount}>{relatedOffers.length} oferta{relatedOffers.length === 1 ? '' : 's'}</span>
        </div>
        <Table className={styles.detailTable} rowKey="offerId" pagination={false} columns={relatedColumns} dataSource={relatedOffers} scroll={{ x: 760 }} />
      </section>
    </main>
  );
}
