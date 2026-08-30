# Vortek — Item 17 — Checklist de Execução

**Função:** painel operacional de acompanhamento
**Última atualização:** 30/08/2026
**Ambiente de execução:** desenvolvimento/homologação
**Branch obrigatória:** `dev`
**Aplicação de homologação:** `https://dev.vortek.shop`
**Serviço de homologação:** `vortek-erp-dev` em `192.168.1.160`
**Banco de homologação:** `supabase-dev` em `192.168.1.162`
**Próxima ação obrigatória:** `DSL-01 — Timeout DSLite`

---

## 1. Fonte de verdade e uso deste checklist

Este arquivo acompanha o andamento. Ele não substitui a especificação técnica nem as auditorias.

Antes de executar qualquer ação, consultar nesta ordem:

1. `AGENTS.md`;
2. `INSTRUCOES_AGENTE_VORTEK.md`;
3. a etapa correspondente em `VORTEK_ITEM_17_PLANO_COMPLETO_EXECUCAO_HOMOLOGACAO.md`;
4. o identificador e as dependências em `VORTEK_AUDITORIA_ITEM_16_CONSOLIDACAO.md`;
5. a auditoria detalhada do domínio afetado;
6. código, schema, migrations, testes e configuração atuais;
7. documentação oficial atual de qualquer tecnologia ou integração envolvida.

Regras de uso:

- executar somente a **próxima ação obrigatória**;
- não iniciar outra ação enquanto a atual não estiver validada;
- atualizar este checklist somente depois de obter evidência real;
- não marcar como concluído algo apenas planejado ou parcialmente testado;
- registrar `N/A` somente com uma justificativa;
- registrar risco aceito sem tratá-lo como risco eliminado;
- nunca registrar secrets, tokens, senhas ou valores sensíveis;
- não fazer merge em `main`, migration ou deploy em produção por meio deste checklist.

### Legenda

- `[x]` — executado e validado no nível aplicável;
- `[ ]` — pendente;
- **N/A** — não aplicável no momento, com motivo registrado;
- **Risco aceito** — pendência conhecida que o responsável decidiu não tratar agora;
- **Bloqueado** — não pode avançar até a condição registrada ser resolvida.

---

## 2. Situação geral

| Ordem | Etapa | Situação | Próxima decisão |
|---:|---|---|---|
| 0 | Homologação isolada | Concluída | Manter isolamento durante todas as ações |
| 1 | Segurança crítica | Encerrada com risco aceito | Reabrir `SEC-05` se a exigência de links permanentes mudar |
| 2 | Prazo externo Mercado Livre | Suspensa com risco aceito | Reabrir `ML-01` quando a tag `business` estiver disponível |
| 3 | Estoque e fulfillment | Concluída | Manter a reserva atômica como base do fulfillment interno |
| 4 | Capacidade e quantidade segura | Concluída | Manter `Q_segura = max(Q_internal, Q_supplier)` como fonte central |
| 5 | Mercado Livre observado e publicação | Concluída | Manter outbox e `stock-publish.ts` como fluxo único de estoque |
| 6 | Fiscal | Concluída | Manter os contratos e gates fiscais validados |
| 7 | Hayamax, Mercado Pago e financeiro | Concluída | Manter Hayamax bloqueada e o histórico somente leitura |
| 8 | Jobs e DSLite | Em andamento | Executar somente `DSL-01` |
| 9 | Plataforma e banco | Pendente | Executar cada mudança isoladamente |
| 10 | Consolidação de regras P2 | Pendente | Executar uma regra por vez |
| 11 | Interface | Pendente | Somente após as regras correspondentes |
| 12 | Limpeza histórica | Pendente | Somente após estabilidade funcional |

### Próxima ação

- [x] Executar somente `ML-03 — Não publicar estoque igual`.
- [x] Não avançar para a ação seguinte antes de `ML-03` estar integralmente validada.
- [x] Executar somente `ML-02 — Scan repetido`.
- [x] Não avançar para a ação seguinte antes de `ML-02` estar integralmente validada.
- [x] Executar somente `RULE-06 — Elegibilidade de publicação`.
- [x] Não avançar para a ação seguinte antes de `RULE-06` estar integralmente validada.
- [x] Executar somente `INV-05 — Automação nativa de preço`.
- [x] Não avançar para a ação seguinte antes de `INV-05` estar integralmente validada.
- [x] Executar somente `INV-02 — Helpers antigos de estoque`.
- [x] Não avançar para a ação seguinte antes de `INV-02` estar integralmente validada.
- [x] Executar somente `FIS-01 — Upload XML correto`.
- [x] Não avançar para a ação seguinte antes de `FIS-01` estar integralmente validada.
- [x] Executar somente `FIS-02 — Gate do shipment`.
- [x] Não avançar para a ação seguinte antes de `FIS-02` estar integralmente validada.
- [x] Executar somente `FIS-03 — not_found Brasil NFe`.
- [x] Não avançar para a ação seguinte antes de `FIS-03` estar integralmente validada.
- [x] Executar somente `FIN-01 + FIN-02 — Lifecycle e parser`.
- [x] Não avançar para a ação seguinte antes de `FIN-01/FIN-02` estar integralmente validada.
- [x] Executar somente `HAYA-01 — Bloqueio operacional da Hayamax`.
- [x] Não avançar para `HAYA-02` antes de `HAYA-01` estar integralmente validada.
- [x] Executar somente `HAYA-02 — Aposentar conta-saldo`.
- [x] Não avançar para `HAYA-03` antes de `HAYA-02` estar integralmente validada.
- [x] Executar somente `HAYA-03 — Desacoplar Mercado Pago`.
- [x] Não avançar para `HAYA-04` antes de `HAYA-03` estar integralmente validada.
- [x] Executar somente `HAYA-04 — Limpeza nominal e histórica`.
- [x] Não avançar para `JOB-01` antes de `HAYA-04` estar integralmente validada.
- [x] Executar somente `JOB-01 — Catálogo on_hold`.
- [x] Não avançar para `DSL-01` antes de `JOB-01` estar integralmente validada.

---

## 3. Gate obrigatório de cada ação

Copiar este gate para o registro da ação e preencher com evidências reais:

- [ ] branch confirmada como `dev` e working tree inspecionada;
- [ ] `AGENTS.md` e documentação aplicável lidos;
- [ ] estado atual e causa confirmados no código/schema/configuração;
- [ ] documentação oficial atual consultada quando houver dependência externa;
- [ ] menor mudança correta e reversível definida;
- [ ] teste de regressão adicionado quando necessário;
- [ ] implementação limitada à ação atual;
- [ ] teste direcionado executado e aprovado;
- [ ] `npm run validate` executado e aprovado;
- [ ] `npm run build` executado quando aplicável;
- [ ] migration aplicada somente no `supabase-dev`, quando aplicável;
- [ ] comportamento validado em `dev.vortek.shop`, quando aplicável;
- [ ] isolamento de produção reconfirmado;
- [ ] diff revisado e sem mudanças fora do escopo;
- [ ] rollback definido;
- [ ] resultado e pendências registrados neste documento;

Se algum item obrigatório falhar: **não avançar**, corrigir ou reverter e repetir a validação.

---

## 4. Etapa 0 — Homologação isolada

**Situação:** concluída e operacional.

- [x] serviço de homologação separado criado;
- [x] serviço ligado à branch `dev`;
- [x] domínio `dev.vortek.shop` configurado;
- [x] deploy de homologação separado da produção;
- [x] stack `supabase-dev` independente em `192.168.1.162`;
- [x] migrations atuais aplicadas na homologação;
- [x] usuário administrativo de homologação criado;
- **N/A no momento:** seed adicional; criar apenas quando um cenário exigir;
- [x] nenhuma credencial produtiva configurada para testes;
- [x] jobs externos mantidos desabilitados por padrão;
- **N/A até a etapa exigir:** usuários de teste do Mercado Livre;
- [x] credencial de teste do Mercado Pago configurada somente no `supabase-dev`;
- **N/A até a etapa exigir:** Brasil NFe em ambiente de homologação;
- [x] escrita DSLite mantida desabilitada;
- [x] WAHA de teste ou integração desabilitada;
- [x] login e navegação validados em homologação;
- [x] validação local concluída;
- [x] build concluído;
- [x] `app.vortek.shop` e o Supabase de produção permaneceram intocados.

**Rollback:** parar/remover somente os recursos de staging, sem afetar produção.

---

## 5. Etapa 1 — Segurança crítica

### SEC-02 — Credencial versionada

**Prioridade:** P0/P1
**Situação:** concluída no estado atual do repositório, com risco residual aceito.
**Commit:** `d81b3cb` — `docs: remove versioned administrative credential`

- [x] credencial literal removida da documentação ativa;
- [x] busca no estado atual não depende mais da credencial documentada;
- [x] acesso administrativo documentado sem reproduzir valor sensível;
- [ ] credencial histórica rotacionada;
- [ ] tokens relacionados rotacionados, caso aplicável;
- [ ] histórico Git tratado após rotação, caso necessário.

**Risco aceito pelo responsável:** a rotação de senhas e tokens foi recusada. A correção do repositório está concluída, mas uma credencial que tenha sido exposta anteriormente deve continuar sendo considerada comprometida.

### SEC-01 — Controle de `cargo`

**Prioridade:** P0
**Situação:** concluída e validada em homologação.
**Commit:** `ebb9026` — `security: restrict profile role changes`
**Migration:** `20260828163450_protect_profiles_cargo.sql`, aplicada somente no `supabase-dev`.

- [x] cadastro público não permite criar usuário privilegiado;
- [x] usuário autenticado edita somente campos pessoais permitidos;
- [x] operador/visualizador não altera `cargo`;
- [x] alteração de `cargo` permanece em operação administrativa autorizada;
- [x] teste de regressão `tests/sec-01-role-control.test.js` incluído;
- [x] Auth signup público desabilitado na homologação;
- [x] migration validada no `supabase-dev`;
- [x] aplicação validada em `dev.vortek.shop`.

### SEC-03 — Permissões web + mobile

**Prioridade:** P1
**Dependência:** `SEC-01`, concluída.
**Situação:** concluída e validada em homologação.
**Commit funcional:** `677fa2f` — `security: enforce shared web and mobile permissions`.

- [x] mapear a matriz atual e todos os consumidores web/mobile necessários;
- [x] confirmar a divergência entre cookie web e Bearer mobile;
- [x] fazer ambos os caminhos usarem a mesma matriz de permissões;
- [x] não criar uma segunda matriz para web;
- [x] provar localmente que operador web e mobile recebem a mesma decisão;
- [x] provar localmente que visualizador permanece somente leitura;
- [x] provar localmente as permissões definidas para admin e gerente;
- [x] concluir o gate obrigatório da seção 3.

**Validação executada:**

- `npm run test:api-auth`: 8 testes aprovados;
- `npm run validate`: aprovado;
- `npm run build`: aprovado, 121 páginas geradas;
- integração local com o `supabase-dev`: admin/gerente passaram pela autorização, operador/visualizador receberam `403` para confirmação de pagamento, e todos mantiveram as leituras permitidas, tanto por cookie quanto por Bearer;
- quatro contas temporárias foram removidas ao final da validação;
- deploy da branch `dev` acionado no serviço `vortek-erp-dev` e nova instância confirmada em `dev.vortek.shop`;
- homologação em `dev.vortek.shop`: leituras web/mobile retornaram `200` para os quatro cargos; confirmação de pagamento chegou ao `404` seguro para admin/gerente e foi bloqueada com `403` para operador/visualizador nos dois clientes;
- quatro contas temporárias de homologação foram removidas e nenhum perfil temporário permaneceu no `supabase-dev`;
- nenhuma migration foi necessária.

**Resultado:** a mesma matriz de permissões governa cookie web e Bearer mobile em homologação. `SEC-04` está liberada como próxima ação única.

### SEC-04 — Secrets no browser

**Prioridade:** P1
**Situação:** concluída e validada em homologação.
**Commit funcional:** `29be5f9` — `security: keep integration secrets server-side`.

- [x] localizar respostas de API que enviam secrets integrais ao cliente;
- [x] impedir retorno de client secrets, access tokens e refresh tokens;
- [x] retornar somente estado `configurado`/`não configurado`;
- [x] enviar novo valor ao servidor somente quando o usuário o alterar;
- [x] provar que nenhum valor sensível permanece no JavaScript do navegador;
- [x] concluir o gate obrigatório da seção 3.

**Validação executada:**

- documentação oficial atual de segurança de dados do Next.js e do Supabase consultada;
- `npm run test:integration-config`: 4 testes aprovados;
- `npm run validate`: aprovado;
- `npm run check:build-secrets`: aprovado;
- `npm run build`: aprovado, 121 páginas geradas;
- integração local com o `supabase-dev`: GET administrativo retornou somente flags coerentes, operador recebeu `403` e nenhum campo secreto foi serializado;
- deploy da branch `dev` acionado no serviço `vortek-erp-dev` e nova instância confirmada em `dev.vortek.shop`;
- homologação em `dev.vortek.shop`: GET e PATCH administrativos retornaram zero campos secretos, a página de configurações respondeu `200` e operador recebeu `403`;
- quatro contas temporárias, duas locais e duas de homologação, foram removidas sem perfis residuais;
- nenhuma credencial de integração foi alterada, nenhuma integração externa foi chamada e nenhuma migration foi necessária.

**Resultado:** o navegador recebe apenas o estado das credenciais; valores existentes permanecem server-side e novos valores exigem gravação ou remoção explícita. `SEC-05` está liberada como próxima ação única.

### SEC-05 — Links sensíveis com expiração

**Prioridade:** P1
**Situação:** encerrada para fins de sequência, com risco aceito e correção técnica pendente.

- [x] mapear links de XML, DANFE, etiqueta e comprovante;
- [ ] reutilizar a infraestrutura expirável já existente;
- [ ] aplicar expiração real a todos os documentos sensíveis mapeados;
- [ ] provar acesso válido antes e inválido depois da expiração;
- [ ] concluir o gate obrigatório da seção 3.

**Estado confirmado:** os tokens HMAC dos links públicos de XML, DANFE, etiqueta e comprovante vinculam o tipo e o identificador do documento, mas não possuem prazo. Os respectivos fluxos de `short_links` não preenchem `expires_at`. Enquanto o token e o documento permanecerem válidos, as rotas públicas podem continuar entregando o documento ou emitindo uma nova URL temporária do Storage.

**Risco aceito pelo responsável em 28/08/2026:** os links existentes devem ser mantidos e os links futuros precisam permanecer sem validade. Assim, qualquer pessoa que obtenha um desses links poderá acessar o documento por tempo indeterminado, enquanto o token, o secret de assinatura, a rota e o documento continuarem disponíveis. A expiração e sua prova antes/depois não foram implementadas e o achado P1 não foi eliminado.

**Decisão de implementação:** nenhuma alteração funcional, migration, build ou deploy é aplicável. Reabrir esta ação caso seja definida uma validade real ou um modelo de acesso autenticado.

**Validação executada:**

- branch `dev` e working tree limpo confirmados antes da alteração;
- implementação atual, auditorias aplicáveis e documentação oficial do Supabase Storage revisadas;
- `git diff --check`: aprovado;
- `npm run validate`: aprovado;
- teste direcionado, build, migration e deploy: **N/A**, pois a mudança é exclusivamente documental;
- nenhuma integração externa, produção, `main` ou `app.vortek.shop` foi acessada ou alterada.

---

## 6. Etapa 2 — Prazo externo Mercado Livre

### ML-01 — Preços por Quantidade

**Prioridade:** P1 com prazo
**Prazo externo:** antes de `26/10/2026`
**Situação:** suspensa com risco aceito; implementação e homologação técnicas concluídas, com anúncio externo de teste validado, mas a prova de Preços por Quantidade permanece pendente até o Mercado Livre habilitar a tag `business` no seller de teste DEV.

- [x] reler `docs/mercado-livre-publicacao-operacional.md`;
- [x] confirmar o contrato oficial atual de Preços por Quantidade;
- [x] confrontar backend, preview da UI e payload publicado;
- [x] manter uma única regra de quantity pricing no backend;
- [x] fazer a UI somente exibir a regra do backend;
- [x] preservar outbox/worker existente;
- [x] provar em teste que preview e payload publicado são iguais;
- [x] validar em teste faixas, quantidades, erros e versão do contrato;
- [ ] concluir o gate obrigatório da seção 3.

**Estado/causa confirmados:** o backend ainda publicava faixas absolutas no endpoint legado e havia fórmulas independentes de `3%/4%/5%` no navegador. Esse estado não atendia ao contrato percentual vigente nem garantia que a prévia coincidisse com o payload.

**Mudança realizada:** regra percentual centralizada no backend para as quantidades `3/5/10`; recomendações oficiais usadas como fonte e fallback `3%/4%/5%` limitado à resposta `204`; leitura de versão, `X-Version`, migração das faixas absolutas, bloqueio de preço líquido B2B e read-back incluídos. As telas passaram a apenas exibir a prévia do backend e o outbox/worker existente foi preservado.

**Commit funcional:** `7c31bbb` — `feat: migrate ML quantity pricing to percentages`.

**Validação executada:**

- `npm run test:ml-quantity-pricing`: 13 testes aprovados;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado, 122 páginas geradas;
- `git diff --check`: aprovado;
- deploy da branch `dev` acionado no serviço `vortek-erp-dev` e nova instância confirmada em `192.168.1.160`;
- `dev.vortek.shop`: health e login responderam `200`; rota de prévia presente no artefato e bloqueada com `401` sem autenticação;
- nenhum acesso ao Mercado Livre foi registrado durante o smoke test;
- migration: **N/A**, pois não houve alteração de banco;
- produção, `main`, `app.vortek.shop` e Supabase de produção permaneceram intocados.

**Rollback:** reverter o commit `7c31bbb` na branch `dev` e redeployar somente `vortek-erp-dev`.

**Pendência externa com risco aceito:** solicitar ao Mercado Livre a habilitação B2B do seller de teste DEV. A documentação oficial restringe Preços por Quantidade a sellers previamente habilitados e identificados pela tag `business`; o seller DEV atual não possui essa tag. O anúncio único de teste necessário para a prova já está ativo. Após a habilitação, falta provar recomendação, publicação percentual e read-back contra a API externa. A conta real não será usada e nenhuma tentativa de contornar a elegibilidade está autorizada.

**Preparação adicional em 29/08/2026:**

- commit `503ab0c` — `security: isolate Mercado Livre account allowlist` enviado para `origin/dev`;
- runtime, OAuth e webhooks passaram a aceitar substituição integral do allowlist por `ML_ALLOWED_USER_IDS`, preservando o ID atual somente como fallback quando a variável estiver ausente;
- 7 testes do guard de conta e os 13 testes de quantity pricing aprovados;
- `npm run validate` e `npm run build` aprovados, com 122 páginas geradas;
- placeholder `integracoes/mercadolivre` criado desconectado somente no `supabase-dev`, sem Client ID, secret ou tokens;
- arquivo local protegido de bootstrap mantido fora do repositório com permissão `0600`, contendo somente as credenciais do app DEV e dos usuários de teste;
- seller e customer de teste `MLB` criados pelo endpoint oficial `/users/test_user`, validados por read-back e armazenados somente no arquivo local protegido;
- token temporário da conta administradora removido do arquivo imediatamente após a criação e validação dos dois usuários;
- `ML_ALLOWED_USER_IDS` configurado no runtime somente com o seller de teste e deploy `dev@9ffaf58` confirmado no serviço `vortek-erp-dev`;
- Client ID e Secret exclusivos do app DEV gravados somente no `supabase-dev`, sem transportar tokens da conta administradora;
- seller de teste autorizado pelo fluxo OAuth do Vortek DEV; access token, refresh token, expiração futura e proprietário permitido confirmados sem reprodução dos valores;
- consulta atual de `/users/{id}` confirmou as tags `test_user`, `user_product_seller` e `normal`, sem a tag obrigatória `business`.

**Validação externa adicional em 30/08/2026:**

- categoria de teste, atributos obrigatórios, modalidade de anúncio, frete e payload foram pré-validados pelos endpoints oficiais antes da publicação;
- um único anúncio gratuito foi criado no seller de teste: item `MLB5159583873`, SKU `VORTEK-DEV-ML01-TEST`, categoria de teste `MLB457941`, título explícito de teste e descrição com aviso para não ofertar;
- o read-back confirmou o seller de teste esperado, status `active`, tag `test_item`, imagem de `500x500` com tag `good_quality_thumbnail`, quantidade `10`, preço de teste e descrição esperada;
- a busca agregada de itens do seller apresentou atraso de consistência logo após a criação; o mecanismo de segurança pausou o mesmo item, a leitura posterior confirmou a publicação e o anúncio foi reativado sem criar duplicata;
- a busca posterior do seller confirmou o mesmo item e o SKU esperado;
- nenhum produto do `supabase-dev` foi criado, associado ou alterado para esta preparação externa;
- nenhuma compra, pergunta, pedido, transação, conta real ou ambiente de produção foi usado;
- a tag `business` continua ausente; permanecem pendentes a habilitação B2B pelo Mercado Livre e, depois dela, a prova externa de recomendação, publicação percentual e read-back de `ML-01`.

**Decisão de sequência em 30/08/2026:**

- o responsável aceitou explicitamente suspender `ML-01` sem tratá-lo como concluído, pois a única validação restante depende de habilitação controlada pelo Mercado Livre e não pode ser resolvida no Vortek;
- `ML-01` deve ser reaberto quando `GET /users/{id}` apresentar a tag `business`, reutilizando o item `MLB5159583873` para a prova externa pendente;
- a exceção de sequência vale somente para este bloqueio externo; a próxima ação liberada é `STO-01 + STO-02`, que não depende da habilitação B2B.

**Validação da transição:**

- branch `dev` e working tree limpo confirmados antes da alteração;
- `git diff --check`: aprovado;
- `npm run validate`: aprovado, sem warnings ou erros;
- teste direcionado, build, migration e deploy: **N/A**, pois a mudança é exclusivamente documental;
- nenhuma integração externa, produção, `main` ou `app.vortek.shop` foi acessada ou alterada.

---

## 7. Etapa 3 — Estoque e fulfillment

### STO-01 + STO-02 — Reserva atômica

**Prioridade:** P1
**Situação:** concluída e validada em desenvolvimento/homologação.
**Commit funcional:** `b7b4275` — `fix: reserve internal stock atomically`

- [x] confirmar o ponto exato entre seleção `internal` e consumo de estoque;
- [x] garantir atomicamente que `internal` significa estoque já reservado;
- [x] reutilizar PostgreSQL, RPC, locks, ledger e `fulfillment_source` existentes;
- [x] representar o fluxo `disponível → reservado → despachado`;
- [x] liberar/estornar no cancelamento antes do despacho, preservando a reserva em falha fiscal/etiqueta transitória;
- [x] provar que saldo 1 com duas vendas simultâneas gera uma reserva;
- [x] provar que retry não cria segunda reserva;
- [x] provar liberação no cancelamento e saída no despacho;
- [x] provar que falha fiscal/etiqueta preserva a reserva;
- [x] provar reserva correta dos componentes de kit;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** `select_order_fulfillment` bloqueava apenas a linha do pedido; a leitura do saldo e a inserção de `saida_envio_interno` aconteciam depois, fora da mesma transação e após fiscal/etiqueta. Dois pedidos distintos podiam observar a mesma unidade, e `fulfillment_source='internal'` podia existir sem estoque comprometido.

**Mudança executada:**

- `select_order_fulfillment` passou a reservar todos os produtos/componentes e gravar a origem `internal` na mesma RPC;
- produtos são bloqueados em ordem estável de UUID, sem chamadas externas dentro da transação;
- o ledger existente distingue `reservado` e `despachado`, preserva estorno auditável e trata retry de forma idempotente;
- kits usam exclusivamente seus componentes diretos, com agregação de quantidades repetidas;
- fiscal/etiqueta ocorre depois da reserva; `envio_interno_at` continua representando etiqueta pronta;
- webhook e sincronização convertem a reserva em despacho no primeiro status pós-despacho;
- cancelamento estorna reserva ou saída sem apagar histórico;
- o preview desconta compromissos globais e adiciona de volta a reserva do próprio pedido para permitir retry;
- a tela de estoque lista como vendido somente o que já foi despachado.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree e `AGENTS.md` conferidos antes da alteração;
- documentação oficial atual de funções/RPC do Supabase e locks/isolation do PostgreSQL consultada;
- testes unitários direcionados: 15 aprovados;
- teste de integração protegido no `supabase-dev` (`192.168.1.162`): saldo 1 + duas reservas concorrentes resultou em uma reserva e uma rejeição por saldo;
- a mesma prova confirmou retry sem duplicação, pedido perdedor livre para `supplier`, reserva anterior à etiqueta, despacho idempotente e cancelamento idempotente;
- fixtures da prova removidas no `finally`;
- testes de kit confirmaram múltiplos componentes, multiplicação, agregação do mesmo componente e falha sem reserva parcial;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- migration `20260830143000_atomic_internal_stock_reservation.sql` aplicada e registrada somente no `supabase-dev`;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- novo container iniciado em homologação; `https://dev.vortek.shop/api/ops/health` respondeu `200`;
- `/api/estoque` respondeu `401` sem sessão, preservando a proteção do endpoint;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** manter a migration e o histórico do ledger; em incidente, interromper temporariamente o envio `internal` e operar somente por `supplier` até uma correção aditiva. Nunca apagar reservas ou reverter estado auditável manualmente.

**Pendência:** nenhuma para `STO-01/STO-02`.

---

## 8. Etapa 4 — Capacidade e quantidade segura

### RULE-01 — Capacidade de fulfillment e Q segura

**Prioridade:** P2 estrutural
**Dependência:** `STO-01/STO-02`
**Situação:** concluída e validada em desenvolvimento/homologação.
**Commit funcional:** `3920a70` — `feat: centralize fulfillment capacity`

- [x] centralizar quanto o fulfillment interno consegue atender;
- [x] centralizar quanto o fornecedor consegue atender;
- [x] definir `Q_segura = max(Q_internal, Q_supplier)`;
- [x] impedir soma de capacidades incompatíveis;
- [x] derivar capacidade de kits exclusivamente dos componentes;
- [x] provar os cenários `2/3 → 3` e `5/3 → 5`;
- [x] provar seleção da melhor oferta válida do fornecedor;
- [x] provar que reserva reduz `Q_internal`;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** a quantidade publicada era calculada em vários pontos a partir de `produtos.estoque`, que representa o snapshot da oferta preferencial, com um `max` local contra o saldo interno. Outra oferta operacional com capacidade maior não participava do cálculo, e kits podiam publicar o snapshot agregado em vez da capacidade real de seus componentes.

**Mudança executada:**

- funções pequenas centralizam `Q_internal`, `Q_supplier` e `Q_segura`, sem criar `AvailabilityEngine`;
- `Q_supplier` usa a maior capacidade de uma única origem operacional e nunca soma fornecedores ou ofertas incompatíveis;
- ofertas inativas, bloqueadas, sem vínculo DSLite, sem custo ou sem estoque são excluídas;
- saldo interno vem exclusivamente do ledger e já desconta reservas/saídas ativas;
- kits derivam a capacidade interna dos componentes; capacidade externa de kit composto permanece zero porque o fluxo DSLite atual não o atende;
- publicação automática, criação de anúncio, backfill, alteração de fornecedor, produto, kit e preview interno passaram a reutilizar a fonte central;
- comandos explícitos de inativação continuam publicando zero como proteção operacional, sem substituir a regra de capacidade.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree, `AGENTS.md` e documentação aplicável conferidos antes da alteração;
- documentação oficial atual do Mercado Livre para atualização de quantidade e do Supabase/PostgreSQL para filtros e consultas em lote consultada;
- 37 testes direcionados aprovados, incluindo `2/3 → 3`, `5/3 → 5`, melhor oferta válida, ausência de soma, reserva reduzindo `Q_internal` e kit limitado por componentes;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- migration: **N/A**, pois a fonte existente, o ledger e os índices atuais foram reutilizados;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=3920a70`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e `/api/produtos` sem sessão respondeu `401`;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy de homologação. Não há migration nem dado persistente novo para desfazer.

**Pendência:** nenhuma para `RULE-01`.

### ML-03 — Não publicar estoque igual

**Prioridade:** P1
**Dependência:** `STO-01/STO-02` e `RULE-01`
**Situação:** concluída e validada em desenvolvimento/homologação.
**Commit funcional:** `93613f0` — `fix: avoid redundant ML stock publication`

- [x] comparar quantidade/status relevante na fonte centralizada;
- [x] não usar timestamp de sincronização como mudança de estoque;
- [x] impedir nova outbox quando a quantidade não mudou;
- [x] criar outbox quando a quantidade realmente mudou;
- [x] provar ausência de publicação redundante;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** o produtor tratava `dslite_ultima_sync` como mudança no snapshot e a outbox deduplicava somente linhas pendentes. Depois de uma publicação concluída, a mesma quantidade/status gerava outra linha; uma pendência idêntica também tinha tentativas e timestamps reiniciados. O modo `seedFromProducts` ainda inseria diretamente `produtos.estoque`, fora da fonte central de capacidade.

**Mudança executada:**

- a outbox passou a comparar cada operação solicitada com a pendência atual e com a última publicação concluída da mesma operação;
- quantidade e status iguais retornam `unchanged`, sem insert, update ou reinício de tentativas/timestamps;
- preço, quantidade e status são preservados como operações independentes, e mudanças reais continuam enfileiradas;
- uma linha `processing` não é alterada: estado igual é ignorado e estado diferente cria uma sucessora;
- divergência observada no Mercado Livre força republicação para corrigir drift externo;
- todos os produtores ajustados contabilizam `unchanged` corretamente;
- `seedFromProducts` passou a reutilizar a outbox central e `Q_segura`, sem escrita direta de `produtos.estoque`;
- nenhuma tabela, migration, dependência ou fluxo paralelo foi criado.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree, `AGENTS.md` e documentação aplicável conferidos antes da alteração;
- contrato operacional do Mercado Livre e contrato atual de consulta JSONB do PostgreSQL/Supabase conferidos para o comportamento usado;
- 48 testes direcionados aprovados, incluindo quantidade/status iguais, timestamp diferente, mudança real, operação de preço isolada, retry, failed, concorrência com `processing`, ordem da última conclusão e drift observado;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- migration: **N/A**, pois a outbox e o histórico existentes foram reutilizados;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=93613f0`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e `/api/produtos` sem sessão respondeu `401`;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy de homologação. Não há migration nem dado persistente novo para desfazer.

**Pendência:** nenhuma para `ML-03`. A próxima ação obrigatória é `ML-02`.

---

## 9. Etapa 5 — Mercado Livre observado e publicação

### ML-02 — Scan repetido

**Prioridade:** P1
**Situação:** concluída e validada em desenvolvimento/homologação.
**Commit funcional:** `0ccbe07` — `fix: persistir manifesto do scan observado ML`

- [x] medir e confirmar a reconstrução repetida da população;
- [x] obter a população uma vez por ciclo;
- [x] processar o ciclo de forma retomável usando mecanismo durável existente;
- [x] não persistir `scroll_id` como estado durável;
- [x] provar cobertura integral sem itens pulados ou duplicados;
- [x] provar retomada e abertura correta de um novo ciclo;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** cada execução de lote chamava novamente o endpoint `search_type=scan`, reconstruía toda a população de anúncios e somente depois aplicava `slice(offset, offset + 100)`. Com cerca de 5.900 IDs, cada lote repetia aproximadamente 59 páginas de scan antes de processar os seus 100 itens.

**Mudança executada:**

- um único scan cria o manifesto durável do ciclo em `ml_listings_observed_items`;
- os lotes seguintes processam no máximo 100 IDs exatos do manifesto, sem novo scan e sem offset;
- o marcador `ml_observed_manifest_completed` só é gravado depois da persistência integral; manifesto parcial sem marcador é reconstruído com novo scan;
- IDs são normalizados e protegidos por chave primária `(job_id, ml_item_id)`, impedindo duplicação no ciclo;
- itens individuais podem ser retomados até três vezes; falhas terminais encerram o job como `completo_parcial`;
- jobs `on_hold` e jobs stale são retomados com o mesmo ID; uma chave de deduplicação impede dois ciclos ativos;
- `scroll_id` permanece apenas na memória durante o scan e nunca é salvo no manifesto ou no log;
- manifestos de jobs concluídos são limpos depois do registro terminal; manifestos de erro permanecem disponíveis para diagnóstico;
- nenhuma fila externa, cron paralelo, dependência ou variável de ambiente foi criada.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree, `AGENTS.md`, Item 17, consolidação e auditorias de ML/jobs conferidos antes da alteração;
- contrato oficial atual do Mercado Livre para `search_type=scan` e documentação oficial do PostgreSQL/Supabase para índices parciais, RLS e processamento em lote conferidos;
- 22 testes direcionados aprovados, cobrindo manifesto sem duplicação, cursor único da primeira página, ausência de offset, retomada, três tentativas, progresso, stale jobs e idempotência;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- migration `20260830090000_durable_ml_listings_observed_scan.sql` aplicada e registrada somente no `supabase-dev` (`192.168.1.162`), com tabela, índice parcial e RLS verificados;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=0ccbe07`; healthcheck respondeu `200` e a rota do sync sem chave respondeu `401`;
- ciclo real DEV concluiu `completo`: um scan, duas páginas até o encerramento do cursor, um anúncio processado em um lote, zero falhas, manifesto limpo e nenhum `scroll_id` persistido;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy de homologação. A migration é aditiva e pode permanecer sem consumidor; não apagar a tabela durante rollback de código.

**Pendência:** nenhuma para `ML-02`. A próxima ação obrigatória é `RULE-06`.

### RULE-06 — Elegibilidade de publicação

**Prioridade:** P2
**Situação:** concluída e validada em desenvolvimento/homologação.
**Commits funcionais:** `1a9ddec` — `fix: centralize ML publish eligibility`; `47bb697` — `fix: gate ML outbox by observed status`

- [x] centralizar no domínio ML a decisão de anúncio modificável;
- [x] classificar erros transitórios e terminais;
- [x] reutilizar a mesma semântica no producer e worker;
- [x] impedir reenfileiramento contínuo de anúncio não modificável;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** a elegibilidade estava distribuída e incompleta. Alguns producers filtravam `active/paused`, o producer central aceitava reenfileirar sem consultar o estado observado ou o cooldown existente, e o worker reconhecia estados não modificáveis somente depois de tentar alterar o anúncio. Como linhas canceladas não participavam da deduplicação, automações podiam criar uma nova outbox para o mesmo `under_review`, `closed` ou `inactive`.

**Mudança executada:**

- uma regra única no domínio ML classifica elegibilidade e falhas de publicação;
- `active/paused` permanecem modificáveis, status desconhecido segue para validação no worker e `under_review/closed/inactive` bloqueiam publicação comum;
- exclusão mantém seu fluxo excepcional e ignora o gate de alteração comum;
- o producer central consulta em paralelo o snapshot observado e os campos de bloqueio existentes antes de inserir, atualizar ou reabrir outbox;
- producers automáticos tratam `skipped_ineligible` como descarte esperado; rotas manuais não informam falsamente que houve enfileiramento;
- o worker faz preflight em lote, cancela estado terminal sem chamar o ML, adia cooldown temporário e preserva metadados estruturados para distinguir retry, autorização e erro determinístico;
- a reconciliação grava o bloqueio quando observa estado terminal e limpa o bloqueio quando o anúncio volta a `active/paused`, sem alterar o estado desejado durante reconciliação de falha;
- nenhuma fila, tabela, coluna, dependência ou variável de ambiente foi criada.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree, `AGENTS.md`, Item 17, consolidação e auditorias de ML/regras conferidos antes da alteração;
- documentação oficial atual do Mercado Livre para sincronização, estados, moderação e conflito `409`, além da documentação oficial do Supabase para filtros, `maybeSingle` e índices, conferida;
- schema confirmou `ml_item_id` com índice `UNIQUE` em `anuncios_ml` e `catalogo_ml_snapshot`, atendendo às consultas novas sem migration ou índice adicional;
- 22 testes direcionados aprovados, cobrindo status modificáveis e terminais, estado desconhecido, cooldown, exclusão, falhas transitórias/terminais, persistência/limpeza do bloqueio, deduplicação e snapshot sem vínculo local;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- migration: **N/A**, pois o snapshot, a outbox e os campos de cooldown existentes foram reutilizados;
- commits funcionais enviados para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=47bb697`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e o worker sem chave respondeu `401`;
- ciclo observado real DEV processou o único item `under_review` em um lote, com um snapshot atualizado, zero falhas e zero warnings; o item não possui produto/anúncio local vinculado, por isso o gate do producer sem vínculo foi validado pelo teste direcionado sem criar dados artificiais;
- o DEV possuía zero produtos com `ml_item_id` e zero linhas de outbox, portanto nenhum anúncio remoto foi modificado durante a homologação;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter os commits `47bb697` e `1a9ddec` em `dev` e executar novo deploy somente de homologação. Não há migration nem dado estrutural novo para desfazer; bloqueios gravados nos campos preexistentes serão naturalmente ignorados pelo código anterior.

**Pendência:** nenhuma para `RULE-06`. A próxima ação obrigatória é `INV-05`.

### INV-05 — Automação nativa de preço

**Situação:** concluída como **N/A no estado operacional atual**, sem alteração funcional.

- [x] verificar se existem anúncios de teste com automação nativa ativa;
- [x] comparar o comportamento com a documentação oficial atual;
- [x] avaliar o pre-check e não implementá-lo sem necessidade operacional comprovada;
- [x] registrar `N/A` com evidência;
- [x] registrar o gate de implementação como **N/A**, pois nenhum código foi alterado.

**Estado confirmado em 30/08/2026:** o Vortek publica o preço-base por `PUT /items/{ITEM_ID}` no worker da outbox e não possui pre-check da automação nativa. A blocklist existente protege a automação própria do Vortek por item/SKU e não representa o estado da automação nativa do Mercado Livre.

**Contrato oficial confirmado:** desde 18/03/2026, um `PUT /items/{ITEM_ID}` contendo somente `price` é rejeitado quando a automação nativa está ativa. O Mercado Livre orienta identificar previamente os itens pelo endpoint paginado `/pricing-automation/users/{USER_ID}/items`; a tag `dynamic_standard_price` também identifica a configuração no recurso do item.

**Evidência operacional DEV:** a consulta autenticada e somente leitura ao endpoint oficial respondeu `200`, com total zero e nenhuma página de item automatizado. O `supabase-dev` possuía um snapshot de anúncio; a consulta desse item respondeu normalmente e não continha `dynamic_standard_price`. Nenhum token, identificador de anúncio ou credencial foi registrado.

**Decisão de implementação:** pre-check, teste de regressão, migration, build, escrita no Mercado Livre e deploy são **N/A** porque a necessidade operacional não foi comprovada. Não serão criados helper, persistência, chamada adicional ou fluxo preventivo para uma condição ausente. Reabrir `INV-05` antes de publicar preço caso a conta passe a usar automação nativa.

**Validação executada em 30/08/2026:**

- branch `dev` e working tree inicial limpo confirmados;
- `AGENTS.md`, Item 17, consolidação, auditoria de Mercado Livre, procedimento operacional e código atual de publicação de preço conferidos;
- documentação oficial atual do Mercado Livre para automação de preços e documentação oficial do Supabase para a leitura REST self-hosted conferidas;
- endpoint oficial do vendedor respondeu `200`, com zero itens automatizados; o único snapshot DEV foi consultado sem falha e não continha `dynamic_standard_price`;
- `npm run validate`: aprovado, sem warnings ou erros;
- `git diff --check`: aprovado;
- teste de regressão, build, migration, escrita no Mercado Livre e deploy: **N/A**, pois a mudança é exclusivamente documental;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter somente o commit documental desta ação em `dev`; não há código, migration, dado operacional ou deploy para desfazer.

**Pendência:** nenhuma para o estado atual de `INV-05`. A próxima ação obrigatória é `INV-02`.

### INV-02 — Helpers antigos de estoque

**Situação:** concluída e validada.
**Commit funcional:** `4b81328` — `refactor(ml): remove legacy stock helpers`.

- [x] todos os chamadores dos helpers antigos foram localizados no histórico e confirmados como removidos do código atual;
- [x] o fluxo atual foi confirmado como `enqueueMlPublishOutbox` → worker de publicação → `publishAndVerifyMlStock`;
- [x] `stock-publish.ts` foi confirmado como cobertura dos contratos tradicional e multiorigem do Mercado Livre;
- [x] foram removidos somente exports, helpers privados, retries, cooldown e imports sem consumidores;
- [x] o restante de `mercadolibre.ts`, o outbox, o worker e os produtores atuais foram preservados;
- [x] nenhum contrato HTTP, schema, migration, variável de ambiente ou regra de negócio foi alterado;
- [x] teste direcionado `tests/ml-publish-outbox.test.js`: 15/15 aprovado;
- [x] `npm run validate`: aprovado, sem warnings ou erros;
- [x] `npm run build`: aprovado;
- [x] busca pós-alteração confirmou ausência dos símbolos antigos e `stock-publish.ts` como único escritor de atualização de `available_quantity`;
- [x] commits enviados para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- [x] container de homologação confirmou `GIT_SHA=c7ac9d3`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e o worker sem chave respondeu `401`;
- [x] produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Teste de regressão novo:** N/A. A ação removeu código inalcançável sem alterar o fluxo retido; a cobertura foi provada pelo grafo de chamadas, teste existente do outbox, typecheck e build.

**Migration e escrita externa:** N/A. Nenhum dado foi modificado no Supabase ou Mercado Livre.

**Rollback:** reverter o commit funcional e republicar somente a homologação; não há dado ou migration para desfazer.

**Pendência:** nenhuma para `INV-02`. A próxima ação obrigatória é `FIS-01`.

---

## 10. Etapa 6 — Fiscal

### FIS-01 — Upload XML correto

**Prioridade:** P1
**Situação:** concluída e validada.
**Commit funcional:** `8837508` — `fix(fiscal): use XML contract for ML invoices`.

- [x] reconfirmar o contrato oficial atual de invoice do Mercado Livre;
- [x] localizar e remover chamadas comprovadamente inválidas;
- [x] usar `GET → POST` para invoice nova;
- [x] usar `GET → PUT` somente para atualização válida;
- [x] verificar o estado final com `GET`;
- [x] provar upload direto correto para invoice nova;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** o helper central consultava o estado e, para invoice nova, tentava `PUT` JSON e `POST` JSON antes do `POST` XML oficial. Isso gerava falhas previsíveis `404/415` antes da operação válida e mantinha um contrato JSON sem suporte para esse upload.

**Mudança executada:**

- o helper central passou a consultar o estado atual uma única vez;
- ausência confirmada por `404` executa diretamente `POST /shipments/{shipment_id}/invoice_data/` com `Content-Type: application/xml`;
- invoice existente com chave diferente e identificador válido executa `PUT /shipment_invoice/{invoice_id}/` também em XML;
- falha de consulta diferente de `404` não cria invoice;
- sucesso de `POST` ou `PUT`, inclusive conflito idempotente, somente é aceito após novo `GET` confirmar a mesma chave fiscal;
- os quatro chamadores preservaram suas validações locais e passaram a usar o read-back centralizado;
- nenhuma fila, tabela, migration, dependência, variável de ambiente ou fluxo paralelo foi criado.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree, `AGENTS.md`, Item 17, consolidação e auditoria fiscal conferidos antes da alteração;
- contrato oficial atual de importação de nota fiscal do Mercado Livre reconfirmado para `GET`, criação por `POST` XML e atualização por `PUT` XML;
- teste direcionado `tests/ml-invoice-upload-contract.test.js`: 5/5 aprovado, cobrindo criação direta sem JSON, atualização somente com `invoice_id`, falha segura de consulta e confirmação final da chave;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=8837508`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e o worker sem chave respondeu `401`;
- upload real no Mercado Livre: **N/A nesta validação**, pois o DEV não possuía pedido com shipment e XML fiscal aptos; nenhum shipment artificial ou escrita externa foi criado apenas para testar;
- migration e escrita no Supabase: **N/A**;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy somente de homologação; não há migration nem dado estrutural para desfazer.

**Pendência:** nenhuma para `FIS-01`. A próxima ação obrigatória é `FIS-02`.

### FIS-02 — Gate do shipment

**Prioridade:** P1
**Situação:** concluída e validada.
**Commit funcional:** `eb94a00` — `fix(fiscal): gate ML invoice upload by shipment state`.

- [x] exigir `status = ready_to_ship`;
- [x] exigir `substatus = invoice_pending`;
- [x] não enviar XML quando o shipment não estiver apto;
- [x] aguardar o fluxo legítimo já existente;
- [x] provar ausência de `invalid_shipment` causado pelo Vortek;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** após o `GET invoice_data`, o helper central executava `POST/PUT` XML sem consultar imediatamente o shipment. Assim, estados diferentes de `ready_to_ship + invoice_pending` alcançavam uma chamada sem possibilidade de sucesso e podiam retornar `400 invalid_shipment`.

**Mudança executada:**

- a regra fiscal existente passou a reconhecer exclusivamente `ready_to_ship + invoice_pending` como estado apto para upload;
- a mesma chave já vinculada continua concluindo por idempotência sem exigir gate, pois não existe escrita externa;
- quando uma criação ou atualização é necessária, o helper reutiliza a consulta existente de `/shipments/{shipment_id}` antes de qualquer `POST/PUT`;
- falha de consulta retorna `shipment_status_lookup_failed` sem tentativa de upload;
- estado não apto retorna `shipment_not_ready_for_invoice`, com status e substatus observados, também sem tentativa de upload;
- shipment apto preserva integralmente o contrato do FIS-01 e a verificação final da chave;
- nenhum polling, retry, job, tabela, migration, dependência ou fluxo paralelo foi criado.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree, `AGENTS.md`, Item 17, consolidação e auditoria fiscal conferidos antes da alteração;
- documentação oficial atual do Mercado Livre reconfirmou a exigência de `ready_to_ship + invoice_pending` antes do envio do XML;
- testes direcionados `tests/ml-fiscal-release.test.js` e `tests/ml-invoice-upload-contract.test.js`: 15/15 aprovados;
- cobertura provou o único par permitido, o bloqueio das demais combinações, a idempotência da mesma chave e o posicionamento do gate antes de ambos os caminhos `POST/PUT`;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- consulta somente leitura no `supabase-dev` confirmou zero pedidos com `ml_shipment_id` e XML fiscal simultaneamente;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=eb94a00`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e o worker sem chave respondeu `401`;
- upload real e observação de `invalid_shipment`: **N/A nesta validação**, pois não havia candidato DEV apto; a ausência de chamada inválida foi provada pelo gate e pelos testes sem criar shipment artificial;
- migration e escrita no Supabase ou Mercado Livre: **N/A**;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy somente de homologação; não há migration nem dado estrutural para desfazer.

**Pendência:** nenhuma para `FIS-02`. A próxima ação obrigatória é `FIS-03`.

### FIS-03 — `not_found` Brasil NFe

**Prioridade:** P1
**Situação:** concluída e validada.
**Commit funcional:** `028417b` — `fix(fiscal): stop terminal Brasil NFe not-found retries`.

- [x] distinguir falha transitória e `not_found` terminal;
- [x] reabrir somente quando houver mudança real de estado;
- [x] impedir consulta periódica infinita de resultado terminal;
- [x] preservar idempotência quando a chave já estiver vinculada;
- [x] não criar outro reconciliador;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** a busca por identificador interno usava o método legado `buscarNotaFiscal` e o campo incorreto `IndentificadorInterno`, divergindo do contrato oficial atual `ObterNotasFiscais + IdentificadorInterno`. Além disso, resposta válida sem correspondência, erro do provedor e exceção eram tratados como o mesmo `not_found`, sem persistir condição terminal; por isso o pedido continuava elegível a cada 2/10 minutos.

**Mudança executada:**

- a busca passou a usar o endpoint oficial já disponível no SDK instalado, sem upgrade de dependência;
- resposta válida vazia ou sem correspondência exata é classificada como `not_found` terminal;
- erro declarado pelo provedor, exceção e nota exata sem chave permanecem transitórios e elegíveis para recuperação;
- o terminal é persistido em `pedidos.nfe_status = not_found` e deixa de ser selecionado pelo reconciliador;
- qualquer fluxo fiscal real que substitua esse status reabre a elegibilidade;
- a persistência compara `nfe_status` e `nfe_last_sync_at` carregados, impedindo que uma resposta antiga sobrescreva mudança concorrente;
- chave, XML, protocolo, número e demais dados fiscais existentes não são apagados;
- o endpoint contabiliza terminal processado separadamente de falha transitória e retorna sucesso quando não há falha recuperável;
- nenhum novo reconciliador, retry, job, tabela, migration, dependência ou fluxo paralelo foi criado.

**Validação executada em 30/08/2026:**

- branch `dev`, working tree, `AGENTS.md`, Item 17, consolidação e auditorias aplicáveis conferidos antes da alteração;
- documentação oficial atual da Brasil NFe confirmou `/ObterNotasFiscais`, o campo `IdentificadorInterno` e a separação entre `Notas` e `Error`;
- testes direcionados `tests/brasil-nfe-identifier.test.js` e `tests/ml-invoice-upload-contract.test.js`: 17/17 aprovados;
- cobertura provou contrato correto, terminal, transitório, saída do ciclo, reabertura por mudança real e preservação da chave já vinculada;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=028417b`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e o worker sem chave respondeu `401`;
- execução autenticada interna do reconciliador respondeu `200`, `success=true`, `total=0`, `terminalNotFound=0`, `transientFailures=0` e `failed=0`;
- consulta somente leitura confirmou zero pedidos elegíveis, zero pedidos em `not_found` e zero eventos `not_found_terminal` no `supabase-dev`; nenhum candidato artificial ou chamada operacional à Brasil NFe foi criado apenas para testar;
- migration e escrita de fixture no Supabase: **N/A**;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy somente de homologação; não há migration nem dado estrutural criado por esta ação.

**Pendência:** nenhuma para `FIS-03`. A próxima ação obrigatória do checklist é `FIN-01 + FIN-02 — Lifecycle e parser`.

---

## 11. Etapa 7 — Mercado Pago e financeiro

### Replanejamento — saída da Hayamax

**Decisão registrada em 30/08/2026:** a Hayamax deixará de trabalhar com dropshipping e não será mais fornecedora do Vortek.

O estudo e o roadmap específicos do Mercado Pago estão em:

- `docs/mercado-pago-estudo-vortek.md`;
- `docs/mercado-pago-checklist-implementacao.md`.

As ações abaixo são sequenciais e não podem ser combinadas em uma única tarefa.

### HAYA-01 — Bloqueio operacional da Hayamax

**Prioridade:** P1

**Situação:** concluída e validada em desenvolvimento/homologação.
**Commit funcional:** `ae14b04`.

- [x] bloquear o DSLite ID `2` pela política central já existente;
- [x] impedir nova ativação, importação, seleção e fulfillment da Hayamax;
- [x] usar o fluxo existente de desativação do fornecedor;
- [x] manter produto com outra oferta operacional e reatribuir sua oferta preferencial;
- [x] inativar produto e retirar anúncio quando a Hayamax for a única capacidade disponível;
- [x] validar ausência de oferta Hayamax ativa e de reativação pelo sync;
- [x] não acessar nem alterar produção neste worktree;
- [x] concluir o gate obrigatório da seção 3.

**Evidências:**

- branch `dev` e working tree inicial limpa confirmados antes da mudança;
- política central passou a bloquear os IDs DSLite `2` e `134`;
- sync de fornecedores mantém fornecedor bloqueado inativo; catálogo, preço/estoque e XML ignoram Hayamax;
- ativação do fornecedor, ativação da oferta e seleção manual de oferta Hayamax retornam bloqueio de regra de negócio;
- seleção preferencial, prévia e criação de pedido, confirmação de estoque, fulfillment, caminho fiscal e evidências de anúncio ignoram oferta Hayamax, inclusive nos fallbacks legados;
- fluxo existente de desativação continua responsável por reatribuir produto com oferta permitida e por inativar produto exclusivo antes de enfileirar a exclusão definitiva do anúncio;
- alternativas de outro fornecedor bloqueado não preservam indevidamente um produto da Hayamax;
- 55 testes direcionados aprovados, incluindo política DSLite, preferência de oferta, capacidade, seleção de fulfillment, outbox e exclusão de anúncio;
- `npm run validate` e `npm run build` aprovados;
- consulta somente leitura no `supabase-dev` confirmou zero fornecedor, zero oferta e zero produto legado com DSLite ID `2`, inclusive ativos;
- desativação de dado e exclusão de anúncio em homologação: **N/A**, pois não existe dado Hayamax no `supabase-dev`; nenhuma fixture ou chamada externa destrutiva foi criada apenas para testar;
- migration e escrita no Supabase: **N/A**;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy somente de homologação; não há migration nem dado estrutural criado por esta ação.

**Pendência:** nenhuma para `HAYA-01`. A próxima ação obrigatória é `HAYA-02 — Aposentar conta-saldo`.

### HAYA-02 — Aposentar conta-saldo

**Prioridade:** P1

**Dependência:** `HAYA-01`

**Situação:** concluída e validada em desenvolvimento/homologação.
**Commit funcional:** `2f9fe90`.

- [x] remover APIs e interface exclusivas do saldo Hayamax;
- [x] remover importação de extrato, aporte manual e aprovação Mercado Pago;
- [x] remover débito automático e novos usos de `balance_account`;
- [x] preservar ledger genérico de créditos, registros históricos e migrations;
- [x] manter histórico legível sem permitir nova operação;
- [x] concluir o gate obrigatório da seção 3.

**Evidências:**

- branch `dev` e working tree inicial limpa confirmados antes da mudança;
- APIs exclusivas de consulta, importação, aporte manual e aprovação Mercado Pago removidas;
- painel, alertas e modais da conta-saldo removidos da página de Compras;
- inferência operacional passou a produzir somente `prepaid_pix`; tentativa explícita de gravar `balance_account` retorna `422`;
- débito automático `purchase_debit` removido da criação e da sincronização de compras;
- `balance_account` foi preservado nos tipos, labels, constraints e migrations somente para leitura histórica;
- ledger genérico de créditos passou a apresentar movimentos Hayamax como conta aposentada e somente leitura, fora dos totais e das ações operacionais;
- relatório, matching, webhook e escritores automáticos Mercado Pago permaneceram inalterados para execução exclusiva na `HAYA-03`;
- 35 testes direcionados aprovados, incluindo a nova regressão `tests/hayamax-balance-retirement.test.js`;
- `npm run validate`, `npm run build` e `git diff --check` aprovados; o build não contém as duas rotas removidas;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação na task `lddq5lh89vs1b0zodo6fnhn7h`, imagem `sha256:1b1c35c1fe20ba33b1357677109b9e2eacdbe26e72a46fc1ddad84ad15689bab`, confirmou rotas ausentes, interface exclusiva ausente, histórico somente leitura e guarda de escrita presentes;
- `https://dev.vortek.shop/api/ops/health` respondeu `200`, com `success=true` e sem job em execução;
- consulta somente leitura no `supabase-dev` confirmou zero movimento Hayamax, zero compra Hayamax, zero compra `balance_account` e seis movimentos Mercado Pago classificados para a próxima ação;
- migration, alteração de schema e escrita no Supabase: **N/A**;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy somente de homologação; não há migration nem dado estrutural criado por esta ação.

**Pendência:** nenhuma para `HAYA-02`. A próxima ação obrigatória é `HAYA-03 — Desacoplar Mercado Pago`.

### HAYA-03 — Desacoplar Mercado Pago

**Prioridade:** P1

**Dependência:** `HAYA-02`

**Situação:** concluída e validada operacionalmente em homologação.
**Commit funcional:** `6888b1b`.

- [x] executar `MP-RET-01` do checklist específico Mercado Pago;
- [x] remover matching, `topup` e revisão exclusiva da Hayamax;
- [x] remover o webhook de pagamento e seu secret, pois não restará consumidor ativo;
- [x] remover o SDK Mercado Pago se continuar sem uso;
- [x] preservar lifecycle, parser, importação genérica, tabela e histórico;
- [x] provar que relatório não gera movimento de fornecedor;
- [x] concluir o gate obrigatório da seção 3.

**Evidências:**

- branch `dev` e working tree inicial limpa confirmadas; instruções, Item 17, auditorias, checklist Mercado Pago e contratos oficiais aplicáveis foram consultados;
- causa confirmada nos dois escritores ativos: o importador do relatório classificava Hayamax/revisão e criava `topup`, enquanto o webhook `payment` repetia a classificação e registrava `payment_lookup_failed`;
- matching, valor mínimo, revisão exclusiva, criação e vínculo de `topup`, webhook, consulta individual de pagamento e SDK `mercadopago` foram removidos;
- autenticação, lifecycle, retomada, download, parser, scheduler e importação genérica foram preservados; o `upsert` usa `defaultToNull: false` para não apagar classificações e vínculos históricos omitidos;
- tabelas, tipos, migrations, `mercadopago_account_movements` e `supplier_balance_movements` foram preservados sem alteração estrutural;
- 14 testes direcionados aprovados, incluindo a regressão `tests/mercadopago-hayamax-retirement.test.js`;
- `npm run validate`, `npm run build` e `git diff --check` aprovados; o build não contém a rota removida;
- commit enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`; task `hymgregdd6km75wamrvcojanp` executou `GIT_SHA=6888b1bc1e861daf78fcfaf147fc2c2241836ff4`;
- `https://dev.vortek.shop/api/ops/health` respondeu `200` e o webhook removido respondeu `404`;
- as variáveis `MERCADOPAGO_HAYAMAX_MATCHERS` e `MERCADOPAGO_WEBHOOK_SECRET` não existem no ambiente do serviço de homologação;
- reimportação do mesmo arquivo TEST respondeu `200/success=true`, importou 238 linhas válidas, rejeitou a mesma linha inválida e não retornou o campo aposentado `topups`;
- antes e depois da reimportação permaneceram exatamente 238 movimentos Mercado Pago, seis classificações históricas `REVIEW_REQUIRED`, zero vínculo e zero movimento de fornecedor originado pelo Mercado Pago;
- o usuário confirmou em 30/08/2026 a remoção da configuração que apontava para o webhook aposentado no aplicativo de desenvolvimento **Vortek MP Dev**;
- migration e exclusão de dados: **N/A**;
- produção, `main`, Supabase produção, aplicativo produtivo e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy somente de homologação; não há migration nem dado estrutural a reverter. A configuração externa aposentada somente deve ser restaurada mediante autorização explícita.

**Pendência:** nenhuma para `HAYA-03`. A próxima ação obrigatória é `HAYA-04 — Limpeza nominal e histórica`.

### HAYA-04 — Limpeza nominal e histórica

**Prioridade:** P2

**Dependência:** `HAYA-03`

**Situação:** concluída e validada em desenvolvimento/homologação.
**Commit funcional:** `825210d`.

- [x] remover guardas de categoria exclusivamente Hayamax;
- [x] retirar o nome Hayamax de textos e eventos que atendem outros fornecedores;
- [x] remover scripts operacionais exclusivamente Hayamax;
- [x] atualizar guias ativos sem reescrever auditorias históricas;
- [x] não apagar schema ou dados históricos sem inventário, backup e autorização em `vortek-prod`;
- [x] concluir o gate obrigatório da seção 3.

**Evidências:**

- branch `dev` e working tree inicial limpa confirmadas; instruções, Item 17, auditorias aplicáveis, guia operacional e contrato oficial de categorização do Mercado Livre foram consultados;
- causa confirmada em três grupos de resíduos executáveis: categorias de uma campanha Hayamax eram injetadas antes do preditor oficial, o ID DSLite `2` ainda aceitava etiqueta provisória e scripts encerrados ainda podiam operar sobre a fornecedora aposentada;
- constantes, sugestões e validações de categoria exclusivamente Hayamax foram removidas; preditor oficial, Wahl, Panasonic, Pet Shop e a validação genérica de evidência de nicho foram preservados;
- ID `2` deixou de aceitar etiqueta provisória; evento, payload de fornecedores permitidos e fallback visual passaram a usar nomenclatura neutra para Vanral, BKR1 e Evolusom;
- oito scripts exclusivamente Hayamax foram removidos; a campanha compartilhada foi renomeada, perdeu o perfil aposentado e passou a exigir perfil explícito; três produtos Hayamax foram retirados do script misto de prateleira rentável;
- `GUIDE.md` deixou de apresentar Hayamax como ativa; migrations, schema, tipos, dados, labels históricos da conta-saldo, relatórios, auditorias e o cluster coordenado `ml-p0-*` foram preservados;
- 43 testes direcionados aprovados, incluindo a nova regressão `tests/hayamax-nominal-cleanup.test.js`;
- `node --check` nos scripts compartilhados, `npm run validate`, `npm run build` e `git diff --check` aprovados sem warnings ou erros;
- commit funcional enviado para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- task `lambxro7gcd5zq01ku1i15tbu`, imagem `sha256:85fca6b41e94e44beb21383c9c299564d303e63cc8e27c802c1dce70570cd221`, confirmou `GIT_SHA=825210dbf751614206afb0dc363b455094557849`;
- `https://dev.vortek.shop/api/ops/health` respondeu `200` e a rota de categorias sem sessão respondeu `401`;
- migration, alteração de schema, escrita ou exclusão de dados: **N/A**;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter o commit funcional em `dev` e executar novo deploy somente de homologação; não há migration nem dado estrutural a reverter. Scripts removidos permanecem recuperáveis pelo histórico Git.

**Pendência:** nenhuma para `HAYA-04`. A próxima ação obrigatória é `JOB-01 — Catálogo on_hold`.

### FIN-01 + FIN-02 — Lifecycle e parser

**Prioridade:** P1
**Situação:** concluída e validada operacionalmente em homologação.
**Commits funcionais:** `a56fb06`, `d26dffc`, `bc0f591` e `d333ff5`.

- [x] reconfirmar o lifecycle e os campos oficiais atuais do relatório;
- [x] fazer a mesma tarefa percorrer `requested → processing → processed → download → import → complete`;
- [x] retomar a mesma tarefa sem criar um segundo cron;
- [x] priorizar o valor líquido oficial relevante ao saldo;
- [x] validar tipo da transação, moeda e idempotência;
- [x] provar que resposta `202/requested` não vira `complete`;
- [x] provar retomada da mesma task;
- [x] provar importação idempotente e ausência de crédito duplicado;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** a rota retornava `202` com `success=true`, e o executor genérico classificava qualquer resposta HTTP bem-sucedida como `completo`. O `taskId` retornado pelo Mercado Pago ficava apenas no log do job encerrado; a execução seguinte recalculava outra janela e podia solicitar outro relatório. Em paralelo, o parser não reconhecia diretamente `SETTLEMENT_NET_AMOUNT`, `TRANSACTION_TYPE` e `SETTLEMENT_CURRENCY`, permitindo que valor bruto e campos genéricos participassem da criação de crédito. A validação com a conta TEST também comprovou que `SOURCE_ID` identifica a transação, mas não cada lançamento: 11 transações possuíam pares financeiros distintos de `SETTLEMENT` com `DISPUTE` ou `REFUND`.

**Mudança executada:**

- resposta `deferred=true` agora mantém o mesmo job em `on_hold`, sem `finished_at`;
- a rota recupera do próprio log o `taskId` inteiro e o intervalo congelado e consulta a mesma tarefa até ficar disponível;
- o lifecycle fica observável como `requested → processing → processed → download → import → complete`;
- o contrato oficial (`processed`/`file_name`) e o formato observado na conta TEST (`available`/`files[]`) são normalizados no mesmo fluxo, sem usar a URL retornada pelo provedor;
- o parser único usa `SOURCE_ID`, `SETTLEMENT_DATE`, `TRANSACTION_TYPE`, `SETTLEMENT_NET_AMOUNT`, `SETTLEMENT_CURRENCY` e valida `TRANSACTION_CURRENCY` quando presente;
- a identidade idempotente usa um fingerprint estável dos campos oficiais do movimento, preservando lançamentos distintos da mesma transação;
- linha sem identidade, líquido, tipo ou moeda oficial válida é rejeitada e não gera crédito;
- `topup` automático exige Hayamax, mínimo vigente, BRL, líquido negativo e tipo oficial `PAYOUT` ou `WITHDRAWAL`; casos válidos, porém ambíguos, permanecem para revisão;
- conflito concorrente da `movement_key` relê o movimento já criado e preserva o vínculo;
- os índices únicos existentes continuam como fonte de idempotência; nenhum cron, tabela, migration ou dependência foi criado.

**Validação executada em 30/08/2026:**

- documentação oficial atual de configuração, criação, acompanhamento, download e campos do relatório Mercado Pago reconfirmada;
- configuração da conta TEST preservada e ampliada somente com `SETTLEMENT_NET_AMOUNT`, `SETTLEMENT_CURRENCY` e `TRANSACTION_CURRENCY`;
- testes direcionados `tests/mercadopago-account-money.test.js` e `tests/ml-order-hydration-queue.test.js`: 14/14 aprovados;
- cobertura provou líquido sobre bruto, bloqueios de tipo/moeda/sinal, identidade estável por movimento, preservação de eventos distintos com o mesmo `SOURCE_ID`, recuperação da mesma task e `deferred → on_hold`;
- `npm run validate`: aprovado, sem warnings ou erros;
- `npm run build`: aprovado;
- `git diff --check`: aprovado;
- credencial TEST persistida somente na integração Mercado Pago do `supabase-dev`, sem reprodução do valor;
- o mesmo job foi criado para uma janela fixa, permaneceu em `on_hold`, retomou a mesma tarefa do provedor e terminou `completo` após download e importação;
- arquivo TEST: 239 linhas processadas, sendo 238 válidas e 1 rejeitada com segurança; resultado final de 238 movimentos, 6 casos para revisão, zero candidatos Hayamax e zero créditos automáticos;
- a reimportação do mesmo arquivo respondeu `200/success=true` e manteve exatamente 238 movimentos, 6 revisões e zero créditos, comprovando idempotência;
- os movimentos intermediários criados com a identidade incompleta foram removidos somente do `supabase-dev`, após confirmar que todos pertenciam ao arquivo TEST e não possuíam vínculo de crédito; os dados foram recuperados pela importação correta;
- commits funcionais enviados para `origin/dev` e deploy acionado somente no serviço `vortek-erp-dev`;
- container de homologação confirmou `GIT_SHA=d333ff5`; `https://dev.vortek.shop/api/ops/health` respondeu `200` e a rota sem chave respondeu `401`;
- migration: **N/A**;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** reverter os commits funcionais em `dev`, executar novo deploy somente de homologação, remover os movimentos deste relatório TEST e desconfigurar a credencial TEST no `supabase-dev`; não há migration.

**Reclassificação em 30/08/2026:** o lifecycle, parser e importação idempotente permanecem válidos como base genérica de conciliação. A criação de `topup` Hayamax foi removida em `HAYA-03`.

**Pendência:** nenhuma para `FIN-01/FIN-02`. A próxima ação obrigatória do checklist é `HAYA-01 — Bloqueio operacional da Hayamax`.

### WEBHOOK-03 — `payment_lookup_failed`

**Prioridade:** P2
**Dependência:** `FIN-01/FIN-02`
**Situação:** **N/A — cancelado pela saída da Hayamax.**

O webhook removido consultava pagamentos apenas para classificar movimentos e criar `topup` Hayamax. Como essa consequência de negócio foi aposentada, não há motivo para criar reconciliação, retry ou fila para `payment_lookup_failed`. A rota completa foi removida em `HAYA-03`. Um novo webhook Mercado Pago só poderá ser criado junto de um caso de pagamento independente e aprovado.

---

## 12. Etapa 8 — Jobs e DSLite

### JOB-01 — Catálogo `on_hold`

**Prioridade:** P1
**Situação:** concluída e validada operacionalmente em homologação.
**Commits funcionais:** `2edacef`, `b32b1ed` e `4ce9524`.

- [x] investigar `pg_cron`, `pg_net`, runtime, worker, eligibility e lock;
- [x] identificar a causa exata do job órfão;
- [x] corrigir o mecanismo atual sem criar outro cron;
- [x] provar que `on_hold` é encontrado, retomado e concluído ou volta a estado observável;
- [x] concluir o gate obrigatório da seção 3.

**Causa confirmada:** o cron já selecionava `on_hold`, mas a rota exata do worker não estava liberada no middleware e a chamada autenticada por `x-api-key` era interceptada com `401` antes de chegar ao handler. Além disso, a função do banco apontava diretamente para `app.vortek.shop`, incompatível com o isolamento de homologação, e usava o timeout padrão do `pg_net`, menor que o limite de 300 segundos do worker. O cron, a elegibilidade e a tomada atômica do job já existiam e não exigiam outro mecanismo.

**Mudança executada:**

- a rota exata `/api/catalogo/no-catalogo/refresh/job/worker` foi incluída na lista interna do middleware, sem liberar um prefixo amplo;
- a função `private.dispatch_catalog_price_refresh_cron()` passou a obter URL e host do worker na configuração de runtime, validar o destino, enviar os cabeçalhos internos necessários e usar timeout de 300 segundos;
- ausência ou configuração inválida agora produz falha observável no cron, em vez de retorno silencioso;
- `on_hold` passou a ser tratado como estado ativo pelo endpoint de status e pela retomada/polling da interface;
- o cron existente foi preservado com a mesma identidade e periodicidade; nenhum cron, job, fila, tabela ou dependência paralela foi criado.

**Validação executada em 30/08/2026:**

- documentação oficial atual de Supabase Cron, `pg_cron` e `pg_net` consultada;
- teste direcionado `tests/catalog-refresh-batch.test.js`: 6/6 aprovado;
- `npm run validate`, `npm run build` e `git diff --check`: aprovados;
- migration `20260830193000_repair_catalog_refresh_dispatch.sql` aplicada e registrada somente no `supabase-dev`;
- aplicação enviada para `origin/dev`, implantada somente no serviço `vortek-erp-dev` e confirmada com `GIT_SHA=2edacef`; health check de homologação respondeu `200`;
- um único job controlado em `on_hold` foi retomado pelo cron existente e terminou `completo`, com progresso 100 e resultado esperado de 0/0 para a conta TEST sem anúncios de catálogo;
- execução do cron `succeeded` e resposta `pg_net` HTTP `200`, sem timeout ou erro;
- ao final, havia zero jobs de catálogo ativos, zero itens de manifesto pendentes, zero advisory locks, zero crons ativos e nenhuma chave de API transitória no runtime;
- a permissão temporária e restrita de rede usada para provar o transporte interno foi removida, restaurando integralmente a política de egress do `supabase-dev`;
- produção, `main`, Supabase produção e `app.vortek.shop` permaneceram intocados.

**Rollback:** manter o cron inativo, remover `catalog_refresh_worker_url` e `catalog_refresh_worker_host` do runtime, reverter os três commits em `dev` e executar novo deploy somente de homologação. A função falha de forma observável sem a configuração e não ativa cron automaticamente.

**Pendência:** nenhuma para `JOB-01`. A próxima ação obrigatória é `DSL-01 — Timeout DSLite`.

### DSL-01 — Timeout DSLite

**Prioridade:** P1
**Situação:** pendente.

- [ ] localizar onde timeout/erro vira sucesso vazio;
- [ ] preservar erro e status da request até a decisão de retry;
- [ ] impedir resultado `0 pedidos + job completo` em falha;
- [ ] provar falha observável e retry seguro;
- [ ] concluir o gate obrigatório da seção 3.

### INV-01 — API DSLite x XML

**Situação:** pendente de investigação; executar após a saúde do sync.

- [ ] mapear a fonte principal de preço/estoque;
- [ ] mapear o papel de fallback ou reconciliação da outra fonte;
- [ ] confirmar lock e consumidores compartilhados;
- [ ] remover uma fonte somente se sua função estiver coberta;
- [ ] concluir o gate obrigatório da seção 3 se houver mudança.

---

## 13. Etapa 9 — Plataforma e banco

### SEC-06 — Next.js

**Prioridade:** P1
**Situação:** pendente.

- [ ] confirmar versão atual do repositório;
- [ ] consultar Support Policy e migration guide oficiais atuais;
- [ ] escolher uma major atualmente suportada;
- [ ] executar upgrade isolado, sem refatoração de UI;
- [ ] executar testes direcionados, `npm run validate` e `npm run build`;
- [ ] executar smoke test em homologação;
- [ ] concluir o gate obrigatório da seção 3.

### SEC-07 — Secrets runtime

**Prioridade:** P1
**Situação:** pendente.

- [ ] confirmar recursos realmente disponíveis no Supabase self-hosted atual;
- [ ] preferir secret store oficialmente suportado;
- [ ] não implementar criptografia própria;
- [ ] migrar sem expor valores em código, logs ou checklist;
- [ ] concluir o gate obrigatório da seção 3.

### DB-03 — Fotografia real do banco

**Prioridade:** P2
**Situação:** pendente.

- [ ] capturar RLS, grants, policies e constraints no staging;
- [ ] capturar indexes, default privileges e funções `SECURITY DEFINER` relevantes;
- [ ] comparar com migrations sem presumir que elas representam todo o runtime;
- [ ] conferir produção somente na preparação autorizada da mudança;
- [ ] bloquear limpeza destrutiva sem essa fotografia;
- [ ] concluir o gate obrigatório da seção 3.

---

## 14. Etapa 10 — Consolidação de regras P2

Executar **uma regra por tarefa**.

### RULE-02 — Pricing

- [ ] manter `services/pricing.ts` como fonte;
- [ ] definir os contextos reais de 4% e 5%;
- [ ] remover fórmulas locais somente depois da equivalência comprovada;
- [ ] não alterar taxa por suposição;
- [ ] concluir o gate obrigatório da seção 3.

### RULE-03 — Payment mode

- [ ] usar `offer.payment_mode` como fonte;
- [ ] reutilizar a inferência compartilhada somente como fallback;
- [ ] provar que preview e execução produzem o mesmo resultado;
- [ ] concluir o gate obrigatório da seção 3.

### RULE-04 — Threshold de custo

- [ ] reutilizar `product-activity.ts`;
- [ ] remover repetição local de `cost > 2000` somente após equivalência;
- [ ] concluir o gate obrigatório da seção 3.

### RULE-05 — Status fiscal

- [ ] distinguir estado externo bruto, normalizado técnico e persistido canônico;
- [ ] consolidar somente dentro do domínio correto;
- [ ] não criar enum global entre domínios;
- [ ] concluir o gate obrigatório da seção 3.

### RULE-07 — Tipos do ledger

- [ ] mapear tipos realmente aceitos e operados no banco;
- [ ] alinhar TypeScript com o contrato real;
- [ ] remover casts dispersos somente no fluxo afetado;
- [ ] concluir o gate obrigatório da seção 3.

### JOB-02 — Dispatch duplicado

- [ ] mapear a lógica comum de `/api/sync/run` e `/api/sync/disparar`;
- [ ] consolidar a lógica interna;
- [ ] preservar autenticação e origem específicas de cada rota;
- [ ] concluir o gate obrigatório da seção 3.

### JOB-04 — Status de job

- [ ] localizar writers e significados divergentes;
- [ ] normalizar writers antes de criar constraint;
- [ ] provar que estados e métricas ficaram inequívocos;
- [ ] concluir o gate obrigatório da seção 3.

---

## 15. Etapa 11 — Interface

Executar somente depois das regras e correções das quais cada item depende.

### UI-05 — Perguntas

- [ ] confirmar que busca/filtro opera somente sobre a página carregada;
- [ ] alinhar semântica entre UI e API;
- [ ] provar busca e filtros sobre o conjunto esperado;
- [ ] concluir o gate obrigatório da seção 3.

### UI-02 — Tracking Mercado Livre

- [ ] localizar o fluxo compartilhável entre Produtos e Catálogo;
- [ ] compartilhar somente o acompanhamento de publicação;
- [ ] não criar framework genérico de polling;
- [ ] concluir o gate obrigatório da seção 3.

### UI-01 — Pedidos

- [ ] separar somente blocos funcionais reais de DSLite;
- [ ] separar pagamento de fornecedor quando independente;
- [ ] separar etiqueta/WhatsApp quando independente;
- [ ] preservar regras de negócio nas fontes existentes;
- [ ] concluir o gate obrigatório da seção 3.

### UI-03 — Configurações

**Dependências:** `SEC-01`, `SEC-03` e `SEC-04`.

- [ ] confirmar todas as dependências concluídas;
- [ ] separar tabs em componentes mantendo a mesma rota;
- [ ] não duplicar autorização nem manipulação de secrets;
- [ ] concluir o gate obrigatório da seção 3.

### UI-04 — DTO Pedidos

- [ ] mapear a resposta operacional real da API;
- [ ] criar o tipo específico dessa resposta;
- [ ] substituir apenas os `any` do fluxo afetado;
- [ ] não iniciar campanha genérica de tipagem;
- [ ] concluir o gate obrigatório da seção 3.

### UI-06 — Compras

- [ ] separar fetch dependente de filtros;
- [ ] separar indicadores independentes;
- [ ] provar que filtros não repetem chamadas independentes;
- [ ] concluir o gate obrigatório da seção 3.

---

## 16. Etapa 12 — Limpeza histórica

Executar somente depois do sistema funcional e validado. Cada remoção exige busca de consumers e rollback conhecido.

### HIST-01 — Cluster `ml-p0-*`

- [ ] confirmar campanha encerrada;
- [ ] localizar todos os consumers;
- [ ] separar testes permanentes e preservar evidências necessárias;
- [ ] remover o cluster por conjunto coerente;
- [ ] remover objetos atuais de banco somente por nova migration;
- [ ] preservar migrations históricas;
- [ ] concluir o gate obrigatório da seção 3.

### HIST-02 + HIST-03 — WhatsApp histórico

- [ ] localizar readers/writers de `whatsapp_alert_events`;
- [ ] localizar readers/writers de `ops_whatsapp_events`;
- [ ] confirmar ausência de serviços ou scripts externos;
- [ ] remover somente após ausência completa de consumers;
- [ ] concluir o gate obrigatório da seção 3.

### HIST-04 — Scripts e reports one-off

- [ ] agrupar candidatos por finalidade/campanha;
- [ ] confirmar que cada processo encerrou;
- [ ] remover por cluster, nunca por arquivo aleatório;
- [ ] concluir o gate obrigatório da seção 3.

### HIST-05 — Panasonic

- [ ] confirmar encerramento do onboarding/importação;
- [ ] remover ou arquivar juntos `Panasonic.xls` e seu importador;
- [ ] concluir o gate obrigatório da seção 3.

### HIST-06 — Dataset

- [ ] confirmar ausência de iniciativa atual que use `scripts/build_dataset/`;
- [ ] remover o cluster somente após essa confirmação;
- [ ] concluir o gate obrigatório da seção 3.

### HIST-07 — OpenCode

- [ ] confirmar se `opencode.json` possui consumidor atual;
- [ ] corrigir a referência se estiver em uso;
- [ ] remover o arquivo se estiver sem uso;
- [ ] concluir o gate obrigatório da seção 3.

### HIST-08 — RTK.md

- [ ] confirmar se `RTK.md` possui consumidor atual;
- [ ] alinhar com `AGENTS.md` se for consumido;
- [ ] remover se estiver sem consumidor;
- [ ] concluir o gate obrigatório da seção 3.

---

## 17. Registro obrigatório de cada ação

Adicionar uma entrada ao concluir ou bloquear uma ação:

```text
Identificador:
Situação:
Data:
Responsável:
Estado/causa confirmados:
Mudança realizada:
Arquivos alterados:
Commit:
Teste direcionado:
npm run validate:
Build: executado / N/A com motivo
Migration: identificador e supabase-dev / N/A
Homologação: cenário e resultado / N/A com motivo
Rollback:
Risco ou pendência:
Próxima ação liberada:
```

Não colocar valores de variáveis de ambiente, credenciais ou qualquer secret nesse registro.

---

## 18. Checklist de promoção controlada `dev → main`

Esta seção prepara a promoção. Ela não autoriza merge nem deploy.

### Antes de solicitar autorização

- [ ] ação individual concluída e registrada;
- [ ] branch `dev` atualizada e limpa;
- [ ] testes direcionados verdes;
- [ ] `npm run validate` aprovado;
- [ ] build aprovado quando aplicável;
- [ ] migrations aplicadas e testadas somente em staging;
- [ ] `dev.vortek.shop` funcional;
- [ ] commits e diff destinados à `main` revisados;
- [ ] nenhuma secret adicionada ao Git;
- [ ] migrations da promoção identificadas;
- [ ] novas variáveis de produção identificadas sem expor valores;
- [ ] rollback e condição de interrupção conhecidos;
- [ ] nenhuma mudança fora do escopo;
- [ ] autorização explícita do responsável recebida.

### Depois de merge autorizado

- [ ] backup realizado quando exigido pela mudança;
- [ ] migration de produção aplicada quando autorizada e aplicável;
- [ ] deploy executado pelo caminho oficial do Easypanel;
- [ ] smoke test seguro executado;
- [ ] logs verificados;
- [ ] operação confirmada;
- [ ] release registrada;
- [ ] branch `dev` reconciliada com a nova base de produção.

---

## 19. Regras de rollback

- **Código sem migration destrutiva:** redeploy do commit anterior ou revert do commit.
- **Migration aditiva:** manter compatibilidade para permitir rollback do código.
- **Migration destrutiva:** executar somente com consumers removidos, backup verificado, transição concluída e restauração definida.
- **Integração externa:** possuir condição de interrupção e não criar efeito externo inverso automaticamente sem confirmar o estado real.

---

## 20. Encerramento do Item 17

O Item 17 só está encerrado quando todos os critérios aplicáveis abaixo tiverem evidência registrada:

- [ ] homologação permanece isolada e operacional;
- [ ] todos os P0 foram resolvidos;
- [ ] todos os P1 foram resolvidos ou formalmente reclassificados com evidência;
- [ ] quantity pricing foi migrado antes do prazo;
- [ ] estoque interno possui reserva segura;
- [ ] quantidade segura possui uma única fonte;
- [ ] Mercado Livre não executa scans/outboxes desnecessários comprovados;
- [ ] fluxo fiscal não faz chamadas inválidas;
- [x] Mercado Pago conclui todo o lifecycle;
- [ ] jobs não escondem falhas críticas;
- [ ] principais regras duplicadas estão consolidadas;
- [ ] interface foi simplificada somente onde havia mistura real;
- [ ] clusters históricos confirmados foram removidos;
- [ ] testes críticos permanentes estão identificados;
- [ ] produção permaneceu operacional durante toda a execução.

Quando estes critérios estiverem concluídos, fazer uma revisão final das auditorias e registrar qualquer item formalmente reclassificado antes de declarar o Item 17 encerrado.
