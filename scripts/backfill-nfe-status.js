/**
 * Backfill de status fiscal (nfe_status) com fonte oficial do Mercado Livre.
 *
 * Uso:
 *   set -a; source .env.local; set +a; node scripts/backfill-nfe-status.js
 *
 * Opcional:
 *   ORDER_ID=2000016078960210 node scripts/backfill-nfe-status.js
 *   LIMIT=100 node scripts/backfill-nfe-status.js
 */

const { createClient } = require('@supabase/supabase-js');

function normalizeNfeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'authorized' || normalized === 'autorizada') return 'autorizada';
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancelada') return 'cancelada';
  if (!normalized) return 'pendente';
  return normalized;
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

  const orderId = (process.env.ORDER_ID || '').trim();
  const limit = Number(process.env.LIMIT || 200);

  const { data: integ, error: integError } = await sb
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .maybeSingle();

  if (integError || !integ?.access_token) {
    throw new Error(`Token ML indisponível: ${integError?.message || 'sem access_token'}`);
  }

  const token = integ.access_token;

  const meRes = await fetch('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${token}` },
  });

  const me = await meRes.json();
  if (!me?.id) {
    throw new Error('Falha ao obter /users/me no ML.');
  }

  let query = sb
    .from('pedidos')
    .select('id, ml_order_id, situacao, nota_fiscal_emitida, nfe_status')
    .not('ml_order_id', 'is', null)
    .eq('nota_fiscal_emitida', true)
    .limit(limit)
    .order('updated_at', { ascending: false });

  if (orderId) {
    query = query.eq('ml_order_id', orderId);
  }

  const { data: pedidos, error: pedidosError } = await query;

  if (pedidosError) {
    throw new Error(`Erro ao buscar pedidos: ${pedidosError.message}`);
  }

  let checked = 0;
  let updated = 0;
  let semInvoice = 0;
  let unchanged = 0;
  const errors = [];

  for (const p of pedidos || []) {
    checked += 1;
    const oid = String(p.ml_order_id);

    try {
      const invRes = await fetch(`https://api.mercadolibre.com/users/${me.id}/invoices/orders/${oid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (invRes.status === 404) {
        semInvoice += 1;
        continue;
      }

      if (!invRes.ok) {
        const txt = await invRes.text().catch(() => '');
        errors.push({ orderId: oid, status: invRes.status, error: txt.slice(0, 200) });
        continue;
      }

      const invoice = await invRes.json();
      const nextNfeStatus = normalizeNfeStatus(invoice?.status);
      const currentNfeStatus = String(p.nfe_status || '').toLowerCase();

      if (currentNfeStatus === nextNfeStatus.toLowerCase()) {
        unchanged += 1;
        continue;
      }

      const { error: updateErr } = await sb
        .from('pedidos')
        .update({
          nfe_status: nextNfeStatus,
          nota_fiscal_numero: invoice?.invoice_number ? String(invoice.invoice_number) : undefined,
          nfe_chave: invoice?.attributes?.invoice_key || undefined,
        })
        .eq('id', p.id);

      if (updateErr) {
        errors.push({ orderId: oid, status: 0, error: updateErr.message });
      } else {
        updated += 1;
      }
    } catch (err) {
      errors.push({ orderId: oid, status: 0, error: err?.message || String(err) });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    checked,
    updated,
    unchanged,
    semInvoice,
    errorsCount: errors.length,
    errors: errors.slice(0, 20),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
