# Vortek — Item 17 — Checklist de Execução

**Função:** painel operacional de acompanhamento
**Última atualização:** 28/08/2026
**Ambiente de execução:** desenvolvimento/homologação
**Branch obrigatória:** `dev`
**Aplicação de homologação:** `https://dev.vortek.shop`
**Serviço de homologação:** `vortek-erp-dev` em `192.168.1.160`
**Banco de homologação:** `supabase-dev` em `192.168.1.162`
**Próxima ação obrigatória:** `ML-01 — Preços por Quantidade`

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
| 2 | Prazo externo Mercado Livre | Em andamento | Executar somente `ML-01` |
| 3 | Estoque e fulfillment | Pendente | Aguardar etapas anteriores |
| 4 | Capacidade e quantidade segura | Pendente | Depende de `STO-01/STO-02` |
| 5 | Mercado Livre observado e publicação | Pendente | Seguir dependências de cada ação |
| 6 | Fiscal | Pendente | Executar uma ação fiscal por vez |
| 7 | Mercado Pago e financeiro | Pendente | Tratar `FIN-01/FIN-02` de forma coerente |
| 8 | Jobs e DSLite | Pendente | Manter integrações externas seguras |
| 9 | Plataforma e banco | Pendente | Executar cada mudança isoladamente |
| 10 | Consolidação de regras P2 | Pendente | Executar uma regra por vez |
| 11 | Interface | Pendente | Somente após as regras correspondentes |
| 12 | Limpeza histórica | Pendente | Somente após estabilidade funcional |

### Próxima ação

- [ ] Executar somente `ML-01 — Preços por Quantidade`.
- [ ] Não avançar para a ação seguinte antes de `ML-01` estar integralmente validada.

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
- **N/A até a etapa exigir:** credenciais de teste do Mercado Pago;
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
**Situação:** implementada e validada tecnicamente em homologação; validação externa bloqueada pela ausência de seller de teste.

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

**Pendência bloqueante:** configurar um seller/conta de teste do Mercado Livre na homologação e provar recomendação, publicação percentual e read-back contra a API externa. A conta real não será usada. Até essa prova, `ML-01` permanece como próxima ação obrigatória e nenhuma ação seguinte do Item 17 está liberada.

**Preparação adicional em 29/08/2026:**

- commit `503ab0c` — `security: isolate Mercado Livre account allowlist` enviado para `origin/dev`;
- runtime, OAuth e webhooks passaram a aceitar substituição integral do allowlist por `ML_ALLOWED_USER_IDS`, preservando o ID atual somente como fallback quando a variável estiver ausente;
- 7 testes do guard de conta e os 13 testes de quantity pricing aprovados;
- `npm run validate` e `npm run build` aprovados, com 122 páginas geradas;
- placeholder `integracoes/mercadolivre` criado desconectado somente no `supabase-dev`, sem Client ID, secret ou tokens;
- arquivo local protegido de bootstrap criado fora do repositório com permissão `0600`, ainda sem valores;
- deploy do commit foi aceito pelo webhook, mas não entrou em operação: a primeira tentativa falhou no Easypanel durante o download do código por erro transitório de DNS (`curl` exit 6), e as novas tentativas não iniciaram outro rollout;
- test users não foram criados e nenhuma chamada autenticada ao Mercado Livre foi executada, pois as credenciais exclusivas do app DEV e o token temporário de bootstrap ainda não foram disponibilizados.

---

## 7. Etapa 3 — Estoque e fulfillment

### STO-01 + STO-02 — Reserva atômica

**Prioridade:** P1
**Situação:** pendente; os dois identificadores formam o mesmo change-set conceitual.

- [ ] confirmar o ponto exato entre seleção `internal` e consumo de estoque;
- [ ] garantir atomicamente que `internal` significa estoque já reservado;
- [ ] reutilizar PostgreSQL, RPC, locks, ledger e `fulfillment_source` existentes;
- [ ] representar o fluxo `disponível → reservado → despachado`;
- [ ] liberar/estornar a reserva quando o fluxo falhar antes do despacho;
- [ ] provar que saldo 1 com duas vendas simultâneas gera uma reserva;
- [ ] provar que retry não cria segunda reserva;
- [ ] provar liberação no cancelamento e saída no despacho;
- [ ] provar que falha fiscal/etiqueta preserva a reserva;
- [ ] provar reserva correta dos componentes de kit;
- [ ] concluir o gate obrigatório da seção 3.

---

## 8. Etapa 4 — Capacidade e quantidade segura

### RULE-01 — Capacidade de fulfillment e Q segura

**Prioridade:** P2 estrutural
**Dependência:** `STO-01/STO-02`
**Situação:** pendente.

- [ ] centralizar quanto o fulfillment interno consegue atender;
- [ ] centralizar quanto o fornecedor consegue atender;
- [ ] definir `Q_segura = max(Q_internal, Q_supplier)`;
- [ ] impedir soma de capacidades incompatíveis;
- [ ] derivar capacidade de kits exclusivamente dos componentes;
- [ ] provar os cenários `2/3 → 3` e `5/3 → 5`;
- [ ] provar seleção da melhor oferta válida do fornecedor;
- [ ] provar que reserva reduz `Q_internal`;
- [ ] concluir o gate obrigatório da seção 3.

### ML-03 — Não publicar estoque igual

**Prioridade:** P1
**Dependência:** `STO-01/STO-02` e `RULE-01`
**Situação:** pendente.

- [ ] comparar quantidade/status relevante na fonte centralizada;
- [ ] não usar timestamp de sincronização como mudança de estoque;
- [ ] impedir nova outbox quando a quantidade não mudou;
- [ ] criar outbox quando a quantidade realmente mudou;
- [ ] provar ausência de publicação redundante;
- [ ] concluir o gate obrigatório da seção 3.

---

## 9. Etapa 5 — Mercado Livre observado e publicação

### ML-02 — Scan repetido

**Prioridade:** P1
**Situação:** pendente.

- [ ] medir e confirmar a reconstrução repetida da população;
- [ ] obter a população uma vez por ciclo;
- [ ] processar o ciclo de forma retomável usando mecanismo durável existente;
- [ ] não persistir `scroll_id` como estado durável;
- [ ] provar cobertura integral sem itens pulados ou duplicados;
- [ ] provar retomada e abertura correta de um novo ciclo;
- [ ] concluir o gate obrigatório da seção 3.

### RULE-06 — Elegibilidade de publicação

**Prioridade:** P2
**Situação:** pendente.

- [ ] centralizar no domínio ML a decisão de anúncio modificável;
- [ ] classificar erros transitórios e terminais;
- [ ] reutilizar a mesma semântica no producer e worker;
- [ ] impedir reenfileiramento contínuo de anúncio não modificável;
- [ ] concluir o gate obrigatório da seção 3.

### INV-05 — Automação nativa de preço

**Situação:** pendente de investigação.

- [ ] verificar se existem anúncios de teste com automação nativa ativa;
- [ ] comparar o comportamento com a documentação oficial atual;
- [ ] implementar pre-check somente se a necessidade operacional for comprovada;
- [ ] registrar `N/A` com evidência se nenhuma mudança for necessária;
- [ ] concluir o gate obrigatório da seção 3 se houver implementação.

### INV-02 — Helpers antigos de estoque

**Situação:** pendente de investigação.

- [ ] localizar todos os chamadores dos helpers antigos;
- [ ] provar que `stock-publish.ts` cobre integralmente o fluxo atual;
- [ ] remover somente código sem consumidor e sem função exclusiva;
- [ ] preservar o código se a cobertura não estiver comprovada;
- [ ] concluir o gate obrigatório da seção 3 se houver remoção.

---

## 10. Etapa 6 — Fiscal

### FIS-01 — Upload XML correto

**Prioridade:** P1
**Situação:** pendente.

- [ ] reconfirmar o contrato oficial atual de invoice do Mercado Livre;
- [ ] localizar e remover chamadas comprovadamente inválidas;
- [ ] usar `GET → POST` para invoice nova;
- [ ] usar `GET → PUT` somente para atualização válida;
- [ ] verificar o estado final com `GET`;
- [ ] provar upload direto correto para invoice nova;
- [ ] concluir o gate obrigatório da seção 3.

### FIS-02 — Gate do shipment

**Prioridade:** P1
**Situação:** pendente; executar separadamente de `FIS-01`.

- [ ] exigir `status = ready_to_ship`;
- [ ] exigir `substatus = invoice_pending`;
- [ ] não enviar XML quando o shipment não estiver apto;
- [ ] aguardar o fluxo legítimo já existente;
- [ ] provar ausência de `invalid_shipment` causado pelo Vortek;
- [ ] concluir o gate obrigatório da seção 3.

### FIS-03 — `not_found` Brasil NFe

**Prioridade:** P1
**Situação:** pendente; executar separadamente.

- [ ] distinguir `not_found` transitório e terminal;
- [ ] reabrir somente quando houver mudança real de estado;
- [ ] impedir consulta periódica infinita de resultado terminal;
- [ ] preservar idempotência quando a chave já estiver vinculada;
- [ ] não criar outro reconciliador;
- [ ] concluir o gate obrigatório da seção 3.

---

## 11. Etapa 7 — Mercado Pago e financeiro

### FIN-01 + FIN-02 — Lifecycle e parser

**Prioridade:** P1
**Situação:** pendente; devem ser coerentes antes de confiar em crédito automático.

- [ ] reconfirmar o lifecycle e os campos oficiais atuais do relatório;
- [ ] fazer a mesma tarefa percorrer `requested → processing → processed → download → import → complete`;
- [ ] retomar a mesma tarefa sem criar um segundo cron;
- [ ] priorizar o valor líquido oficial relevante ao saldo;
- [ ] validar tipo da transação, moeda e idempotência;
- [ ] provar que resposta `202/requested` não vira `complete`;
- [ ] provar retomada da mesma task;
- [ ] provar importação idempotente e ausência de crédito duplicado;
- [ ] concluir o gate obrigatório da seção 3.

### WEBHOOK-03 — `payment_lookup_failed`

**Prioridade:** P2
**Dependência:** `FIN-01/FIN-02`
**Situação:** pendente.

- [ ] integrar a falha à mesma estratégia de reconciliação financeira;
- [ ] não criar fila paralela exclusiva para o webhook;
- [ ] garantir estado observável e reprocessamento seguro;
- [ ] concluir o gate obrigatório da seção 3.

---

## 12. Etapa 8 — Jobs e DSLite

### JOB-01 — Catálogo `on_hold`

**Prioridade:** P1
**Situação:** pendente.

- [ ] investigar `pg_cron`, `pg_net`, runtime, worker, eligibility e lock;
- [ ] identificar a causa exata do job órfão;
- [ ] corrigir o mecanismo atual sem criar outro cron;
- [ ] provar que `on_hold` é encontrado, retomado e concluído ou volta a estado observável;
- [ ] concluir o gate obrigatório da seção 3.

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
- [ ] Mercado Pago conclui todo o lifecycle;
- [ ] jobs não escondem falhas críticas;
- [ ] principais regras duplicadas estão consolidadas;
- [ ] interface foi simplificada somente onde havia mistura real;
- [ ] clusters históricos confirmados foram removidos;
- [ ] testes críticos permanentes estão identificados;
- [ ] produção permaneceu operacional durante toda a execução.

Quando estes critérios estiverem concluídos, fazer uma revisão final das auditorias e registrar qualquer item formalmente reclassificado antes de declarar o Item 17 encerrado.
