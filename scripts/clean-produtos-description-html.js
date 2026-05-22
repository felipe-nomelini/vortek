/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');

function normalizeText(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

function stripHtmlToText(input) {
  return normalizeText(
    String(input ?? '')
      .replace(/<\s*br\s*\/?>/gi, ' ')
      .replace(/<\s*\/p\s*>/gi, ' ')
      .replace(/<\s*\/li\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  const fornecedorArg = process.argv.find((a) => a.startsWith('--fornecedor-id='));
  const fornecedorId = fornecedorArg ? fornecedorArg.split('=')[1] : '';

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const pageSize = 500;
  let from = 0;
  let analyzed = 0;
  let changed = 0;
  let skippedEmpty = 0;
  let errors = 0;
  const samples = [];

  while (true) {
    let query = supabase
      .from('produtos')
      .select('id, sku, descricao, dslite_fornecedor_id')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (fornecedorId) {
      query = query.eq('dslite_fornecedor_id', fornecedorId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const row of data) {
      analyzed += 1;
      const original = String(row.descricao ?? '');
      const cleaned = stripHtmlToText(original);

      if (!original || cleaned === normalizeText(original)) continue;
      if (!cleaned) {
        skippedEmpty += 1;
        continue;
      }

      changed += 1;
      if (samples.length < 20) {
        samples.push({ id: row.id, sku: row.sku, before: normalizeText(original).slice(0, 120), after: cleaned.slice(0, 120) });
      }

      if (apply) {
        const { error: updErr } = await supabase
          .from('produtos')
          .update({ descricao: cleaned })
          .eq('id', row.id);
        if (updErr) {
          errors += 1;
          console.error('update_error', row.id, updErr.message);
        }
      }
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    fornecedor_id: fornecedorId || null,
    analyzed,
    changed,
    skipped_empty: skippedEmpty,
    errors,
    samples,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
