import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type ServiceClient = SupabaseClient<Database>;

type ShortLinkInput = {
  client: ServiceClient;
  baseUrl: string;
  targetUrl: string | null | undefined;
  purpose?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
};

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function buildDeterministicCode(targetUrl: string, purpose?: string | null): string {
  const hash = createHash('sha256')
    .update(`${purpose || 'link'}:${targetUrl}`)
    .digest('base64url')
    .replace(/[^a-zA-Z0-9]/g, '');
  return hash.slice(0, 8);
}

function buildFallbackCode(): string {
  return randomBytes(5).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
}

export async function createShortLink(input: ShortLinkInput): Promise<string | null> {
  const targetUrl = String(input.targetUrl || '').trim();
  if (!targetUrl) return null;

  const code = buildDeterministicCode(targetUrl, input.purpose);
  const payload = {
    code,
    target_url: targetUrl,
    purpose: input.purpose || null,
    metadata: input.metadata || {},
    expires_at: input.expiresAt || null,
  };

  const { error } = await (input.client as any)
    .from('short_links')
    .upsert(payload, { onConflict: 'code' });

  if (error) {
    const fallbackCode = buildFallbackCode();
    const fallback = await (input.client as any)
      .from('short_links')
      .insert({ ...payload, code: fallbackCode });
    if (fallback.error) return targetUrl;
    return `${normalizeBaseUrl(input.baseUrl)}/s/${fallbackCode}`;
  }

  return `${normalizeBaseUrl(input.baseUrl)}/s/${code}`;
}
