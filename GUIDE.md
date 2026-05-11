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

## Fase 2 — Integrações Individuais (Em andamento)

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

**Sync catálogo:** Paginado (1000 por página), faz sync de todos os fornecedores ativos automaticamente se nenhum ID for informado.

**Campos mapeados por produto:**

| Campo DSLite | Campo Vortek |
|---|---|
| `produtoid` | `dslite_produto_id` |
| `produtoid_empresa` | `sku` |
| `titulo` | `nome` |
| `preco_crossdocking` | `custo` |
| `estoque` | `estoque` |
| `ean11` | `gtin` |
| `ncm` | `ncm` |
| `marca` | `marca` |
| `peso / largura / altura / profundidade` | `peso_liq / largura / altura / profundidade` |
| `descricao` | `descricao` |
| `categoria_nome` | `categoria` |
| `cest` | — (armazenar futuramente) |
| `ipi / icmsrate` | — (impostos) |

| Funcionalidade | Endpoint API | Rota Vortek |
|---|---|---|
| Sync catálogo (full) | `GET /CrossDocking/Catalogo/{fornecedorId}` | `POST /api/sync/catalogo` |
| Sync preço/estoque (rápido) | `GET /CrossDocking/PrecoEstoque/{fornecedorId}` | `POST /api/sync/preco-estoque` |
| Mapear produto (DE/PARA) | `PUT /CrossDocking/Catalogo/{fornecedorId}/{produtoId}/{produtoIdEmpresa}` | — (via service) |
| Criar pedido dropshipping | `POST /DropShipping/fornecedor/{id}/transportadora/{id}` | `POST /api/dslite/pedido` |
| Consultar status pedido | `GET /DropShipping/{id}` | `GET /api/dslite/pedido/status?dsid={id}` |
| Listar fornecedores | `GET /Empresa/fornecedor/status` | — (via service) |
| Listar categorias | `GET /CrossDocking/Categoria` | — (via service) |

### 🟢 Brasil NFe

**Configuração:** Token fixo no header `Token:`
**Preço:** R$ **49,90**/mês — emissão **ilimitada** NF-e (modelo 55) + NFC-e (modelo 65)

**Testado em homologação:** ✅ NF-e emitida e autorizada pela SEFAZ

| Funcionalidade | Endpoint API | Rota Vortek |
|---|---|---|
| Emitir NF-e | `POST /services/fiscal/EnviarNotaFiscal` | `POST /api/nfe/emitir` |
| Cancelar NF-e | `POST /services/fiscal/CancelarNotaFiscal` | `POST /api/nfe/cancelar` |
| Status SEFAZ | `POST /services/statusSefaz` | `GET /api/nfe/status` |
| Carta de Correção | `POST /services/fiscal/CartaCorrecao` | — |
| SDK oficial | `npm install brasilnfe` (TypeScript) | ✅ Instalado |

### 🔵 Mercado Livre OAuth2

- ✅ OAuth2 (connect + callback + refresh)
- ✅ Sincronizar anúncios
- ✅ Sincronizar pedidos
- 🔜 Criar/Ativar/Pausar anúncio
- 🔜 Responder perguntas
- 🔜 Webhooks

---

## Fase 3 — Job Queue + Feedback Visual ✅ (Concluída)

---

## Fase 3.5 — Automação das Sincronizações

**Status: ⏳ A implementar**

| Tarefa | Frequência | Gatilho |
|---|---|---|
| Sync catálogo DSLite → Vortek | Diária (6h) | Cron ou botão |
| Sync preço/estoque DSLite | Diária (6h) | Cron ou botão |
| Sync ML pedidos | A cada 15min | Cron + webhook |
| Criar pedido DSLite | Automático (ao receber pedido ML pago) | Evento |
| Emitir NF-e | Manual (botão) | Ação usuário |

---

## Fase 4 — Funcionalidades Completas

| Ação | API | Prioridade |
|---|---|---|
| Criar anúncio ML | `POST /items` | 🔴 Alta |
| Ativar/Pausar anúncio ML | `PUT /items/{id}` | 🟡 Média |
| Atualizar preço no ML | `PUT /items/{id}` | 🟡 Média |
| Responder perguntas ML | `POST /answers` | 🟡 Média |
| Mapear produto (DE/PARA) DSLite | `PUT /Catalogo/{id}/{produtoId}` | 🔴 Alta |
| Emitir NF-e (botão na página de pedidos) | Brasil NFe | ✅ |
| Cancelar NF-e na UI | Brasil NFe | 🔜 |
| Criar pedido DSLite (botão) | DSLite | ✅ |
| Carta de Correção CC-e | Brasil NFe | 🔜 |
| Consultar NF-e por chave | Brasil NFe | 🔜 (SDK limitado) |

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

---

## Notas Técnicas

- **Rate limits apertados:** Especialmente no ML. Sync em massa precisa de fila com backoff.
- **SDK oficial:** `brasilnfe` (npm) mantido pela Brasil NFe, TypeScript nativo.
- **DSLite auth:** Header `Token:` (fixo, sem OAuth).
- **DSLite paginação:** Parâmetros `page`, `limit`. Padrão 1000 por página.
- **DSLite timeout:** 60s (alguns catálogos grandes podem precisar de mais).
- **Ações em massa sempre com feedback:** Processar múltiplos itens DEVE abrir a Modal de Progresso.
- **AGENTS.md:** Regra Zero obriga a consultar documentação oficial antes de qualquer ação.
