'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert, Breadcrumb, Button, Descriptions, Empty, Image, Input, InputNumber,
  Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, Tooltip, Typography, message,
} from 'antd';
import type { DescriptionsProps, TableProps, TabsProps } from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, LinkOutlined, LoadingOutlined,
  ReloadOutlined, SaveOutlined, StopOutlined,
} from '@ant-design/icons';
import { formatCurrency, currencyFormatter, currencyParser } from '@/lib/format';
import { calculateNetProfitAtPrice, calculateSuggestedPrice } from '@/services/pricing';
import type { Product, MLStatus } from '@/types/product';
import type { Database } from '@/types/database';
import type { ProductMlListing } from '@/lib/ml/product-listings';
import styles from './produto-detalhe.module.css';
import type { CommercialPricingConfiguration } from '@/lib/commercial-pricing';
import { resolveMlFee } from '@/lib/commercial-pricing';

const { Paragraph, Text, Title } = Typography;
const mlStatusColor: Record<MLStatus, string> = { ativo: 'green', pausado: 'orange', sem_anuncio: 'default' };
const mlStatusLabel: Record<MLStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', sem_anuncio: 'Sem anúncio' };

type ProdutoRow = Database['public']['Tables']['produtos']['Row'];
type ProductDetail = Product & {
  originFiscal: string;
  csosn: string;
  originState: string;
  supplierLastSync: string | null;
  shippingWarning: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
type KitComponent = {
  sku: string;
  nome: string;
  sku_fornecedor: string;
  quantidade: number;
  estoque: number;
  custo: number;
  oferta_encontrada: boolean;
};
type ProductSupplierOffer = Database['public']['Tables']['produto_fornecedor_ofertas']['Row'] & {
  preferred?: boolean;
  preferred_manual?: boolean;
  is_internal_stock?: boolean;
  is_kit_supplier?: boolean;
  kit_sku_origem?: string;
  kit_mapping_complete?: boolean;
  kit_components?: KitComponent[];
};
type FulfillmentCapacity = { internal: number; supplier: number; safe: number };
type VisualReviewMetadata = {
  enabled: true;
  source: 'production-read-only';
  capturedAt: string;
  expiresAt: string;
  itemCount: number;
};

function mapDBtoProduct(
  item: ProdutoRow & Record<string, any>,
  mlFeeFallbackRate: number,
): ProductDetail {
  return {
    id: String(item.id), active: item.ativo !== false, sku: String(item.sku || ''),
    name: String(item.nome || ''), brand: String(item.marca || ''),
    fornecedor: item.fornecedor_operacional || item.fornecedor || null,
    supplierId: item.dslite_fornecedor_id || null,
    supplierProductId: item.dslite_produto_id || null,
    preferredSupplierManual: Boolean(item.fornecedor_preferencial_manual),
    stock: Number(item.estoque_operacional ?? item.estoque ?? 0),
    supplierStock: Number(item.estoque_fornecedor ?? item.estoque ?? 0),
    internalStock: Number(item.estoque_interno ?? 0), cost: Number(item.custo || 0),
    mlFee: resolveMlFee(item.ml_fee, mlFeeFallbackRate), mlShipping: Number(item.ml_shipping || 0),
    customPrice: item.custom_price === null || item.custom_price === undefined ? null : Number(item.custom_price),
    mlStatus: item.ml_status_operacional || item.ml_status || 'sem_anuncio',
    mlItemId: item.ml_item_id_operacional || item.ml_item_id || null,
    netWeight: Number(item.peso_liq || 0), grossWeight: Number(item.peso_bruto || 0),
    width: Number(item.largura || 0), height: Number(item.altura || 0), depth: Number(item.profundidade || 0),
    gtin: String(item.gtin || ''), description: String(item.descricao || ''),
    images: Array.isArray(item.imagens) ? item.imagens : [], category: item.categoria || undefined,
    ncm: item.ncm || null, cest: item.cest || null,
    originFiscal: String(item.origem_fiscal || ''), csosn: String(item.csosn || ''),
    originState: String(item.origem_uf || ''), supplierLastSync: item.dslite_ultima_sync || null,
    shippingWarning: item.ml_shipping_warning || null, createdAt: item.created_at || null,
    updatedAt: item.updated_at || null,
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function paymentModeLabel(value: string | null | undefined) {
  if (value === 'prepaid_pix') return 'PIX antecipado';
  if (value === 'postpaid') return 'Pós-pago';
  if (value === 'balance_account') return 'Conta-saldo histórica';
  return 'Não informado';
}

function listingStatusLabel(status: string) {
  if (status === 'ativo') return 'Ativo';
  if (status === 'pausado') return 'Pausado';
  if (status === 'encerrado') return 'Encerrado';
  return status || 'Não informado';
}

function catalogStatusLabel(status: ProductMlListing['catalogStatus']) {
  if (status === 'ganhando') return 'Ganhando o catálogo';
  if (status === 'competindo') return 'Competindo';
  if (status === 'perdendo') return 'Fora da disputa';
  return 'Sem competição de catálogo';
}

function readValue(value: React.ReactNode, muted = false) {
  const empty = value === null || value === undefined || value === '';
  return <span className={muted || empty ? styles.mutedValue : styles.readValue}>{empty ? 'Não informado' : value}</span>;
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [original, setOriginal] = useState<ProductDetail | null>(null);
  const [pricingTaxRate, setPricingTaxRate] = useState<number | null>(null);
  const [commercialPricing, setCommercialPricing] = useState<CommercialPricingConfiguration | null>(null);
  const [capacity, setCapacity] = useState<FulfillmentCapacity>({ internal: 0, supplier: 0, safe: 0 });
  const [mlListings, setMlListings] = useState<ProductMlListing[]>([]);
  const [isKit, setIsKit] = useState(false);
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [supplierOffers, setSupplierOffers] = useState<ProductSupplierOffer[]>([]);
  const [supplierSelectionMode, setSupplierSelectionMode] = useState<'automatic' | 'manual'>('automatic');
  const [preferredSupplierOfferId, setPreferredSupplierOfferId] = useState<string | null>(null);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChanges = useMemo(
    () => Boolean(product && original && JSON.stringify(product) !== JSON.stringify(original)),
    [product, original],
  );

  const fetchDetail = useCallback(async () => {
    setLoading(true); setError(null); setOffersError(null);
    try {
      const [productResponse, offersResponse] = await Promise.all([
        fetch(`/api/produtos/${id}`), fetch(`/api/produtos/${id}/fornecedores`),
      ]);
      const productJson = await productResponse.json().catch(() => ({}));
      if (!productResponse.ok) throw new Error(productJson.error || productJson.erro || 'Erro ao buscar produto');
      const mapped = mapDBtoProduct(
        productJson.data,
        Number(productJson?.commercialPricing?.mlFeeFallbackRate),
      );
      setProduct(mapped); setOriginal(mapped);
      setPricingTaxRate(typeof productJson?.pricingTaxContext?.appliedRate === 'number' ? productJson.pricingTaxContext.appliedRate : null);
      setCommercialPricing(productJson?.commercialPricing || null);
      setCapacity({
        internal: Number(productJson?.fulfillmentCapacity?.internal || 0),
        supplier: Number(productJson?.fulfillmentCapacity?.supplier || 0),
        safe: Number(productJson?.fulfillmentCapacity?.safe || 0),
      });
      setMlListings(Array.isArray(productJson.mlListings) ? productJson.mlListings : []);
      setIsKit(productJson.isKit === true);
      setVisualReview(productJson?.visualReview?.enabled === true ? productJson.visualReview : null);
      const offersJson = await offersResponse.json().catch(() => ({}));
      if (!offersResponse.ok) {
        setSupplierOffers([]);
        setOffersError(offersJson.error || 'Não foi possível carregar as ofertas deste produto.');
      } else {
        setSupplierOffers(Array.isArray(offersJson.data) ? offersJson.data : []);
        setSupplierSelectionMode(offersJson.selection_mode === 'manual' ? 'manual' : 'automatic');
        setPreferredSupplierOfferId(offersJson.preferred_offer_id ? String(offersJson.preferred_offer_id) : null);
      }
    } catch (fetchError: any) {
      setError(fetchError?.message || 'Erro ao carregar produto');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void fetchDetail(); }, [fetchDetail]);
  useEffect(() => {
    const preventUnsavedExit = (event: BeforeUnloadEvent) => {
      if (!isEditing || !hasChanges) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnsavedExit);
    return () => window.removeEventListener('beforeunload', preventUnsavedExit);
  }, [hasChanges, isEditing]);

  const patch = (diff: Partial<ProductDetail>) => setProduct((current) => current ? { ...current, ...diff } : current);
  const resetEditing = () => { setProduct(original ? { ...original } : original); setIsEditing(false); };
  const confirmDiscard = (onConfirm: () => void) => {
    if (!isEditing || !hasChanges) return onConfirm();
    Modal.confirm({
      title: 'Descartar alterações?', content: 'As mudanças ainda não foram salvas.',
      okText: 'Descartar', cancelText: 'Continuar editando', okButtonProps: { danger: true }, onOk: onConfirm,
    });
  };
  const handleBack = () => confirmDiscard(() => router.push('/produtos'));
  const handleCancel = () => confirmDiscard(resetEditing);

  const performSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/produtos/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: product.sku, ativo: product.active, nome: product.name, marca: product.brand,
          gtin: product.gtin, estoque: product.supplierStock ?? product.stock, custo: product.cost,
          ml_shipping: product.mlShipping, ml_fee: product.mlFee, peso_liq: product.netWeight,
          peso_bruto: product.grossWeight, largura: product.width, altura: product.height,
          profundidade: product.depth, descricao: product.description, ncm: product.ncm,
          cest: product.cest, origem_fiscal: product.originFiscal, csosn: product.csosn,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Erro ao salvar produto');
      if (json.warning) message.warning(json.warning);
      else if (json.queued_publish) message.success('Produto salvo e atualização do Mercado Livre enfileirada.');
      else message.success('Produto salvo com sucesso.');
      setIsEditing(false); await fetchDetail();
    } catch (saveError: any) { message.error(saveError?.message || 'Erro ao salvar produto'); }
    finally { setSaving(false); }
  };

  const handleSave = () => {
    if (!product || !original || !hasChanges) return;
    const effects: string[] = [];
    if (original.active && !product.active) effects.push('pausar o anúncio operacional vinculado');
    if (Number(original.supplierStock || 0) !== Number(product.supplierStock || 0)) effects.push('recalcular e publicar a quantidade segura');
    if (effects.length === 0) return void performSave();
    Modal.confirm({
      title: 'Confirmar alterações operacionais', content: `Ao salvar, o sistema irá ${effects.join(' e ')}.`,
      okText: 'Salvar alterações', cancelText: 'Revisar', onOk: performSave,
    });
  };

  const persistPreferredSupplier = async (value: string) => {
    setSavingSupplier(true);
    try {
      const automatic = value === 'automatic';
      const response = await fetch(`/api/produtos/${id}/fornecedores`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(automatic ? { selectionMode: 'automatic' } : { selectionMode: 'manual', offerId: value }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Erro ao alterar fornecedor preferencial');
      message.success(automatic ? 'Seleção automática por menor custo ativada.' : 'Fornecedor preferencial definido manualmente.');
      await fetchDetail();
    } catch (supplierError: any) { message.error(supplierError?.message || 'Erro ao alterar fornecedor preferencial'); }
    finally { setSavingSupplier(false); }
  };

  const requestPreferredSupplier = (value: string) => {
    const automatic = value === 'automatic';
    const offer = supplierOffers.find((item) => String(item.id) === value);
    Modal.confirm({
      title: automatic ? 'Ativar seleção automática?' : 'Alterar fornecedor preferencial?',
      content: automatic ? 'A oferta válida de menor custo passará a ser escolhida automaticamente.' : `${offer?.fornecedor_nome || offer?.dslite_fornecedor_id || 'A oferta selecionada'} prevalecerá enquanto continuar válida.`,
      okText: 'Confirmar', cancelText: 'Cancelar', onOk: () => persistPreferredSupplier(value),
    });
  };

  if (loading) return <div className={styles.centerState}><Spin indicator={<LoadingOutlined className={styles.loadingIcon} spin />} /><Text type="secondary">Carregando produto...</Text></div>;
  if (error || !product) return <div className={styles.centerState}><StopOutlined className={styles.errorIcon} /><Title level={4}>{error || 'Produto não encontrado'}</Title><Button type="primary" onClick={() => router.push('/produtos')}>Voltar para Produtos</Button></div>;
  if (pricingTaxRate === null || !commercialPricing) return <Alert type="error" showIcon message="Precificação indisponível" description="Não é possível apresentar a precificação com segurança enquanto a configuração fiscal ou comercial estiver indisponível." />;

  const suggestedPrice = calculateSuggestedPrice({ cost: product.cost, shipping: product.mlShipping, mlFee: product.mlFee, taxRate: pricingTaxRate, costTiers: commercialPricing.costTiers }).suggestedPrice;
  const displayPrice = product.customPrice ?? suggestedPrice;
  const profit = calculateNetProfitAtPrice({ price: displayPrice, cost: product.cost, shipping: product.mlShipping, mlFee: product.mlFee, taxRate: pricingTaxRate });
  const margin = displayPrice > 0 ? (profit / displayPrice) * 100 : 0;
  const effectiveListings: ProductMlListing[] = mlListings.length > 0 ? mlListings : product.mlItemId ? [{ itemId: product.mlItemId, type: 'standard', status: product.mlStatus, price: displayPrice, permalink: null, catalogStatus: 'sem_catalogo' }] : [];
  const kitSupplierOffer = supplierOffers.find((offer) => offer.is_kit_supplier);
  const currentSupplier = supplierOffers.find((offer) => offer.preferred) || supplierOffers.find((offer) => String(offer.id) === preferredSupplierOfferId) || null;
  const categoryItems = product.category ? product.category.split(' > ').map((name) => ({ title: name })) : [];

  const cadastroItems: DescriptionsProps['items'] = [
    { key: 'sku', label: 'SKU Bentevi', children: readValue(product.sku) },
    { key: 'brand', label: 'Marca', children: readValue(product.brand) },
    { key: 'gtin', label: 'GTIN / EAN', children: readValue(product.gtin) },
    { key: 'active', label: 'Situação', children: readValue(product.active ? 'Ativo' : 'Inativo') },
    { key: 'created', label: 'Criado em', children: readValue(formatDateTime(product.createdAt), true) },
    { key: 'updated', label: 'Última alteração', children: readValue(formatDateTime(product.updatedAt), true) },
    { key: 'category', label: 'Categoria', span: 3, children: categoryItems.length > 0 ? <Breadcrumb items={categoryItems} /> : readValue(null) },
  ];

  const offerColumns: TableProps<ProductSupplierOffer>['columns'] = [
    { title: 'Fornecedor', key: 'supplier', width: 220, render: (_, offer) => <div className={styles.tablePrimary}><strong>{offer.fornecedor_nome || offer.dslite_fornecedor_id || 'Não informado'}</strong><span>{offer.is_internal_stock ? 'Origem interna' : `ID DSLite ${offer.dslite_fornecedor_id || '—'}`}</span></div> },
    { title: 'SKU externo', key: 'sku', width: 165, render: (_, offer) => offer.is_internal_stock ? '—' : (offer.sku_fornecedor || offer.sku_oferta || '—') },
    { title: 'Estoque', dataIndex: 'estoque', width: 95, render: (value) => <strong className={Number(value || 0) > 0 ? styles.positiveText : styles.negativeText}>{Number(value || 0)}</strong> },
    { title: 'Custo', dataIndex: 'custo', width: 115, render: (value, offer) => offer.is_internal_stock ? '—' : formatCurrency(Number(value || 0)) },
    { title: 'Prazo', dataIndex: 'lead_time_dias', width: 90, render: (value) => value === null || value === undefined ? '—' : `${value} dia${Number(value) === 1 ? '' : 's'}` },
    { title: 'Pagamento', dataIndex: 'payment_mode', width: 145, render: (value, offer) => offer.is_internal_stock ? '—' : paymentModeLabel(value) },
    { title: 'Última sincronização', dataIndex: 'last_sync_at', width: 170, render: (value, offer) => offer.is_internal_stock ? 'Saldo atual' : formatDateTime(value) },
    { title: 'Uso atual', key: 'current', width: 165, render: (_, offer) => <span className={offer.preferred ? styles.currentOffer : styles.alternativeOffer}>{offer.is_internal_stock ? 'Prioridade interna' : offer.is_kit_supplier ? (offer.kit_mapping_complete ? 'Origem do kit' : 'Kit incompleto') : offer.preferred ? (offer.preferred_manual ? 'Preferência manual' : 'Menor custo') : offer.ativo === false ? 'Inativa' : 'Alternativa'}</span> },
  ];
  const kitColumns: TableProps<KitComponent>['columns'] = [
    { title: 'Componente', dataIndex: 'nome', key: 'name', render: (value, row) => <div className={styles.tablePrimary}><strong>{value}</strong><span>SKU Bentevi {row.sku}</span></div> },
    { title: 'SKU fornecedor', dataIndex: 'sku_fornecedor', key: 'supplierSku', width: 170, render: (value) => value || '—' },
    { title: 'Quantidade', dataIndex: 'quantidade', key: 'quantity', width: 105 },
    { title: 'Estoque', dataIndex: 'estoque', key: 'stock', width: 95 },
    { title: 'Custo unitário', dataIndex: 'custo', key: 'cost', width: 135, render: (value) => formatCurrency(Number(value || 0)) },
    { title: 'Mapeamento', dataIndex: 'oferta_encontrada', key: 'mapping', width: 120, render: (value) => <span className={value ? styles.positiveText : styles.negativeText}>{value ? 'Completo' : 'Pendente'}</span> },
  ];

  const renderCadastro = () => <section className={styles.sectionCard}>
    <div className={styles.sectionHeader}><div><Title level={4}>Cadastro mestre</Title><Text type="secondary">Identidade própria da Bentevi, independente do fornecedor.</Text></div></div>
    {isEditing ? <div className={styles.formGrid}>
      <label className={styles.fullField}><span>Nome do produto</span><Input value={product.name} onChange={(event) => patch({ name: event.target.value })} /></label>
      <label><span>SKU Bentevi</span><Input value={product.sku} onChange={(event) => patch({ sku: event.target.value })} /></label>
      <label><span>Marca</span><Input value={product.brand} onChange={(event) => patch({ brand: event.target.value })} /></label>
      <label><span>GTIN / EAN</span><Input value={product.gtin} onChange={(event) => patch({ gtin: event.target.value })} /></label>
      <label className={styles.switchField}><span>Produto ativo</span><Switch checked={product.active} onChange={(active) => patch({ active })} /><small>Ao inativar, o anúncio operacional vinculado será pausado após a confirmação.</small></label>
      <div className={styles.fullField}><span className={styles.fieldLabel}>Categoria</span>{categoryItems.length > 0 ? <Breadcrumb items={categoryItems} /> : readValue(null)}</div>
    </div> : <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 3 }} items={cadastroItems} />}
  </section>;

  const renderFornecimento = () => <div className={styles.tabStack}>
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div><Title level={4}>Fonte preferencial</Title><Text type="secondary">Estoque interno prevalece; sem saldo interno, vale a escolha abaixo.</Text></div>
        <div className={styles.supplierSelector}><span>Regra de escolha</span><Select
          value={supplierSelectionMode === 'manual' && preferredSupplierOfferId ? preferredSupplierOfferId : 'automatic'}
          onChange={requestPreferredSupplier} loading={savingSupplier}
          disabled={Boolean(visualReview) || savingSupplier || Boolean(kitSupplierOffer)}
          options={[{ value: 'automatic', label: 'Automático · menor custo' }, ...supplierOffers.filter((offer) => !offer.is_internal_stock && !offer.is_kit_supplier).map((offer) => ({ value: String(offer.id), label: `${offer.fornecedor_nome || offer.dslite_fornecedor_id} · ${formatCurrency(Number(offer.custo || 0))}`, disabled: offer.ativo === false || !(Number(offer.custo) > 0) }))]}
        /></div>
      </div>
      {offersError ? <Alert type="warning" showIcon message="Ofertas indisponíveis" description={offersError} /> : null}
      <Table<ProductSupplierOffer> className={styles.detailTable} rowKey="id" size="middle" pagination={false} dataSource={supplierOffers} columns={offerColumns} scroll={{ x: 1160 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma oferta vinculada" /> }} />
    </section>
    {kitSupplierOffer ? <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}><div><Title level={4}>Composição do kit</Title><Text type="secondary">Pedido e nota fiscal usam estes componentes multiplicados pela quantidade.</Text></div><span className={kitSupplierOffer.kit_mapping_complete ? styles.currentOffer : styles.dangerPill}>{kitSupplierOffer.kit_mapping_complete ? 'Mapeamento completo' : 'Mapeamento incompleto'}</span></div>
      <Table<KitComponent> className={styles.detailTable} rowKey={(row) => `${row.sku}-${row.sku_fornecedor}`} size="middle" pagination={false} dataSource={kitSupplierOffer.kit_components || []} columns={kitColumns} scroll={{ x: 850 }} />
    </section> : null}
  </div>;

  const renderCommercial = () => <div className={styles.tabStack}>
    <section className={styles.capacityBand} aria-label="Composição da disponibilidade">
      <div className={styles.capacityPrimary}><span>Q segura</span><strong>{capacity.safe}</strong><small>quantidade publicável</small></div>
      <div><span>Estoque interno</span><strong>{capacity.internal}</strong><small>saldo físico liberado</small></div>
      <div><span>Fornecedor</span><strong>{capacity.supplier}</strong><small>oferta operacional</small></div>
      <div><span>Fonte atual</span><strong className={styles.textMetric}>{capacity.internal > 0 ? 'Estoque interno' : currentSupplier?.fornecedor_nome || product.fornecedor || 'Não definida'}</strong><small>{product.preferredSupplierManual ? 'preferência manual' : 'seleção automática'}</small></div>
    </section>
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}><div><Title level={4}>Custo e publicação</Title><Text type="secondary">Custo e estoque refletem a fonte preferencial quando houver oferta vinculada.</Text></div></div>
      {isEditing ? <div className={styles.formGrid}>
        <label><span>Custo atual</span><InputNumber value={product.cost} onChange={(value) => patch({ cost: value ?? 0 })} formatter={currencyFormatter} parser={currencyParser} step={0.5} /></label>
        <label><span>Estoque do fornecedor</span><InputNumber value={product.supplierStock} onChange={(value) => patch({ supplierStock: value ?? 0 })} min={0} disabled={capacity.internal > 0} /></label>
        <label><span>Frete Mercado Livre</span><InputNumber value={product.mlShipping} onChange={(value) => patch({ mlShipping: value ?? 0 })} formatter={currencyFormatter} parser={currencyParser} step={0.5} /></label>
        <label><span>Taxa Mercado Livre</span><InputNumber suffix="%" value={product.mlFee * 100} onChange={(value) => patch({ mlFee: (value ?? 0) / 100 })} min={0} max={100} /></label>
      </div> : <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 4 }} items={[
        { key: 'cost', label: 'Custo atual', children: readValue(formatCurrency(product.cost)) },
        { key: 'supplierStock', label: 'Estoque do fornecedor', children: readValue(String(product.supplierStock || 0)) },
        { key: 'shipping', label: 'Frete ML', children: readValue(formatCurrency(product.mlShipping)) },
        { key: 'fee', label: 'Taxa ML', children: readValue(`${(product.mlFee * 100).toFixed(2).replace('.', ',')}%`) },
      ]} />}
      {product.shippingWarning ? <Alert className={styles.inlineAlert} type="warning" showIcon message="Frete precisa de revisão" description={product.shippingWarning} /> : null}
      <div className={styles.priceSummary}>
        <div><span>Preço atual</span><strong>{formatCurrency(displayPrice)}</strong><small>{product.customPrice === null ? 'calculado pela regra central' : 'personalizado'}</small></div>
        <div><span>Preço calculado</span><strong>{formatCurrency(suggestedPrice)}</strong><small>referência automática</small></div>
        <div className={profit >= 0 ? styles.profitBox : styles.lossBox}><span>Lucro líquido</span><strong>{formatCurrency(profit)}</strong><small>{margin.toFixed(2).replace('.', ',')}% de margem</small></div>
      </div>
    </section>
  </div>;

  const renderLogisticsFiscal = () => <div className={styles.tabStack}>
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}><div><Title level={4}>Peso e dimensões</Title><Text type="secondary">Medidas usadas nas operações logísticas e de publicação.</Text></div></div>
      {isEditing ? <div className={styles.formGridFive}>
        <label><span>Peso líquido</span><InputNumber suffix="kg" value={product.netWeight} onChange={(value) => patch({ netWeight: value ?? 0 })} precision={3} step={0.01} /></label>
        <label><span>Peso bruto</span><InputNumber suffix="kg" value={product.grossWeight} onChange={(value) => patch({ grossWeight: value ?? 0 })} precision={3} step={0.01} /></label>
        <label><span>Largura</span><InputNumber suffix="cm" value={product.width} onChange={(value) => patch({ width: value ?? 0 })} precision={1} step={0.5} /></label>
        <label><span>Altura</span><InputNumber suffix="cm" value={product.height} onChange={(value) => patch({ height: value ?? 0 })} precision={1} step={0.5} /></label>
        <label><span>Profundidade</span><InputNumber suffix="cm" value={product.depth} onChange={(value) => patch({ depth: value ?? 0 })} precision={1} step={0.5} /></label>
      </div> : <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 5 }} items={[
        { key: 'net', label: 'Peso líquido', children: readValue(`${product.netWeight} kg`) }, { key: 'gross', label: 'Peso bruto', children: readValue(`${product.grossWeight} kg`) },
        { key: 'width', label: 'Largura', children: readValue(`${product.width} cm`) }, { key: 'height', label: 'Altura', children: readValue(`${product.height} cm`) }, { key: 'depth', label: 'Profundidade', children: readValue(`${product.depth} cm`) },
      ]} />}
    </section>
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}><div><Title level={4}>Dados fiscais</Title><Text type="secondary">Classificação local usada na emissão e na publicação.</Text></div></div>
      {isEditing ? <div className={styles.formGrid}>
        <label><span>NCM</span><Input value={product.ncm || ''} onChange={(event) => patch({ ncm: event.target.value || null })} /></label>
        <label><span>CEST</span><Input value={product.cest || ''} onChange={(event) => patch({ cest: event.target.value || null })} /></label>
        <label><span>Origem fiscal</span><Input value={product.originFiscal} onChange={(event) => patch({ originFiscal: event.target.value })} /></label>
        <label><span>CSOSN</span><Input value={product.csosn} onChange={(event) => patch({ csosn: event.target.value })} /></label>
        <div><span className={styles.fieldLabel}>UF de origem</span>{readValue(product.originState)}</div>
      </div> : <Descriptions className={styles.descriptions} column={{ xs: 1, sm: 2, lg: 5 }} items={[
        { key: 'ncm', label: 'NCM', children: readValue(product.ncm) }, { key: 'cest', label: 'CEST', children: readValue(product.cest) },
        { key: 'origin', label: 'Origem fiscal', children: readValue(product.originFiscal) }, { key: 'csosn', label: 'CSOSN', children: readValue(product.csosn) }, { key: 'uf', label: 'UF de origem', children: readValue(product.originState) },
      ]} />}
    </section>
  </div>;

  const renderMercadoLivre = () => <section className={styles.sectionCard}>
    <div className={styles.sectionHeader}><div><Title level={4}>Anúncios vinculados</Title><Text type="secondary">Anúncios padrão e de catálogo continuam independentes, mas pertencem ao mesmo produto.</Text></div><Tag color={mlStatusColor[product.mlStatus]}>{mlStatusLabel[product.mlStatus]}</Tag></div>
    {effectiveListings.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Este produto ainda não possui anúncio vinculado" /> : <div className={styles.listingGrid}>{effectiveListings.map((listing) => <article className={styles.listingCard} key={listing.itemId}>
      <div className={styles.listingHeader}><div><span>{listing.type === 'catalog' ? 'Anúncio de catálogo' : 'Anúncio padrão'}</span><strong>{listing.itemId}</strong></div><Tag color={listing.status === 'ativo' ? 'green' : listing.status === 'pausado' ? 'orange' : 'default'}>{listingStatusLabel(listing.status)}</Tag></div>
      <Descriptions className={styles.descriptions} column={1} size="small" items={[
        { key: 'price', label: 'Preço observado', children: readValue(formatCurrency(listing.price || displayPrice)) },
        ...(listing.type === 'catalog' ? [
          { key: 'catalogProduct', label: 'Produto de catálogo', children: readValue(listing.catalogProductId) },
          { key: 'competition', label: 'Competição', children: readValue(catalogStatusLabel(listing.catalogStatus)) },
          { key: 'priceToWin', label: 'Preço para ganhar', children: listing.priceToWin === null || listing.priceToWin === undefined ? readValue(null) : readValue(formatCurrency(listing.priceToWin)) },
        ] : []),
        { key: 'related', label: 'Anúncio relacionado', children: readValue(listing.relatedItemId) },
      ]} />
      {listing.permalink && !visualReview ? <Button type="link" icon={<LinkOutlined />} href={listing.permalink} target="_blank" rel="noreferrer">Abrir no Mercado Livre</Button> : visualReview ? <Text type="secondary">Link externo desabilitado na amostra protegida.</Text> : null}
    </article>)}</div>}
  </section>;

  const renderDescription = () => <section className={styles.sectionCard}>
    <div className={styles.sectionHeader}><div><Title level={4}>Descrição do produto</Title><Text type="secondary">Conteúdo cadastral completo, sem truncamento.</Text></div></div>
    {isEditing ? <Input.TextArea value={product.description} onChange={(event) => patch({ description: event.target.value })} rows={14} /> : product.description ? <Paragraph className={styles.descriptionText}>{product.description}</Paragraph> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Descrição não cadastrada" />}
  </section>;

  const tabs: TabsProps['items'] = [
    { key: 'cadastro', label: 'Cadastro', children: renderCadastro() },
    { key: 'fornecimento', label: `Fornecimento (${supplierOffers.length})`, children: renderFornecimento() },
    { key: 'comercial', label: 'Comercial e estoque', children: renderCommercial() },
    { key: 'logistica', label: 'Logística e fiscal', children: renderLogisticsFiscal() },
    { key: 'mercado-livre', label: `Mercado Livre (${effectiveListings.length})`, children: renderMercadoLivre() },
    { key: 'descricao', label: 'Descrição', children: renderDescription() },
  ];

  return <div className={styles.page}>
    {visualReview ? <Alert className={styles.visualReviewAlert} type="warning" showIcon message="Amostra real de produção, somente leitura" description="Este detalhe usa dados protegidos para aprovação visual. Edição, troca de fornecedor e links externos estão desabilitados." /> : null}
    <header className={styles.stickyHeader}>
      <div className={styles.headerIdentity}><Button aria-label="Voltar para Produtos" type="text" icon={<ArrowLeftOutlined />} onClick={handleBack} /><div><div className={styles.headerMeta}><span>SKU {product.sku}</span>{isKit ? <span className={styles.kitPill}>Kit</span> : null}<span className={product.active ? styles.activeState : styles.inactiveState}><i />{product.active ? 'Ativo' : 'Inativo'}</span></div><Title level={3}>{product.name}</Title></div></div>
      <Space><Tooltip title="Recarregar dados do produto"><Button aria-label="Atualizar produto" icon={<ReloadOutlined />} onClick={() => void fetchDetail()} /></Tooltip><Button type="primary" icon={<EditOutlined />} disabled={Boolean(visualReview) || isEditing} onClick={() => setIsEditing(true)}>Editar produto</Button></Space>
    </header>
    <section className={styles.hero}>
      <div className={styles.gallery}>
        <div className={styles.mainImage}><Image src={product.images[0]} alt={product.name} fallback="/branding/bentevi/bentevi-mark.png" preview={product.images.length > 0} /></div>
        {product.images.length > 1 ? <Image.PreviewGroup><div className={styles.thumbnails}>{product.images.slice(1).map((url, index) => <Image key={`${url}-${index}`} src={url} alt={`${product.name} ${index + 2}`} />)}</div></Image.PreviewGroup> : null}
        <span className={styles.imageCount}>{product.images.length} imagem{product.images.length === 1 ? '' : 'ens'}</span>
      </div>
      <div className={styles.heroSummary}>
        <div className={styles.productContext}><div><Text type="secondary">{product.brand || 'Marca não informada'}</Text><Title level={2}>{product.name}</Title><div className={styles.contextMeta}><span>GTIN {product.gtin || 'não informado'}</span><span>{product.category || 'Sem categoria'}</span></div></div><Tag color={mlStatusColor[product.mlStatus]}>{mlStatusLabel[product.mlStatus]}</Tag></div>
        <div className={styles.summaryBand}>
          <div className={styles.summaryHighlight}><span>Q segura</span><strong>{capacity.safe}</strong><small>I {capacity.internal} · F {capacity.supplier}</small></div>
          <div><span>Fornecedor atual</span><strong className={styles.summaryText}>{capacity.internal > 0 ? 'Estoque interno' : currentSupplier?.fornecedor_nome || product.fornecedor || 'Não definido'}</strong><small>{supplierOffers.length} oferta{supplierOffers.length === 1 ? '' : 's'}</small></div>
          <div><span>Custo</span><strong>{formatCurrency(product.cost)}</strong><small>{product.preferredSupplierManual ? 'preferência manual' : 'fonte automática'}</small></div>
          <div><span>Preço</span><strong>{formatCurrency(displayPrice)}</strong><small>{product.customPrice === null ? 'calculado' : 'personalizado'}</small></div>
          <div className={profit >= 0 ? styles.summaryProfit : styles.summaryLoss}><span>Lucro</span><strong>{formatCurrency(profit)}</strong><small>{margin.toFixed(2).replace('.', ',')}% de margem</small></div>
        </div>
      </div>
    </section>
    <Tabs className={styles.tabs} items={tabs} size="large" />
    {isEditing ? <div className={styles.editBar}><div><strong>{hasChanges ? 'Alterações pendentes' : 'Modo de edição'}</strong><span>{hasChanges ? 'Revise os dados antes de salvar.' : 'Nenhum campo foi alterado.'}</span></div><Space><Button onClick={handleCancel}>Cancelar</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!hasChanges} onClick={handleSave}>Salvar alterações</Button></Space></div> : null}
  </div>;
}
