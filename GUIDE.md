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

| Funcionalidade | Endpoint API | Fluxo/Rota Vortek |
|---|---|---|
| Garantir emissão/autorização NF-e | Brasil NFe | `POST /api/dslite/pedido` + `ensure-brasilnfe-invoice` |
| Cancelar NF-e | `POST /services/fiscal/CancelarNotaFiscal` | `POST /api/notas-fiscais/[id]/cancelar` |
| Carta de Correção (CC-e) | Brasil NFe | `POST /api/notas-fiscais/[id]/carta-correcao` |
| Visualizar DANFE | Brasil NFe + Storage | `GET /api/notas-fiscais/[id]/pdf` |
| Enviar DANFE por e-mail | SMTP + Brasil NFe/Storage | `POST /api/notas-fiscais/[id]/enviar-email` |
| SDK oficial | `npm install brasilnfe` (TypeScript) | ✅ Instalado |

### 🔵 Mercado Livre OAuth2

- ✅ OAuth2 (connect + callback + refresh)
- ✅ Sincronizar anúncios (observado + publicação)
- ✅ Sincronizar pedidos
- ✅ Criar anúncio
- ✅ Ativar/Pausar anúncio
- ✅ Atualizar preço e atacado
- ✅ Webhook de notificações (`topic=items`, pedidos e claims)

---

## Fase 3 — Job Queue + Feedback Visual ✅ (Concluída)

---

## Fase 4 — Limpeza e Organização do Código 🟡 (Parcialmente Concluída)

**Estado atual:** a maior parte da limpeza estrutural já foi feita, mas ainda restam pendências pontuais de tipagem, documentação e ações stub em telas específicas.

### 4.1 — Código morto removido ✅

Os arquivos abaixo já não existem mais no projeto:

| Arquivo | Status |
|---|---|
| `src/components/Header.tsx` | ✅ Removido |
| `src/components/ProgressModal.tsx` | ✅ Removido |
| `src/lib/AntdRegistry.tsx` | ✅ Removido |
| `src/lib/api-key.ts` | ✅ Removido |
| `src/lib/theme.ts` | ✅ Removido |

### 4.2 — `globals.css` e tema Ant Design ajustados ✅

- O CSS global não força mais altura com `!important` em `Input`, `Select` e `InputNumber`.
- O tema atual está centralizado no `ConfigProvider` em `src/lib/Providers.tsx`.
- Tokens de `Input`, `InputNumber` e `Select` já estão configurados no provider raiz.

### 4.3 — Tipos do Supabase gerados e em uso 🟡

- `src/types/database.ts` existe e está ativo no projeto.
- A base já não depende de tipagem manual para as tabelas principais.
- Ainda existem usos residuais de `any` fora do arquivo gerado, principalmente em integrações, jobs e helpers fiscais.

### 4.4 — Extrações e deduplicações parciais ✅

| Item | Estado atual |
|---|---|
| `lib/fetch-all.ts` | ✅ Existe |
| `lib/mocks/clientes.ts` | ✅ Existe |
| `refreshMLToken()` duplicada | ✅ Consolidada no fluxo com `getValidMLToken()` |

### 4.5 — Ações stub restantes 🟡

Ainda existem ações visuais sem integração completa em pontos específicos:

| Onde | Estado atual |
|---|---|
| `perguntas/page.tsx` | 🟡 Mock + ação stub/TODO |
| `reclamacoes/page.tsx` | 🟡 Mock + ação stub |
| `fornecedores/page.tsx` | 🟡 ação residual com `console.log` |
| `clientes/page.tsx` | 🟡 comentário `TODO: editar` |

### 4.6 — Documentação técnica 🟡

- O projeto já possui comentários úteis em serviços e fluxos mais complexos.
- Ainda não foi concluída a padronização total de JSDoc em serviços, rotas, tipos, componentes e páginas.

---

## Fase 5 — Funcionalidades do Produto (Status Real)

### ✅ Já concluído

| Funcionalidade | Estado atual |
|---|---|
| Criar anúncio ML | ✅ Implementado (`/api/ml/anuncio/criar`) |
| Ativar/Pausar anúncio ML | ✅ Implementado via produto/anúncio |
| Atualizar preço no ML | ✅ Implementado (`/api/ml/anuncio/atualizar-preco`) |
| Sync observado/publicação de anúncios ML | ✅ Implementado |
| Webhook ML de notificações | ✅ Implementado |
| Cancelar NF-e na UI | ✅ Implementado (`/api/notas-fiscais/[id]/cancelar`) |
| Carta de Correção CC-e | ✅ Implementado (`/api/notas-fiscais/[id]/carta-correcao`) |
| Dashboard com dados reais | ✅ Implementado |
| Notas Fiscais com dados reais | ✅ Implementado |
| Clientes com dados reais | ✅ Implementado |
| Fornecedores com dados reais | ✅ Implementado |
| Produtos detalhe com backend real | ✅ Implementado |
| Reputação ML com dados reais | ✅ Implementado |

### 🟡 Parcialmente concluído

| Funcionalidade | Estado atual |
|---|---|
| Mapear produto (DE/PARA) DSLite | 🟡 Fluxos de vínculo e catálogo existem, mas vale revisar se falta uma operação explícita de mapeamento manual fim-a-fim |
| Catálogo | 🟡 Fluxo real existe em `catalogo/elegiveis` e `catalogo/no-catalogo`; `catalogo/page.tsx` hoje redireciona para esse fluxo |
| Análises e sincronizações ML/DSLite | 🟡 Operacionais, mas ainda exigem acompanhamento e hardening contínuo |

### 🔴 Pendências reais

| Funcionalidade | Estado atual |
|---|---|
| Perguntas ML | 🔴 Tela ainda usa mock e ação stub |
| Reclamações ML | 🔴 Tela ainda usa mock e ação stub |
| Ações residuais de UI | 🔴 Restam `console.log` / `TODO` pontuais |

### Páginas ainda dependentes de mock ou integração incompleta

| Página | Estado atual |
|---|---|
| `perguntas/page.tsx` | `mockPerguntas` + ações stub |
| `reclamacoes/page.tsx` | `mockReclamacoes` + ações stub |

### Páginas já conectadas ao backend real

| Página | Estado atual |
|---|---|
| `produtos/[id]/page.tsx` | `GET/PATCH /api/produtos/[id]` |
| `clientes/page.tsx` | `GET /api/clientes` + resumo |
| `clientes/[id]/page.tsx` | `GET/PATCH /api/clientes/[id]` |
| `fornecedores/page.tsx` | `GET /api/fornecedores` |
| `dashboard/page.tsx` | `GET /api/dashboard/resumo` |
| `notas-fiscais/page.tsx` | `GET /api/notas-fiscais` + resumo + ações |
| `reputacao/page.tsx` | `GET /api/ml/reputacao` |
| `catalogo/page.tsx` | redireciona para o fluxo real de catálogo |

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
- Definir `BRASILNFE_TIPO_AMBIENTE=1` como **Runtime Environment Variable** obrigatória no Easypanel (produção fiscal).
- `NEXT_PUBLIC_*` pode permanecer em build/runtime quando necessário para bundle do frontend.
- Em caso de exposição em logs de build, **rotacionar imediatamente** as chaves e atualizar no painel.
- Rodar `npm run check:build-secrets` antes de deploy; deve retornar `[OK]`.

---

## O que falta para concluir o projeto

### Pendências funcionais principais

1. Integrar `Perguntas ML` com API real e resposta real.
2. Integrar `Reclamações ML` com API real e resposta/ação real.
3. Finalizar ações stub residuais em UI (`fornecedores`, `clientes` e pontos menores relacionados).

### Pendências técnicas secundárias

1. Reduzir usos residuais de `any` fora de `src/types/database.ts`.
2. Concluir a padronização de JSDoc/documentação técnica onde isso ainda fizer sentido como critério de qualidade.
3. Revisar se o produto precisa de uma tela unificada de catálogo além dos fluxos atuais `elegíveis` / `no catálogo`.

### Ordem recomendada de implementação

**Prioridade padrão:** primeiro fechamos lacunas funcionais visíveis ao usuário, depois eliminamos stubs residuais e, por fim, tratamos dívida técnica e refinamento documental.

1. **Perguntas ML**
   Integrar `perguntas/page.tsx` com API real do Mercado Livre, substituindo `mockPerguntas`, busca local e ação stub de resposta.
   Critério de conclusão: listar perguntas reais, responder pela UI e refletir o estado atualizado.

2. **Reclamações ML**
   Integrar `reclamacoes/page.tsx` com API real do Mercado Livre, substituindo `mockReclamacoes` e a ação stub de resposta/atendimento.
   Critério de conclusão: listar reclamações reais e executar ação real pela interface.

3. **Ações stub residuais de UI**
   Remover `console.log` e `TODO` remanescentes em telas já conectadas, principalmente `fornecedores` e `clientes`.
   Critério de conclusão: nenhuma ação visível ao usuário fica sem comportamento real.

4. **Redução de `any` residual**
   Atacar usos de `any` fora de `src/types/database.ts`, priorizando integrações, jobs e helpers mais críticos.
   Critério de conclusão: redução substancial nos pontos operacionais centrais, sem reescrita ampla.

5. **Padronização de documentação/JSDoc**
   Documentar serviços, fluxos e contratos realmente críticos para manutenção.
   Critério de conclusão: integrações e rotas sensíveis ficam autoexplicativas para manutenção futura.

6. **Decisão final sobre catálogo**
   Avaliar se o produto precisa de uma tela unificada de catálogo ou se os fluxos atuais `elegíveis` / `no catálogo` já fecham o escopo.
   Critério de conclusão: decisão registrada no guia, com `não necessário` ou `implementar depois`.

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

### SMTP Gmail (Envio de NF)

- Variáveis runtime obrigatórias:
  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=587`
  - `SMTP_SECURE=false`
  - `SMTP_USER=<conta smtp>`
  - `SMTP_PASS=<app-password>`
- Variável recomendada:
  - `EMAIL_FROM_NFE=<email remetente>`
- Fallback implementado: se `EMAIL_FROM_NFE` ausente, o sistema usa `SMTP_USER`.
- Segredos SMTP devem ficar apenas em runtime env (nunca em build args).

### Regra Fiscal CFOP (DSLite)

- Regra oficial obrigatória no fluxo de criação de pedido DSLite:
  - Mesmo estado (emitente e destinatário na mesma UF): `CFOP 5120`
  - Estado diferente (emitente e destinatário em UFs diferentes): `CFOP 6120`
- Apenas `5120` e `6120` são permitidos.
- Qualquer CFOP diferente, ausência de CFOP no XML, ou divergência da regra por UF bloqueia o pedido DSLite e exige correção na origem fiscal.

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
