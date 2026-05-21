/**
 * Auditoria de conteúdo faltante para produtos Floratta (fornecedor 27 / SKU FJ*)
 *
 * Uso:
 *   set -a; source .env.local; set +a; node scripts/audit-floratta-missing-content.js
 */

const { createClient } = require('@supabase/supabase-js');

function normalizeText(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

function hasImages(value) {
  return Array.isArray(value) && value.some((v) => normalizeText(v));
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error('SUPABASE não configurado no ambiente.');
  }

  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await sb
    .from('produtos')
    .select('id, sku, nome, dslite_fornecedor_id, descricao, imagens, dslite_ultima_sync')
    .or('dslite_fornecedor_id.eq.27,sku.ilike.FJ%')
    .order('updated_at', { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(`Erro ao consultar produtos: ${error.message}`);
  }

  let semDescricao = 0;
  let semImagens = 0;
  let semAmbos = 0;
  const exemplos = [];

  for (const row of data || []) {
    const missingDescription = !normalizeText(row.descricao);
    const missingImages = !hasImages(row.imagens);
    if (missingDescription) semDescricao += 1;
    if (missingImages) semImagens += 1;
    if (missingDescription && missingImages) semAmbos += 1;

    if ((missingDescription || missingImages) && exemplos.length < 25) {
      exemplos.push({
        id: row.id,
        sku: row.sku,
        nome: row.nome,
        missing_description: missingDescription,
        missing_images: missingImages,
        dslite_ultima_sync: row.dslite_ultima_sync,
      });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    total_floratta: (data || []).length,
    sem_descricao: semDescricao,
    sem_imagens: semImagens,
    sem_ambos: semAmbos,
    exemplos,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});

