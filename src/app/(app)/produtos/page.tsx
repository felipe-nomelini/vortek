'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Input, Select, InputNumber, Tag, Typography, Space, Spin, Drawer, Button, message, Dropdown, Row, Col, Radio, Alert, Tooltip, Segmented, Collapse, Image as AntImage, Steps, Modal,
} from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, LoadingOutlined, EllipsisOutlined, EditOutlined, PlusOutlined, StarOutlined, LinkOutlined, FilePdfOutlined, ReloadOutlined, FilterOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { calculateNetProfitAtPrice, calculateSuggestedPrice } from '@/services/pricing';
import { formatCurrency, formatPercent } from '@/lib/format';
import { useRouter } from 'next/navigation';
import type { Product, MLStatus } from '@/types/product';
import type { Database } from '@/types/database';
import ResizableTable from '@/components/ResizableTable';
import ProgressModal from '@/components/modals/ProgressModal';
import { appendRemoteSortParams, getRemoteSortOrder, type RemoteSortState, resolveRemoteSortState } from '@/lib/remote-sort';
import { useMlPricePublishTracking } from '@/hooks/useMlPricePublishTracking';
import styles from './produtos.module.css';

type ProdutoRow = Database['public']['Tables']['produtos']['Row'];
type ProdutoOfertaRow = Database['public']['Tables']['produto_fornecedor_ofertas']['Row'];

const { Title, Text } = Typography;

const mlStatusOptions: { value: MLStatus | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'pausado', label: 'Pausado' },
  { value: 'sem_anuncio', label: 'Sem Anúncio' },
];

const estoqueOptions = [
  { value: 'todos', label: 'Todos' },
  { value: 'com_estoque', label: 'Com Estoque' },
  { value: 'sem_estoque', label: 'Sem Estoque' },
];

const productActiveOptions = [
  { value: 'todos', label: 'Todos' },
  { value: 'ativo', label: 'Ativos' },
  { value: 'inativo', label: 'Inativos' },
];

const priceFieldOptions = [
  { value: 'cost', label: 'Custo' },
  { value: 'suggestedPrice', label: 'Sugerido' },
  { value: 'profit', label: 'Lucro' },
];

interface ProductMasterListItem {
  product: Product;
  mlListings: ProductMlListing[];
  preferredOffer: ProdutoOfertaRow | null;
  offersCount: number;
  fulfillmentCapacity: {
    internal: number;
    supplier: number;
    safe: number;
  };
  isKit: boolean;
  isHomologationFixture?: boolean;
}

interface ProductMlListing {
  itemId: string;
  type: 'standard' | 'catalog';
  status: string;
  price: number;
  permalink: string | null;
  catalogProductId?: string | null;
  catalogStatus?: 'ganhando' | 'competindo' | 'perdendo' | 'sem_catalogo';
  priceToWin?: number | null;
  relatedItemId?: string | null;
}

interface PriceUpdateResult {
  mlItemId: string;
  type: 'standard' | 'catalog';
  price_updated: boolean;
  queued_publish: boolean;
  outboxId?: string | null;
  error?: string | null;
}

interface VisualReviewMetadata {
  enabled: true;
  source: 'production-read-only';
  capturedAt: string;
  expiresAt: string;
  itemCount: number;
}

interface ProductRow {
  key: string;
  product: Product;
  mlListings: ProductMlListing[];
  preferredOffer: ProdutoOfertaRow | null;
  offersCount: number;
  fulfillmentCapacity: ProductMasterListItem['fulfillmentCapacity'];
  isKit: boolean;
  effectiveCost: number;
  displayPrice: number;
  profit: number | null;
  margin: number | null;
}

interface SupplierOption {
  id: string;
  label: string;
  apelido: string;
  dsliteId: string;
}

type ProductQuickView = 'ativos' | 'com_estoque' | 'sem_anuncio' | 'margem_risco' | 'inativos';

interface MlCategoryAttributeOption {
  id: string;
  name: string;
}

interface MlRequiredAttribute {
  id: string;
  name: string;
  value_type: string;
  values: MlCategoryAttributeOption[];
  required?: boolean;
  value_id?: string;
  value_name?: string;
  source_urls?: string[];
  evidence?: string;
}

interface MlCategoryOption {
  id: string;
  nome: string;
  dominio: string;
  requiredAttributes?: MlRequiredAttribute[];
}

interface MlSaleTermField {
  id: string;
  name: string;
  value_type: string;
  required: boolean;
  values: MlCategoryAttributeOption[];
  value_id?: string;
  value_name?: string;
  source_urls?: string[];
  evidence?: string;
}

interface CategorySchemaResponse {
  required_attributes: MlRequiredAttribute[];
  optional_attributes: MlRequiredAttribute[];
  sale_terms: MlSaleTermField[];
  fiscal_fields: {
    ncm: string;
    cest: string;
    gtin: string;
    origem_fiscal: string;
    csosn: string;
  };
  prefill: {
    description: string;
    base_price: number;
    listing_type: string;
  };
}

type MlCreateListingResult = {
  success?: boolean;
  linked_existing?: boolean;
  error?: string;
  warnings?: string[];
  steps?: Record<string, { ok: boolean; error?: string }>;
  anuncio?: {
    id?: string;
    title?: string;
    price?: number;
    permalink?: string;
    status?: string;
    sub_status?: string[];
  };
  quantity_pricing?: boolean;
  pricing_correction?: {
    initial_price?: number;
    final_price?: number | null;
    ml_shipping?: number | null;
    ml_fee?: number | null;
    status?: 'not_needed' | 'corrected' | 'pending';
    error?: string;
    outbox_id?: string;
  };
  fiscal?: 'ok' | string[];
  fiscal_details?: Array<{
    step?: string;
    statusHttp?: number | null;
    endpoint?: string | null;
    error?: string;
    fields?: Array<{ field: string; message: string; error_code: string }> | null;
  }>;
  missing_required_attributes?: Array<{ id: string; name: string }>;
};

const DEPENDENT_FIELDS: Record<string, string[]> = {
  WITH_CLOSING: ['CLASP_TYPE'],
  WITH_GEMSTONE: ['GEMSTONE_TYPE', 'GEMSTONE_COLOR'],
};
const FALSE_VALUE_IDS = new Set(['242084']);

function isNegativeChoice(valueId?: string, valueName?: string) {
  const txt = String(valueName || '').trim().toLowerCase();
  return FALSE_VALUE_IDS.has(String(valueId || '')) || txt === 'não' || txt === 'nao' || txt === 'false';
}

function withNotApplicableOption(values: MlCategoryAttributeOption[] = []) {
  return values;
}

function isNotApplicableOptionName(value: unknown) {
  const text = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return text.includes('nao se aplica') || text.includes('nao aplicavel') || text === 'n/a';
}

function sanitizeMlFieldValue(value: unknown) {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return !raw || normalized === 'null' || normalized === 'undefined' || normalized === 'n/a' || normalized === 'na'
    ? ''
    : raw;
}

function findOfficialNotApplicableOption(values: MlCategoryAttributeOption[] = []) {
  return values.find((value) => isNotApplicableOptionName(value.name)) || null;
}

function formatWeightFromKg(weightKg: number) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return '';
  const grams = Math.round(weightKg * 1000);
  return grams >= 1000 ? `${String(weightKg).replace('.', ',')} kg` : `${grams} g`;
}

function priceToEditableText(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
  return String(Math.round(Number(value) * 100) / 100).replace('.', ',');
}

function parseEditablePriceText(input: string): number | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot >= 0 ? '.' : '';
  const normalized = decimalSeparator
    ? cleaned
      .replace(new RegExp(`\\${decimalSeparator === ',' ? '.' : ','}`, 'g'), '')
      .replace(decimalSeparator, '.')
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function computeDerived(item: Product | ProductMasterListItem, taxRate: number | null): { displayPrice: number; profit: number | null } {
  const product = 'product' in item ? item.product : item;
  const cost = 'preferredOffer' in item
    ? Number(item.preferredOffer?.custo ?? item.product.cost)
    : item.cost;
  try {
    if (taxRate === null) throw new Error('Alíquota tributária indisponível');
    const result = calculateSuggestedPrice({
      cost,
      shipping: product.mlShipping,
      mlFee: product.mlFee,
      taxRate,
    });
    const displayPrice = Math.round((product.customPrice ?? result.suggestedPrice) * 100) / 100;

    // Sem anúncio vinculado: não exibimos lucro operacional.
    if (product.mlStatus === 'sem_anuncio') {
      return { displayPrice, profit: null };
    }

    const netProfit = calculateNetProfitAtPrice({
      price: displayPrice,
      cost,
      shipping: product.mlShipping,
      mlFee: product.mlFee,
      taxRate,
    });

    return { displayPrice, profit: Math.round(netProfit * 100) / 100 };
  } catch {
    return { displayPrice: Math.round((product.customPrice ?? cost) * 100) / 100, profit: null };
  }
}

const mlStatusColor: Record<MLStatus, string> = { ativo: 'green', pausado: 'orange', sem_anuncio: 'default' };
const mlStatusLabel: Record<MLStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', sem_anuncio: 'Sem Anúncio' };

function mapDBtoProduct(item: ProdutoRow): Product {
  return {
    id: item.id,
    active: item.ativo !== false,
    sku: item.sku,
    name: item.nome,
    brand: item.marca || '',
    fornecedor: item.fornecedor || null,
    supplierId: item.dslite_fornecedor_id || null,
    supplierProductId: item.dslite_produto_id || null,
    preferredSupplierManual: item.fornecedor_preferencial_manual === true,
    stock: item.estoque || 0,
    cost: item.custo || 0,
    mlFee: item.ml_fee || 0.15,
    mlShipping: Number(item.ml_shipping ?? 0),
    customPrice: item.custom_price,
    mlStatus: item.ml_status || 'sem_anuncio',
    mlItemId: item.ml_item_id || null,
    netWeight: item.peso_liq || 0,
    grossWeight: item.peso_bruto || 0,
    width: item.largura || 0,
    height: item.altura || 0,
    depth: item.profundidade || 0,
    gtin: item.gtin || '',
    description: item.descricao || '',
    images: item.imagens || [],
    category: item.categoria || undefined,
    ncm: item.ncm || null,
    cest: item.cest || null,
  };
}

function renderMlShipping(shipping: number, mlStatus: MLStatus) {
  const hasInvalidShipping = mlStatus !== 'sem_anuncio' && Number(shipping || 0) <= 0;
  if (hasInvalidShipping) return <Tag color="red">Frete inválido</Tag>;
  return formatCurrency(Number(shipping || 0));
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductMasterListItem[]>([]);
  const [pricingTaxRate, setPricingTaxRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'sku', sortOrder: 'asc' });

  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [filterMLStatus, setFilterMLStatus] = useState<MLStatus | ''>('');
  const [filterFornecedores, setFilterFornecedores] = useState<string[]>([]);
  const [fornecedorOptions, setFornecedorOptions] = useState<SupplierOption[]>([]);
  const [filterProductActive, setFilterProductActive] = useState<string>('ativo');
  const [filterEstoque, setFilterEstoque] = useState<string>('');
  const [priceField, setPriceField] = useState<string>('cost');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [visualReview, setVisualReview] = useState<VisualReviewMetadata | null>(null);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const {
    hasOpenTracking: hasOpenMlPublishTracking,
    startTracking: startMlPublishTracking,
    progressModalProps: mlPublishProgressModalProps,
  } = useMlPricePublishTracking(messageApi);
  const [updatingPriceProductId, setUpdatingPriceProductId] = useState<string | null>(null);
  const [priceModal, setPriceModal] = useState<{
    open: boolean;
    record: ProductRow | null;
    value: number | null;
    saving: boolean;
    results: PriceUpdateResult[];
    error: string | null;
  }>({ open: false, record: null, value: null, saving: false, results: [], error: null });
  const productsRequestRef = useRef(0);
  const statsRequestRef = useRef(0);
  const [mlModalPriceText, setMlModalPriceText] = useState('');
  const [mlModal, setMlModal] = useState<{
    open: boolean;
    produtoId: string;
    nome: string;
    product: Product | null;
    categorias: MlCategoryOption[];
    selectedCategory: string | null;
    editablePrice: number | null;
    editableFiscal: {
      ncm: string;
      cest: string;
      gtin: string;
      origem_fiscal: string;
      csosn: string;
    };
    editableAttributes: MlRequiredAttribute[];
    optionalAttributes: MlRequiredAttribute[];
    saleTerms: MlSaleTermField[];
    description: string;
    categorySchemaCache: Record<string, CategorySchemaResponse>;
    suggestingFieldId: string | null;
    suggestingRequiredBulk: boolean;
    suggestingOptionalBulk: boolean;
    suggestingSmartFill: boolean;
    loading: boolean;
    result: MlCreateListingResult | null;
  }>({
    open: false,
    produtoId: '',
    nome: '',
    product: null,
    categorias: [],
    selectedCategory: null,
    editablePrice: null,
    editableFiscal: { ncm: '', cest: '', gtin: '', origem_fiscal: '0', csosn: '' },
    editableAttributes: [],
    optionalAttributes: [],
    saleTerms: [],
    description: '',
    categorySchemaCache: {},
    suggestingFieldId: null,
    suggestingRequiredBulk: false,
    suggestingOptionalBulk: false,
    suggestingSmartFill: false,
    loading: false,
    result: null,
  });

  const [stats, setStats] = useState({ total: 0, comEstoque: 0, semAnuncio: 0, lucroMedio: 0, receitaPotencial: 0 });

  useEffect(() => {
    const skuFromUrl = new URLSearchParams(window.location.search).get('search')?.trim() || '';
    if (!skuFromUrl) return;
    setSearch(skuFromUrl);
    setLastSearch(skuFromUrl);
    setPage(1);
  }, []);

  const applyDependencyRules = useCallback((modalState: typeof mlModal) => {
    const requiredMap = new Map(modalState.editableAttributes.map((a) => [a.id, a]));
    const optionalMap = new Map(modalState.optionalAttributes.map((a) => [a.id, a]));

    for (const [parentId, children] of Object.entries(DEPENDENT_FIELDS)) {
      const parent = requiredMap.get(parentId) || optionalMap.get(parentId);
      if (!parent) continue;
      if (!isNegativeChoice(parent.value_id, parent.value_name)) continue;

      for (const childId of children) {
        if (requiredMap.has(childId)) {
          const current = requiredMap.get(childId)!;
          const notApplicable = findOfficialNotApplicableOption(current.values || []);
          requiredMap.set(childId, {
            ...current,
            value_id: notApplicable?.id || '',
            value_name: notApplicable?.name || '',
          });
        }
        if (optionalMap.has(childId)) {
          const current = optionalMap.get(childId)!;
          const notApplicable = findOfficialNotApplicableOption(current.values || []);
          optionalMap.set(childId, {
            ...current,
            value_id: notApplicable?.id || '',
            value_name: notApplicable?.name || '',
          });
        }
      }
    }

    return {
      ...modalState,
      editableAttributes: Array.from(requiredMap.values()),
      optionalAttributes: Array.from(optionalMap.values()),
    };
  }, []);

  const abrirCriarAnuncioML = async (product: Product) => {
    const derived = computeDerived(product, pricingTaxRate);
    const basePrice = product.customPrice ?? derived.displayPrice;
    setMlModal({
      open: true,
      produtoId: product.id,
      nome: product.name,
      product,
      categorias: [],
      selectedCategory: null,
      editablePrice: basePrice,
      editableFiscal: {
        ncm: product.ncm || '',
        cest: product.cest || '',
        gtin: product.gtin || '',
        origem_fiscal: '0',
        csosn: '',
      },
      editableAttributes: [],
      optionalAttributes: [],
      saleTerms: [],
      description: product.description || '',
      categorySchemaCache: {},
      suggestingFieldId: null,
      suggestingRequiredBulk: false,
      suggestingOptionalBulk: false,
      suggestingSmartFill: false,
      loading: true,
      result: null,
    });
    setMlModalPriceText(priceToEditableText(basePrice));
    try {
      const res = await fetch('/api/ml/anuncio/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: product.id }),
      });
      const data = await res.json();
      if (data.categorias) {
        setMlModal(prev => ({ ...prev, categorias: data.categorias as MlCategoryOption[], loading: false }));
      } else {
        messageApi.error(data.error || 'Erro ao buscar categorias');
        setMlModal(prev => ({ ...prev, open: false }));
      }
    } catch {
      messageApi.error('Erro ao conectar');
      setMlModal(prev => ({ ...prev, open: false }));
    }
  };

  const loadCategorySchema = async (categoryId: string) => {
    if (!mlModal.produtoId) return;

    const cached = mlModal.categorySchemaCache[categoryId];
    if (cached) {
      setMlModalPriceText(priceToEditableText(cached.prefill.base_price));
      setMlModal(prev => ({
        ...prev,
        selectedCategory: categoryId,
        editableAttributes: cached.required_attributes.map((a) => ({
          id: a.id, name: a.name, value_type: a.value_type, values: a.values || [], value_id: a.value_id || '', value_name: a.value_name || '',
        })),
        optionalAttributes: cached.optional_attributes,
        saleTerms: cached.sale_terms,
        editableFiscal: cached.fiscal_fields,
        editablePrice: cached.prefill.base_price,
        description: cached.prefill.description || prev.description,
      }));
      return;
    }

    setMlModal(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/ml/anuncio/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: mlModal.produtoId,
          categoriaId: categoryId,
          listingType: 'gold_pro',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.schema) {
        messageApi.error(data?.error || 'Falha ao carregar schema da categoria');
        setMlModal(prev => ({ ...prev, loading: false }));
        return;
      }

      const schema = data.schema as CategorySchemaResponse;
      setMlModalPriceText(priceToEditableText(schema.prefill.base_price));
      setMlModal(prev => ({
        ...prev,
        loading: false,
        selectedCategory: categoryId,
        categorySchemaCache: { ...prev.categorySchemaCache, [categoryId]: schema },
        editableAttributes: schema.required_attributes.map((a) => ({
          id: a.id, name: a.name, value_type: a.value_type, values: a.values || [], value_id: a.value_id || '', value_name: a.value_name || '',
        })),
        optionalAttributes: schema.optional_attributes,
        saleTerms: schema.sale_terms,
        editableFiscal: schema.fiscal_fields,
        editablePrice: schema.prefill.base_price,
        description: schema.prefill.description || prev.description,
      }));
    } catch {
      messageApi.error('Erro ao carregar schema da categoria');
      setMlModal(prev => ({ ...prev, loading: false }));
    }
  };

  const sugerirCampoIA = async (field: { id: string; name: string; value_type?: string; values?: MlCategoryAttributeOption[] }, target: 'required' | 'optional' | 'sale_term' | 'description', index?: number) => {
    if (!mlModal.produtoId || !mlModal.selectedCategory) return;
    setMlModal(prev => ({ ...prev, suggestingFieldId: `${target}:${field.id}` }));
    try {
      const res = await fetch('/api/ml/anuncio/sugerir-campo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: mlModal.produtoId,
          categoriaId: mlModal.selectedCategory,
          field: {
            id: field.id,
            name: field.name,
            value_type: field.value_type,
            allowed_values: field.values || [],
          },
          target,
          currentForm: {
            required_attributes: mlModal.editableAttributes,
            optional_attributes: mlModal.optionalAttributes,
            sale_terms: mlModal.saleTerms,
            fiscal: mlModal.editableFiscal,
            description: mlModal.description,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        messageApi.warning(data?.error || (data?.ignored ? 'Sem evidência confiável para preencher este atributo.' : 'Não foi possível sugerir valor'));
        return;
      }
      const suggestion = data.suggestion || {};
      const suggestionValueId = sanitizeMlFieldValue(suggestion.value_id);
      const suggestionValueName = sanitizeMlFieldValue(suggestion.value_name);
      const generatedDescription = String(suggestionValueName || '').trim();

      if (target === 'description' && generatedDescription) {
        const saveRes = await fetch(`/api/produtos/${mlModal.produtoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descricao: generatedDescription }),
        });
        const saveData = await saveRes.json().catch(() => ({}));
        if (!saveRes.ok) {
          messageApi.warning(saveData?.error || 'Descrição gerada, mas não foi possível salvar no produto.');
        } else {
          messageApi.success('Descrição melhorada e salva no produto.');
          setProducts((prev) => prev.map((item) => (
            item.product.id === mlModal.produtoId
              ? { ...item, product: { ...item.product, description: generatedDescription } }
              : item
          )));
        }
      }

      setMlModal(prev => {
        if (target === 'required' && typeof index === 'number') {
          const next = [...prev.editableAttributes];
          next[index] = {
            ...next[index],
            value_id: suggestionValueId,
            value_name: suggestionValueName,
            source_urls: suggestion.source_urls || [],
            evidence: suggestion.evidence || '',
          };
          return applyDependencyRules({ ...prev, editableAttributes: next });
        }
        if (target === 'optional' && typeof index === 'number') {
          const next = [...prev.optionalAttributes];
          next[index] = {
            ...next[index],
            value_id: suggestionValueId,
            value_name: suggestionValueName,
            source_urls: suggestion.source_urls || [],
            evidence: suggestion.evidence || '',
          };
          return applyDependencyRules({ ...prev, optionalAttributes: next });
        }
        if (target === 'sale_term' && typeof index === 'number') {
          const next = [...prev.saleTerms];
          next[index] = {
            ...next[index],
            value_id: suggestionValueId,
            value_name: suggestionValueName,
            source_urls: suggestion.source_urls || [],
            evidence: suggestion.evidence || '',
          };
          return { ...prev, saleTerms: next };
        }
        if (target === 'description') {
          return {
            ...prev,
            description: generatedDescription || prev.description,
            product: prev.product ? { ...prev.product, description: generatedDescription || prev.product.description } : prev.product,
          };
        }
        return prev;
      });
      if (suggestion.source_urls?.length) {
        messageApi.success(`Sugestão aplicada com ${suggestion.source_urls.length} fonte(s).`);
      }
    } catch {
      messageApi.warning('Falha ao solicitar sugestão da IA');
    } finally {
      setMlModal(prev => ({ ...prev, suggestingFieldId: null }));
    }
  };

  const sugerirSecaoIA = async (section: 'required' | 'optional') => {
    if (!mlModal.produtoId || !mlModal.selectedCategory) return;

    const currentRequired = mlModal.editableAttributes;
    const currentOptional = mlModal.optionalAttributes;
    const requiredDefs = mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes || [];

    type CandidateField = {
      id: string;
      name: string;
      value_type?: string;
      values?: MlCategoryAttributeOption[];
      index: number;
    };

    const candidates: CandidateField[] = section === 'required'
      ? currentRequired
        .map((attr, index) => {
          const valueFilled = Boolean(attr.value_id) || Boolean(attr.value_name?.trim());
          if (valueFilled) return null;

          const def = requiredDefs.find(a => a.id === attr.id);
          return {
            id: attr.id,
            name: attr.name,
            value_type: def?.value_type || 'string',
            values: def?.values || [],
            index,
          } as CandidateField;
        })
        .filter((item): item is CandidateField => item !== null)
      : currentOptional
        .map((attr, index) => {
          const valueFilled = Boolean(attr.value_id) || Boolean(attr.value_name?.trim());
          if (valueFilled) return null;

          return {
            id: attr.id,
            name: attr.name,
            value_type: attr.value_type,
            values: attr.values || [],
            index,
          } as CandidateField;
        })
        .filter((item): item is CandidateField => item !== null);

    const alreadyFilledCount = (section === 'required' ? currentRequired : currentOptional).length - candidates.length;

    if (candidates.length === 0) {
      messageApi.info('Nenhum campo vazio para preencher nesta seção.');
      return;
    }

    setMlModal(prev => ({
      ...prev,
      suggestingRequiredBulk: section === 'required' ? true : prev.suggestingRequiredBulk,
      suggestingOptionalBulk: section === 'optional' ? true : prev.suggestingOptionalBulk,
    }));

    let successCount = 0;
    let ruleCount = 0;
    let aiResearchCount = 0;
    let officialNaCount = 0;
    let ignoredCount = 0;
    let failedCount = 0;
    let researchedCount = 0;

    try {
      for (const field of candidates) {
        try {
          const res = await fetch('/api/ml/anuncio/sugerir-campo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              produtoId: mlModal.produtoId,
              categoriaId: mlModal.selectedCategory,
              field: {
                id: field.id,
                name: field.name,
                value_type: field.value_type,
                allowed_values: field.values || [],
              },
              target: section,
              currentForm: {
                required_attributes: mlModal.editableAttributes,
                optional_attributes: mlModal.optionalAttributes,
                sale_terms: mlModal.saleTerms,
                fiscal: mlModal.editableFiscal,
                description: mlModal.description,
              },
            }),
          });

          const data = await res.json();
          if (!res.ok || !data?.success) {
            if (data?.ignored) ignoredCount += 1;
            else failedCount += 1;
            if (data?.searched_web || data?.suggestion?.searched_web) researchedCount += 1;
            continue;
          }

          const suggestion = data.suggestion || {};
          if (data?.searched_web || suggestion.searched_web) researchedCount += 1;
          const suggestionValueId = sanitizeMlFieldValue(suggestion.value_id);
          const suggestionValueName = sanitizeMlFieldValue(suggestion.value_name);
          const hasValue = Boolean(suggestionValueId) || Boolean(suggestionValueName);
          if (!hasValue) {
            ignoredCount += 1;
            continue;
          }

          setMlModal(prev => {
            if (section === 'required') {
              const next = [...prev.editableAttributes];
              next[field.index] = {
                ...next[field.index],
                value_id: suggestionValueId,
                value_name: suggestionValueName,
                source_urls: suggestion.source_urls || [],
                evidence: suggestion.evidence || '',
              };
              return applyDependencyRules({ ...prev, editableAttributes: next });
            }

            const next = [...prev.optionalAttributes];
            next[field.index] = {
              ...next[field.index],
              value_id: suggestionValueId,
              value_name: suggestionValueName,
              source_urls: suggestion.source_urls || [],
              evidence: suggestion.evidence || '',
            };
            return applyDependencyRules({ ...prev, optionalAttributes: next });
          });
          successCount += 1;
          const reason = String(suggestion.reason || '');
          if (reason === 'rule_based_not_applicable') officialNaCount += 1;
          else if (reason.startsWith('rule_based') || reason === 'ml_domain_prediction') ruleCount += 1;
          else aiResearchCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      const totalProcessado = candidates.length;
      messageApi.info(
        `Preenchimento IA (${section === 'required' ? 'obrigatórios' : 'secundários'}): ` +
        `${successCount} preenchidos (${ruleCount} regra/ML, ${aiResearchCount} IA/pesquisa, ${officialNaCount} não se aplica oficial), ` +
        `${researchedCount} pesquisados, ${ignoredCount} omitidos sem evidência, ${failedCount} falhas reais, ` +
        `${alreadyFilledCount} já preenchidos (total: ${totalProcessado}).`
      );
    } finally {
      setMlModal(prev => ({
        ...prev,
        suggestingRequiredBulk: section === 'required' ? false : prev.suggestingRequiredBulk,
        suggestingOptionalBulk: section === 'optional' ? false : prev.suggestingOptionalBulk,
      }));
    }
  };

  const preencherAnuncioInteligente = async (section?: 'required' | 'optional') => {
    if (!mlModal.produtoId || !mlModal.selectedCategory) {
      messageApi.warning('Selecione uma categoria primeiro.');
      return;
    }

    setMlModal(prev => ({
      ...prev,
      suggestingSmartFill: !section,
      suggestingRequiredBulk: section === 'required' ? true : prev.suggestingRequiredBulk,
      suggestingOptionalBulk: section === 'optional' ? true : prev.suggestingOptionalBulk,
    }));
    try {
      const res = await fetch('/api/ml/anuncio/preencher-inteligente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: mlModal.produtoId,
          categoriaId: mlModal.selectedCategory,
          required_attributes: mlModal.editableAttributes,
          optional_attributes: mlModal.optionalAttributes,
          description: mlModal.description,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        messageApi.error(data?.error || 'Falha ao preencher anúncio com IA');
        return;
      }

      setMlModal(prev => applyDependencyRules({
        ...prev,
        editableAttributes: !section || section === 'required'
          ? (Array.isArray(data.required_attributes) ? data.required_attributes : prev.editableAttributes)
          : prev.editableAttributes,
        optionalAttributes: !section || section === 'optional'
          ? (Array.isArray(data.optional_attributes) ? data.optional_attributes : prev.optionalAttributes)
          : prev.optionalAttributes,
        description: section ? prev.description : (data.description || prev.description),
        product: prev.product && data.description ? { ...prev.product, description: data.description } : prev.product,
      }));

      if (!section && data.description) {
        const saveRes = await fetch(`/api/produtos/${mlModal.produtoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descricao: data.description }),
        });
        if (saveRes.ok) {
          setProducts((prev) => prev.map((item) => (
            item.product.id === mlModal.produtoId
              ? { ...item, product: { ...item.product, description: data.description } }
              : item
          )));
        }
      }

      const summary = data.summary || {};
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      messageApi.success(
        `IA ${section ? 'da seção' : 'completa'}: ${summary.filled ?? 0} preenchidos, ${summary.corrected ?? 0} corrigidos, ${summary.empty ?? 0} sem evidência.`
      );
      if (warnings.length > 0) {
        messageApi.warning(warnings.slice(0, 3).join(' | '));
      }
    } catch {
      messageApi.error('Erro ao preencher anúncio com IA');
    } finally {
      setMlModal(prev => ({
        ...prev,
        suggestingSmartFill: false,
        suggestingRequiredBulk: section === 'required' ? false : prev.suggestingRequiredBulk,
        suggestingOptionalBulk: section === 'optional' ? false : prev.suggestingOptionalBulk,
      }));
    }
  };

  const confirmarCriarAnuncio = async () => {
    if (!mlModal.product?.sku?.trim()) {
      messageApi.warning('Produto sem SKU. Preencha o SKU antes de criar o anúncio.');
      return;
    }
    if (!mlModal.selectedCategory) {
      messageApi.warning('Selecione uma categoria primeiro');
      return;
    }

    const requiredAttrs = mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes || [];
    const missingAttrs = mlModal.editableAttributes.filter(a => !a.value_id && !a.value_name?.trim());
    if (requiredAttrs.length > 0 && missingAttrs.length > 0) {
      messageApi.warning(`Preencha os atributos obrigatórios: ${missingAttrs.map(a => a.name).join(', ')}`);
      return;
    }

    setMlModal(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/ml/anuncio/criar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: mlModal.produtoId,
          categoriaId: mlModal.selectedCategory,
          listingType: 'gold_pro',
          basePrice: mlModal.editablePrice,
          fiscal: mlModal.editableFiscal,
          description: mlModal.description,
          attributes: [...mlModal.editableAttributes, ...mlModal.optionalAttributes].map(attr => ({
            id: attr.id,
            value_id: attr.value_id,
            value_name: attr.value_name,
          })),
          sale_terms: mlModal.saleTerms.map(term => ({
            id: term.id,
            value_id: term.value_id,
            value_name: term.value_name,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMlModal(prev => ({ ...prev, loading: false, result: data }));
        await Promise.all([fetchProducts(), fetchStats()]);
      } else {
        setMlModal(prev => ({ ...prev, loading: false, result: data }));
        if (Array.isArray(data.missing_required_attributes) && data.missing_required_attributes.length > 0) {
          messageApi.error(`Atributos obrigatórios pendentes: ${data.missing_required_attributes.map((a: any) => a.name).join(', ')}`);
        } else {
          messageApi.error(data.error || 'Erro ao criar anúncio');
        }
      }
    } catch {
      messageApi.error('Erro ao criar anúncio');
      setMlModal(prev => ({ ...prev, loading: false, result: { success: false, error: 'Erro ao criar anúncio' } }));
    }
  };

  const openPriceEditor = (record: ProductRow) => {
    setPriceModal({
      open: true,
      record,
      value: record.displayPrice,
      saving: false,
      results: [],
      error: null,
    });
  };

  const submitPriceChange = async () => {
    const record = priceModal.record;
    const targetPrice = Number(priceModal.value);
    if (!record || !Number.isFinite(targetPrice) || targetPrice <= 0) {
      setPriceModal(prev => ({ ...prev, error: 'Informe um preço maior que zero.' }));
      return;
    }
    if (visualReview) {
      setPriceModal(prev => ({ ...prev, error: 'A amostra de homologação é somente leitura.' }));
      return;
    }
    if (updatingPriceProductId || hasOpenMlPublishTracking) {
      messageApi.warning('Já existe uma publicação de preço em acompanhamento.');
      return;
    }

    setUpdatingPriceProductId(record.product.id);
    setPriceModal(prev => ({ ...prev, saving: true, results: [], error: null }));
    try {
      const response = await fetch('/api/ml/anuncio/atualizar-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId: record.product.id,
          targetPrice,
          scope: 'linked',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const results: PriceUpdateResult[] = Array.isArray(payload?.results) ? payload.results : [];
      const error = response.ok ? null : (payload?.error || 'Falha ao alterar o preço no Mercado Livre.');
      setPriceModal(prev => ({ ...prev, saving: false, results, error }));

      const updated = results.filter(result => result.price_updated).length;
      const queued = results.filter(result => result.queued_publish).length;
      const failed = results.length - updated - queued;
      if (updated > 0 && failed === 0 && queued === 0) {
        messageApi.success(`Preço alterado em ${updated} anúncio${updated === 1 ? '' : 's'}.`);
      } else if (updated > 0 || queued > 0) {
        messageApi.warning(`Preço processado: ${updated} atualizado${updated === 1 ? '' : 's'}, ${queued} em fila e ${failed} com falha.`);
      } else {
        messageApi.error(error || 'Nenhum anúncio teve o preço alterado.');
      }

      const queuedResult = results.length === 1 && results[0]?.queued_publish
        ? results[0]
        : null;
      if (queuedResult?.outboxId) {
        startMlPublishTracking({
          outboxId: queuedResult.outboxId,
          produtoId: record.product.id,
          retry: () => { void submitPriceChange(); },
          onTerminal: () => { void fetchProducts(); },
        });
      }
      await fetchProducts();
    } catch {
      const error = 'Erro ao conectar com a API de atualização de preço.';
      setPriceModal(prev => ({ ...prev, saving: false, error }));
      messageApi.error(error);
    } finally {
      setUpdatingPriceProductId(null);
    }
  };

  const fetchProducts = useCallback(async () => {
    const requestId = productsRequestRef.current + 1;
    productsRequestRef.current = requestId;
    setLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      appendRemoteSortParams(params, sort);
      if (lastSearch) params.set('search', lastSearch);
      if (filterFornecedores.length > 0) params.set('fornecedores', filterFornecedores.join(','));
      params.set('ativo', filterProductActive || 'ativo');
      if (filterMLStatus) params.set('ml_status', filterMLStatus);
      if (filterEstoque) params.set('estoque', filterEstoque);
      if (priceMin !== null) params.set('priceMin', String(priceMin));
      if (priceMax !== null) params.set('priceMax', String(priceMax));
      params.set('priceField', priceField);
      const res = await fetch(`/api/produtos?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.erro || json?.error || 'Erro ao carregar produtos');
      }
      const data = json.data || [];
      const mapped: ProductMasterListItem[] = data.map((item: any) => ({
        product: mapDBtoProduct(item.product),
        mlListings: Array.isArray(item.mlListings)
          ? item.mlListings.map((listing: any) => ({
              itemId: String(listing?.itemId || '').trim().toUpperCase(),
              type: listing?.type === 'catalog' ? 'catalog' : 'standard',
              status: String(listing?.status || ''),
              price: Number(listing?.price || 0),
              permalink: String(listing?.permalink || '').trim() || null,
              catalogProductId: String(listing?.catalogProductId || '').trim() || null,
              catalogStatus: listing?.catalogStatus || 'sem_catalogo',
              priceToWin: listing?.priceToWin === null ? null : Number(listing?.priceToWin || 0),
              relatedItemId: String(listing?.relatedItemId || '').trim() || null,
            })).filter((listing: ProductMlListing) => Boolean(listing.itemId))
          : [],
        preferredOffer: item.preferredOffer ? {
          ...item.preferredOffer,
          custo: Number(item.preferredOffer.custo || 0),
          estoque: Number(item.preferredOffer.estoque || 0),
          ativo: Boolean(item.preferredOffer.ativo),
        } : null,
        offersCount: Number(item.offersCount || 0),
        fulfillmentCapacity: {
          internal: Number(item?.fulfillmentCapacity?.internal || 0),
          supplier: Number(item?.fulfillmentCapacity?.supplier || 0),
          safe: Number(item?.fulfillmentCapacity?.safe || 0),
        },
        isKit: Boolean(item.isKit),
        isHomologationFixture: item.isHomologationFixture === true,
      }));
      if (productsRequestRef.current !== requestId) return;
      setProducts(mapped);
      setTotal(json.total || 0);
      setVisualReview(json?.visualReview?.enabled === true ? json.visualReview : null);
      setPricingTaxRate(
        typeof json?.pricingTaxContext?.appliedRate === 'number'
          ? json.pricingTaxContext.appliedRate
          : null,
      );
      setFornecedorOptions(
        Array.isArray(json.fornecedores)
          ? json.fornecedores.map((item: any) => ({
            id: String(item?.id || ''),
            label: String(item?.label || item?.apelido || ''),
            apelido: String(item?.apelido || item?.label || ''),
            dsliteId: String(item?.dsliteId || ''),
          })).filter((item: SupplierOption) => item.id && item.label)
          : [],
      );
    } catch (error: any) {
      if (productsRequestRef.current !== requestId) return;
      setListError(error?.message || 'Erro ao carregar produtos');
      messageApi.error(error?.message || 'Erro ao carregar produtos');
    } finally {
      if (productsRequestRef.current !== requestId) return;
      setLoading(false);
    }
  }, [page, sort, lastSearch, filterFornecedores, filterProductActive, filterMLStatus, filterEstoque, priceMin, priceMax, priceField, messageApi]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== lastSearch) {
        setPage(1);
        setLastSearch(search);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, lastSearch]);

  useEffect(() => {
    setPage(1);
  }, [filterMLStatus, filterEstoque, filterFornecedores, filterProductActive, priceField, priceMin, priceMax]);

  const fetchStats = useCallback(async () => {
    const requestId = statsRequestRef.current + 1;
    statsRequestRef.current = requestId;
    try {
      const params = new URLSearchParams();
      if (lastSearch) params.set('search', lastSearch);
      if (filterFornecedores.length > 0) params.set('fornecedores', filterFornecedores.join(','));
      params.set('ativo', filterProductActive || 'ativo');
      if (filterMLStatus) params.set('ml_status', filterMLStatus);
      if (filterEstoque) params.set('estoque', filterEstoque);
      if (priceMin !== null) params.set('priceMin', String(priceMin));
      if (priceMax !== null) params.set('priceMax', String(priceMax));
      params.set('priceField', priceField);
      const res = await fetch(`/api/produtos/resumo?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.erro || json?.error || 'Erro ao carregar resumo de produtos');
      }
      if (statsRequestRef.current !== requestId) return;
      setStats({
        total: json.total || 0,
        comEstoque: json.comEstoque || 0,
        semAnuncio: json.semAnuncio || 0,
        lucroMedio: json.lucroMedio || 0,
        receitaPotencial: json.receitaPotencial || 0,
      });
    } catch (error: any) {
      if (statsRequestRef.current !== requestId) return;
      console.error('[produtos/page] Falha ao carregar resumo:', error?.message || error);
    }
  }, [lastSearch, filterFornecedores, filterProductActive, filterMLStatus, filterEstoque, priceMin, priceMax, priceField]);

  useEffect(() => {
    fetchProducts();
    fetchStats();
  }, [fetchProducts, fetchStats]);

  const rows: ProductRow[] = useMemo(() => {
    return products.map(item => {
      const { displayPrice, profit } = computeDerived(item, pricingTaxRate);
      const effectiveCost = Number(item.preferredOffer?.custo ?? item.product.cost ?? 0);
      return {
        key: item.product.id,
        product: item.product,
        mlListings: item.mlListings,
        preferredOffer: item.preferredOffer,
        offersCount: item.offersCount,
        fulfillmentCapacity: item.fulfillmentCapacity,
        isKit: item.isKit,
        effectiveCost,
        displayPrice,
        profit,
        margin: profit === null || displayPrice <= 0
          ? null
          : Math.round((profit / displayPrice) * 10000) / 100,
      };
    });
  }, [pricingTaxRate, products]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const params = new URLSearchParams();
      appendRemoteSortParams(params, sort);
      if (lastSearch) params.set('search', lastSearch);
      if (filterFornecedores.length > 0) params.set('fornecedores', filterFornecedores.join(','));
      if (filterMLStatus) params.set('ml_status', filterMLStatus);
      if (filterEstoque) params.set('estoque', filterEstoque);
      if (priceMin !== null) params.set('priceMin', String(priceMin));
      if (priceMax !== null) params.set('priceMax', String(priceMax));
      params.set('priceField', priceField);

      const hasExplicitFilter = Boolean(
        lastSearch
        || filterFornecedores.length > 0
        || filterProductActive
        || filterMLStatus
        || filterEstoque
        || priceMin !== null
        || priceMax !== null
      );
      params.set('ativo', filterProductActive || (hasExplicitFilter ? 'ativo' : 'todos'));

      const response = await fetch(`/api/produtos/exportar-pdf?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.erro || 'Falha ao gerar PDF dos produtos.');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const fileName = contentDisposition.match(/filename="([^"]+)"/i)?.[1] || 'produtos.pdf';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      messageApi.success('PDF dos produtos exportado.');
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao exportar PDF dos produtos.');
    } finally {
      setExportingPdf(false);
    }
  }, [
    filterEstoque,
    filterFornecedores,
    filterMLStatus,
    filterProductActive,
    lastSearch,
    messageApi,
    priceField,
    priceMax,
    priceMin,
    sort,
  ]);
  const supplierLabelByDsliteId = useMemo(
    () => new Map(fornecedorOptions.map((supplier) => [supplier.dsliteId, supplier.apelido])),
    [fornecedorOptions],
  );

  const getSupplierLabel = (record: ProductRow) => {
    const supplierId = String(record.product.supplierId || record.preferredOffer?.dslite_fornecedor_id || '');
    return supplierLabelByDsliteId.get(supplierId)
      || record.preferredOffer?.fornecedor_nome
      || record.product.fornecedor
      || 'Sem fornecedor';
  };

  const isPublishEligible = (record: ProductRow) => record.product.active
    && record.product.mlStatus === 'sem_anuncio'
    && record.fulfillmentCapacity.safe > 0;

  const displayMlListings = (record: ProductRow): ProductMlListing[] => {
    if (record.mlListings.length > 0) return record.mlListings;
    if (!record.product.mlItemId) return [];
    return [{
      itemId: record.product.mlItemId,
      type: 'standard',
      status: record.product.mlStatus,
      price: record.displayPrice,
      permalink: null,
      catalogStatus: 'sem_catalogo',
    }];
  };

  const primaryProductAction = (record: ProductRow) => {
    const hasListing = displayMlListings(record).some(listing => ['ativo', 'pausado'].includes(listing.status))
      || record.product.mlStatus !== 'sem_anuncio';
    if (isPublishEligible(record)) return { key: 'publish', label: 'Publicar no ML', icon: <PlusOutlined /> };
    if (hasListing) return { key: 'price', label: 'Alterar preço', icon: <EditOutlined /> };
    return { key: 'open', label: 'Ver produto', icon: <ArrowRightOutlined /> };
  };

  const renderProductActions = (record: ProductRow) => {
    const primary = primaryProductAction(record);
    if (visualReview) {
      return (
        <div className={styles.actionCell}>
          <Tooltip title="Ação desabilitada na amostra protegida de homologação">
            <Button size="small" disabled icon={primary.icon}>{primary.label}</Button>
          </Tooltip>
          <Tooltip title="Demais ações desabilitadas na amostra protegida">
            <Button aria-label="Mais ações do produto" size="small" disabled icon={<EllipsisOutlined />} />
          </Tooltip>
        </div>
      );
    }

    const isUpdatingCurrent = updatingPriceProductId === record.product.id;
    const primaryIcon = primary.key === 'price' && isUpdatingCurrent
      ? <LoadingOutlined spin />
      : primary.icon;
    const runAction = (key: string) => {
      if (key === 'publish') void abrirCriarAnuncioML(record.product);
      if (key === 'price') openPriceEditor(record);
      if (key === 'open' || key === 'edit') router.push(`/produtos/${record.product.id}`);
      if (key.startsWith('listing:')) {
        const itemId = key.slice('listing:'.length);
        const listing = displayMlListings(record).find(item => item.itemId === itemId);
        if (listing?.permalink) window.open(listing.permalink, '_blank', 'noopener,noreferrer');
      }
    };
    const listingActions = displayMlListings(record)
      .filter(listing => Boolean(listing.permalink))
      .map(listing => ({
        key: `listing:${listing.itemId}`,
        label: `Abrir anúncio ${listing.type === 'catalog' ? 'catálogo' : 'padrão'}`,
        icon: <LinkOutlined />,
      }));
    return (
      <div className={styles.actionCell}>
        <Button
          size="small"
          type={primary.key === 'open' ? 'default' : 'primary'}
          icon={primaryIcon}
          loading={isUpdatingCurrent}
          disabled={Boolean(updatingPriceProductId && !isUpdatingCurrent)}
          onClick={() => runAction(primary.key)}
        >
          {primary.label}
        </Button>
        <Dropdown
          menu={{
            items: [
              { key: 'edit', label: 'Editar produto', icon: <EditOutlined /> },
              ...listingActions,
            ],
            onClick: ({ key }) => runAction(key),
          }}
          trigger={['click']}
        >
          <Button aria-label="Mais ações do produto" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      </div>
    );
  };

  const columns: TableProps<ProductRow>['columns'] = [
    {
      title: 'Produto', key: 'nome', width: 350, fixed: 'left', sorter: true,
      sortOrder: getRemoteSortOrder('nome', sort),
      render: (_, record) => (
        <div className={styles.productCell}>
          <AntImage
            className={styles.productImage}
            width={54}
            height={54}
            src={record.product.images[0]}
            fallback="/branding/bentevi/bentevi-mark.png"
            preview={false}
          />
          <div className={styles.productIdentity}>
            {visualReview ? (
              <span className={styles.productNameReadonly}>{record.product.name}</span>
            ) : (
              <button className={styles.productLink} onClick={() => router.push(`/produtos/${record.product.id}`)}>
                {record.product.name}
              </button>
            )}
            <div className={styles.productMeta}>
              <span>SKU {record.product.sku}</span>
              {record.product.brand && <span>{record.product.brand}</span>}
              {record.isKit && <span className={styles.kitLabel}>Kit</span>}
            </div>
            <span className={record.product.active ? styles.activeState : styles.inactiveState}>
              <i aria-hidden />{record.product.active ? 'Ativo' : 'Inativo'}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: 'Disponibilidade', key: 'estoque', width: 175, sorter: true,
      sortOrder: getRemoteSortOrder('estoque', sort),
      render: (_, record) => (
        <div className={styles.availabilityCell}>
          <strong className={record.fulfillmentCapacity.safe > 0 ? styles.safePositive : styles.safeZero}>
            {record.fulfillmentCapacity.safe} un.
          </strong>
          <span>Q segura</span>
          <div className={styles.capacitySplit}>
            <span>Interno <b>{record.fulfillmentCapacity.internal}</b></span>
            <span>Fornecedor <b>{record.fulfillmentCapacity.supplier}</b></span>
          </div>
        </div>
      ),
    },
    {
      title: 'Fornecimento', key: 'fornecedor', width: 190, sorter: true,
      sortOrder: getRemoteSortOrder('fornecedor', sort),
      render: (_, record) => (
        <div className={styles.stackedCell}>
          <strong>{getSupplierLabel(record)}</strong>
          <span>{record.offersCount} oferta{record.offersCount === 1 ? '' : 's'}</span>
          <span>{record.product.preferredSupplierManual ? 'Preferência manual' : 'Melhor oferta automática'}</span>
        </div>
      ),
    },
    {
      title: 'Comercial', key: 'suggested_price', width: 175, sorter: true,
      sortOrder: getRemoteSortOrder('suggested_price', sort),
      render: (_, record) => (
        <div className={styles.commercialCell}>
          <strong>{formatCurrency(record.displayPrice)}</strong>
          <span>Preço {record.product.customPrice === null ? 'calculado' : 'personalizado'}</span>
          <span>Custo {formatCurrency(record.effectiveCost)}</span>
        </div>
      ),
    },
    {
      title: 'Rentabilidade', key: 'profit', width: 155, sorter: true,
      sortOrder: getRemoteSortOrder('profit', sort),
      render: (_, record) => record.profit === null ? (
        <div className={styles.stackedCell}><strong>—</strong><span>Após publicação</span></div>
      ) : (
        <div className={record.profit >= 0 ? styles.profitPositive : styles.profitNegative}>
          <strong>{formatCurrency(record.profit)}</strong>
          <span>{record.margin === null ? '—' : `${record.margin.toFixed(2).replace('.', ',')}% de margem`}</span>
        </div>
      ),
    },
    {
      title: 'Mercado Livre', key: 'ml_status', width: 215, sorter: true,
      sortOrder: getRemoteSortOrder('ml_status', sort),
      render: (_, record) => (
        <div className={styles.mlCell}>
          <Tag className={styles.mlOverallStatus} color={mlStatusColor[record.product.mlStatus]}>{mlStatusLabel[record.product.mlStatus]}</Tag>
          {displayMlListings(record).map(listing => (
            <div className={styles.mlListingLine} key={listing.itemId}>
              <i className={listing.status === 'ativo' ? styles.mlListingActive : styles.mlListingPaused} />
              <span className={styles.mlListingType}>{listing.type === 'catalog' ? 'Catálogo' : 'Padrão'}</span>
              <span className={styles.mlListingId}>{listing.itemId}</span>
              {listing.type === 'catalog' && listing.catalogStatus && listing.catalogStatus !== 'sem_catalogo' && (
                <small className={styles[`catalog_${listing.catalogStatus}`]}>
                  {listing.catalogStatus === 'ganhando' ? 'Ganhando' : listing.catalogStatus === 'competindo' ? 'Competindo' : 'Fora da disputa'}
                </small>
              )}
            </div>
          ))}
          {record.product.mlStatus !== 'sem_anuncio' && record.product.mlShipping <= 0 && (
            <span className={styles.warningText}>Frete precisa de revisão</span>
          )}
        </div>
      ),
    },
    {
      title: 'Ações', key: 'actions', width: 205, fixed: 'right',
      render: (_, record) => renderProductActions(record),
    },
  ];

  const handleTableChange: TableProps<ProductRow>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'sku', sortOrder: 'asc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

  const activeQuickView: ProductQuickView | 'personalizado' = filterProductActive === 'inativo'
    && !filterMLStatus && !filterEstoque && priceMin === null && priceMax === null
    ? 'inativos'
    : filterProductActive === 'ativo' && filterMLStatus === 'sem_anuncio'
      && !filterEstoque && priceMin === null && priceMax === null
      ? 'sem_anuncio'
      : filterProductActive === 'ativo' && !filterMLStatus && filterEstoque === 'com_estoque'
        && priceMin === null && priceMax === null
        ? 'com_estoque'
        : filterProductActive === 'ativo' && !filterMLStatus && !filterEstoque
          && priceField === 'profit' && priceMin === null && priceMax === 0
          ? 'margem_risco'
          : filterProductActive === 'ativo' && !filterMLStatus && !filterEstoque
            && priceField === 'cost' && priceMin === null && priceMax === null
            ? 'ativos'
            : 'personalizado';

  const applyQuickView = (view: ProductQuickView) => {
    setFilterProductActive(view === 'inativos' ? 'inativo' : 'ativo');
    setFilterMLStatus(view === 'sem_anuncio' ? 'sem_anuncio' : '');
    setFilterEstoque(view === 'com_estoque' ? 'com_estoque' : '');
    setPriceField(view === 'margem_risco' ? 'profit' : 'cost');
    setPriceMin(null);
    setPriceMax(view === 'margem_risco' ? 0 : null);
    setPage(1);
  };

  const clearAdvancedFilters = () => {
    setFilterFornecedores([]);
    setFilterProductActive('ativo');
    setFilterMLStatus('');
    setFilterEstoque('');
    setPriceField('cost');
    setPriceMin(null);
    setPriceMax(null);
    setPage(1);
  };

  const advancedFilterCount = filterFornecedores.length
    + (filterProductActive !== 'ativo' ? 1 : 0)
    + (filterMLStatus ? 1 : 0)
    + (filterEstoque ? 1 : 0)
    + (priceMin !== null || priceMax !== null ? 1 : 0);

  const renderAdvancedFilters = () => (
    <div className={styles.advancedFilters}>
      <label>
        <span>Situação do produto</span>
        <Select value={filterProductActive} onChange={setFilterProductActive} options={productActiveOptions} />
      </label>
      <label>
        <span>Mercado Livre</span>
        <Select value={filterMLStatus} onChange={value => setFilterMLStatus(value as MLStatus | '')} options={mlStatusOptions} />
      </label>
      <label>
        <span>Fornecedor</span>
        <Select
          mode="multiple"
          value={filterFornecedores}
          onChange={setFilterFornecedores}
          options={fornecedorOptions.map((supplier) => ({ value: supplier.id, label: supplier.label }))}
          maxTagCount="responsive"
          allowClear
          placeholder="Todos"
        />
      </label>
      <label>
        <span>Saldo operacional</span>
        <Select value={filterEstoque || 'todos'} onChange={value => setFilterEstoque(value === 'todos' ? '' : value)} options={estoqueOptions} />
      </label>
      <label className={styles.rangeFilter}>
        <span>Faixa de valor</span>
        <Space.Compact block>
          <Select value={priceField} onChange={setPriceField} options={priceFieldOptions} />
          <InputNumber placeholder="Mínimo" value={priceMin} onChange={value => setPriceMin(value ?? null)} />
          <InputNumber placeholder="Máximo" value={priceMax} onChange={value => setPriceMax(value ?? null)} />
        </Space.Compact>
      </label>
      <Button onClick={clearAdvancedFilters}>Limpar filtros</Button>
    </div>
  );

  return (
    <div className={styles.page}>
      {contextHolder}
      <header className={styles.header}>
        <div>
          <Title level={2} className={styles.title}>Produtos</Title>
          <Text type="secondary">Compare disponibilidade, fornecedor, preço, rentabilidade e publicação em uma única leitura.</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => { void fetchProducts(); void fetchStats(); }}>
            Atualizar
          </Button>
          <Button
            icon={<FilePdfOutlined />}
            loading={exportingPdf}
            onClick={() => void handleExportPdf()}
          >
            Exportar PDF
          </Button>
        </Space>
      </header>

      {visualReview && (
        <Alert
          className={styles.visualReviewAlert}
          type="warning"
          showIcon
          message="Amostra real de produção, somente leitura"
          description={`Recorte protegido com ${visualReview.itemCount} produtos para validação visual. Ações e navegação estão desabilitadas; o relatório PDF permanece disponível em modo somente leitura.`}
        />
      )}

      <Segmented<ProductQuickView | 'personalizado'>
        className={styles.quickViews}
        block
        value={activeQuickView}
        onChange={view => { if (view !== 'personalizado') applyQuickView(view); }}
        options={[
          { value: 'ativos', label: 'Ativos' },
          { value: 'com_estoque', label: 'Com estoque' },
          { value: 'sem_anuncio', label: 'Sem anúncio' },
          { value: 'margem_risco', label: 'Margem em risco' },
          { value: 'inativos', label: 'Inativos' },
        ]}
      />

      <section className={styles.summaryBand} aria-label="Resumo dos produtos filtrados">
        <div className={styles.summaryItem}><span>Produtos</span><strong>{stats.total}</strong><small>no conjunto atual</small></div>
        <div className={styles.summaryItem}><span>Com estoque</span><strong>{stats.comEstoque}</strong><small>saldo operacional</small></div>
        <div className={styles.summaryItem}><span>Sem anúncio ML</span><strong>{stats.semAnuncio}</strong><small>aguardando publicação</small></div>
        <div className={stats.lucroMedio >= 0 ? styles.summaryItem : styles.summaryDanger}>
          <span>Lucro médio</span><strong>{formatCurrency(stats.lucroMedio)}</strong><small>anúncios com cálculo</small>
        </div>
        <div className={styles.summaryHighlight}><span>Receita potencial</span><strong>{formatCurrency(stats.receitaPotencial)}</strong><small>preço × saldo operacional</small></div>
      </section>

      <section className={styles.filterBar}>
        <Input
          className={styles.searchInput}
          placeholder="Buscar por produto, SKU, GTIN ou fornecedor"
          prefix={<SearchOutlined />}
          value={search}
          onChange={event => setSearch(event.target.value)}
          allowClear
          onClear={() => { setSearch(''); setLastSearch(''); setPage(1); }}
        />
        <Button className={styles.mobileFilterButton} icon={<FilterOutlined />} onClick={() => setFiltersDrawerOpen(true)}>
          Filtros{advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ''}
        </Button>
      </section>

      <Collapse
        className={styles.desktopFilters}
        ghost
        items={[{
          key: 'filters',
          label: `Mais filtros${advancedFilterCount > 0 ? ` · ${advancedFilterCount} aplicado${advancedFilterCount === 1 ? '' : 's'}` : ''}`,
          children: renderAdvancedFilters(),
        }]}
      />

      <Spin spinning={loading} indicator={<LoadingOutlined className={styles.loadingIcon} spin />}>
        <section className={styles.tableCard}>
          {listError && (
            <Alert
              type="error"
              showIcon
              message="Falha ao carregar a lista de produtos"
              description={`${listError}. Os dados anteriores foram preservados quando disponíveis.`}
            />
          )}
          <div className={styles.desktopTable}>
            <ResizableTable<ProductRow>
              storageKey="produtos-bentevi"
              dataSource={rows}
              columns={columns}
              rowKey="key"
              pagination={{
                current: page,
                pageSize: 100,
                total,
                showSizeChanger: false,
                showTotal: (count) => `${count} produtos`,
              }}
              onChange={handleTableChange}
              scroll={{ x: 1450 }}
              size="middle"
            />
          </div>
          <div className={styles.mobileList}>
            {rows.map((record) => (
              <article className={styles.productCard} key={record.key}>
                <div className={styles.cardHeader}>
                  <AntImage width={52} height={52} src={record.product.images[0]} fallback="/branding/bentevi/bentevi-mark.png" preview={false} />
                  <div>
                    {visualReview ? (
                      <span className={styles.mobileProductNameReadonly}>{record.product.name}</span>
                    ) : (
                      <button onClick={() => router.push(`/produtos/${record.product.id}`)}>{record.product.name}</button>
                    )}
                    <span>SKU {record.product.sku}{record.isKit ? ' · Kit' : ''}</span>
                  </div>
                  <Tag color={mlStatusColor[record.product.mlStatus]}>{mlStatusLabel[record.product.mlStatus]}</Tag>
                </div>
                <div className={styles.cardMetrics}>
                  <div><span>Q segura</span><strong>{record.fulfillmentCapacity.safe}</strong><small>I {record.fulfillmentCapacity.internal} · F {record.fulfillmentCapacity.supplier}</small></div>
                  <div><span>Fornecedor</span><strong>{getSupplierLabel(record)}</strong><small>{record.offersCount} oferta{record.offersCount === 1 ? '' : 's'}</small></div>
                  <div><span>Preço</span><strong>{formatCurrency(record.displayPrice)}</strong><small>Custo {formatCurrency(record.effectiveCost)}</small></div>
                  <div><span>Lucro</span><strong className={record.profit !== null && record.profit < 0 ? styles.negativeText : styles.positiveText}>{record.profit === null ? '—' : formatCurrency(record.profit)}</strong><small>{record.margin === null ? 'Após publicação' : `${record.margin.toFixed(2).replace('.', ',')}%`}</small></div>
                </div>
                {displayMlListings(record).length > 0 && (
                  <div className={styles.mobileMlListings}>
                    {displayMlListings(record).map(listing => (
                      <span key={listing.itemId}>
                        {listing.type === 'catalog' ? 'Catálogo' : 'Padrão'} · {listing.itemId}
                      </span>
                    ))}
                  </div>
                )}
                {renderProductActions(record)}
              </article>
            ))}
            {!loading && rows.length === 0 && <Text type="secondary">Nenhum produto encontrado.</Text>}
          </div>
        </section>
      </Spin>

      <Drawer
        title="Filtros de produtos"
        open={filtersDrawerOpen}
        onClose={() => setFiltersDrawerOpen(false)}
        width="min(92vw, 460px)"
        footer={<Button type="primary" block onClick={() => setFiltersDrawerOpen(false)}>Ver produtos</Button>}
      >
        {renderAdvancedFilters()}
      </Drawer>

      <ProgressModal {...mlPublishProgressModalProps} />

      <Modal
        title={priceModal.record ? `Alterar preço — ${priceModal.record.product.sku}` : 'Alterar preço'}
        open={priceModal.open}
        onCancel={() => setPriceModal(prev => ({ ...prev, open: false }))}
        onOk={() => { void submitPriceChange(); }}
        okText={priceModal.results.length > 0 ? 'Aplicar novamente' : 'Aplicar nos anúncios'}
        cancelText="Fechar"
        confirmLoading={priceModal.saving}
        okButtonProps={{ disabled: Boolean(visualReview) }}
        destroyOnClose
      >
        {priceModal.record && (() => {
          const record = priceModal.record;
          const value = Number(priceModal.value || 0);
          const previewProfit = pricingTaxRate === null || value <= 0
            ? null
            : calculateNetProfitAtPrice({
                price: value,
                cost: record.effectiveCost,
                shipping: record.product.mlShipping,
                mlFee: record.product.mlFee,
                taxRate: pricingTaxRate,
              });
          const previewMargin = previewProfit === null || value <= 0
            ? null
            : Math.round((previewProfit / value) * 10000) / 100;
          const suggestedPrice = pricingTaxRate === null
            ? record.displayPrice
            : calculateSuggestedPrice({
                cost: record.effectiveCost,
                shipping: record.product.mlShipping,
                mlFee: record.product.mlFee,
                taxRate: pricingTaxRate,
              }).suggestedPrice;
          const listings = displayMlListings(record).filter(listing => ['ativo', 'pausado'].includes(listing.status));
          return (
            <div className={styles.priceModalContent}>
              <div className={styles.priceModalProduct}>
                <strong>{record.product.name}</strong>
                <span>Um único preço será aplicado a todos os anúncios vinculados.</span>
              </div>
              <label className={styles.priceInputLabel}>
                <span>Novo preço de venda</span>
                <InputNumber
                  value={priceModal.value}
                  onChange={value => setPriceModal(prev => ({ ...prev, value: value ?? null, results: [], error: null }))}
                  min={0.01}
                  precision={2}
                  decimalSeparator=","
                  prefix="R$"
                  autoFocus
                  className={styles.priceInput}
                />
              </label>
              <div className={styles.pricePreview}>
                <div><span>Custo</span><strong>{formatCurrency(record.effectiveCost)}</strong></div>
                <div><span>Preço sugerido</span><strong>{formatCurrency(suggestedPrice)}</strong></div>
                <div>
                  <span>Lucro estimado</span>
                  <strong className={previewProfit !== null && previewProfit < 0 ? styles.negativeText : styles.positiveText}>
                    {previewProfit === null ? '—' : formatCurrency(previewProfit)}
                  </strong>
                </div>
                <div><span>Margem</span><strong>{previewMargin === null ? '—' : `${previewMargin.toFixed(2).replace('.', ',')}%`}</strong></div>
              </div>
              {previewProfit !== null && previewProfit < 0 && (
                <Alert type="warning" showIcon message="Este preço gera prejuízo" description="A alteração continua permitida, mas revise custo, frete e taxas antes de confirmar." />
              )}
              <div className={styles.priceListingTargets}>
                <strong>Anúncios que receberão o preço</strong>
                {listings.map(listing => (
                  <div key={listing.itemId}>
                    <span>{listing.type === 'catalog' ? 'Catálogo' : 'Padrão'} · {listing.itemId}</span>
                    <small>Atual {formatCurrency(listing.price)}</small>
                  </div>
                ))}
              </div>
              {priceModal.error && <Alert type="error" showIcon message="Preço não aplicado" description={priceModal.error} />}
              {priceModal.results.length > 0 && (
                <div className={styles.priceResults}>
                  {priceModal.results.map(result => (
                    <div key={result.mlItemId}>
                      <span>{result.type === 'catalog' ? 'Catálogo' : 'Padrão'} · {result.mlItemId}</span>
                      <strong className={result.price_updated ? styles.positiveText : result.queued_publish ? styles.pendingText : styles.negativeText}>
                        {result.price_updated ? 'Atualizado' : result.queued_publish ? 'Em fila' : 'Falhou'}
                      </strong>
                      {result.error && <small>{result.error}</small>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Drawer
        title={`Publicar no Mercado Livre — ${mlModal.nome}`}
        open={mlModal.open}
        onClose={() => setMlModal(prev => ({ ...prev, open: false }))}
        footer={null}
        width="min(96vw, 960px)"
        destroyOnClose={false}
      >
        {!mlModal.result && (
          <Steps
            className={styles.publishSteps}
            size="small"
            current={!mlModal.selectedCategory ? 0 : mlModal.editableAttributes.some(attribute => !attribute.value_id && !attribute.value_name?.trim()) ? 1 : 2}
            items={[
              { title: 'Categoria' },
              { title: 'Atributos' },
              { title: 'Conteúdo e fiscal' },
              { title: 'Revisão' },
            ]}
          />
        )}
        {mlModal.result ? (() => {
          const result = mlModal.result;
          const anuncio = result.anuncio || {};
          const warnings = Array.isArray(result.warnings) ? result.warnings : [];
          const fiscalDetails = Array.isArray(result.fiscal_details) ? result.fiscal_details : [];
          const pricingCorrection = result.pricing_correction;
          const fiscalOk = result.fiscal === 'ok';
          const imagePending = Array.isArray(anuncio.sub_status) && anuncio.sub_status.includes('picture_download_pending');
          const created = Boolean(result.success && anuncio.id);
          const statusText = !result.success
            ? 'Falhou'
            : warnings.length > 0 || !fiscalOk || imagePending
              ? 'Criado com pendências'
              : 'Criado';
          const statusType = !result.success ? 'error' : statusText === 'Criado' ? 'success' : 'warning';
          const fiscalMessage = fiscalOk
            ? 'Fiscal ML vinculado com sucesso.'
            : fiscalDetails[0]?.fields?.map((field) => `${field.field}: ${field.message}`).join(' | ')
              || (Array.isArray(result.fiscal) ? result.fiscal.join(' | ') : 'Fiscal ML pendente.');
          const visibleWarnings = warnings.filter((warning) => !/^Atributo GEMSTONE_/i.test(warning));
          const pricingStatus = pricingCorrection?.status;
          const pricingCorrectionOk = !pricingStatus || pricingStatus === 'not_needed' || pricingStatus === 'corrected';
          const descriptionStep = result.steps?.descricao;
          const descriptionOk = Boolean(descriptionStep?.ok);
          const pricingDescription = pricingCorrection
            ? [
                typeof pricingCorrection.initial_price === 'number' ? `Inicial: ${formatCurrency(pricingCorrection.initial_price)}` : null,
                typeof pricingCorrection.ml_shipping === 'number' ? `Frete ML: ${formatCurrency(pricingCorrection.ml_shipping)}` : null,
                typeof pricingCorrection.ml_fee === 'number' ? `Taxa ML: ${(pricingCorrection.ml_fee * 100).toFixed(2)}%` : null,
                typeof pricingCorrection.final_price === 'number' ? `Final: ${formatCurrency(pricingCorrection.final_price)}` : null,
                pricingCorrection.status === 'corrected' ? 'Preço corrigido automaticamente.' : null,
                pricingCorrection.status === 'not_needed' ? 'Sem ajuste necessário.' : null,
                pricingCorrection.status === 'pending' ? `Correção pendente${pricingCorrection.error ? `: ${pricingCorrection.error}` : '.'}` : null,
              ].filter(Boolean).join(' | ')
            : 'Sem ajuste de preço retornado.';

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Alert
                type={statusType}
                showIcon
                message={`Resultado do anúncio: ${statusText}`}
                description={result.error || (created ? `Anúncio ${anuncio.id} ${result.linked_existing ? 'vinculado' : 'criado'} no Mercado Livre.` : 'Não foi possível criar o anúncio.')}
              />

              {created && (
                <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                  <Title level={5} style={{ color: '#e0e0e0', marginTop: 0 }}>Anúncio</Title>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <Text style={{ color: '#a0a0a0' }}>ID: <Text style={{ color: '#e0e0e0' }}>{anuncio.id}</Text></Text>
                    <Text style={{ color: '#a0a0a0' }}>Status ML: <Text style={{ color: '#e0e0e0' }}>{anuncio.status || '—'}</Text></Text>
                    {typeof anuncio.price === 'number' && (
                      <Text style={{ color: '#a0a0a0' }}>Preço: <Text style={{ color: '#e0e0e0' }}>{formatCurrency(anuncio.price)}</Text></Text>
                    )}
                    {anuncio.permalink && (
                      <Button size="small" type="link" href={anuncio.permalink} target="_blank" style={{ padding: 0, width: 'fit-content' }}>
                        Abrir anúncio no ML
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gap: 8 }}>
                <Alert
                  type={created ? 'success' : 'error'}
                  showIcon
                  message="Anúncio"
                  description={created ? 'Item criado/vinculado no Mercado Livre.' : (result.error || 'Falha ao criar item no ML.')}
                />
                <Alert
                  type={descriptionOk ? 'success' : 'warning'}
                  showIcon
                  message="Descrição"
                  description={descriptionOk ? 'Descrição enviada ao Mercado Livre.' : (descriptionStep?.error || 'Descrição não confirmada no Mercado Livre.')}
                />
                <Alert
                  type={imagePending ? 'warning' : 'success'}
                  showIcon
                  message="Imagens"
                  description={imagePending ? 'ML está processando imagens; isso costuma liberar automaticamente.' : 'Sem pendência de imagem retornada pelo ML.'}
                />
                <Alert
                  type={pricingCorrectionOk ? 'success' : 'warning'}
                  showIcon
                  message="Preço pós-frete"
                  description={pricingDescription}
                />
                <Alert
                  type={fiscalOk ? 'success' : 'warning'}
                  showIcon
                  message="Fiscal ML"
                  description={fiscalMessage}
                />
                <Alert
                  type={result.quantity_pricing ? 'success' : 'warning'}
                  showIcon
                  message="Preços de atacado"
                  description={result.quantity_pricing ? 'Preços de atacado configurados.' : 'Preços de atacado não confirmados.'}
                />
              </div>

              {visibleWarnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="Pendências"
                  description={visibleWarnings.join(' | ')}
                />
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <Button onClick={() => router.push(`/produtos/${mlModal.produtoId}`)}>
                  Ver produto
                </Button>
                {anuncio.permalink && (
                  <Button onClick={() => window.open(anuncio.permalink, '_blank', 'noopener,noreferrer')}>
                    Abrir anúncio
                  </Button>
                )}
                <Button type="primary" onClick={() => setMlModal(prev => ({ ...prev, open: false }))}>
                  Fechar
                </Button>
              </div>
            </div>
          );
        })() : mlModal.loading && mlModal.categorias.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />
            <p style={{ marginTop: 8, color: '#a0a0a0' }}>Buscando categorias...</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Resumo do Produto */}
            {mlModal.product && (() => {
              const p = mlModal.product;
              const derived = computeDerived(p, pricingTaxRate);
              const price = mlModal.editablePrice ?? p.customPrice ?? derived.displayPrice;
              const profit = derived.profit;
              return (
                <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                  <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, marginTop: 0 }}>Resumo do Anúncio</Title>
                  <Row gutter={[16, 8]}>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Título: </Text>
                      <Text style={{ color: '#e0e0e0' }}>{p.name}{p.brand ? ` ${p.brand}` : ''}</Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>SKU: </Text>
                      <Text style={{ color: '#e0e0e0' }}>{p.sku}</Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Marca: </Text>
                      <Text style={{ color: '#e0e0e0' }}>{p.brand || '—'}</Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Estoque: </Text>
                      <Text style={{ color: p.stock === 0 ? '#ff4d4f' : '#e0e0e0' }}>{p.stock} unidades</Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Custo: </Text>
                      <Text style={{ color: '#e0e0e0' }}>{formatCurrency(p.cost)}</Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Preço: </Text>
                      <Input
                        size="small"
                        value={mlModalPriceText}
                        onChange={(event) => setMlModalPriceText(event.target.value)}
                        onFocus={() => setMlModalPriceText(priceToEditableText(mlModal.editablePrice ?? price))}
                        onBlur={() => {
                          const parsed = parseEditablePriceText(mlModalPriceText);
                          if (parsed === null || parsed <= 0) {
                            messageApi.warning('Preço do anúncio inválido.');
                            setMlModalPriceText(priceToEditableText(price));
                            return;
                          }
                          setMlModal(prev => ({ ...prev, editablePrice: parsed }));
                          setMlModalPriceText(priceToEditableText(parsed));
                        }}
                        onPressEnter={(event) => event.currentTarget.blur()}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setMlModalPriceText(priceToEditableText(price));
                            event.currentTarget.blur();
                          }
                        }}
                        style={{ width: 180 }}
                      />
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Taxa ML: </Text>
                      <Text style={{ color: '#e0e0e0' }}>{formatPercent(p.mlFee)}</Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Frete ML: </Text>
                      <Text style={{ color: '#e0e0e0' }}>{renderMlShipping(p.mlShipping, p.mlStatus)}</Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Lucro: </Text>
                      <Text style={{ color: profit !== null ? (profit >= 0 ? '#52c41a' : '#ff4d4f') : '#888', fontWeight: 600 }}>
                        {profit !== null ? formatCurrency(profit) : '—'}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Dimensões: </Text>
                      <Text style={{ color: '#e0e0e0' }}>
                        {p.height > 0 && p.width > 0 && p.depth > 0
                          ? `${p.height} × ${p.width} × ${p.depth} cm`
                          : '—'}
                        {p.grossWeight > 0 ? ` | ${formatWeightFromKg(p.grossWeight)}` : ''}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>GTIN: </Text>
                      <Input
                        size="small"
                        value={mlModal.editableFiscal.gtin}
                        onChange={(e) => setMlModal(prev => ({ ...prev, editableFiscal: { ...prev.editableFiscal, gtin: e.target.value } }))}
                      />
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>NCM: </Text>
                      <Input
                        size="small"
                        value={mlModal.editableFiscal.ncm}
                        onChange={(e) => setMlModal(prev => ({ ...prev, editableFiscal: { ...prev.editableFiscal, ncm: e.target.value } }))}
                        status={mlModal.editableFiscal.ncm ? undefined : 'error'}
                      />
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>CEST: </Text>
                      <Input
                        size="small"
                        value={mlModal.editableFiscal.cest}
                        onChange={(e) => setMlModal(prev => ({ ...prev, editableFiscal: { ...prev.editableFiscal, cest: e.target.value } }))}
                      />
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Origem fiscal: </Text>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={mlModal.editableFiscal.origem_fiscal}
                        onChange={(value) => setMlModal(prev => ({ ...prev, editableFiscal: { ...prev.editableFiscal, origem_fiscal: value } }))}
                        options={[
                          { value: '0', label: '0 - Nacional' },
                          { value: '1', label: '1 - Importação direta' },
                          { value: '2', label: '2 - Importado interno' },
                          { value: '3', label: '3 - Nacional >40% importado' },
                          { value: '4', label: '4 - Nacional PPB' },
                          { value: '5', label: '5 - Nacional <=40% importado' },
                          { value: '8', label: '8 - Nacional >70% importado' },
                        ]}
                      />
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>CSOSN: </Text>
                      <Input
                        size="small"
                        value={mlModal.editableFiscal.csosn}
                        onChange={(e) => setMlModal(prev => ({ ...prev, editableFiscal: { ...prev.editableFiscal, csosn: e.target.value } }))}
                      />
                    </Col>
                    <Col span={12}>
                      <Text style={{ color: '#888' }}>Imagens: </Text>
                      <Text style={{ color: '#e0e0e0' }}>{p.images.length} imagem{p.images.length !== 1 ? 'ns' : 'm'}</Text>
                    </Col>
                  </Row>
                </div>
              );
            })()}

            {/* Preços por Quantidade (Atacado) */}
            {mlModal.product && (
              <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, marginTop: 0 }}>Preços por Quantidade (B2B)</Title>
                <Text style={{ color: '#a0a0a0' }}>
                  As faixas percentuais serão calculadas pelo backend com as recomendações oficiais do Mercado Livre após a criação do anúncio.
                </Text>
              </div>
            )}

            {/* Avisos */}
            {mlModal.product && (() => {
              const p = mlModal.product;
              const avisos: string[] = [];
              if (!mlModal.editableFiscal.ncm) avisos.push('Produto sem NCM cadastrado. Não será possível emitir NF-e até preencher o NCM.');
              if (!mlModal.editableFiscal.cest) avisos.push('Produto sem CEST cadastrado.');
              if (!mlModal.editableFiscal.gtin) avisos.push('Produto sem GTIN cadastrado.');
              if (p.images.length === 0) avisos.push('Produto sem imagens. O anúncio será criado sem fotos.');
              if (p.stock === 0) avisos.push('Produto com estoque zero. O anúncio não será criado até haver estoque.');
              if (avisos.length === 0) return null;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {avisos.map((aviso, idx) => (
                    <Alert key={idx} type="warning" message={aviso} showIcon style={{ background: '#2b2111', borderColor: '#d48806' }} />
                  ))}
                </div>
              );
            })()}

            {/* Seleção de Categoria */}
            <div>
              <Text style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 8, display: 'block' }}>
                Selecione a categoria mais adequada para este anúncio:
              </Text>
              <Radio.Group
                value={mlModal.selectedCategory}
                onChange={e => {
                  const selectedId = e.target.value;
                  void loadCategorySchema(selectedId);
                }}
                style={{ width: '100%' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mlModal.categorias.map((cat) => (
                    <div
                      key={cat.id}
                      style={{
                        padding: '10px 12px',
                        background: '#1a1a1a',
                        border: '1px solid #303030',
                        borderRadius: 6,
                        cursor: 'pointer',
                      }}
                      onClick={() => { void loadCategorySchema(cat.id); }}
                    >
                      <Radio value={cat.id} style={{ color: '#e0e0e0' }}>
                        <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{cat.nome}</span>
                        <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{cat.dominio}</div>
                      </Radio>
                    </div>
                  ))}
                </div>
              </Radio.Group>
            </div>

            {mlModal.selectedCategory && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  type="primary"
                  icon={<StarOutlined />}
                  loading={mlModal.suggestingSmartFill}
                  disabled={mlModal.suggestingRequiredBulk || mlModal.suggestingOptionalBulk || Boolean(mlModal.suggestingFieldId)}
                  onClick={() => void preencherAnuncioInteligente()}
                >
                  Preencher anúncio com IA
                </Button>
              </div>
            )}

            {/* Atributos obrigatórios da categoria */}
            {mlModal.selectedCategory && mlModal.editableAttributes.length > 0 && (
              <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <Title level={5} style={{ color: '#e0e0e0', margin: 0 }}>Atributos Obrigatórios</Title>
                  <Button
                    size="small"
                    onClick={() => void preencherAnuncioInteligente('required')}
                    loading={mlModal.suggestingRequiredBulk}
                    disabled={
                      !mlModal.selectedCategory ||
                      mlModal.suggestingOptionalBulk ||
                      mlModal.editableAttributes.every((a) => Boolean(a.value_id) || Boolean(a.value_name?.trim()))
                    }
                  >
                    Preencher com IA
                  </Button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                  {mlModal.editableAttributes.map((attr, idx) => (
                    <div key={attr.id} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: '#a0a0a0' }}>
                        {attr.name}
                        {attr.source_urls?.length ? (
                          <Tooltip title={attr.source_urls.join('\n')}>
                            <LinkOutlined style={{ marginLeft: 6, color: '#1677ff' }} />
                          </Tooltip>
                        ) : null}
                      </Text>
                      {attr.value_type !== 'string' &&
                      Array.isArray(mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id)?.values) &&
                      (mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id)?.values?.length || 0) > 0 ? (
                        <Select
                          size="small"
                          value={attr.value_id || undefined}
                          onChange={(value) => {
                            const selectedDef = mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id);
                            const selectedVal = selectedDef?.values?.find(v => v.id === value);
                            setMlModal(prev => {
                              const next = [...prev.editableAttributes];
                            next[idx] = { ...next[idx], value_id: value, value_name: selectedVal?.name || '' };
                              return applyDependencyRules({ ...prev, editableAttributes: next });
                            });
                          }}
                          options={withNotApplicableOption(mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id)?.values || []).map(v => ({ value: v.id, label: v.name }))}
                        />
                      ) : (
                        <Input
                          size="small"
                          value={attr.value_name || ''}
                          status={attr.value_name?.trim() ? undefined : 'warning'}
                          onChange={(e) => {
                            const value = e.target.value;
                            setMlModal(prev => {
                              const next = [...prev.editableAttributes];
                              next[idx] = { ...next[idx], value_id: '', value_name: value };
                              return { ...prev, editableAttributes: next };
                            });
                          }}
                        />
                      )}
                      <Button
                        size="small"
                        icon={<StarOutlined />}
                        loading={mlModal.suggestingFieldId === `required:${attr.id}`}
                        onClick={() => void sugerirCampoIA({
                          id: attr.id,
                          name: attr.name,
                          value_type: 'string',
                          values: mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id)?.values || [],
                        }, 'required', idx)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mlModal.selectedCategory && mlModal.optionalAttributes.length > 0 && (
              <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <Title level={5} style={{ color: '#e0e0e0', margin: 0 }}>Atributos Secundários</Title>
                  <Button
                    size="small"
                    onClick={() => void preencherAnuncioInteligente('optional')}
                    loading={mlModal.suggestingOptionalBulk}
                    disabled={
                      !mlModal.selectedCategory ||
                      mlModal.suggestingRequiredBulk ||
                      mlModal.optionalAttributes.every((a) => Boolean(a.value_id) || Boolean(a.value_name?.trim()))
                    }
                  >
                    Preencher com IA
                  </Button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                  {mlModal.optionalAttributes.map((attr, idx) => (
                    <div key={attr.id} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: '#a0a0a0' }}>
                        {attr.name}
                        {attr.source_urls?.length ? (
                          <Tooltip title={attr.source_urls.join('\n')}>
                            <LinkOutlined style={{ marginLeft: 6, color: '#1677ff' }} />
                          </Tooltip>
                        ) : null}
                      </Text>
                      {attr.value_type !== 'string' && attr.values?.length ? (
                        <Select
                          size="small"
                          value={attr.value_id || undefined}
                          onChange={(value) => {
                            const selectedVal = withNotApplicableOption(attr.values || []).find(v => v.id === value);
                            setMlModal(prev => {
                              const next = [...prev.optionalAttributes];
                              next[idx] = { ...next[idx], value_id: value, value_name: selectedVal?.name || '' };
                              return applyDependencyRules({ ...prev, optionalAttributes: next });
                            });
                          }}
                          options={withNotApplicableOption(attr.values || []).map(v => ({ value: v.id, label: v.name }))}
                          allowClear
                        />
                      ) : (
                        <Input
                          size="small"
                          value={attr.value_name || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setMlModal(prev => {
                              const next = [...prev.optionalAttributes];
                              next[idx] = { ...next[idx], value_id: '', value_name: value };
                              return { ...prev, optionalAttributes: next };
                            });
                          }}
                        />
                      )}
                      <Button
                        size="small"
                        icon={<StarOutlined />}
                        loading={mlModal.suggestingFieldId === `optional:${attr.id}`}
                        onClick={() => void sugerirCampoIA({ id: attr.id, name: attr.name, value_type: attr.value_type, values: attr.values || [] }, 'optional', idx)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
              <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, marginTop: 0 }}>Descrição</Title>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <Input.TextArea
                  value={mlModal.description}
                  rows={5}
                  onChange={(e) => setMlModal(prev => ({ ...prev, description: e.target.value }))}
                />
                <Button
                  size="small"
                  icon={<StarOutlined />}
                  loading={mlModal.suggestingFieldId === 'description:DESCRIPTION'}
                  onClick={() => void sugerirCampoIA({ id: 'DESCRIPTION', name: 'Descrição', value_type: 'string', values: [] }, 'description')}
                >
                  Melhorar descrição com IA
                </Button>
              </div>
            </div>

            {mlModal.saleTerms.length > 0 && (
              <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, marginTop: 0 }}>Garantia e Termos</Title>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                  {mlModal.saleTerms.map((term, idx) => (
                    <div key={term.id} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: '#a0a0a0' }}>
                        {term.name}
                        {term.source_urls?.length ? (
                          <Tooltip title={term.source_urls.join('\n')}>
                            <LinkOutlined style={{ marginLeft: 6, color: '#1677ff' }} />
                          </Tooltip>
                        ) : null}
                      </Text>
                      {term.values?.length ? (
                        <Select
                          size="small"
                          value={term.value_id || undefined}
                          onChange={(value) => {
                            const selectedVal = term.values.find(v => v.id === value);
                            setMlModal(prev => {
                              const next = [...prev.saleTerms];
                              next[idx] = { ...next[idx], value_id: value, value_name: term.id === 'WARRANTY_TIME' ? '' : (selectedVal?.name || '') };
                              return { ...prev, saleTerms: next };
                            });
                          }}
                          options={term.values.map(v => ({ value: v.id, label: v.name }))}
                        />
                      ) : (
                        <Input
                          size="small"
                          value={term.value_name || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setMlModal(prev => {
                              const next = [...prev.saleTerms];
                              next[idx] = { ...next[idx], value_name: value, value_id: term.id === 'WARRANTY_TIME' ? '' : next[idx].value_id };
                              return { ...prev, saleTerms: next };
                            });
                          }}
                        />
                      )}
                      <Button
                        size="small"
                        icon={<StarOutlined />}
                        loading={mlModal.suggestingFieldId === `sale_term:${term.id}`}
                        onClick={() => void sugerirCampoIA({ id: term.id, name: term.name, value_type: term.value_type, values: term.values || [] }, 'sale_term', idx)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Botões */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <Button onClick={() => setMlModal(prev => ({ ...prev, open: false }))}>
                Cancelar
              </Button>
              <Button
                type="primary"
                onClick={confirmarCriarAnuncio}
                disabled={!mlModal.selectedCategory || mlModal.loading}
                loading={mlModal.loading}
              >
                Criar Anúncio
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
