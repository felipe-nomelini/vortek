'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Input, Select, InputNumber, Tag, Typography, Space, Spin, Modal, Button, message, Dropdown, Row, Col, Statistic, Divider, Radio, Alert,
} from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, LoadingOutlined, EllipsisOutlined, EditOutlined, PlusOutlined, StarOutlined } from '@ant-design/icons';
import { calculateSuggestedPrice } from '@/services/pricing';
import { formatCurrency, formatPercent } from '@/lib/format';
import { useRouter } from 'next/navigation';
import type { Product, MLStatus } from '@/types/product';
import type { Database } from '@/types/database';
import ResizableTable from '@/components/ResizableTable';

type ProdutoRow = Database['public']['Tables']['produtos']['Row'];

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

const priceFieldOptions = [
  { value: 'cost', label: 'Custo' },
  { value: 'suggestedPrice', label: 'Sugerido' },
  { value: 'profit', label: 'Lucro' },
];

const FORNECEDORES = ["FLORATTA JOIAS", "HAYAMAX-PR", "NOVA CENTER", "VITRINE OUTLET"];

interface ProductRow {
  key: string;
  product: Product;
  displayPrice: number;
  profit: number | null;
}

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

const NOT_APPLICABLE_ID = '-1';
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
  if (values.some((v) => String(v.id) === NOT_APPLICABLE_ID)) return values;
  return [{ id: NOT_APPLICABLE_ID, name: 'Não se aplica' }, ...values];
}

function computeDerived(product: Product): { displayPrice: number; profit: number | null } {
  try {
    const result = calculateSuggestedPrice({
      cost: product.cost,
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
    const netProfit = displayPrice - product.cost - product.mlShipping - tax - mlFeeAmount;

    return { displayPrice, profit: Math.round(netProfit * 100) / 100 };
  } catch {
    return { displayPrice: Math.round((product.customPrice ?? product.cost) * 100) / 100, profit: null };
  }
}

const mlStatusColor: Record<MLStatus, string> = { ativo: 'green', pausado: 'orange', sem_anuncio: 'default' };
const mlStatusLabel: Record<MLStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', sem_anuncio: 'Sem Anúncio' };

function mapDBtoProduct(item: ProdutoRow): Product {
  return {
    id: item.id,
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
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [filterMLStatus, setFilterMLStatus] = useState<MLStatus | ''>('');
  const [filterFornecedores, setFilterFornecedores] = useState<string[]>([]);
  const [fornecedorOptions, setFornecedorOptions] = useState<string[]>(FORNECEDORES);
  const [filterEstoque, setFilterEstoque] = useState<string>('todos');
  const [priceField, setPriceField] = useState<string>('cost');
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const [updatingPriceProductId, setUpdatingPriceProductId] = useState<string | null>(null);
  const [savingCustomPriceById, setSavingCustomPriceById] = useState<Record<string, boolean>>({});
  const [persistedCustomPriceById, setPersistedCustomPriceById] = useState<Record<string, number | null>>({});
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
    editableAttributes: Array<{ id: string; name: string; value_name?: string; value_id?: string }>;
    optionalAttributes: MlRequiredAttribute[];
    saleTerms: MlSaleTermField[];
    description: string;
    categorySchemaCache: Record<string, CategorySchemaResponse>;
    suggestingFieldId: string | null;
    suggestingRequiredBulk: boolean;
    suggestingOptionalBulk: boolean;
    loading: boolean;
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
    loading: false,
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
          requiredMap.set(childId, { ...current, value_id: NOT_APPLICABLE_ID, value_name: 'Não se aplica' });
        }
        if (optionalMap.has(childId)) {
          const current = optionalMap.get(childId)!;
          optionalMap.set(childId, { ...current, value_id: NOT_APPLICABLE_ID, value_name: 'Não se aplica' });
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
      loading: true,
    });
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
      setMlModal(prev => ({
        ...prev,
        selectedCategory: categoryId,
        editableAttributes: cached.required_attributes.map((a) => ({
          id: a.id, name: a.name, value_id: a.value_id || '', value_name: a.value_name || '',
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
      setMlModal(prev => ({
        ...prev,
        loading: false,
        selectedCategory: categoryId,
        categorySchemaCache: { ...prev.categorySchemaCache, [categoryId]: schema },
        editableAttributes: schema.required_attributes.map((a) => ({
          id: a.id, name: a.name, value_id: a.value_id || '', value_name: a.value_name || '',
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
        messageApi.warning(data?.error || 'Não foi possível sugerir valor');
        return;
      }
      const suggestion = data.suggestion || {};

      setMlModal(prev => {
        if (target === 'required' && typeof index === 'number') {
          const next = [...prev.editableAttributes];
          next[index] = { ...next[index], value_id: suggestion.value_id || '', value_name: suggestion.value_name || '' };
          return applyDependencyRules({ ...prev, editableAttributes: next });
        }
        if (target === 'optional' && typeof index === 'number') {
          const next = [...prev.optionalAttributes];
          next[index] = { ...next[index], value_id: suggestion.value_id || '', value_name: suggestion.value_name || '' };
          return applyDependencyRules({ ...prev, optionalAttributes: next });
        }
        if (target === 'sale_term' && typeof index === 'number') {
          const next = [...prev.saleTerms];
          next[index] = { ...next[index], value_id: suggestion.value_id || '', value_name: suggestion.value_name || '' };
          return { ...prev, saleTerms: next };
        }
        if (target === 'description') {
          return { ...prev, description: suggestion.value_name || prev.description };
        }
        return prev;
      });
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
    let failedCount = 0;

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
            failedCount += 1;
            continue;
          }

          const suggestion = data.suggestion || {};
          const hasValue = Boolean(suggestion.value_id) || Boolean(String(suggestion.value_name || '').trim());
          if (!hasValue) {
            failedCount += 1;
            continue;
          }

          setMlModal(prev => {
            if (section === 'required') {
              const next = [...prev.editableAttributes];
              next[field.index] = {
                ...next[field.index],
                value_id: suggestion.value_id || '',
                value_name: suggestion.value_name || '',
              };
              return applyDependencyRules({ ...prev, editableAttributes: next });
            }

            const next = [...prev.optionalAttributes];
            next[field.index] = {
              ...next[field.index],
              value_id: suggestion.value_id || '',
              value_name: suggestion.value_name || '',
            };
            return applyDependencyRules({ ...prev, optionalAttributes: next });
          });
          successCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      const totalProcessado = candidates.length;
      messageApi.info(
        `Preenchimento IA (${section === 'required' ? 'obrigatórios' : 'secundários'}): ` +
        `${successCount} preenchidos, ${alreadyFilledCount} ignorados, ${failedCount} falhas (total processado: ${totalProcessado}).`
      );
    } finally {
      setMlModal(prev => ({
        ...prev,
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
        messageApi.success(`Anúncio criado! ${data.anuncio.permalink}`);
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          messageApi.warning(`Pendências: ${data.warnings.join(' | ')}`);
        }
        setMlModal(prev => ({ ...prev, open: false }));
      } else {
        if (Array.isArray(data.missing_required_attributes) && data.missing_required_attributes.length > 0) {
          messageApi.error(`Atributos obrigatórios pendentes: ${data.missing_required_attributes.map((a: any) => a.name).join(', ')}`);
        } else {
          messageApi.error(data.error || 'Erro ao criar anúncio');
        }
        setMlModal(prev => ({ ...prev, loading: false }));
      }
    } catch {
      messageApi.error('Erro ao criar anúncio');
      setMlModal(prev => ({ ...prev, loading: false }));
    }
  };

  const atualizarPrecoMl = async (product: Product) => {
    if (updatingPriceProductId) return;

    setUpdatingPriceProductId(product.id);
    try {
      const res = await fetch('/api/ml/anuncio/atualizar-preco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: product.id }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        messageApi.error(data?.error || 'Falha ao atualizar preço no ML');
        return;
      }

      if (data.success) {
        messageApi.success('Preço principal e atacado atualizados no ML');
      } else if (data.price_updated || data.quantity_pricing_updated) {
        messageApi.warning(
          `Atualização parcial: ${Array.isArray(data.errors) ? data.errors.join(' | ') : 'verifique os detalhes'}`
        );
      } else {
        messageApi.error(
          `Falha na atualização: ${Array.isArray(data.errors) && data.errors.length > 0 ? data.errors.join(' | ') : 'nenhuma etapa concluída'}`
        );
      }

      await fetchProducts();
    } catch {
      messageApi.error('Erro ao conectar com a API de atualização de preço');
    } finally {
      setUpdatingPriceProductId(null);
    }
  };

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (lastSearch) params.set('search', lastSearch);
      if (filterFornecedores.length > 0) params.set('fornecedores', filterFornecedores.join(','));
      if (filterMLStatus) params.set('ml_status', filterMLStatus);
      if (filterEstoque !== 'todos') params.set('estoque', filterEstoque);
      if (priceMin !== null) params.set('priceMin', String(priceMin));
      if (priceMax !== null) params.set('priceMax', String(priceMax));
      params.set('priceField', priceField);
      const res = await fetch(`/api/produtos?${params}`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data || [];
        const mapped: Product[] = data.map(mapDBtoProduct);
        setProducts(mapped);
        setPersistedCustomPriceById(Object.fromEntries(
          mapped.map((p) => [p.id, p.customPrice ?? null])
        ));
        setTotal(json.total || 0);
        if (json.fornecedores?.length) setFornecedorOptions(json.fornecedores);
      }
    } catch {}
    setLoading(false);
  }, [page, lastSearch, filterFornecedores, filterMLStatus, filterEstoque, priceMin, priceMax, priceField]);

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
  }, [filterMLStatus, filterEstoque, filterFornecedores, priceField, priceMin, priceMax]);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (lastSearch) params.set('search', lastSearch);
      if (filterFornecedores.length > 0) params.set('fornecedores', filterFornecedores.join(','));
      if (filterMLStatus) params.set('ml_status', filterMLStatus);
      if (filterEstoque !== 'todos') params.set('estoque', filterEstoque);
      if (priceMin !== null) params.set('priceMin', String(priceMin));
      if (priceMax !== null) params.set('priceMax', String(priceMax));
      params.set('priceField', priceField);
      const res = await fetch(`/api/produtos/resumo?${params}`);
      if (res.ok) {
        const json = await res.json();
        setStats({
          total: json.total || 0,
          comEstoque: json.comEstoque || 0,
          semAnuncio: json.semAnuncio || 0,
          lucroMedio: json.lucroMedio || 0,
          receitaPotencial: json.receitaPotencial || 0,
        });
      }
    } catch {}
  }, [lastSearch, filterFornecedores, filterMLStatus, filterEstoque, priceMin, priceMax, priceField]);

  useEffect(() => {
    fetchProducts();
    fetchStats();
  }, [fetchProducts, fetchStats]);

  const persistCustomPrice = useCallback(async (productId: string, customPrice: number | null) => {
    const normalized = customPrice === null ? null : Math.round(customPrice * 100) / 100;
    const persistedRaw = persistedCustomPriceById[productId] ?? null;
    const persisted = persistedRaw === null ? null : Math.round(persistedRaw * 100) / 100;
    if (normalized === persisted) return;

    if (normalized !== null && normalized < 0) {
      messageApi.warning('Preço sugerido não pode ser negativo.');
      setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, customPrice: persisted } : p)));
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
      setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, customPrice: normalized } : p)));
      setPersistedCustomPriceById((prev) => ({ ...prev, [productId]: normalized }));
    } catch (error: any) {
      messageApi.error(error?.message || 'Erro ao salvar preço sugerido');
      setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, customPrice: previousPersisted } : p)));
    } finally {
      setSavingCustomPriceById((prev) => ({ ...prev, [productId]: false }));
    }
  }, [messageApi, persistedCustomPriceById]);

  const rows: ProductRow[] = useMemo(() => {
    return products.map(p => {
      const { displayPrice, profit } = computeDerived(p);
      return { key: p.id, product: p, displayPrice, profit };
    });
  }, [products]);



  const columns: TableProps<ProductRow>['columns'] = [
    {
      title: 'SKU', dataIndex: ['product', 'sku'], key: 'sku', width: 130,
      sorter: (a, b) => a.product.sku.localeCompare(b.product.sku),
    },
    {
      title: 'Produto', dataIndex: ['product', 'name'], key: 'name',
      sorter: (a, b) => a.product.name.localeCompare(b.product.name),
      render: (name: string, record) => (
        <a
          onClick={() => router.push(`/produtos/${record.product.id}`)}
          style={{ color: '#1677ff', cursor: 'pointer' }}
        >
          {name}
        </a>
      ),
    },
    {
      title: 'Fornecedor', dataIndex: ['product', 'fornecedor'], key: 'fornecedor', width: 140,
      sorter: (a, b) => (a.product.fornecedor || '').localeCompare(b.product.fornecedor || ''),
      render: (v: string | null) => v
        ? <Tag color="default">{v}</Tag>
        : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Estoque', dataIndex: ['product', 'stock'], key: 'stock', width: 90,
      sorter: (a, b) => a.product.stock - b.product.stock,
      render: (stock: number) => (
        <span style={{ color: stock === 0 ? '#ff4d4f' : undefined }}>{stock}</span>
      ),
    },
    {
      title: 'Custo', dataIndex: ['product', 'cost'], key: 'cost', width: 110,
      sorter: (a, b) => a.product.cost - b.product.cost,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Taxa ML', dataIndex: ['product', 'mlFee'], key: 'mlFee', width: 90,
      sorter: (a, b) => a.product.mlFee - b.product.mlFee,
      render: (v: number) => formatPercent(v),
    },
    {
      title: 'Frete ML', dataIndex: ['product', 'mlShipping'], key: 'mlShipping', width: 110,
      sorter: (a, b) => a.product.mlShipping - b.product.mlShipping,
      render: (v: number) => formatCurrency(v),
    },
    {
      title: 'Sugerido', key: 'suggestedPrice', width: 160,
      sorter: (a, b) => a.displayPrice - b.displayPrice,
      render: (_, record) => {
        const val = record.product.customPrice;
        const isSaving = Boolean(savingCustomPriceById[record.product.id]);
        return (
          <InputNumber
            size="small"
            style={{ width: 140 }}
            disabled={isSaving}
            status={isSaving ? 'warning' : undefined}
            value={val ?? record.displayPrice}
            onChange={v => {
              const newProducts = products.map(p =>
                p.id === record.product.id ? { ...p, customPrice: v ?? null } : p
              );
              setProducts(newProducts);
            }}
            onBlur={() => {
              const latest = products.find((p) => p.id === record.product.id);
              if (!latest) return;
              persistCustomPrice(record.product.id, latest.customPrice ?? null);
            }}
            formatter={(v) => v !== undefined ? formatCurrency(typeof v === 'string' ? parseFloat(v) : v) : ''}
            parser={(v) => {
              if (!v || !String(v).trim()) return null as any;
              const parsed = parseFloat(String(v).replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.'));
              return Number.isNaN(parsed) ? null as any : parsed;
            }}
          />
        );
      },
    },
    {
      title: 'Lucro', key: 'profit', width: 130,
      sorter: (a, b) => (a.profit ?? -Infinity) - (b.profit ?? -Infinity),
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
      title: 'Status ML', dataIndex: ['product', 'mlStatus'], key: 'mlStatus', width: 130,
      sorter: (a, b) => a.product.mlStatus.localeCompare(b.product.mlStatus),
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
        if (record.product.mlStatus === 'sem_anuncio') {
          items.push({ key: 'criarAnuncio', label: 'Criar Anúncio ML', icon: <PlusOutlined /> });
        }
        if (record.product.mlStatus === 'ativo') {
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

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Produtos</Title>

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
              ...fornecedorOptions.map(f => ({ value: f, label: f })),
            ]}
            style={{ minWidth: 180, maxWidth: 250 }}
            maxTagCount={2}
            allowClear
            onClear={() => setFilterFornecedores([])}
          />
          <Select
            value={filterEstoque}
            onChange={v => setFilterEstoque(v)}
            options={estoqueOptions}
            style={{ width: 150 }}
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
              onChange: (p) => setPage(p),
            }}
            scroll={{ x: 1200 }}
            style={{ background: 'transparent' }}
            size="small"
          />
        </div>
      </Spin>

      <Modal
        title={`Criar Anúncio no ML — ${mlModal.nome}`}
        open={mlModal.open}
        onCancel={() => setMlModal(prev => ({ ...prev, open: false }))}
        footer={null}
        width={560}
      >
        {mlModal.loading && mlModal.categorias.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <LoadingOutlined style={{ fontSize: 24 }} />
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
                      <InputNumber
                        size="small"
                        min={0.01}
                        value={price}
                        onChange={(v) => setMlModal(prev => ({ ...prev, editablePrice: typeof v === 'number' ? v : prev.editablePrice }))}
                        formatter={(v) => v !== undefined ? formatCurrency(typeof v === 'string' ? parseFloat(v) : v) : ''}
                        parser={(v) => {
                          if (!v) return 0;
                          return parseFloat(v.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.'));
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
                        {p.grossWeight > 0 ? ` | ${p.grossWeight}g` : ''}
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
              if (p.stock === 0) avisos.push('Produto com estoque zero. O anúncio será criado como indisponível.');
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

            {/* Atributos obrigatórios da categoria */}
            {mlModal.selectedCategory && mlModal.editableAttributes.length > 0 && (
              <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <Title level={5} style={{ color: '#e0e0e0', margin: 0 }}>Atributos Obrigatórios</Title>
                  <Button
                    size="small"
                    onClick={() => void sugerirSecaoIA('required')}
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
                      <Text style={{ color: '#a0a0a0' }}>{attr.name}</Text>
                      {Array.isArray(mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id)?.values) &&
                      (mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id)?.values?.length || 0) > 0 ? (
                        <Select
                          size="small"
                          value={attr.value_id || undefined}
                          onChange={(value) => {
                            const selectedDef = mlModal.categorias.find(c => c.id === mlModal.selectedCategory)?.requiredAttributes?.find(a => a.id === attr.id);
                            const selectedVal = selectedDef?.values?.find(v => v.id === value);
                            setMlModal(prev => {
                              const next = [...prev.editableAttributes];
                              next[idx] = { ...next[idx], value_id: value, value_name: selectedVal?.name || (value === NOT_APPLICABLE_ID ? 'Não se aplica' : '') };
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
                              next[idx] = { ...next[idx], value_name: value };
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
                    onClick={() => void sugerirSecaoIA('optional')}
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
                      <Text style={{ color: '#a0a0a0' }}>{attr.name}</Text>
                      {attr.values?.length ? (
                        <Select
                          size="small"
                          value={attr.value_id || undefined}
                          onChange={(value) => {
                            const selectedVal = withNotApplicableOption(attr.values || []).find(v => v.id === value);
                            setMlModal(prev => {
                              const next = [...prev.optionalAttributes];
                              next[idx] = { ...next[idx], value_id: value, value_name: selectedVal?.name || (value === NOT_APPLICABLE_ID ? 'Não se aplica' : '') };
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
                              next[idx] = { ...next[idx], value_name: value };
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
                />
              </div>
            </div>

            {mlModal.saleTerms.length > 0 && (
              <div style={{ background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6, padding: 16 }}>
                <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, marginTop: 0 }}>Garantia e Termos</Title>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                  {mlModal.saleTerms.map((term, idx) => (
                    <div key={term.id} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: '#a0a0a0' }}>{term.name}</Text>
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
