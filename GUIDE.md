# Vortek — Guia de Desenvolvimento

## Roadmap para Produção

---

## Fase 1 — Backend + Banco de Dados (Fundação)

- Servidor Node/Express (ou API routes do Next.js)
- Supabase + PostgreSQL
- Tabelas: `produtos`, `pedidos`, `clientes`, `fornecedores`, `usuarios`, `configuracoes`
- Autenticação JWT (Supabase Auth)
- CRUD básico de todas as entidades

---

## Fase 1 — Backend + Banco de Dados ✅ (Concluída)

- ✅ Supabase configurado (12 tabelas + RLS + triggers)
- ✅ Admin `admin@vortek.shop` / `Vortek@123` criado
- ✅ API routes de CRUD (produtos, pedidos, clientes, configuracoes)
- ✅ Login + middlware de autenticação
- ✅ Build 24 páginas / 0 erros

---

## Fase 2 — Integrações Individuais (Em andamento)

### Estrutura da implementação

```
src/app/api/integracao/
├── ml/
│   ├── connect/route.ts     → GET → redirect para auth ML
│   └── callback/route.ts    → GET → recebe code, troca por token, salva no DB
├── bling/
│   ├── connect/route.ts     → GET → redirect para auth Bling
│   └── callback/route.ts    → GET → recebe code, troca por token, salva no DB
│
src/services/integration.ts  → refresh automático + helpers
```

### 🔵 Mercado Livre OAuth2

**Fluxo:**
1. Usuário clica "Conectar" → redirect para `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id={APP_ID}&redirect_uri={CALLBACK_URL}`
2. ML redireciona para `{CALLBACK_URL}?code={CODE}`
3. Servidor troca code por token: `POST https://api.mercadolibre.com/oauth/token`
4. Salva `access_token`, `refresh_token`, `user_id`, `expires_in` na tabela `integracoes`

**Refresh automático:** Antes de cada requisição, verifica se token expirou. Se sim, usa `refresh_token` para renovar.

**Rate limit:** ~10 req/min — fila com backoff nas sincronizações.

| Funcionalidade | Complexidade | Endpoint |
|---|---|---|
| OAuth2 (connect + callback + refresh) | 🔴 Alta | `/oauth/token` |
| Listar anúncios | 🟡 Média | `GET /users/{id}/items/search` |
| Criar anúncio | 🔴 Alta | `POST /items` |
| Ativar/Pausar anúncio | 🟢 Baixa | `PUT /items/{id}` |
| Atualizar preço | 🟢 Baixa | `PUT /items/{id}` |
| Sincronizar pedidos | 🟡 Média | `GET /orders/search` |
| Sincronizar visitas/vendidos | 🟡 Média | POST em lote |
| Responder perguntas | 🟢 Baixa | `POST /answers` |
| Gerenciar reclamações | 🟡 Média | `POST /post-purchase/v1/claims` |
| Reputação | 🟢 Baixa | `GET /users/me` |
| Webhooks | 🟡 Média | Notificações em tempo real |

### 🟢 Bling V3 OAuth2

**Fluxo:**
1. Usuário clica "Conectar" → redirect para `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id={CLIENT_ID}`
2. Bling redireciona para `{CALLBACK_URL}?code={CODE}`
3. Servidor troca code por token: `POST https://api.bling.com.br/Api/v3/oauth/token` com `Authorization: Basic base64(client_id:client_secret)`
4. Salva tokens na tabela `integracoes`

**Refresh:** Mesmo endpoint com `grant_type=refresh_token`.

| Funcionalidade | Complexidade | Endpoint |
|---|---|---|
| OAuth2 (connect + callback) | 🔴 Alta | `/Api/v3/oauth/token` |
| Sincronizar produtos | 🟡 Média | `GET /produtos` |
| Atualizar preço | 🟢 Baixa | `PATCH /produtos/{id}` |
| Ativar/Desativar produto | 🟢 Baixa | `PATCH /produtos/{id}/situacao` |
| Sincronizar pedidos | 🟡 Média | `GET /pedidos/vendas` |
| Sincronizar clientes | 🟡 Média | `GET /contatos` |

### 🟠 DSLite

- Token fixo: `Authorization: Bearer {token}`
- Armazenar na tabela `integracoes` com `tipo: 'dslite'`

---

## Fase 3 — Job Queue + Feedback Visual

### Arquitetura
- Backend: **Job Queue** (Bull + Redis)
- Frontend: **Polling** (`GET /api/jobs/{id}`) ou WebSocket
- Cada job tem: `id`, `status`, `progresso`, `log[]`, `cancellable`

### Modal de Progresso (Componente Único)

```
┌────────────────────────────────────────────────┐
│  🔄 Sincronizando Produtos com Bling            │
│                                                  │
│  ████████████████░░░░░░░░░░░░░░  45%             │
│  Processando: 45 de 100 produtos                 │
│                                                  │
│  ┌─ Log ───────────────────────────────────┐    │
│  │ ✅ FONE-001 → Preço atualizado          │    │
│  │ ✅ CAPA-002 → Preço atualizado          │    │
│  │ ❌ MOUSE-005 → Erro: rate limit (tent  │    │
│  │   ativa 2 em 5s)                        │    │
│  │ ⏳ CAB-008 → Aguardando...              │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  [⏹️  Cancelar]                     [Fechar]     │
└────────────────────────────────────────────────┘
```

### Funcionalidades da Modal
- Barra de progresso (0-100%)
- Log em tempo real com ícones (✅ ❌ ⏳)
- Tentativas com backoff (rate limit)
- Cancelar (mata o job no backend)
- Sumário ao final (X concluídos, Y erros, Z cancelados)

---

## Fase 4 — Funcionalidades Completas

Cada ação implementada endpoint por endpoint, substituindo os placeholders (`console.log`):

- Atualizar preço no Bling → `PATCH /produtos/{id}`
- Ativar/Desativar no Bling → `PATCH /produtos/{id}/situacao`
- Criar anúncio no ML → `POST /items`
- Atualizar preço no ML → `PUT /items/{id}`
- Responder pergunta → `POST /answers`
- Sincronizar catálogo completo → Job queue
- Sincronizar pedidos (ML + Bling) → Job queue
- Emitir nota fiscal → Requer certificado

---

## Fase 5 — Deploy no Easypanel

### Preparar o repositório

```bash
cd /home/nomelini/projetos/vortek
git init
echo ".env.local" > .gitignore
echo ".next" >> .gitignore
echo "node_modules" >> .gitignore
git add -A
git commit -m "v0.1 - Setup inicial + Fase 2 OAuth integracoes"
git branch -M main
git remote add origin https://github.com/felipe-nomelini/vortek.git
git push -u origin main
```

### Configurar no Easypanel

| Etapa | Ação |
|---|---|
| 1. Novo projeto | Nome: `vortek` |
| 2. + Service | Tipo: **App** |
| 3. Fonte | GitHub → `felipe-nomelini/vortek` |
| 4. Build | **Nixpacks** (automático, sem Dockerfile) |
| 5. Variáveis | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` |
| 6. Domínio | Configurar `app.vortek.shop` |
| 7. Deploy | Clicar e aguardar (1-2 min) |

### Registrar redirect URIs

| App | Redirect URI |
|---|---|
| **ML** | `https://app.vortek.shop/api/integracao/ml/callback` |
| **Bling** | `https://app.vortek.shop/api/integracao/bling/callback` |

### Conectar

1. Acessar `https://app.vortek.shop/login`
2. Email: `admin@vortek.shop` / Senha: `Vortek@123`
3. Configurações → Integrações → preencher credenciais → Conectar

### Desenvolvimento local (depois dos tokens salvos)

```bash
npm run dev  # localhost:3000
```

---

## Notas Técnicas

- **Rate limits apertados:** Especialmente no ML. Qualquer sync em massa precisa de fila com backoff, ou chamadas são rejeitadas. Usar Bull + Redis para gerenciar filas.
- **Schemas mutáveis:** Bling e ML mudam schemas com frequência. Seguir o Protocolo de Consulta Obrigatória (MCP) do AGENTS.md — pesquisar documentação oficial antes de implementar qualquer endpoint.
- **OAuth2 require servidor:** Callbacks precisam de endpoint público (`/api/ml/callback`, `/api/bling/callback`).
- **Ações em massa sempre com feedback:** Toda ação que processa múltiplos itens DEVE abrir a Modal de Progresso. Sem exceção.
