'use client';

/**
 * Cliente Supabase para uso no navegador (client components).
 * Usa createBrowserClient do @supabase/ssr (suporta cookies HTTP-only).
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
