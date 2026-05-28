import type { SupabaseClient } from '@supabase/supabase-js';

type ResolveSource = 'ibge_exact' | 'ibge_zip' | 'none';
const IBGE_RUNTIME_FETCH_ENABLED = String(process.env.IBGE_RUNTIME_FETCH_ENABLED || 'false').toLowerCase() === 'true';

export type ResolveCodMunicipioResult = {
  codMunicipio: string | null;
  source: ResolveSource;
  reason?: string;
};

function normalizeUf(value: string | null | undefined): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('BR-') && raw.length >= 5) return raw.slice(3);
  return raw;
}

function normalizeCity(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeZip(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

async function ensureUfMunicipiosLoaded(client: SupabaseClient, uf: string): Promise<void> {
  const normalizedUf = normalizeUf(uf);
  if (!normalizedUf) return;

  const { count } = await (client.from('municipios_ibge' as any)
    .select('*', { count: 'exact', head: true })
    .eq('uf', normalizedUf) as any);
  if ((count || 0) > 0) return;

  const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${normalizedUf}/municipios`);
  if (!res.ok) return;
  const data: any[] = await res.json().catch(() => []);
  if (!Array.isArray(data) || data.length === 0) return;

  const rows = data
    .map((m: any) => {
      const nome = String(m?.nome || '').trim();
      const codigo = String(m?.id || '').trim();
      if (!nome || !/^\d{6,7}$/.test(codigo)) return null;
      return {
        uf: normalizedUf,
        nome,
        nome_normalizado: normalizeCity(nome),
        codigo_ibge: codigo.padStart(7, '0'),
      };
    })
    .filter(Boolean);

  if (rows.length > 0) {
    await (client.from('municipios_ibge' as any).upsert(rows as any, { onConflict: 'codigo_ibge' }) as any);
  }
}

export async function resolveCodMunicipio(params: {
  client: SupabaseClient;
  uf: string | null | undefined;
  cityName: string | null | undefined;
  zipCode?: string | null | undefined;
}): Promise<ResolveCodMunicipioResult> {
  const uf = normalizeUf(params.uf);
  const city = normalizeCity(params.cityName);
  const zip = normalizeZip(params.zipCode);

  if (!uf || !city) return { codMunicipio: null, source: 'none', reason: 'uf_or_city_missing' };
  const selectRows = async () => {
    const { data } = await (params.client
      .from('municipios_ibge' as any)
      .select('codigo_ibge,cep_inicio,cep_fim')
      .eq('uf', uf)
      .eq('nome_normalizado', city) as any);
    return Array.isArray(data) ? data as Array<{ codigo_ibge: string; cep_inicio?: string | null; cep_fim?: string | null }> : [];
  };

  let rows = await selectRows();
  if (rows.length === 0 && IBGE_RUNTIME_FETCH_ENABLED) {
    await ensureUfMunicipiosLoaded(params.client, uf);
    rows = await selectRows();
  }
  if (rows.length === 0) {
    return {
      codMunicipio: null,
      source: 'none',
      reason: IBGE_RUNTIME_FETCH_ENABLED ? 'no_match' : 'no_match_static',
    };
  }
  if (rows.length === 1) return { codMunicipio: rows[0].codigo_ibge, source: 'ibge_exact' };

  if (zip) {
    const zipNum = Number(zip);
    const ranged = rows.filter((r) => {
      const start = Number(String(r.cep_inicio || '').replace(/\D/g, ''));
      const end = Number(String(r.cep_fim || '').replace(/\D/g, ''));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) return false;
      return zipNum >= start && zipNum <= end;
    });
    if (ranged.length === 1) return { codMunicipio: ranged[0].codigo_ibge, source: 'ibge_zip' };
    if (ranged.length > 1) return { codMunicipio: null, source: 'none', reason: 'ambiguous_zip' };
  }

  return { codMunicipio: null, source: 'none', reason: 'ambiguous_city' };
}
