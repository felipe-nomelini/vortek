# Vortek — Guia de Desenvolvimento

## Roadmap para Produção

---

## Fase 1 — Backend + Banco de Dados ✅ (Concluída)

- ✅ Supabase configurado (12 tabelas + RLS + triggers)
- ✅ Admin `admin@vortek.shop` / `Vortek@123` criado
- ✅ API routes de CRUD (produtos, pedidos, clientes, configuracoes)
- ✅ Login + middleware de autenticação
- ✅ Build 24 páginas / 0 erros

---

## Fase 2 — Integrações Individuais (Em andamento)

### Fluxo Final (sem Bling)

```
Mercado Livre ←→ Vortek ERP ←→ DSLite (dropshipping + catálogo)
                              ←→ Brasil NFe (NF-e R$ 49,90/mês)
```

### Serviços Criados

| Arquivo | Função |
|---|---|
| `src/services/dslite.ts` | Catálogo, preço/estoque, pedidos dropshipping |
| `src/services/nfe.ts` | Emitir/cancelar/consultar NF-e via Brasil NFe (SDK `brasilnfe`) |

### 🟠 DSLite

**Configuração:** Token fixo no header `Token:` (armazenado em `integracoes` tipo `dslite`)

| Funcionalidade | Endpoint API | Rota Vortek |
|---|---|---|
| Sync catálogo | `GET /CrossDocking/Catalogo/{fornecedorId}` | `POST /api/sync/catalogo` |
| Sync preço/estoque | `GET /CrossDocking/PrecoEstoque/{fornecedorId}` | `POST /api/sync/preco-estoque` |
| Mapear produto (DE/PARA) | `PUT /CrossDocking/Catalogo/{fornecedorId}/{produtoId}/{produtoIdEmpresa}` | — (via service) |
| Criar pedido dropshipping | `POST /DropShipping/fornecedor/{id}/transportadora/{id}` | `POST /api/dslite/pedido` |
| Consultar status pedido | `GET /DropShipping/{id}` | `GET /api/dslite/pedido/status?dsid={id}` |

### 🟢 Brasil NFe

**Configuração:** Token fixo no header `Token:` (armazenado em `integracoes` tipo `brasilnfe`)
**Preço:** R$ **49,90**/mês — emissão **ilimitada** NF-e (modelo 55)

| Funcionalidade | Endpoint API | Rota Vortek |
|---|---|---|
| Emitir NF-e | `POST /services/fiscal/EnviarNotaFiscal` | `POST /api/nfe/emitir` |
| Cancelar NF-e | `POST /services/fiscal/CancelarNotaFiscal` | `POST /api/nfe/cancelar` |
| Status SEFAZ | `POST /services/statusSefaz` | `GET /api/nfe/status` |
| Carta de Correção | `POST /services/fiscal/CartaCorrecao` | — |
| SDK oficial | `npm install brasilnfe` (TypeScript) | ✅ Instalado |

### 🔵 Mercado Livre OAuth2 (já implementado)

- ✅ OAuth2 (connect + callback + refresh)
- ✅ Sincronizar anúncios
- ✅ Sincronizar pedidos
- 🔜 Criar/Ativar/Pausar anúncio
- 🔜 Responder perguntas
- 🔜 Webhooks

### 🟢 Bling V3 (depreciado — manter apenas para referência)

- ⚠️ Bloqueado por Cloudflare no VPS
- ⚠️ Refresh token consumido (single-use) — requer re-autorização
- ⏳ Será removido quando migração para DSLite + Brasil NFe estiver completa

### 🔵 Webhooks do Mercado Livre

**Endpoint:** `POST /api/webhooks/ml/notifications`

**Registrar no ML:** `https://app.vortek.shop/api/webhooks/ml/notifications`

**Topics:** `orders`, `questions`, `claims`, `payments`, `items`

---

## Fase 3 — Job Queue + Feedback Visual ✅ (Concluída)

- ✅ Estrutura criada (ProgressModal, jobs API, job-queue service)

---

## Fase 3.5 — Automação das Sincronizações

**Status: ⏳ A implementar**

| Tarefa | Frequência | Gatilho |
|---|---|---|
| Sync catálogo DSLite → Vortek | Diária (6h) | Cron ou botão |
| Sync preço/estoque DSLite | Diária (6h) | Cron ou botão |
| Sync ML pedidos | A cada 15min | Cron + webhook |
| Criar pedido DSLite | Automático (ao receber pedido ML pago) | Evento |
| Emitir NF-e | Manual (botão) ou automático | Ação usuário |

### Opções de implementação

| Curto prazo | Médio prazo | Longo prazo |
|---|---|---|
| Cron job no VPS + botão "Sync Now" | Job Queue com Redis | Agendamento configurável pelo usuário |

---

## Fase 4 — Funcionalidades Completas

| Ação | API | Prioridade |
|---|---|---|
| Criar anúncio ML | `POST /items` | 🔴 Alta |
| Ativar/Pausar anúncio ML | `PUT /items/{id}` | 🟡 Média |
| Atualizar preço no ML | `PUT /items/{id}` | 🟡 Média |
| Responder perguntas ML | `POST /answers` | 🟡 Média |
| Mapear produto (DE/PARA) DSLite | `PUT /Catalogo/{id}/{produtoId}` | 🔴 Alta |
| Emitir NF-e (botão na página de pedidos) | Brasil NFe | ✅ Implementado |
| Cancelar NF-e (botão na página de pedidos) | Brasil NFe | 🔜 Pendente |
| Criar pedido DSLite (botão na página de pedidos) | DSLite | ✅ Implementado |

---

## Fase 5 — Deploy no Easypanel

### Registrar redirect URIs

| App | Redirect URI |
|---|---|
| **ML** | `https://app.vortek.shop/api/integracao/ml/callback` |

### Conectar

1. Acessar `https://app.vortek.shop/login`
2. Email: `admin@vortek.shop` / Senha: `Vortek@123`
3. Configurações → Integrações → preencher credenciais

### Migração do banco

Após deploy, rodar a migration no SQL Editor do Supabase:

```sql
-- supabase/migrations/00002_nfe_dslite.sql
alter type integracao_tipo add value if not exists 'brasilnfe';
alter table public.pedidos add column if not exists nfe_chave text;
alter table public.pedidos add column if not exists nfe_xml text;
alter table public.pedidos add column if not exists nfe_danfe_url text;
alter table public.pedidos add column if not exists nfe_protocolo text;
alter table public.pedidos add column if not exists nfe_status text default 'pendente';
alter table public.pedidos add column if not exists dslite_id text;
alter table public.pedidos add column if not exists dslite_status text;
alter table public.produtos add column if not exists dslite_fornecedor_id text;
alter table public.produtos add column if not exists dslite_produto_id text;
alter table public.produtos add column if not exists dslite_ultima_sync timestamptz;
insert into public.integracoes (tipo, conectado) values ('brasilnfe', false) on conflict (tipo) do nothing;
```

---

## Notas Técnicas

- **Rate limits apertados:** Especialmente no ML. Qualquer sync em massa precisa de fila com backoff, ou chamadas são rejeitadas.
- **SDK oficial:** `brasilnfe` (npm) mantido pela Brasil NFe, TypeScript nativo.
- **DSLite auth:** Header `Token:` (fixo, sem OAuth).
- **Ações em massa sempre com feedback:** Toda ação que processa múltiplos itens DEVE abrir a Modal de Progresso. Sem exceção.
