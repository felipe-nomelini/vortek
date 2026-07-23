import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

export const SHIPPING_LABEL_BUCKET = 'etiquetas';
export const SHIPPING_LABEL_SIGNED_URL_TTL_SECONDS = 60 * 60;

type ServiceClient = SupabaseClient<Database>;

type StoreShippingLabelInput = {
  client: ServiceClient;
  pedidoId: string;
  pedidoNumero: string | number | null | undefined;
  mlOrderId?: string | null;
  shipmentId: string;
  pdf: Buffer;
  source: string;
};

type StoreShippingLabelResult = {
  ok: boolean;
  storagePath: string | null;
  signedUrl: string | null;
  error?: string;
};

type StoreThermalShippingLabelInput = Omit<StoreShippingLabelInput, 'pdf'> & {
  zpl: Buffer;
};

function normalizePathSegment(value: string | number | null | undefined): string | null {
  const normalized = String(value ?? '').trim().replace(/[^\w.-]+/g, '_');
  return normalized || null;
}

export function buildShippingLabelPath(
  pedidoNumero: string | number | null | undefined,
  shipmentId: string | number | null | undefined,
): string | null {
  const shipment = normalizePathSegment(shipmentId);
  if (!shipment) return null;
  const pedido = normalizePathSegment(pedidoNumero) || 'sem_pedido';
  return `${pedido}/${shipment}.pdf`;
}

export function buildThermalShippingLabelPath(
  pedidoNumero: string | number | null | undefined,
  shipmentId: string | number | null | undefined,
): string | null {
  const shipment = normalizePathSegment(shipmentId);
  if (!shipment) return null;
  const pedido = normalizePathSegment(pedidoNumero) || 'sem_pedido';
  return `${pedido}/${shipment}.zpl`;
}

export async function createShippingLabelSignedUrl(
  client: ServiceClient,
  filePath: string,
  ttlSeconds = SHIPPING_LABEL_SIGNED_URL_TTL_SECONDS,
  downloadFileName?: string,
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(SHIPPING_LABEL_BUCKET)
    .createSignedUrl(filePath, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  if (!downloadFileName) return data.signedUrl;
  const signedUrl = new URL(data.signedUrl);
  signedUrl.searchParams.set('download', downloadFileName);
  return signedUrl.toString();
}

export async function downloadShippingLabelFromStorage(
  client: ServiceClient,
  filePath: string | null | undefined,
): Promise<Buffer | null> {
  const path = String(filePath || '').trim();
  if (!path) return null;
  const { data, error } = await client.storage
    .from(SHIPPING_LABEL_BUCKET)
    .download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function storeShippingLabelForPedido(input: StoreShippingLabelInput): Promise<StoreShippingLabelResult> {
  const storagePath = buildShippingLabelPath(input.pedidoNumero, input.shipmentId);
  if (!storagePath) {
    return {
      ok: false,
      storagePath: null,
      signedUrl: null,
      error: 'Pedido sem shipment ML para armazenar etiqueta',
    };
  }

  const upload = await input.client.storage
    .from(SHIPPING_LABEL_BUCKET)
    .upload(storagePath, input.pdf, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (upload.error) {
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId: input.mlOrderId || null,
      evento: 'ml_label_storage_failed',
      payloadEnviado: {
        source: input.source,
        storage_path: storagePath,
        ml_shipment_id: input.shipmentId,
        bytes: input.pdf.length,
      },
      respostaMl: {
        error: upload.error.message,
      },
      statusResultante: 'failed',
    });
    return {
      ok: false,
      storagePath,
      signedUrl: null,
      error: upload.error.message,
    };
  }

  const signedUrl = await createShippingLabelSignedUrl(input.client, storagePath);
  await input.client
    .from('pedidos')
    .update({
      ml_label_storage_path: storagePath,
      ml_label_url: signedUrl,
      ml_label_downloaded_at: new Date().toISOString(),
      ml_label_bytes: input.pdf.length,
    } as any)
    .eq('id', input.pedidoId);

  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    mlOrderId: input.mlOrderId || null,
    evento: 'ml_label_storage_success',
    payloadEnviado: {
      source: input.source,
      storage_path: storagePath,
      ml_shipment_id: input.shipmentId,
      bytes: input.pdf.length,
    },
    respostaMl: {
      signed_url_generated: Boolean(signedUrl),
    },
    statusResultante: 'success',
  });

  return {
    ok: true,
    storagePath,
    signedUrl,
  };
}

export async function storeThermalShippingLabelForPedido(
  input: StoreThermalShippingLabelInput,
): Promise<StoreShippingLabelResult> {
  const storagePath = buildThermalShippingLabelPath(input.pedidoNumero, input.shipmentId);
  if (!storagePath) {
    return {
      ok: false,
      storagePath: null,
      signedUrl: null,
      error: 'Pedido sem shipment ML para armazenar etiqueta térmica',
    };
  }

  const upload = await input.client.storage
    .from(SHIPPING_LABEL_BUCKET)
    .upload(storagePath, input.zpl, {
      contentType: 'text/plain',
      upsert: true,
    });

  if (upload.error) {
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId: input.mlOrderId || null,
      evento: 'ml_label_storage_failed',
      payloadEnviado: {
        source: input.source,
        storage_path: storagePath,
        ml_shipment_id: input.shipmentId,
        response_type: 'zpl2',
        bytes: input.zpl.length,
      },
      respostaMl: { error: upload.error.message },
      statusResultante: 'failed',
    });
    return {
      ok: false,
      storagePath,
      signedUrl: null,
      error: upload.error.message,
    };
  }

  const signedUrl = await createShippingLabelSignedUrl(
    input.client,
    storagePath,
    SHIPPING_LABEL_SIGNED_URL_TTL_SECONDS,
    `etiqueta_ml_${normalizePathSegment(input.pedidoNumero) || input.shipmentId}.zpl`,
  );
  const { error: pedidoUpdateError } = await input.client
    .from('pedidos')
    .update({
      ml_thermal_label_storage_path: storagePath,
      ml_thermal_label_downloaded_at: new Date().toISOString(),
      ml_thermal_label_bytes: input.zpl.length,
    })
    .eq('id', input.pedidoId);

  if (pedidoUpdateError) {
    return {
      ok: false,
      storagePath,
      signedUrl,
      error: pedidoUpdateError.message,
    };
  }

  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    mlOrderId: input.mlOrderId || null,
    evento: 'ml_label_storage_success',
    payloadEnviado: {
      source: input.source,
      storage_path: storagePath,
      ml_shipment_id: input.shipmentId,
      response_type: 'zpl2',
      bytes: input.zpl.length,
    },
    respostaMl: { signed_url_generated: Boolean(signedUrl) },
    statusResultante: 'success',
  });

  return {
    ok: true,
    storagePath,
    signedUrl,
  };
}
