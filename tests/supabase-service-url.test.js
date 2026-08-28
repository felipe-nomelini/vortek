const assert = require('node:assert/strict');
const test = require('node:test');
const { createServerClient } = require('@supabase/ssr');

const {
  resolveSupabaseAuthCookieName,
  resolveSupabaseServiceUrl,
} = require('../src/lib/supabase-url.ts');

test('service client prioriza endpoint interno quando ambos existem', () => {
  assert.equal(resolveSupabaseServiceUrl({
    SUPABASE_SERVICE_URL: 'http://192.168.1.160:8000',
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.vortek.shop',
  }), 'http://192.168.1.160:8000');
});

test('service client usa endpoint público somente como fallback', () => {
  assert.equal(resolveSupabaseServiceUrl({
    SUPABASE_SERVICE_URL: '',
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.vortek.shop',
  }), 'https://supabase.vortek.shop');
});

test('cliente SSR interno preserva o cookie derivado do endpoint público', () => {
  const publicUrl = 'https://supabase.vortek.shop';
  const internalUrl = 'http://192.168.1.160:8000';
  const cookieName = resolveSupabaseAuthCookieName({
    NEXT_PUBLIC_SUPABASE_URL: publicUrl,
  });
  const cookies = { getAll: () => [], setAll: () => {} };

  const publicClient = createServerClient(publicUrl, 'test-anon-key', {
    cookies,
  });
  const internalClient = createServerClient(internalUrl, 'test-anon-key', {
    cookieOptions: { name: cookieName },
    cookies,
  });

  assert.equal(cookieName, 'sb-supabase-auth-token');
  assert.equal(internalClient.auth.storageKey, publicClient.auth.storageKey);
});
