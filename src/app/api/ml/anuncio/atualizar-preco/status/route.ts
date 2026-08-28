import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { previewItemQuantityPricing } from '@/services/mercadolibre';
import {
  extractQuantityPricingTiers,
  serializeQuantityPricingTiers,
} from '@/lib/ml/quantity-pricing';

type PublishOutboxStatus = 'pending' | 'processing' | 'retry' | 'failed' | 'done';
type PublishPhase = 'enfileirado' | 'processando' | 'erro' | 'concluido';
type QuantityPricingState = 'active' | 'absent' | 'failed_validation' | 'provider_rejected';

type QuantityPricingTier = {
  min_purchase_unit: number;
  discount_percent: number;
  amount: number;
  currency_id: string;
  pricing_model: 'percentage' | 'absolute';
};

function normalizeOutboxStatus(value: unknown): PublishOutboxStatus {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'processing') return 'processing';
  if (raw === 'retry') return 'retry';
  if (raw === 'failed') return 'failed';
  if (raw === 'done') return 'done';
  return 'pending';
}

function mapStatusToPhase(status: PublishOutboxStatus): PublishPhase {
  if (status === 'done') return 'concluido';
  if (status === 'failed') return 'erro';
  if (status === 'processing' || status === 'retry') return 'processando';
  return 'enfileirado';
}

function extractLastOperationFromError(lastError: string | null): string | null {
  const raw = String(lastError || '').trim();
  if (!raw.startsWith('[')) return null;
  const close = raw.indexOf(']');
  if (close <= 1) return null;
  return raw.slice(1, close).trim() || null;
}

function extractFailedOperationCode(lastError: string | null): string | null {
  const raw = String(lastError || '').trim();
  if (!raw.startsWith('[')) return null;
  const close = raw.indexOf(']');
  if (close <= 1) return null;
  const marker = raw.slice(1, close).trim();
  const parts = marker.split(':');
  if (parts.length < 2) return null;
  return String(parts[1] || '').trim() || null;
}

function mapQuantityPricingState(hasQuantityPricing: boolean, operationCode: string | null): QuantityPricingState {
  if (hasQuantityPricing) return 'active';
  const code = String(operationCode || '').toLowerCase();
  if (
    code.includes('quantity_pricing_not_effective')
    || code.includes('quantity_pricing_validation_failed')
  ) {
    return 'failed_validation';
  }
  if (
    code.includes('quantity_pricing_provider_rejected')
    || code.includes('item_not_eligible')
    || code.includes('forbidden')
    || code.includes('auth')
  ) {
    return 'provider_rejected';
  }
  return 'absent';
}

function normalizeAmount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function minutesSince(value: unknown): number | null {
  const time = new Date(String(value || '')).getTime();
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 60_000;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const url = new URL(request.url);
  const outboxId = String(url.searchParams.get('outboxId') || '').trim();

  if (!outboxId) {
    return NextResponse.json({ error: 'outboxId é obrigatório' }, { status: 422 });
  }

  const service = createServiceClient();
  const { data: outboxRow, error } = await (service
    .from('anuncios_ml_outbox' as any)
    .select('id,status,attempts,last_error,ml_item_id,created_at,updated_at,processed_at,available_at,payload')
    .eq('id', outboxId)
    .maybeSingle() as any);

  if (error) {
    return NextResponse.json({ error: `Falha ao consultar outbox: ${error.message}` }, { status: 500 });
  }

  if (!outboxRow) {
    return NextResponse.json({ error: 'Outbox não encontrado' }, { status: 404 });
  }

  let status = normalizeOutboxStatus(outboxRow.status);
  const processingAgeMinutes = status === 'processing'
    ? minutesSince(outboxRow.updated_at || outboxRow.created_at)
    : null;
  const isStaleProcessing = processingAgeMinutes !== null && processingAgeMinutes > 10;
  if (isStaleProcessing) {
    status = 'failed';
  }
  const phase = mapStatusToPhase(status);
  const lastError = outboxRow.last_error ? String(outboxRow.last_error) : null;
  const failedOperationCode = extractFailedOperationCode(lastError);
  const payload = outboxRow.payload && typeof outboxRow.payload === 'object'
    ? outboxRow.payload as Record<string, any>
    : {};
  const lastOperation = String(payload?.publish_progress?.last_operation || '').trim()
    || extractLastOperationFromError(lastError)
    || null;

  const response: Record<string, unknown> = {
    success: true,
    outboxId,
    status,
    phase,
    attempts: Number(outboxRow.attempts || 0),
    last_error: isStaleProcessing
      ? 'Publicação ficou presa no worker por mais de 10 minutos. Tente novamente.'
      : lastError,
    ml_item_id: outboxRow.ml_item_id || null,
    created_at: outboxRow.created_at || null,
    updated_at: outboxRow.updated_at || null,
    processed_at: outboxRow.processed_at || null,
    available_at: outboxRow.available_at || null,
    progress: {
      last_operation: lastOperation,
      raw: payload?.publish_progress || null,
    },
    result: null,
  };

  if (status !== 'done') {
    return NextResponse.json(response);
  }

  const mlItemId = String(outboxRow.ml_item_id || '').trim();
  if (!mlItemId) {
    response.result = {
      item_price: null,
      quantity_pricing: [],
      has_quantity_pricing: false,
      suggested_quantity_pricing: [],
      quantity_pricing_state: 'absent' as QuantityPricingState,
      quantity_pricing_last_error: null,
      warnings: ['Outbox concluído sem ml_item_id para conferência final.'],
    };
    return NextResponse.json(response);
  }

  const warnings: string[] = [];
  let itemPrice: number | null = null;
  let quantityPricing: QuantityPricingTier[] = [];

  const itemResult = await fetchMLResult<any>(`/items/${mlItemId}`, { method: 'GET' });
  if (itemResult.ok) {
    itemPrice = normalizeAmount(itemResult.data?.price);
  } else {
    warnings.push(itemResult.error?.message || 'Não foi possível consultar o preço final do anúncio no ML.');
  }

  const quantityResult = await fetchMLResult<any>(`/items/${mlItemId}/prices`, {
    method: 'GET',
    headers: {
      'show-all-prices': 'TRUE',
    },
  });
  if (quantityResult.ok) {
    quantityPricing = serializeQuantityPricingTiers(
      extractQuantityPricingTiers(quantityResult.data, Number(itemPrice || 0)),
    );
  } else {
    warnings.push(quantityResult.error?.message || 'Não foi possível consultar faixas de atacado no ML.');
  }

  const hasQuantityPricing = quantityPricing.length > 0;
  const quantityPricingState = mapQuantityPricingState(hasQuantityPricing, failedOperationCode);
  let suggestedQuantityPricing: QuantityPricingTier[] = [];
  if (!hasQuantityPricing && itemPrice !== null) {
    const preview = await previewItemQuantityPricing(mlItemId, itemPrice);
    if (preview.ok) {
      suggestedQuantityPricing = serializeQuantityPricingTiers(preview.tiers);
    } else {
      warnings.push(preview.error || 'Não foi possível calcular a sugestão de atacado no ML.');
    }
  }
  const quantityPricingLastError = quantityPricingState === 'active'
    ? null
    : (lastError || null);

  response.result = {
    item_price: itemPrice,
    quantity_pricing: quantityPricing,
    has_quantity_pricing: hasQuantityPricing,
    quantity_pricing_state: quantityPricingState,
    quantity_pricing_last_error: quantityPricingLastError,
    suggested_quantity_pricing: suggestedQuantityPricing,
    warnings,
  };

  return NextResponse.json(response);
}
