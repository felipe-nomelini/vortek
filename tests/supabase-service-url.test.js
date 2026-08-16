const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveSupabaseServiceUrl } = require('../src/lib/supabase-url.ts');

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
