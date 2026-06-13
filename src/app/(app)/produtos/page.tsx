'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Input, Select, InputNumber, Tag, Typography, Space, Spin, Modal, Button, message, Dropdown, Row, Col, Statistic, Divider, Radio, Alert, Tooltip,
} from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, LoadingOutlined, EllipsisOutlined, EditOutlined, PlusOutlined, StarOutlined, LinkOutlined } from '@ant-design/icons';
import { calculateSuggestedPrice } from '@/services/pricing';
import { formatCurrency, formatPercent } from '@/lib/format';
import { useRouter } from 'next/navigation';
import type { Product, MLStatus } from '@/types/product';
import type { Database } from '@/types/database';
import ResizableTable from '@/components/ResizableTable';
import ProgressModal, { type ProgressStep } from '@/components/modals/ProgressModal';
import { appendRemoteSortParams, getRemoteSortOrder, type RemoteSortState, resolveRemoteSortState } from '@/lib/remote-sort';

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
  preferredOffer: ProdutoOfertaRow | null;
  offersCount: number;
}

interface ProductRow {
  key: string;
  product: Product;
  preferredOffer: ProdutoOfertaRow | null;
  offersCount: number;
  displayPrice: number;
  profit: number | null;
}

interface SupplierOption {
  id: string;
  label: string;
  apelido: string;
}

type MlPublishStatusResponse = {
  success: boolean;
  status?: 'pending' | 'processing' | 'retry' | 'failed' | 'done';
  phase?: 'enfileirado' | 'processando' | 'erro' | 'concluido';
  last_error?: string | null;
  outboxId?: string;
  result?: {
    item_price?: number | null;
    has_quantity_pricing?: boolean;
    quantity_pricing_state?: 'active' | 'absent' | 'failed_validation' | 'provider_rejected';
    quantity_pricing_last_error?: string | null;
    quantity_pricing?: Array<{
      min_purchase_unit: number;
      amount: number;
      currency_id: string;
    }>;
    suggested_quantity_pricing?: Array<{
      min_purchase_unit: number;
      discount_percent: number;
      amount: number;
      currency_id: string;
    }>;
    warnings?: string[];
  } | null;
  progress?: {
    last_operation?: string | null;
  } | null;
  error?: string;
};

type MlPublishContext = {
  produtoId: string;
};

const ML_PUBLISH_POLLING_INTERVAL_MS = 2000;

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

function computeDerived(item: Product | ProductMasterListItem): { displayPrice: number; profit: number | null } {
  const product = 'product' in item ? item.product : item;
  const cost = 'preferredOffer' in item
    ? Number(item.preferredOffer?.custo ?? item.product.cost)
    : item.cost;
  try {
    const result = calculateSuggestedPrice({
      cost,
      shipping: product.mlShipping,
      mlFee: product.mlFee,
    });
    const displayPrice = Math.round((product.customPrice ?? result.suggestedPrice) * 100) / 100;

    // Sem anúncio vinculado: não exibimos lucro operacional.
    if (product.mlStatus === 'sem_anuncio') {
      return { displayPrice, profit: null };
    }

    const tax = displayPrice * 0.04;
    const mlFeeAmount = displayPrice * product.mlFee;
    const netProfit = displayPrice - cost - product.mlShipping - tax - mlFeeAmount;

    return { displayPrice, profit: Math.round(netProfit * 100) / 100 };
  } catch {
    return { displayPrice: Math.round((product.customPrice ?? cost) * 100) / 100, profit: null };
  }
}

const mlStatusColor: Record<MLStatus, string> = { ativo: 'green', pausado: 'orange', sem_anuncio: 'default' };
const mlStatusLabel: Record<MLStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', sem_anuncio: 'Sem Anúncio' };

function parseOutboxStepLabel(operation: string | null | undefined): string {
  const op = String(operation || '').trim().toLowerCase();
  if (!op) return 'Aguardando worker';
  if (op === 'processing_start') return 'Iniciando publicação';
  if (op === 'validate') return 'Validando item no outbox';
  if (op === 'price') return 'Publicando preço base';
  if (op === 'quantity_pricing') return 'Publicando preços de atacado';
  if (op === 'quantity') return 'Publicando estoque';
  if (op === 'status') return 'Publicando status do anúncio';
  return op;
}

function buildMlPublishSteps(statusPayload: MlPublishStatusResponse | null): ProgressStep[] {
  const currentStatus = statusPayload?.status || 'pending';
  const lastError = statusPayload?.last_error || null;
  const phase = statusPayload?.phase || 'enfileirado';
  const lastOperation = statusPayload?.progress?.last_operation || null;
  const result = statusPayload?.result || null;
  const quantityPricing = Array.isArray(result?.quantity_pricing) ? result?.quantity_pricing : [];
  const hasQuantityPricing = quantityPricing.length > 0;
  const quantityPricingState = String(result?.quantity_pricing_state || (hasQuantityPricing ? 'active' : 'absent'));
  const quantityPricingLastError = String(result?.quantity_pricing_last_error || '').trim();
  const suggestedQuantityPricing = Array.isArray(result?.suggested_quantity_pricing) ? result.suggested_quantity_pricing : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  const atacadoAtivoDetail = quantityPricing.length > 0
    ? quantityPricing.map((tier) => `${tier.min_purchase_unit}+ = ${formatCurrency(Number(tier.amount || 0))}`).join(' | ')
    : 'Sem preços de atacado ativos no anúncio.';
  const atacadoSugeridoDetail = suggestedQuantityPricing.length > 0
    ? `Sugestão: ${suggestedQuantityPricing.map((tier) => `${tier.min_purchase_unit}+ (-${tier.discount_percent}%) = ${formatCurrency(Number(tier.amount || 0))}`).join(' | ')}`
    : 'Sem sugestões disponíveis.';
  const diagnosticReason = quantityPricingState === 'failed_validation'
    ? 'Diagnóstico: o ML aceitou a chamada, mas as faixas não ficaram ativas.'
    : quantityPricingState === 'provider_rejected'
      ? 'Diagnóstico: o ML rejeitou a aplicação de atacado para este anúncio.'
      : quantityPricingState === 'absent' && !hasQuantityPricing
        ? 'Diagnóstico: anúncio sem faixas de atacado ativas no momento.'
        : '';
  const technicalReason = quantityPricingLastError ? ` Detalhe técnico: ${quantityPricingLastError}` : '';

  return [
    {
      label: 'Enfileirado',
      status: phase === 'enfileirado' ? 'loading' : 'success',
      detail: currentStatus === 'pending' ? 'Aguardando início do processamento no worker.' : 'Publicação recebida na fila.',
    },
    {
      label: 'Processando publicação no ML',
      status: currentStatus === 'failed'
        ? 'error'
        : currentStatus === 'done'
          ? 'success'
          : 'loading',
      detail: currentStatus === 'done'
        ? 'Preço base e atacado processados pelo worker.'
        : parseOutboxStepLabel(lastOperation),
      error: currentStatus === 'failed' ? (lastError || 'Falha ao processar publicação no ML.') : undefined,
    },
    {
      label: 'Preço final do anúncio',
      status: currentStatus === 'done'
        ? 'success'
        : currentStatus === 'failed'
          ? 'warning'
          : 'pending',
      detail: currentStatus === 'done'
        ? `Preço atual no ML: ${result?.item_price !== null && result?.item_price !== undefined ? formatCurrency(Number(result.item_price)) : 'não disponível'}`
        : 'Aguardando confirmação final do ML.',
    },
    {
      label: 'Preços de atacado',
      status: currentStatus === 'done'
        ? (hasQuantityPricing ? 'success' : 'warning')
        : currentStatus === 'failed'
          ? 'warning'
          : 'pending',
      detail: currentStatus === 'done'
        ? `${atacadoAtivoDetail} ${atacadoSugeridoDetail}${diagnosticReason ? ` ${diagnosticReason}` : ''}${technicalReason}${warnings.length > 0 ? ` | Aviso: ${warnings.join(' | ')}` : ''}`
        : 'Aguardando confirmação final do ML.',
    },
  ];
}

function mapDBtoProduct(item: ProdutoRow): Product {
  return {
    id: item.id,
    active: item.ativo !== false,
    sku: item.sku,
    name: item.nome,
    brand: item.marca || '',
    fornecedor: item.fornecedor || null,
    stock: item.estoque || 0,
    cost: item.custo || 0,
    mlFee: item.ml_fee || 0.15,
    mlShipping: item.ml_shipping || 0,
    customPrice: item.custom_price,
    mlStatus: item.ml_status || 'sem_anuncio',
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

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductMasterListItem[]>([]);
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
  const [filterProductActive, setFilterProductActive] = useState<string>('');
  const [filterEstoque, setFilterEstoque] = useState<string>('');
  const [priceField, setPriceField] = useState<string>('cost');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const [updatingPriceProductId, setUpdatingPriceProductId] = useState<string | null>(null);
  const [mlPublishModalOpen, setMlPublishModalOpen] = useState(false);
  const [mlPublishModalSteps, setMlPublishModalSteps] = useState<ProgressStep[]>(buildMlPublishSteps(null));
  const [mlPublishOutboxId, setMlPublishOutboxId] = useState<string | null>(null);
  const [mlPublishLastStatus, setMlPublishLastStatus] = useState<MlPublishStatusResponse | null>(null);
  const [mlPublishRetryContext, setMlPublishRetryContext] = useState<MlPublishContext | null>(null);
  const [mlPublishApplyingWholesale, setMlPublishApplyingWholesale] = useState(false);
  const mlPublishPollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productsRequestRef = useRef(0);
  const statsRequestRef = useRef(0);
  const [savingCustomPriceById, setSavingCustomPriceById] = useState<Record<string, boolean>>({});
  const [persistedCustomPriceById, setPersistedCustomPriceById] = useState<Record<string, number | null>>({});
  const [editingPriceTextById, setEditingPriceTextById] = useState<Record<string, string>>({});
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
    const derived = computeDerived(product);
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

  const clearMlPublishPolling = () => {
    if (mlPublishPollingRef.current) {
      clearTimeout(mlPublishPollingRef.current);
      mlPublishPollingRef.current = null;
    }
  };

  const closeMlPublishModal = () => {
    clearMlPublishPolling();
    setMlPublishModalOpen(false);
    setMlPublishOutboxId(null);
    setMlPublishLastStatus(null);
    setMlPublishApplyingWholesale(false);
    setMlPublishModalSteps(buildMlPublishSteps(null));
  };

  const pollMlPublishStatus = async (outboxId: string) => {
    const response = await fetch(`/api/ml/anuncio/atualizar-preco/status?outboxId=${encodeURIComponent(outboxId)}`);
    const payload = await response.json().catch(() => ({})) as MlPublishStatusResponse;
    if (!response.ok) {
      throw new Error(payload?.error || 'Falha ao consultar status da publicação.');
    }
    return payload;
  };

  const scheduleMlPublishPolling = (outboxId: string) => {
    clearMlPublishPolling();
    mlPublishPollingRef.current = setTimeout(async () => {
      try {
        const payload = await pollMlPublishStatus(outboxId);
        setMlPublishLastStatus(payload);
        setMlPublishModalSteps(buildMlPublishSteps(payload));
        if (payload.status === 'done' || payload.status === 'failed') {
          clearMlPublishPolling();
          await fetchProducts();
          return;
        }
        scheduleMlPublishPolling(outboxId);
      } catch (error: any) {
        const mensagem = error?.message || 'Erro ao consultar status da publicação no ML.';
        setMlPublishLastStatus({
          success: false,
          status: 'failed',
          phase: 'erro',
          last_error: mensagem,
          error: mensagem,
          outboxId,
          result: null,
        });
        setMlPublishModalSteps(buildMlPublishSteps({
          success: false,
          status: 'failed',
          phase: 'erro',
          last_error: mensagem,
          outboxId,
          result: null,
        }));
        clearMlPublishPolling();
      }
    }, ML_PUBLISH_POLLING_INTERVAL_MS);
  };

  const startMlPublishTracking = (outboxId: string) => {
    setMlPublishOutboxId(outboxId);
    setMlPublishLastStatus({
      success: true,
      status: 'pending',
      phase: 'enfileirado',
      outboxId,
      result: null,
    });
    setMlPublishModalSteps(buildMlPublishSteps({
      success: true,
      status: 'pending',
      phase: 'enfileirado',
      outboxId,
      result: null,
    }));
    setMlPublishModalOpen(true);
    scheduleMlPublishPolling(outboxId);
  };

  const startMlPublishUpdate = async (context: MlPublishContext) => {
    if (updatingPriceProductId) return;
    if (mlPublishModalOpen && mlPublishOutboxId) {
      messageApi.warning('Já existe uma publicação em acompanhamento. Aguarde finalizar para iniciar outra.');
      return;
    }

    setUpdatingPriceProductId(context.produtoId);
    try {
      const res = await fetch('/api/ml/anuncio/atualizar-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: context.produtoId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        messageApi.error(data?.error || 'Falha ao atualizar preço no ML');
        return;
      }

      const queued = Boolean(data?.queued_publish);
      const outboxId = String(data?.outboxId || '').trim();
      if (!queued || !outboxId) {
        messageApi.error(
          `Falha ao enfileirar atualização: ${Array.isArray(data.errors) && data.errors.length > 0 ? data.errors.join(' | ') : 'nenhuma etapa concluída'}`
        );
        return;
      }

      setMlPublishRetryContext(context);
      startMlPublishTracking(outboxId);
      messageApi.success('Atualização enfileirada. Acompanhe o processamento no modal.');
      await fetchProducts();
    } catch {
      messageApi.error('Erro ao conectar com a API de atualização de preço');
    } finally {
      setUpdatingPriceProductId(null);
    }
  };

  const retryMlPublish = () => {
    const retryContext = mlPublishRetryContext;
    closeMlPublishModal();
    if (!retryContext) return;
    void startMlPublishUpdate(retryContext);
  };

  const applyWholesaleFromModal = async () => {
    if (mlPublishApplyingWholesale) return;
    const produtoId = mlPublishRetryContext?.produtoId;
    const itemPrice = Number(mlPublishLastStatus?.result?.item_price);
    const outboxProcessing = Boolean(
      mlPublishModalOpen
      && mlPublishOutboxId
      && mlPublishLastStatus?.status !== 'done'
      && mlPublishLastStatus?.status !== 'failed',
    );
    if (outboxProcessing) {
      messageApi.warning('Já existe uma publicação em acompanhamento. Aguarde finalizar.');
      return;
    }
    if (!produtoId || !Number.isFinite(itemPrice) || itemPrice <= 0) {
      messageApi.error('Não foi possível identificar preço base válido para aplicar atacado.');
      return;
    }

    setMlPublishApplyingWholesale(true);
    try {
      const response = await fetch('/api/ml/anuncio/aplicar-atacado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId,
          basePrice: itemPrice,
          source: 'modal_result_sem_atacado',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(payload?.error || 'Falha ao enfileirar aplicação de atacado.');
        return;
      }
      const outboxId = String(payload?.outboxId || '').trim();
      if (!payload?.queued_publish || !outboxId) {
        messageApi.error('Não foi possível enfileirar aplicação de atacado.');
        return;
      }

      startMlPublishTracking(outboxId);
      messageApi.success('Aplicação de atacado enfileirada. Acompanhe no modal.');
    } catch {
      messageApi.error('Erro de conexão ao aplicar atacado.');
    } finally {
      setMlPublishApplyingWholesale(false);
    }
  };

  const canApplyWholesaleFromModal = Boolean(
    mlPublishLastStatus?.status === 'done'
    && !mlPublishApplyingWholesale
    && !(mlPublishLastStatus?.result?.has_quantity_pricing)
    && Number(mlPublishLastStatus?.result?.item_price || 0) > 0
    && mlPublishRetryContext?.produtoId,
  );

  const atualizarPrecoMl = async (product: Product) => {
    await startMlPublishUpdate({ produtoId: product.id });
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
      params.set('ativo', filterProductActive || 'todos');
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
        preferredOffer: item.preferredOffer ? {
          ...item.preferredOffer,
          custo: Number(item.preferredOffer.custo || 0),
          estoque: Number(item.preferredOffer.estoque || 0),
          ativo: Boolean(item.preferredOffer.ativo),
        } : null,
        offersCount: Number(item.offersCount || 0),
      }));
      if (productsRequestRef.current !== requestId) return;
      setProducts(mapped);
      setPersistedCustomPriceById(Object.fromEntries(
        mapped.map((item) => [item.product.id, item.product.customPrice ?? null])
      ));
      setTotal(json.total || 0);
      setFornecedorOptions(
        Array.isArray(json.fornecedores)
          ? json.fornecedores.map((item: any) => ({
            id: String(item?.id || ''),
            label: String(item?.label || item?.apelido || ''),
            apelido: String(item?.apelido || item?.label || ''),
          })).filter((item: SupplierOption) => item.id && item.label)
          : [],
      );
    } catch (error: any) {
      if (productsRequestRef.current !== requestId) return;
      setProducts([]);
      setTotal(0);
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
      params.set('ativo', filterProductActive || 'todos');
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

  useEffect(() => {
    return () => {
      clearMlPublishPolling();
    };
  }, []);

  const persistCustomPrice = useCallback(async (productId: string, customPrice: number | null) => {
    const normalized = customPrice === null ? null : Math.round(customPrice * 100) / 100;
    const persistedRaw = persistedCustomPriceById[productId] ?? null;
    const persisted = persistedRaw === null ? null : Math.round(persistedRaw * 100) / 100;
    if (normalized === persisted) return;

    if (normalized !== null && normalized < 0) {
      messageApi.warning('Preço sugerido não pode ser negativo.');
      setProducts((prev) => prev.map((item) => (
        item.product.id === productId
          ? { ...item, product: { ...item.product, customPrice: persisted } }
          : item
      )));
      return;
    }

    const previousPersisted = persistedRaw;
    setSavingCustomPriceById((prev) => ({ ...prev, [productId]: true }));

    try {
      const res = await fetch(`/api/produtos/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_price: normalized }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || json?.erro || 'Falha ao salvar preço sugerido');
      }
      setProducts((prev) => prev.map((item) => (
        item.product.id === productId
          ? { ...item, product: { ...item.product, customPrice: normalized } }
          : item
      )));
      setPersistedCustomPriceById((prev) => ({ ...prev, [productId]: normalized }));
    } catch (error: any) {
      messageApi.error(error?.message || 'Erro ao salvar preço sugerido');
      setProducts((prev) => prev.map((item) => (
        item.product.id === productId
          ? { ...item, product: { ...item.product, customPrice: previousPersisted } }
          : item
      )));
    } finally {
      setSavingCustomPriceById((prev) => ({ ...prev, [productId]: false }));
    }
  }, [messageApi, persistedCustomPriceById]);

  const commitCustomPriceText = useCallback((productId: string) => {
    const text = editingPriceTextById[productId];
    if (text === undefined) return;
    const parsed = parseEditablePriceText(text);
    if (text.trim() && parsed === null) {
      messageApi.warning('Preço sugerido inválido.');
      setEditingPriceTextById((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      return;
    }
    if (parsed !== null && parsed < 0) {
      messageApi.warning('Preço sugerido não pode ser negativo.');
      setEditingPriceTextById((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      return;
    }
    const nextPrice = text.trim() ? parsed : null;
    setProducts((prev) => prev.map((item) => (
      item.product.id === productId
        ? { ...item, product: { ...item.product, customPrice: nextPrice } }
        : item
    )));
    setEditingPriceTextById((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    void persistCustomPrice(productId, nextPrice ?? null);
  }, [editingPriceTextById, messageApi, persistCustomPrice]);

  const cancelCustomPriceText = useCallback((productId: string) => {
    setEditingPriceTextById((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }, []);

  const rows: ProductRow[] = useMemo(() => {
    return products.map(item => {
      const { displayPrice, profit } = computeDerived(item);
      return {
        key: item.product.id,
        product: item.product,
        preferredOffer: item.preferredOffer,
        offersCount: item.offersCount,
        displayPrice,
        profit,
      };
    });
  }, [products]);



  const columns: TableProps<ProductRow>['columns'] = [
    {
      title: 'SKU', dataIndex: ['product', 'sku'], key: 'sku', width: 150,
      sorter: true,
      sortOrder: getRemoteSortOrder('sku', sort),
    },
    {
      title: 'Produto', dataIndex: ['product', 'name'], key: 'nome',
      sorter: true,
      sortOrder: getRemoteSortOrder('nome', sort),
      render: (_: string, record) => (
        <div>
          <a
            onClick={() => router.push(`/produtos/${record.product.id}`)}
            style={{ color: '#1677ff', cursor: 'pointer' }}
          >
            {record.product.name}
          </a>
          <div style={{ marginTop: 5, color: '#8c8c8c', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: record.product.active ? '#52c41a' : '#ff4d4f',
                  display: 'inline-block',
                }}
              />
              {record.product.active ? 'Ativo' : 'Inativo'}
            </span>
            <span>{record.offersCount} fornecedor{record.offersCount === 1 ? '' : 'es'}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Fornecedor Atual', dataIndex: ['product', 'fornecedor'], key: 'fornecedor', width: 170,
      sorter: true,
      sortOrder: getRemoteSortOrder('fornecedor', sort),
      render: (v: string | null, record) => v
        ? <Tag color="default">{v}</Tag>
        : (
          <span style={{ color: '#666' }}>
            {record.preferredOffer?.fornecedor_nome || '—'}
          </span>
        ),
    },
    {
      title: 'Estoque', dataIndex: ['product', 'stock'], key: 'estoque', width: 90,
      sorter: true,
      sortOrder: getRemoteSortOrder('estoque', sort),
      render: (stock: number) => (
        <span style={{ color: stock === 0 ? '#ff4d4f' : undefined }}>{stock}</span>
      ),
    },
    {
      title: 'Custo Atual', dataIndex: ['product', 'cost'], key: 'custo', width: 120,
      sorter: true,
      sortOrder: getRemoteSortOrder('custo', sort),
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Taxa ML', dataIndex: ['product', 'mlFee'], key: 'ml_fee', width: 90,
      sorter: true,
      sortOrder: getRemoteSortOrder('ml_fee', sort),
      render: (v: number) => formatPercent(v),
    },
    {
      title: 'Frete ML', dataIndex: ['product', 'mlShipping'], key: 'ml_shipping', width: 110,
      sorter: true,
      sortOrder: getRemoteSortOrder('ml_shipping', sort),
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Sugerido', key: 'suggested_price', width: 160,
      sorter: true,
      sortOrder: getRemoteSortOrder('suggested_price', sort),
      render: (_, record) => {
        const val = record.product.customPrice;
        const isSaving = Boolean(savingCustomPriceById[record.product.id]);
        const productId = record.product.id;
        const editingValue = editingPriceTextById[productId];
        const displayValue = editingValue ?? formatCurrency(val ?? record.displayPrice);
        return (
          <div>
            <Input
              size="small"
              style={{ width: 140 }}
              disabled={isSaving}
              status={isSaving ? 'warning' : undefined}
              value={displayValue}
              onFocus={() => {
                setEditingPriceTextById((prev) => ({
                  ...prev,
                  [productId]: priceToEditableText(val ?? record.displayPrice),
                }));
              }}
              onChange={(event) => {
                const value = event.target.value;
                setEditingPriceTextById((prev) => ({ ...prev, [productId]: value }));
              }}
              onBlur={() => {
                commitCustomPriceText(productId);
              }}
              onPressEnter={(event) => {
                event.currentTarget.blur();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelCustomPriceText(productId);
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        );
      },
    },
    {
      title: 'Lucro', key: 'profit', width: 130,
      sorter: true,
      sortOrder: getRemoteSortOrder('profit', sort),
      render: (_, record) => {
        if (record.profit === null) {
          return <span style={{ color: '#666' }}>—</span>;
        }
        return (
          <span style={{ color: record.profit >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {formatCurrency(record.profit)}
          </span>
        );
      },
    },
    {
      title: 'Status ML', dataIndex: ['product', 'mlStatus'], key: 'ml_status', width: 130,
      sorter: true,
      sortOrder: getRemoteSortOrder('ml_status', sort),
      render: (status: MLStatus) => (
        <Tag color={mlStatusColor[status]}>{mlStatusLabel[status]}</Tag>
      ),
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => {
        const isUpdatingCurrent = updatingPriceProductId === record.product.id;
        const items: { key: string; label: React.ReactNode; icon?: React.ReactNode }[] = [
          { key: 'edit', label: 'Editar', icon: <EditOutlined /> },
        ];
        if (record.product.active && record.product.mlStatus === 'sem_anuncio' && record.product.stock > 0) {
          items.push({ key: 'criarAnuncio', label: 'Criar Anúncio ML', icon: <PlusOutlined /> });
        }
        if (record.product.active && record.product.mlStatus === 'ativo') {
          items.push({
            key: 'atualizarPrecoMl',
            label: isUpdatingCurrent ? 'Atualizando preço...' : 'Atualizar Preço ML',
            icon: isUpdatingCurrent ? <LoadingOutlined spin /> : undefined,
          });
        }
        return (
          <Dropdown
            menu={{
              items,
              selectable: false,
              onClick: ({ key }) => {
                if (key === 'edit') router.push(`/produtos/${record.product.id}`);
                if (key === 'criarAnuncio') abrirCriarAnuncioML(record.product);
                if (key === 'atualizarPrecoMl') atualizarPrecoMl(record.product);
              },
            }}
            trigger={['click']}
          >
            <Button
              type="text"
              size="small"
              icon={<EllipsisOutlined />}
              loading={isUpdatingCurrent}
              disabled={Boolean(updatingPriceProductId && !isUpdatingCurrent)}
            />
          </Dropdown>
        );
      },
    },
  ];

  const handleTableChange: TableProps<ProductRow>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'sku', sortOrder: 'asc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

  return (
    <div>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e0e0e0', marginBottom: 0 }}>Produtos</Title>
      </div>

      {/* Mini Dashboard */}
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Produtos</span>}
              value={stats.total}
              valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Com Estoque</span>}
              value={stats.comEstoque}
              valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Sem Anúncio ML</span>}
              value={stats.semAnuncio}
              valueStyle={{ color: '#faad14', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Receita Potencial</span>}
              value={formatCurrency(stats.receitaPotencial)}
              valueStyle={{ color: '#13c2c2', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
        <Divider style={{ borderColor: '#303030', margin: '12px 0' }} />
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title={<span style={{ color: '#a0a0a0' }}>Lucro Médio</span>}
              value={formatCurrency(stats.lucroMedio)}
              valueStyle={{ color: stats.lucroMedio >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700, fontSize: 24 }}
            />
          </Col>
        </Row>
      </div>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Input
            placeholder="Buscar por nome ou SKU"
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220 }}
            allowClear
            onClear={() => { setSearch(''); setLastSearch(''); setPage(1); }}
          />
          <Select
            placeholder="Status Produto"
            value={filterProductActive || undefined}
            onChange={setFilterProductActive}
            options={productActiveOptions}
            style={{ width: 150 }}
            allowClear
            onClear={() => setFilterProductActive('')}
          />
          <Select
            placeholder="Status ML"
            value={filterMLStatus || undefined}
            onChange={v => setFilterMLStatus(v as MLStatus | '')}
            options={mlStatusOptions}
            style={{ width: 150 }}
            allowClear
            onClear={() => setFilterMLStatus('')}
          />
          <Select
            mode="multiple"
            placeholder="Fornecedor"
            value={filterFornecedores}
            onChange={v => {
              if (v.includes('__all__')) setFilterFornecedores([]);
              else setFilterFornecedores(v);
            }}
            options={[
              ...(filterFornecedores.length === 0 ? [{ value: '__all__', label: 'Todos' }] : []),
              ...fornecedorOptions.map((fornecedor) => ({ value: fornecedor.id, label: fornecedor.label })),
            ]}
            style={{ minWidth: 180, maxWidth: 250 }}
            maxTagCount={2}
            allowClear
            onClear={() => setFilterFornecedores([])}
          />
          <Select
            placeholder="Estoque"
            value={filterEstoque || undefined}
            onChange={v => setFilterEstoque(v)}
            options={estoqueOptions}
            style={{ width: 150 }}
            allowClear
            onClear={() => setFilterEstoque('')}
          />
          <Space.Compact>
            <Select value={priceField} onChange={setPriceField} options={priceFieldOptions} style={{ width: 130 }} />
            <InputNumber placeholder="Mín" value={priceMin} onChange={v => setPriceMin(v ?? null)} style={{ width: 100 }} />
            <InputNumber placeholder="Máx" value={priceMax} onChange={v => setPriceMax(v ?? null)} style={{ width: 100 }} />
          </Space.Compact>
        </div>
      </div>
      <Spin spinning={loading} indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />}>
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
          {listError && (
            <Alert
              type="error"
              showIcon
              message="Falha ao carregar a lista de produtos"
              description={listError}
              style={{ marginBottom: 16, background: '#2a1215', borderColor: '#ff4d4f' }}
            />
          )}
          <ResizableTable<ProductRow>
            storageKey="produtos"
            dataSource={rows}
            columns={columns}
            rowKey="key"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (t) => `${t} produtos`,
            }}
            onChange={handleTableChange}
            scroll={{ x: 1200 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>

      <ProgressModal
        open={mlPublishModalOpen}
        title="Atualizando preço no Mercado Livre"
        steps={mlPublishModalSteps}
        onClose={closeMlPublishModal}
        onCancel={retryMlPublish}
        showCloseButton={mlPublishLastStatus?.status === 'failed' || mlPublishLastStatus?.status === 'done'}
        customActions={canApplyWholesaleFromModal ? [{
          key: 'apply_wholesale',
          label: mlPublishApplyingWholesale ? 'Criando atacado...' : 'Criar preços de atacado',
          onClick: () => { void applyWholesaleFromModal(); },
          primary: true,
        }] : []}
      />

      <Modal
        title={`Criar Anúncio no ML — ${mlModal.nome}`}
        open={mlModal.open}
        onCancel={() => setMlModal(prev => ({ ...prev, open: false }))}
        footer={null}
        width={560}
      >
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
              const derived = computeDerived(p);
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
                      <Text style={{ color: '#e0e0e0' }}>{formatCurrency(p.mlShipping)}</Text>
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
            {mlModal.product && (() => {
              const basePrice = mlModal.editablePrice ?? 0;
              const tiers = [
                { qtd: 3, discount: 3, price: Math.round(basePrice * 0.97 * 100) / 100 },
                { qtd: 5, discount: 4, price: Math.round(basePrice * 0.96 * 100) / 100 },
                { qtd: 10, discount: 5, price: Math.round(basePrice * 0.95 * 100) / 100 },
              ];
              return (
                <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                  <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, marginTop: 0 }}>Preços por Quantidade (B2B)</Title>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tiers.map((tier) => (
                      <div key={tier.qtd} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#a0a0a0' }}>
                          {tier.qtd} unidades
                          <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>-{tier.discount}%</Tag>
                        </span>
                        <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 14 }}>
                          {formatCurrency(tier.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Text style={{ color: '#666', fontSize: 12, marginTop: 8, display: 'block' }}>
                    Visíveis apenas para compradores do tipo business (B2B).
                  </Text>
                </div>
              );
            })()}

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
      </Modal>
    </div>
  );
}
