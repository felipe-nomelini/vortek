# Vortek — Guia de Desenvolvimento

## Roadmap para Produção

---

## Fase 1 — Backend + Banco de Dados ✅ (Concluída)

- ✅ Supabase configurado (12 tabelas + RLS + triggers)
- ✅ Admin `admin@vortek.shop` / `Vortek@123` criado
- ✅ API routes de CRUD (produtos, pedidos, clientes, configuracoes)
- ✅ Login + middleware de autenticação
- ✅ Bling removido (15 arquivos modificados, 5 deletados, migration 00003)

---

## Fase 2 — Integrações Individuais ✅ (Concluída)

### Fluxo Final

```
Mercado Livre ←→ Vortek ERP ←→ DSLite (dropshipping + catálogo)
                              ←→ Brasil NFe (NF-e R$ 49,90/mês)
```

### 🟠 DSLite

**Configuração:** API DSLite com Token fixo no header `Token:`
- Base URL: `https://api.dslite.com.br`
- Empresa: VORTEK TECNOLOGIA (ID 7945) — CrossDocking/DropShipping ativo
- Validade: 29/05/2026

**Fornecedores disponíveis:**

| ID | Nome | Produtos | CrossDocking |
|---|---|---|---|
| 2 | HAYAMAX-PR | **6.642** | ✅ Ativo |
| 27 | FLORATTA JOIAS | 247 | ✅ Ativo |
| 39 | NOVA CENTER | 545 | ✅ Ativo |
| 81 | VITRINE OUTLET | 2.259 | ✅ Ativo |
| **Total** | | **~9.693** | |

| Funcionalidade | Endpoint API | Rota Vortek |
|---|---|---|
| Sync catálogo | `GET /CrossDocking/Catalogo/{fornecedorId}` | `POST /api/sync/catalogo` |
| Sync preço/estoque | `GET /CrossDocking/PrecoEstoque/{fornecedorId}` | `POST /api/sync/preco-estoque` |
| Criar pedido dropshipping | `POST /DropShipping/fornecedor/{id}/transportadora/{id}` | `POST /api/dslite/pedido` |
| Consultar status pedido | `GET /DropShipping/{id}` | `GET /api/dslite/pedido/status?dsid={id}` |

### 🟢 Brasil NFe

**Preço:** R$ **49,90**/mês — emissão **ilimitada** NF-e (modelo 55) + NFC-e (modelo 65)
**Testado em homologação:** ✅ NF-e emitida e autorizada pela SEFAZ

| Funcionalidade | Endpoint API | Rota Vortek |
|---|---|---|
| Emitir NF-e | `POST /services/fiscal/EnviarNotaFiscal` | `POST /api/nfe/emitir` |
| Cancelar NF-e | `POST /services/fiscal/CancelarNotaFiscal` | `POST /api/nfe/cancelar` |
| Status SEFAZ | `POST /services/statusSefaz` | `GET /api/nfe/status` |
| SDK oficial | `npm install brasilnfe` (TypeScript) | ✅ Instalado |

### 🔵 Mercado Livre OAuth2

- ✅ OAuth2 (connect + callback + refresh)
- ✅ Sincronizar anúncios
- ✅ Sincronizar pedidos

---

## Fase 3 — Job Queue + Feedback Visual ✅ (Concluída)

---

## Fase 4 — Limpeza e Organização do Código (NOVA)

**Validado via Context7:** Ant Design 5, Next.js 14 App Router, Supabase JS v2.

### 4.1 — Remover código morto (5 arquivos)

| Arquivo | Motivo |
|---|---|
| `src/components/Header.tsx` | Nunca importado |
| `src/components/ProgressModal.tsx` | Nunca importado |
| `src/lib/AntdRegistry.tsx` | Duplicado no `Providers.tsx` |
| `src/lib/api-key.ts` | `validateApiKey` nunca usada |
| `src/lib/theme.ts` | Tema duplicado no `Providers.tsx` |

### 4.2 — Consertar globals.css (validado pelo Ant Design 5 docs via Context7)

**Problema:** `globals.css` força `min-height: 38px !important` em Input, Select e InputNumber, ignorando o `size` prop do Ant Design.

**Solução:** Remover as linhas 12-27 do `globals.css`. O Ant Design 5 controla altura via **Component Tokens** no `ConfigProvider`:

```tsx
// lib/Providers.tsx
<ConfigProvider theme={{
  components: {
    Input: { controlHeight: 32 },
    Select: { controlHeight: 32 },
    InputNumber: { controlHeight: 32 },
  },
}}>
```

### 4.3 — Gerar tipos TypeScript do Supabase (validado pelo Supabase JS docs via Context7)

**Problema:** 44 usos de `any` em todo o código.

**Solução:** Rodar comando oficial do Supabase CLI:
```bash
supabase gen types typescript --linked > src/types/database.ts
```

Depois registrar no `createClient<Database>()` no `lib/supabase.ts`. TypeScript infere **todos** os tipos automaticamente — zero `any` manual.

### 4.4 — Extrair lógica duplicada

| Duplicata | Solução |
|---|---|
| `fetchAll()` em `api/clientes` e `api/pedidos` | Criar `lib/fetch-all.ts` |
| `mockClients` em `clientes/page` e `clientes/[id]` | Criar `lib/mocks/clientes.ts` |
| `refreshMLToken()` duplicata de `getValidMLToken()` | Remover função duplicada |

### 4.5 — Substituir stubs de dropdown por ações reais

| Onde | Qtde | Problema |
|---|---|---|
| Dropdowns em 8 páginas | 8 | `console.log(key + id)` em vez de ação real |
| Webhook ML | 4 | `console.log` sem estrutura |

### 4.6 — Documentar código (comentários)

| Escopo | Qtde | O que fazer |
|---|---|---|
| Serviços (`services/*.ts`) | 4 | JSDoc completo (`@param`, `@returns`) |
| Rotas (`api/**/route.ts`) | 21 | 1 linha descritiva no topo |
| Tipos (`types/*.ts`) | 3 | JSDoc em cada interface |
| Componentes (`components/*.tsx`) | 3 | JSDoc no componente e props |
| Páginas (`(app)/**/page.tsx`) | 15 | 1 linha descritiva no topo |

---

## Fase 5 — Funcionalidades Completas (pendentes)

| Ação | API | Prioridade |
|---|---|---|
| Conectar páginas mock ao backend | — | 🔴 Alta |
| Criar anúncio ML | `POST /items` | 🔴 Alta |
| Ativar/Pausar anúncio ML | `PUT /items/{id}` | 🟡 Média |
| Atualizar preço no ML | `PUT /items/{id}` | 🟡 Média |
| Responder perguntas ML | `POST /answers` | 🟡 Média |
| Mapear produto (DE/PARA) DSLite | `PUT /Catalogo/{id}/{produtoId}` | 🔴 Alta |
| Cancelar NF-e na UI | Brasil NFe | 🔜 |
| Carta de Correção CC-e | Brasil NFe | 🔜 |

### Páginas para migrar de mock para dados reais

| Página | Dados mock | API destino |
|---|---|---|
| `produtos/[id]/page.tsx` | 10 produtos | `GET /api/produtos?id=X` |
| `clientes/page.tsx` | 15 clientes | `GET /api/clientes` |
| `clientes/[id]/page.tsx` | 15 clientes | `GET /api/clientes?id=X` |
| `fornecedores/page.tsx` | 8 fornecedores | DSLite + Supabase |
| `catalogo/page.tsx` | 10 itens | Produtos + fornecedor |
| `perguntas/page.tsx` | 12 perguntas | `GET /questions/search` (ML) |
| `reclamacoes/page.tsx` | 6 reclamações | `GET /claims` (ML) |
| `reputacao/page.tsx` | 1 objeto | `GET /users/me` (ML) |
| `notas-fiscais/page.tsx` | 12 notas | Tabela `pedidos` (nfe_*) |
| `dashboard/page.tsx` | Gráficos mock | Dados reais de vendas/pedidos |

---

## Fase 6 — Deploy no Easypanel

### Registrar redirect URIs

| App | Redirect URI |
|---|---|
| **ML** | `https://app.vortek.shop/api/integracao/ml/callback` |

### Conectar

1. Acessar `https://app.vortek.shop/login`
2. Email: `admin@vortek.shop` / Senha: `Vortek@123`
3. Configurações → Integrações → preencher credenciais

### Ajustes obrigatórios de runtime/build (Nixpacks)

- Runtime Node fixado em **22** (`nixpacks.toml` com `NIXPACKS_NODE_VERSION=22`).
- Não enviar `SUPABASE_SERVICE_ROLE_KEY` e `API_SECRET_KEY` como **Build Args**.
- Definir `SUPABASE_SERVICE_ROLE_KEY` e `API_SECRET_KEY` apenas como **Runtime Environment Variables** no Easypanel.
- `NEXT_PUBLIC_*` pode permanecer em build/runtime quando necessário para bundle do frontend.
- Em caso de exposição em logs de build, **rotacionar imediatamente** as chaves e atualizar no painel.
- Rodar `npm run check:build-secrets` antes de deploy; deve retornar `[OK]`.

---

## Notas Técnicas

- **Rate limits apertados:** Especialmente no ML. Sync em massa precisa de fila com backoff.
- **SDK oficial:** `brasilnfe` (npm) mantido pela Brasil NFe, TypeScript nativo.
- **DSLite auth:** Header `Token:` (fixo, sem OAuth).
- **DSLite paginação:** Parâmetros `page`, `limit`. Padrão 1000 por página.
- **DSLite timeout:** 60s (alguns catálogos grandes podem precisar de mais).
- **Performance First:** onChange que dispara fetch a cada tecla é inaceitável para +100 registros. Use Enter key ou debounce.
- **Tipagem:** Use `supabase gen types typescript` antes de cada novo sync para manter os tipos do banco sincronizados.
- **Ant Design 5:** Nunca use `!important` no CSS global. Use `ConfigProvider` com Component Tokens.
- **AGENTS.md:** Regra Zero obriga a consultar documentação oficial antes de qualquer ação. Use o MCP Context7 para bibliotecas.

---

## Runbook — Incidente OAuth Mercado Livre (`auth_fatal`)

### Sintomas

- Logs com `401 (auth_fatal)` e `invalid access token`.
- Jobs de sync ML finalizando como `failed_auth`.
- `/api/ops/health` ou `/api/sync/cron-status` com `ml_auth.state = reauth_required` ou `blocked_until` ativo.

### Diagnóstico rápido

1. Consultar `integracoes` (tipo `mercadolivre`):
   - `conectado`
   - `last_refresh_at`
   - `last_refresh_error`
   - `last_refresh_error_code`
2. Confirmar se `last_refresh_error_code` é fatal (`invalid_grant`, `invalid_client`, `unauthorized_client`, `unauthorized_application`).
3. Verificar se o `cron-dispatch` está pulando tarefas ML com `action = skipped_auth_block`.

### Recuperação

1. Reautenticar integração ML no painel (fluxo OAuth connect/callback).
2. Confirmar transição para estado saudável:
   - `integracoes.conectado = true`
   - `last_refresh_error_code = null` (ou sem fatal)
   - `ml_auth.state = ok`
3. Validar manualmente:
   - `POST /api/sync/anuncios`
   - `POST /api/sync/pedidos`
4. Confirmar retorno do scheduler:
   - `cron-dispatch` volta a disparar `ml_anuncios` e `ml_pedidos`.

### Critérios de encerramento

- Sem novos `401 auth_fatal` por pelo menos 2 ciclos de cron.
- Jobs ML voltam a concluir com `completo`.
- `ml_auth.blocked_until` nulo.
