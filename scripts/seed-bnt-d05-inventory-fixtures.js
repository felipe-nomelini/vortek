#!/usr/bin/env node

const dns = require('node:dns/promises');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const connectionString = process.env.SUPABASE_DEV_DB_URL || '';
const apply = process.argv.includes('--apply');
const cleanupOnly = process.argv.includes('--cleanup');

async function preflight() {
  if (!apply) throw new Error('Use --apply para confirmar a gravação das amostras no supabase-dev.');
  if (!connectionString) throw new Error('Configure SUPABASE_DEV_DB_URL sem imprimir seu valor.');
  const parsed = new URL(connectionString);
  const resolved = await dns.lookup(parsed.hostname);
  if (parsed.hostname !== '192.168.1.162' || resolved.address !== '192.168.1.162') {
    throw new Error(`Destino bloqueado: ${resolved.address}. O único destino gravável é 192.168.1.162.`);
  }
  console.log('Destino confirmado: 192.168.1.162 (supabase-dev).');
}

async function main() {
  await preflight();
  const client = new Client({ connectionString, application_name: 'bnt_d05_fixture_seed' });
  await client.connect();
  try {
    if (cleanupOnly) {
      await client.query(`
        begin;
        delete from public.estoque_manifestacoes_nfe where recebimento_id in (
          select id from public.estoque_recebimentos_nfe where snapshot_source = 'bnt_d05_inventory_mock'
        );
        delete from public.estoque_interno_movimentacoes where snapshot_source = 'bnt_d05_inventory_mock';
        delete from public.estoque_recebimentos_nfe where snapshot_source = 'bnt_d05_inventory_mock';
        delete from public.produtos where sku like 'BNT-MOCK-D05-%';
        commit;
      `);
      console.log('Amostras BNT-D05 removidas do supabase-dev.');
      return;
    }
    const sql = fs.readFileSync(path.join(__dirname, 'seed-bnt-d05-inventory-fixtures.sql'), 'utf8');
    await client.query(sql);
    console.log('Criadas 9 NF-e de entrada e 5 posições visuais protegidas no supabase-dev.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
