import { createServiceClient } from '@/lib/supabase';

export async function getSyncRuntimeConfigValue(key: string): Promise<string | null> {
  const client = createServiceClient();
  const { data, error } = await (client
    .from('sync_runtime_config' as any)
    .select('value')
    .eq('key', key)
    .maybeSingle() as any);

  if (error) {
    throw new Error(`Falha ao ler sync_runtime_config (${key}): ${error.message}`);
  }

  return data?.value ? String(data.value) : null;
}

export async function setSyncRuntimeConfigValue(key: string, value: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await (client
    .from('sync_runtime_config' as any)
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: 'key' }) as any);

  if (error) {
    throw new Error(`Falha ao salvar sync_runtime_config (${key}): ${error.message}`);
  }
}

export async function getSyncRuntimeJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await getSyncRuntimeConfigValue(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setSyncRuntimeJson<T>(key: string, value: T): Promise<void> {
  await setSyncRuntimeConfigValue(key, JSON.stringify(value));
}

