import { fetchML } from './integration';

export interface MLCategoryPrediction {
  domain_id: string;
  domain_name: string;
  category_id: string;
  category_name: string;
  attributes: Array<{ id: string; value_id?: string; value_name?: string }>;
}

export interface MLAttribute {
  id: string;
  name: string;
  tags: { required?: boolean; catalog_required?: boolean; fixed?: boolean; hidden?: boolean };
  value_type: 'list' | 'number' | 'string' | 'boolean' | 'number_unit';
  values?: Array<{ id: string; name: string }>;
  allowed_units?: Array<{ id: string; name: string }>;
  default_unit?: string;
  hierarchy?: string;
}

export interface MLCreateItemInput {
  title: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: 'new' | 'used';
  listingTypeId: 'gold_special' | 'gold_pro';
  description: string;
  pictures: string[];
  attributes: Array<{ id: string; value_name?: string; value_id?: string }>;
  fiscalData?: {
    gtin?: string;
    ncm?: string;
    cest?: string;
    csosn?: string;
  };
  shipping?: {
    mode?: string;
    localPickUp?: boolean;
    freeShipping?: boolean;
  };
}

export interface MLCreateItemResult {
  id: string;
  title: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  permalink: string;
  thumbnail: string;
  status: string;
}

export async function predictCategory(title: string, limit: number = 3): Promise<MLCategoryPrediction[] | null> {
  const encoded = encodeURIComponent(title);
  return fetchML<MLCategoryPrediction[]>(
    `/sites/MLB/domain_discovery/search?q=${encoded}&limit=${limit}`
  );
}

export async function getCategoryAttributes(categoryId: string): Promise<MLAttribute[] | null> {
  const data = await fetchML<any>(`/categories/${categoryId}/attributes`);
  if (!data) return null;
  return data.filter((a: any) => !a.tags?.hidden);
}

export async function createListing(input: MLCreateItemInput): Promise<MLCreateItemResult | null> {
  const attributes = [...input.attributes];

  if (input.fiscalData) {
    if (input.fiscalData.gtin) attributes.push({ id: 'GTIN', value_name: input.fiscalData.gtin });
    if (input.fiscalData.ncm) attributes.push({ id: 'NCM', value_name: input.fiscalData.ncm });
    if (input.fiscalData.cest) attributes.push({ id: 'CEST', value_name: input.fiscalData.cest });
    if (input.fiscalData.csosn) attributes.push({ id: 'CSOSN', value_name: input.fiscalData.csosn });
  }

  const payload: Record<string, any> = {
    title: input.title,
    category_id: input.categoryId,
    price: input.price,
    currency_id: 'BRL',
    available_quantity: input.availableQuantity,
    buying_mode: 'buy_it_now',
    listing_type_id: input.listingTypeId,
    condition: input.condition,
    description: { plain_text: input.description },
    pictures: input.pictures.map(url => ({ source: url })),
    attributes,
    shipping: input.shipping
      ? {
          mode: input.shipping.mode || 'me2',
          local_pick_up: input.shipping.localPickUp ?? true,
          free_shipping: input.shipping.freeShipping ?? false,
        }
      : { mode: 'not_specified', local_pick_up: true, free_shipping: false },
  };

  return fetchML<MLCreateItemResult>('/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateListingFiscalData(
  itemId: string,
  fiscalData: { gtin?: string; ncm?: string; cest?: string; csosn?: string }
): Promise<boolean> {
  const attributes: Array<{ id: string; value_name: string }> = [];
  if (fiscalData.gtin) attributes.push({ id: 'GTIN', value_name: fiscalData.gtin });
  if (fiscalData.ncm) attributes.push({ id: 'NCM', value_name: fiscalData.ncm });
  if (fiscalData.cest) attributes.push({ id: 'CEST', value_name: fiscalData.cest });
  if (fiscalData.csosn) attributes.push({ id: 'CSOSN', value_name: fiscalData.csosn });

  if (attributes.length === 0) return true;

  const result = await fetchML(`/items/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes }),
  });
  return result !== null;
}
