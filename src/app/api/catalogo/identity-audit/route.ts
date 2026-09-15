import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { createCatalogIdentityRun } from '@/services/catalog-identity-audit';

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.read');
  if (!auth.ok) return auth.response;
  const result = await (createServiceClient().from('ml_catalog_identity_runs' as any) as any)
    .select('id,state,mode,rule_version,baseline_filename,baseline_sha256,baseline_count,delta_count,total_count,manifest_hash,snapshot_at,started_at,finished_at,created_at,summary,safety_stop,approved_at')
    .order('created_at', { ascending: false }).limit(30);
  if (result.error) return json({ error: 'Não foi possível carregar as auditorias.' }, 503);
  return json({ data: result.data || [] });
}

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.manage');
  if (!auth.ok) return auth.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'Envie o CSV ou XLSX original.' }, 422);
  if (!file.size || file.size > 15 * 1024 * 1024) {
    return json({ error: 'O arquivo deve ter até 15 MB.', code: 'baseline_file_size_invalid' }, 422);
  }
  try {
    const run = await createCatalogIdentityRun({
      actorId: auth.userId,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return json({ data: run }, 201);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'baseline_import_failed';
    const messages: Record<string, string> = {
      baseline_file_type_invalid: 'Formato inválido. Use CSV ou XLSX.',
      baseline_file_size_invalid: 'O arquivo deve ter até 15 MB.',
      baseline_ml_item_id_column_missing: 'A coluna ml_item_id não foi encontrada.',
      baseline_requires_1550_unique_items: 'O baseline precisa conter exatamente 1.550 ml_item_id únicos.',
    };
    return json({ error: messages[code] || 'Não foi possível importar o baseline.', code }, 422);
  }
}
