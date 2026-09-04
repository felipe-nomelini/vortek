import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth/admin';
import {
  configurationValidationMessage,
  operationConfigurationPatchSchema,
} from '@/lib/configuracoes/contracts';
import { listarEnderecosUsuarioMl, type MlUserAddress } from '@/lib/estoque-interno';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  CONFIGURATION_ROW_ID,
  loadOperationRuntimeConfiguration,
} from '@/services/operation-configuration';
import { recordConfigurationAudit } from '@/services/configuration-audit';

export const dynamic = 'force-dynamic';

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function addressDto(address: MlUserAddress) {
  const source = address as Record<string, any>;
  const city = String(source.city?.name || source.city || '').trim();
  const state = String(source.state?.name || source.state || '').trim();
  const line = String(source.address_line || source.street_name || '').trim();
  return {
    id: String(address.id),
    label: [line, city, state].filter(Boolean).join(' · ') || `Endereço ${address.id}`,
    zipCode: String(address.zip_code || '').replace(/\D/g, ''),
    isDefaultReturn: (address.types || []).includes('default_return_address'),
  };
}

async function loadDto(serviceClient: ReturnType<typeof createServiceClient>) {
  const [configuration, suppliersResult, addressResult] = await Promise.all([
    loadOperationRuntimeConfiguration(serviceClient),
    serviceClient
      .from('fornecedores')
      .select('id,dslite_id,apelido,nome,ativo,dropshipping,crossdocking,dropshipping_retired_at,dslite_catalog_xml_url')
      .order('apelido', { ascending: true }),
    listarEnderecosUsuarioMl()
      .then((addresses) => ({ addresses, error: null as string | null }))
      .catch((error) => ({ addresses: [] as MlUserAddress[], error: error instanceof Error ? error.message : 'Consulta indisponível' })),
  ]);
  if (suppliersResult.error) throw new Error(suppliersResult.error.message);

  return {
    orders: { delayedAfterMinutes: configuration.delayedAfterMinutes },
    internalStock: {
      configuredAddressId: configuration.returnAddress.addressId,
      configuredZipCode: configuration.returnAddress.zipCode,
      addresses: addressResult.addresses.map(addressDto),
      lookup: { available: !addressResult.error, error: addressResult.error },
    },
    suppliers: (suppliersResult.data || []).map((supplier) => ({
      id: supplier.id,
      dsliteId: supplier.dslite_id,
      name: supplier.apelido || supplier.nome,
      active: supplier.ativo,
      retired: Boolean(supplier.dropshipping_retired_at),
      externalDropshipping: supplier.dropshipping,
      crossdocking: supplier.crossdocking,
      xmlFeedConfigured: Boolean(supplier.dslite_catalog_xml_url),
    })),
    invariants: [
      'O estoque seguro soma a capacidade interna e a capacidade operacional dos fornecedores.',
      'Kits respeitam a capacidade do componente limitante.',
      'Criar pedido DSLite continua sendo uma ação explícita do operador.',
      'Fornecedores aposentados não voltam ao fulfillment.',
    ],
  };
}

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  try {
    return noStore(await loadDto(createServiceClient()));
  } catch (error) {
    return noStore({ erro: error instanceof Error ? error.message : 'Falha ao carregar configuração operacional' }, 500);
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const parsed = operationConfigurationPatchSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return noStore({ erro: configurationValidationMessage(parsed.error, 'Configuração operacional inválida') }, 422);
  }

  const serviceClient = createServiceClient();
  try {
    if (parsed.data.section === 'orders') {
      const previous = await loadOperationRuntimeConfiguration(serviceClient);
      const { error } = await serviceClient
        .from('configuracoes')
        .update({ order_operational_delay_minutes: parsed.data.delayedAfterMinutes })
        .eq('id', CONFIGURATION_ROW_ID);
      if (error) throw new Error(error.message);
      await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [{
        key: 'configuracoes.order_operational_delay_minutes',
        targetId: CONFIGURATION_ROW_ID,
        before: previous.delayedAfterMinutes,
        after: parsed.data.delayedAfterMinutes,
      }]);
    } else if (parsed.data.section === 'internal_stock') {
      const returnAddressId = parsed.data.returnAddressId;
      const [previous, addresses] = await Promise.all([
        loadOperationRuntimeConfiguration(serviceClient),
        listarEnderecosUsuarioMl(),
      ]);
      const selected = addresses.find((address) => (
        String(address.id) === returnAddressId
        && (address.types || []).includes('default_return_address')
      ));
      if (!selected) return noStore({ erro: 'Selecione o endereço padrão de devolução da conta Mercado Livre conectada' }, 422);
      const nextAddress = {
        addressId: String(selected.id),
        zipCode: String(selected.zip_code || '').replace(/\D/g, '') || null,
      };
      const { error } = await serviceClient
        .from('configuracoes')
        .update({
          internal_stock_return_address_id: nextAddress.addressId,
          internal_stock_return_zip_code: nextAddress.zipCode,
        })
        .eq('id', CONFIGURATION_ROW_ID);
      if (error) throw new Error(error.message);
      await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [{
        key: 'configuracoes.internal_stock_return_address',
        targetId: CONFIGURATION_ROW_ID,
        before: previous.returnAddress,
        after: nextAddress,
      }]);
    } else {
      const { data: supplier, error: loadError } = await serviceClient
        .from('fornecedores')
        .select('id,dslite_catalog_xml_url,dropshipping_retired_at')
        .eq('id', parsed.data.supplierId)
        .maybeSingle();
      if (loadError) throw new Error(loadError.message);
      if (!supplier) return noStore({ erro: 'Fornecedor não encontrado' }, 404);
      if (supplier.dropshipping_retired_at) return noStore({ erro: 'Fornecedor aposentado não aceita feed operacional' }, 422);
      const xmlUrl = parsed.data.xmlUrl ? parsed.data.xmlUrl.trim() : null;
      const { error } = await serviceClient
        .from('fornecedores')
        .update({ dslite_catalog_xml_url: xmlUrl })
        .eq('id', supplier.id);
      if (error) throw new Error(error.message);
      await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [{
        key: 'fornecedores.dslite_catalog_xml_url',
        targetId: supplier.id,
        before: supplier.dslite_catalog_xml_url,
        after: xmlUrl,
      }]);
    }

    return noStore(await loadDto(serviceClient));
  } catch (error) {
    return noStore({ erro: error instanceof Error ? error.message : 'Falha ao salvar configuração operacional' }, 500);
  }
}
