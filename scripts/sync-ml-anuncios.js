/**
 * Script de sincronização completa de anúncios do Mercado Livre.
 * Chama a API /api/sync/anuncios em loop paginado até sincronizar todos.
 * Depois chama /api/sync/vincular-produtos para vincular SKUs.
 */
const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_SECRET_KEY;

if (!API_KEY) {
  console.error('Erro: API_SECRET_KEY não definida');
  process.exit(1);
}

async function syncAnuncios() {
  let offset = 0;
  let totalSincronizados = 0;
  let pagina = 1;

  while (true) {
    console.log(`\n[Pagina ${pagina}] offset=${offset}`);
    const res = await fetch(`${API_URL}/api/sync/anuncios?offset=${offset}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Erro HTTP ${res.status}: ${text}`);
      process.exit(1);
    }

    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));

    if (data.erro) {
      console.error(`Erro: ${data.erro}`);
      process.exit(1);
    }

    totalSincronizados += data.sincronizados || 0;

    if (data.acabou) {
      console.log(`\n✅ Sincronização de anúncios completa. Total sincronizado: ${totalSincronizados}`);
      break;
    }

    offset = data.proximo;
    pagina++;
  }
}

async function vincularProdutos() {
  console.log('\n[Vinculando produtos...]');
  const res = await fetch(`${API_URL}/api/sync/vincular-produtos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Erro HTTP ${res.status}: ${text}`);
    return;
  }

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

(async () => {
  await syncAnuncios();
  await vincularProdutos();
  console.log('\n🏁 Processo completo.');
})();
