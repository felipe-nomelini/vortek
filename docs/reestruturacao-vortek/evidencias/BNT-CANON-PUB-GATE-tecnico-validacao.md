# BNT-CANON-PUB-GATE — marco 1 técnico

Data: 08/09/2026. Branch: `dev`. Base local: `e35970c`, com alterações documentais preexistentes preservadas.

**Situação: implementação e regressões concluídas; publicada em DEV; conta de teste conectada na última verificação. Recorte técnico do marco 1 concluído para sequência; aceite autenticado e prova externa transferidos ao marco 6 por decisão do usuário. PUB-GATE integral não encerrado.** A publicação autorizada está registrada abaixo; não habilitou escrita comercial ML. Próxima ação: planejar V2-15 operacional no marco 2.

## Decisão de sequência — após o deploy de 08/09/2026

O usuário aprovou avançar nas etapas e realizar a prova externa de publicação/preço na ativação real acompanhada. Não preparar novo produto de teste nem ampliar agora a homologação visual desta ação. O marco 2 fica liberado pelo recorte técnico já comprovado; os 219 testes anteriores e smokes não são convertidos em evidência de operação externa ou aceite autenticado.

Risco aceito para desenvolvimento: a primeira prova real pode revelar divergências ainda não observadas. O risco não foi eliminado e continua bloqueador da liberação geral do fluxo se materializado. A capacidade produtiva deve ser preparada e testada no marco 5; o aceite autenticado e a prova externa, junto de ME2, pertencem ao marco 6. Sequência e critérios são os de [Bentevi em operação](../VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md#bentevi-em-operacao).

Esta atualização é exclusivamente documental: não habilita `test_only`, não seleciona produto, não altera amostras protegidas, código, banco, credenciais ou produção. Testes automatizados continuam obrigatórios por mudança. Nenhum commit/push/deploy novo é necessário nesta tarefa.

**Validação desta atualização documental (08/09/2026):** branch `dev`, árvore inicialmente limpa; seis documentos alterados, sem arquivos funcionais. Conferência automatizada aprovou sete marcos únicos, V2-15 operacional como próxima ação, V2-15/D20 ainda pendentes, capacidade produtiva no marco 5, prova externa no marco 6 e PUB-GATE integral aberto; 84 links locais conferidos. `npm run validate` (lint/typecheck) e `git diff --check` aprovados. A suíte funcional de 219 testes e o build abaixo são evidências anteriores, não reexecutadas nesta tarefa documental. Sem acesso à infraestrutura, migrations, alteração de `AGENTS.md`, commit, push ou deploy nesta atualização. Contratos externos e homologação runtime: não aplicáveis a esta alteração de sequência, permanecendo obrigatórios nas respectivas ações técnicas.

## AS_IS → TO_BE implementado

| Antes | Agora | Dono |
|---|---|---|
| Rotas antigas de criação/preço guardadas, com implementação comercial legada ainda atrás do bloqueio | Criação apenas prepara; endpoint de preço bruto continua bloqueado e perdeu o escritor antigo | Rotas `ml/anuncio/criar` e `ml/anuncio/atualizar-preco` |
| Decisão aprovada sem transporte operacional | Aprovação consumida uma vez, intenção persistida, mesmo outbox/worker e conferência remota | `pricing-dispatch`, RPCs de decisões/operações e worker `sync/anuncios/publish` |
| Formulário de Produtos encaminhava preço bruto | Formulário registra proposta; central separa aprovar, aplicar e conferir | `PricingDecisionCenter` e `/produtos` |
| Anúncio novo não tinha item/grupo remoto antes do POST | Intenção `listing_create` com IDs nulos; captura remota imediata e grupo anexado somente depois da conferência | `pricing_operations`, `capture_pricing_created_item`, `publication-readback` |

Não foram criados fila, scheduler, tabela de jobs ou motor econômico paralelos. Preço sugerido/cotação continuam em `pricing-detail` → `pricing-live` → economia canônica. `custom_price` não é usado como prova de alteração manual.

## Contrato de execução

`preparar → aprovar → consumir/enfileirar → revalidar → claim atômico → enviar uma vez → conferir → confirmar ou manter inconclusivo`.

- `ML_PRICING_EXECUTION_MODE=disabled` por padrão. `test_only` exige URL DEV/local, allowlist explícita, seller exato, site MLB e tag `test_user`.
- Destino do cliente Supabase resolvido deve ser exclusivamente `192.168.1.162`. A identidade do token efetivamente usado é verificada imediatamente antes do envio.
- Os escritores legados continuam incondicionalmente bloqueados, inclusive quando o transporte canônico de teste for habilitado.
- Nova publicação exige produto ativo, SKU, oferta/capacidade válidas, ausência de anúncio/vínculo inconclusivo, identidade/kit, garantia comprovada, cadastro fiscal, fotos HTTPS reais, logística explícita, economia válida e categoria/atributos condicionais/validador ML. Sem imagem substituta nem fórmulas por modo legado.
- Mudança de preço exige grupo verificado, economia recotada, identidade e elegibilidade atuais da origem e dos pares, sem preço automático ML. Variações permanecem explicitamente impedidas até contrato próprio; não se tenta uma escrita genérica nelas.
- Mudança material de custo, preço, grupo, identidade ou proteção invalida a proposta anterior. A governança SQL existente conserva override e liquidação explícitos.
- Claim com lock e transição `prepared → requested` antecede o HTTP. Redelivery de `requested`/`inconclusive` só lê; não envia novamente preço, criação ou descrição.
- Transporte comercial executa uma tentativa: não repete automaticamente após 401/429, timeout ou resposta perdida. Refresh prévio à primeira tentativa permanece no serviço OAuth existente.
- Novo ID retornado pelo ML é persistido antes de enviar descrição ou processar projeções. Criação só confirma após item/valor/identidade/garantia/descrição/imagens/logística/quantidade/economia/vínculo conferidos.
- Preço só confirma após origem e todos os membros do grupo apresentarem o valor aprovado em BRL, na conta esperada. HTTP 2xx sozinho não confirma.
- Falha comprovadamente anterior ao envio encerra a operação como `failed` e permite nova proposta, sem reutilizar a aprovação consumida. Resultado remoto incerto permanece `inconclusive` e exige conferência.

## Banco DEV

Migrations novas, sem reescrever histórico:

1. `20260908150000_pub_gate_price_dispatch.sql` — claim transacional de envio.
2. `20260908153000_pub_gate_publication_intent.sql` — intenção tipada de criação, captura remota e extensão dos contratos existentes.
3. `20260908160000_pub_gate_failed_proposal.sql` — nova proposta após falha local pré-envio, sem reutilizar decisão consumida.

Destino TCP confirmado `.162`; histórico/schema inspecionados; ensaios `BEGIN/ROLLBACK`; aplicação e registro no histórico na mesma transação. Tipos dos objetos afetados regenerados a partir do pg-meta da instância DEV. Testes SQL repetidos sobre o schema aplicado, sempre com rollback. Nenhuma fixture SQL persistida.

Fotografia ao terminar a implementação: conta ML DEV com `conectado=false`, sem access token; zero operações com `rule_id=PUB-GATE`.

Atualização de 08/09/2026, anterior à publicação: após o usuário corrigir o redirect do aplicativo para `https://dev.bentevi.shop/api/integracao/ml/callback` e conectar a conta, leitura em `.162` confirmou `conectado=true`, presença de access/refresh token e ausência de erro de refresh. `GET /users/me` retornou HTTP 200, seller `3648914818`, nickname `TESTUSER360990419984443265`, site `MLB` e tag `test_user`. Nenhum token foi reproduzido; a capacidade de execução permanece desabilitada.

## Validações executadas

- **219 testes aprovados, zero falhas**, na seleção abaixo, repetida antes do push/deploy e incluindo os sete testes do guard da conta ML (212 na implementação inicial).
- `tests/pricing-decisions.sql` e `tests/pub-gate-publication.sql`: lifecycle, permissões, expiração, revalidação, replay, consumo/outbox, claim único, captura idempotente, seller divergente, efeito incerto, conferência e nova aprovação após falha pré-envio. Executados em `.162` e revertidos.
- `npm run validate`: lint e typecheck aprovados.
- `npm run build`: aprovado, 122 páginas estáticas geradas. O build do projeto pula typecheck; por isso a verificação de tipos acima foi executada separadamente.
- `git diff --check`: aprovado. `AGENTS.md` sem alteração.
- Smoke no build local, `127.0.0.1:3107`: login 200; GET/POST `pricing/decisions/execute` e POST das rotas de criação/preço bruto retornaram 401 sem sessão. Servidor temporário encerrado. Não equivale a E2E autenticado/visual.

Seleção reproduzível de testes:

```bash
node --test tests/pub-gate-dispatch.test.js tests/pub-gate-preparation.test.js tests/pub-gate-price-evidence.test.js tests/pricing-decisions.test.js tests/m2m-prc-03-execution.test.js tests/m2m-cfl-02-consumers.test.js tests/ml-identity-block-lifecycle.test.js tests/product-warranty.test.js tests/ml-price-publish-tracking.test.js tests/bentevi-products.test.js tests/bentevi-listings.test.js tests/pricing-audit.test.js tests/pricing-audit-reconciliation.test.js tests/pricing-overrides.test.js tests/pricing-clearances.test.js tests/m2m-prc-04-live-pricing.test.js tests/ml-quantity-pricing.test.js tests/ml-account-guard.test.js
```

Os testes de transporte utilizam mocks e os SQL provam o contrato transacional; não são evidência de execução bem-sucedida na API viva nem de corrida entre processos reais.

## Pendências e limites de aceite

1. **Marco 5 — capacidade produtiva pendente:** preparar e testar o contrato produtivo canônico, preservando aprovação humana, auditoria, consumo idempotente, prevenção de duplicação, revalidação e read-back. O código atual exige `test_only`, conta `test_user` e `.162`; conectar a conta real ou remover o guard não é implementação suficiente. Ensaios permanecem em DEV `.162`; configuração/ativação produtivas somente pelo workspace `vortek-prod`, no release autorizado. Definir backup, recuperação e tratamento de efeitos externos já enviados antes da ativação.
2. **Marco 6 — aceite autenticado e prova externa transferidos, não realizados:** começar por leitura/conferência de preços, custos, tarifas e frete/ME2 da conta real no ambiente produtivo preparado. Validar preparação, decisão, aplicação, resultado e recuperação com uma publicação comercial selecionada e uma alteração de preço, aprovadas individualmente. Registrar IDs, operação/outbox, histórico, projeções, read-back e ausência de duplicação antes de ampliar uso. Manter um único executor por fluxo; resultado inconclusivo ou divergência material interrompe o fluxo afetado. Sem novo produto de teste como bloqueador da sequência DEV, sem transportar fixtures nem criar anúncio fictício na conta real. Os smokes sem sessão não substituem esse aceite.
3. Resposta perdida antes da captura do ID de criação não tem busca heurística/novo POST: permanece inconclusiva, exige investigação do anúncio remoto. Descrição falha não é reenviada automaticamente; a conferência aponta incompletude sem duplicar anúncio.
4. O cadastro fiscal é validado localmente, mas esta entrega **não realiza nem comprova vínculo fiscal externo no ML**. Verificar a necessidade/contrato no contexto comercial autorizado antes de liberar sua operação; não confundir NF-e/integração fiscal com cadastro de anúncio.
5. Frete/tarifa ME2 da conta real e aceitação comercial permanecem no **marco 6**, junto da prova transferida do marco 1. A capacidade produtiva é entrega obrigatória do marco 5; sua ativação fica no workspace produtivo/release autorizados, sem contornar o guard nem permitir escrita produtiva por este worktree.
6. Não foram comprovados externamente kit, reativação ou pares de catálogo nesta entrega. Os contratos existentes e testes de bloqueio/sincronização foram preservados; criação rejeita anúncios existentes/reativações, que não viram novo anúncio. Sem publicação em massa nem autonomia de preço.

## Publicação DEV — 08/09/2026

- Implementação/testes: commit `6a3a64ce`. Documentação/marcos autorizados: `9a18ff8f`.
- Push normal de `dev` concluído; candidato implantado: `9a18ff8f903d990d8beda7264d720894ef30f5bf`.
- Webhook conferido com a configuração real de `local/vortek-erp-dev`, branch `dev`, autoDeploy desabilitado. URL/segredo não reproduzidos. Usado `npm run deploy:easypanel`, sem bypass de Git nem atualização manual de serviço.
- Ação Easypanel `cmtsvy4qy000707o9gs5q1tcy`: `done`, criada às 16:30:11 UTC e concluída às 16:32:48 UTC (13:32:48 BRT). Build remoto compilado e 122 páginas geradas.
- Serviço DEV: atualização `completed`, réplica `Running`, `GIT_SHA` igual ao candidato. `https://dev.bentevi.shop/login`: HTTP 200. Sem sessão, GET/POST `/api/pricing/decisions/execute` e POST `/api/ml/anuncio/criar` e `/api/ml/anuncio/atualizar-preco`: HTTP 401.
- Conta de teste novamente verificada **após deploy**, por transação somente leitura em `.162` e `GET /users/me`: conectada, HTTP 200, seller `3648914818`, site MLB, tag `test_user`, sem erro de refresh. Sem renovar/copiar/exibir tokens.
- `ML_PRICING_EXECUTION_MODE` continua ausente no runtime, portanto `disabled`. Nenhuma publicação, alteração de preço ou habilitação comercial foi executada.
- Produção comparada por metadados somente leitura: serviço `local_vortek-erp` conservou versão `9649`, `UpdatedAt=2026-09-08T16:19:25.482718275Z` e SHA `82f0425ade3b6f9e391762fd9cd9635f49639e07` antes/depois. Nenhuma operação no banco produtivo; nenhuma migration foi executada nesta publicação.
- `AGENTS.md` e `.gitignore` preservados; regras/skills locais continuam ignoradas. Registro pós-deploy enviado em commit exclusivamente documental, sem necessidade de nova imagem (autoDeploy desligado); o SHA implantado é o candidato informado acima.

## Rollback e recuperação

Desabilitar a capacidade de teste interrompe novos envios; não desfaz efeito remoto. Preservar operações, eventos, IDs remotos e migrations para recuperar sem duplicação. Reimplantar o código anterior validado, se necessário, pelo fluxo de release autorizado, conservando os escritores bloqueados. Não apagar intenção/auditoria para tentar novamente; não fazer downgrade destrutivo das tabelas para simular rollback. Read-back do dispatcher também requer capacidade/test account válidas; desabilitá-la deixa a recuperação pendente até reabilitação autorizada.

## Contratos oficiais consultados

- [Contas e anúncios de teste ML](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes).
- [Publicação de produtos](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos) e [validador](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/validador-de-publicacoes).
- [Atributos condicionais](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos).
- [Sincronização de publicações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes) e [catálogo](https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo).
- [Advisory locks PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS), [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [gerador pg-meta v0.96.6](https://raw.githubusercontent.com/supabase/postgres-meta/v0.96.6/src/server/routes/generators/typescript.ts).

Parte das páginas ML foi acessível pelo conteúdo indexado oficial, com acesso direto limitado por HTTP 403. Nenhuma resposta operacional de endpoint foi inventada para substituir a prova externa pendente.
