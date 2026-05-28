import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

export const maxDuration = 300;

type SeedRow = {
  uf: string;
  nome: string;
  nome_normalizado: string;
  codigo_ibge: string;
  cep_inicio: string | null;
  cep_fim: string | null;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const domain = 'municipios:seed';
  let lockOwnerToken = '';
  let lockAcquired = false;

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_municipios_seed',
      ttlSeconds: 30 * 60,
      metadata: { source: 'api/sync/municipios-ibge/seed' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        records: { total_seed: 0, inserted: 0, updated: 0, failed: 0 },
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

  const seedPath = path.join(process.cwd(), 'src/data/municipios-ibge.seed.json');
  const raw = await fs.readFile(seedPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return NextResponse.json({ ok: false, erro: 'Seed inválido: formato não suportado' }, { status: 400 });
  }

  const seed: SeedRow[] = parsed.filter((r: any) => r && r.uf && r.nome && r.nome_normalizado && r.codigo_ibge);
  const chunks = chunk(seed, 500);
  const client = createServiceClient();

  let inseridos = 0;
  let atualizados = 0;
  let falhas = 0;
  const errors: Array<{ chunk: number; error: string }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i];
    const codigos = part.map((p) => p.codigo_ibge);

    const { data: existingRows, error: existingErr } = await (client
      .from('municipios_ibge' as any)
      .select('codigo_ibge')
      .in('codigo_ibge', codigos) as any);
    if (existingErr) {
      falhas += part.length;
      errors.push({ chunk: i + 1, error: existingErr.message });
      continue;
    }

    const existing = new Set((existingRows || []).map((r: any) => String(r.codigo_ibge)));
    for (const row of part) {
      if (existing.has(row.codigo_ibge)) atualizados += 1;
      else inseridos += 1;
    }

    const { error: upsertErr } = await (client
      .from('municipios_ibge' as any)
      .upsert(part as any, { onConflict: 'codigo_ibge' }) as any);
    if (upsertErr) {
      falhas += part.length;
      errors.push({ chunk: i + 1, error: upsertErr.message });
      inseridos -= part.filter((row) => !existing.has(row.codigo_ibge)).length;
      atualizados -= part.filter((row) => existing.has(row.codigo_ibge)).length;
    }
  }

  return NextResponse.json({
    success: falhas === 0,
    domain,
    ok: falhas === 0,
    total_seed: seed.length,
    inseridos,
    atualizados,
    falhas,
    chunks_total: chunks.length,
    errors,
    records: {
      total_seed: seed.length,
      inserted: inseridos,
      updated: atualizados,
      failed: falhas,
    },
    duration: { ms: Date.now() - startedAt },
  });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      errors: [{ code: 'municipios_seed_unexpected_error', message: err?.message || 'Erro inesperado no seed de municípios' }],
      records: { total_seed: 0, inserted: 0, updated: 0, failed: 0 },
      duration: { ms: Date.now() - startedAt },
      lock_acquired: lockAcquired,
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
