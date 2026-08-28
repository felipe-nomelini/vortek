# Vortek — Auditoria de Limpeza e Organização

## Item 7 — Sincronizações + Jobs + Scheduler

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** inventariar os jobs e mecanismos de execução atuais, identificar quem dispara cada fluxo, mapear frequência, duração, locks, retries e recuperação, e separar redundância real de mecanismos legítimos de resiliência antes de qualquer simplificação.

---

## 1. Conclusão executiva

O Vortek não possui uma única fila/scheduler.

Hoje existem três mecanismos principais de disparo automático:

```text
1. cron-dispatch central
   pg_cron a cada 1 minuto
   ↓
   registry de syncs periódicos
   + filas operacionais
   + recuperação de stale
   + alertas/notificações

2. publicação Mercado Livre
   pg_cron a cada 15 segundos
   ↓
   somente quando há outbox pendente/on_hold
   ↓
   sync_ml_listings_publish

3. refresh durável de catálogo
   pg_cron a cada 15 segundos
   ↓
   somente quando existe job pendente/on_hold
   ↓
   catalogo_no_catalogo_refresh
```

Essa multiplicidade **não é automaticamente duplicação**.

Os três mecanismos possuem funções diferentes:

```text
cron-dispatch
= tarefas periódicas gerais

ML publish
= drenagem quase em tempo real da outbox

catalog refresh
= retomada em lotes de um job pesado e durável
```

A base também possui proteções importantes:

- registry central para syncs conhecidos;
- `dispatchMode` explícito: `scheduled`, `realtime`, `manual`;
- locks por domínio em `sync_domain_locks`;
- jobs persistidos;
- `on_hold`;
- retries;
- backoff;
- stale recovery;
- dedupe por chave para filas duráveis;
- auditoria em `jobs.log`;
- monitoramento de tasks agendadas.

Esses mecanismos devem ser preservados.

Os problemas reais encontrados são de **coerência operacional e organização**, não de ausência de infraestrutura.

### Principais achados

**P1**
1. Um refresh durável de catálogo está `on_hold` há horas sem retomada, embora o cron dedicado de 15 s devesse retomá-lo.
2. O job Mercado Pago pode terminar como `completo` depois de apenas solicitar um relatório assíncrono, sem fechar o ciclo.
3. O reconciliador Brasil NFe executa corretamente na frequência configurada, mas continua elegendo `not_found` determinístico repetidamente; o problema está na elegibilidade/retry do domínio, não na existência do scheduler.

**P2**
4. O `cron-dispatch` pode ter execuções sobrepostas; as proteções atuais reduzem o risco, mas o controle é distribuído.
5. `/api/sync/run` e `/api/sync/disparar` duplicam grande parte da lógica de resolução/criação/disparo de jobs.
6. Jobs duráveis fora do `SYNC_TASKS` não aparecem no mesmo modelo de saúde das tasks registradas.
7. API DSLite de preço/estoque e XML DSLite atualizam o mesmo domínio em agendas diferentes; o lock evita concorrência, mas a ownership entre as duas fontes precisa ficar explícita.
8. O significado de `completo`, `processados` e `total` não é uniforme entre famílias de jobs.
9. Chamadas de sistema via `/api/sync/run` são registradas como `manual_dispatch`, reduzindo clareza da auditoria.

Não foi identificado P0.

---

# 2. Registry central

O arquivo:

```text
src/lib/sync/registry.ts
```

é a fonte central das tasks de sincronização gerais.

Ele declara 14 tasks.

## Scheduled

```text
sync_dslite_fornecedores
sync_dslite_catalogo
sync_dslite_preco_estoque
sync_dslite_xml_preco_estoque
sync_dslite_pedidos_compra
sync_ml_orders_ingest
sync_ml_cancelamentos_pos_nfe
sync_ml_listings_observed
sync_reconcile_brasilnfe
sync_mercadopago_account_money
```

## Realtime

```text
sync_ml_listings_publish
```

## Manual

```text
sync_reconcile_fiscal
sync_pack_id_backfill
sync_municipios_seed
```

### Avaliação

**Manter o registry.**

Ele resolveu um problema real já documentado no próprio código: uma task de preço/estoque ficou 19 dias sem schedule sem que isso fosse percebido.

A existência explícita de:

```text
scheduled
realtime
manual
```

é uma boa proteção contra regressão.

---

# 3. Horário operacional

O registry define horário comercial em São Paulo como:

```text
08:00 <= hora < 22:00
```

Algumas tasks usam frequência diferente fora desse intervalo.

### Avaliação

**Manter.**

É uma regra operacional simples e centralizada.

---

# 4. Frequências das tasks registradas

| Task | Frequência comercial | Fora do horário | Domínio |
|---|---:|---:|---|
| `sync_dslite_fornecedores` | 30 min | 120 min | `fornecedores:dslite` |
| `sync_dslite_catalogo` | 360 min | 720 min | `produtos:dslite_catalogo` |
| `sync_dslite_preco_estoque` | 2 min | 2 min | `produtos:dslite_preco` |
| `sync_dslite_xml_preco_estoque` | 10 min | 10 min | `produtos:dslite_preco` |
| `sync_dslite_pedidos_compra` | 2 min | 2 min | `compras:dslite` |
| `sync_ml_orders_ingest` | 2 min | 5 min | `pedidos:ml_ingest` |
| `sync_ml_cancelamentos_pos_nfe` | 2 min | 5 min | `pedidos:cancelamentos_pos_nfe` |
| `sync_ml_listings_observed` | 5 min | 15 min | `anuncios:ml_pull` |
| `sync_reconcile_brasilnfe` | 2 min | 10 min | `pedidos:brasilnfe` |
| `sync_mercadopago_account_money` | 180 min | 360 min | `financeiro:mercadopago` |

A consulta operacional confirmou atividade recente das principais tasks, inclusive `sync_dslite_catalogo`.

---

# 5. Dispatcher principal

O banco agenda:

```text
vortek-sync-cron-dispatch
```

a cada:

```text
1 minuto
```

O dispatcher:

```text
/api/sync/cron-dispatch
```

não executa todas as tasks a cada minuto.

Ele usa o minuto como pulso e decide se cada task está:

```text
devida
rodando
on_hold
em backoff
bloqueada por autenticação
```

### Avaliação

**Manter essa separação.**

O `pg_cron` não precisa possuir um cron diferente para cada sync comum.

A regra de frequência continuar no registry reduz configuração espalhada.

---

# 6. `pg_cron` + `pg_net`

O dispatcher do banco usa:

```text
pg_cron
+
pg_net
```

para chamar o aplicativo.

A documentação oficial atual do Supabase confirma que:

- Cron é baseado em `pg_cron`;
- `pg_net` faz chamadas HTTP assíncronas;
- jobs podem ser agendados inclusive em intervalos de segundos nas versões suportadas.

### Consequência

O banco não espera necessariamente o request anterior do aplicativo terminar antes de poder disparar outro cron posteriormente.

Isso importa para entender a sobreposição observada no Vortek.

---

# 7. Sobreposição real do `cron-dispatch`

A consulta operacional confirmou um exemplo claro.

Um:

```text
sync_ml_listings_observed
```

ficou rodando por mais de 1 minuto.

Durante esse período, novos jobs de outras tasks começaram a ser criados/executados.

Portanto:

```text
cron-dispatch A
ainda ativo
+
cron-dispatch B
já iniciado
```

é uma situação real.

### Avaliação

A sobreposição **não é automaticamente um bug**.

Ela é parcialmente protegida por:

- consulta de job ativo;
- claim condicional do job;
- locks por domínio;
- dedupe de filas;
- dedupe de alertas.

Porém a proteção está distribuída.

### Classificação

**P2 — concorrência do orquestrador precisa ficar explícita.**

Não adicionar um lock global no dispatcher sem estudar o impacto.

Um lock global poderia atrasar tasks rápidas sempre que um sync observado demorar mais de 1 minuto.

A direção final deve ser definida no Item 16 após consolidar performance e webhooks.

---

# 8. Locks por domínio

O Vortek possui:

```text
sync_domain_locks
```

O lock guarda:

- domínio;
- task;
- token;
- job;
- horário de aquisição;
- expiração.

A consulta operacional confirmou locks ativos reais em domínios como:

```text
anuncios:ml_pull
anuncios:ml_push
```

### Avaliação

**Manter.**

É a principal barreira contra dois fluxos modificarem o mesmo domínio simultaneamente.

Não substituir por Redis ou outra fila.

---

# 9. Claim do job

`runMlSingleStageJob(...)` tenta assumir um job somente se ele estiver:

```text
pendente
ou
on_hold
```

e atualiza condicionalmente para:

```text
rodando
```

Se outro processo já assumiu o mesmo job, o segundo não prossegue normalmente.

### Avaliação

**Manter.**

Isso reduz duplicidade quando dois dispatchers encontram a mesma linha.

---

# 10. Retry por lock

Quando uma rota retorna conflito de domínio, o runner pode:

```text
aguardar
repetir
```

ou:

```text
deixar on_hold
```

dependendo da configuração da task.

O comportamento foi confirmado operacionalmente no XML DSLite.

Um job recente aguardou várias vezes porque:

```text
produtos:dslite_preco
```

estava ocupado.

### Avaliação

**Complexidade necessária.**

O problema não é o retry existir.

O ponto a revisar é por que duas fontes independentes são programadas para o mesmo domínio.

---

# 11. API DSLite x XML DSLite

Existem duas fontes programadas de custo/estoque:

```text
/api/sync/preco-estoque
→ API DSLite

/api/sync/preco-estoque-xml
→ feeds XML DSLite
```

Ambas:

- atualizam ofertas;
- recalculam snapshot preferencial;
- afetam kits;
- podem enfileirar Mercado Livre.

Ambas usam:

```text
produtos:dslite_preco
```

como domínio.

### Avaliação

**Não remover uma delas agora.**

O lock compartilhado mostra que o sistema já reconhece que elas não podem escrever simultaneamente.

Porém a responsabilidade entre as duas fontes não está suficientemente explícita.

### Classificação

**P2 — investigar ownership.**

Precisamos confirmar futuramente se o XML é:

```text
fallback
reconciliador
segunda fonte oficial
ou legado
```

A documentação oficial pública consultada da DSLite não foi suficiente para classificar esse feed como redundante.

---

# 12. Falhas recentes do XML DSLite

Foram encontrados jobs recentes em `erro`.

Um exemplo real:

```text
lock ocupado
↓
retry
↓
execução prossegue
↓
um feed XML aborta após tentativas
↓
HTTP 207
↓
job termina erro
```

Outras execuções posteriores voltaram a completar.

### Avaliação

Isso demonstra resiliência, mas também gera ruído operacional.

**Não remover retries.**

O Item 13 deve medir a recorrência antes de decidir se frequência ou timeout precisam mudar.

---

# 13. Mercado Livre — publicação realtime

A publicação não depende do dispatcher central.

Existe cron dedicado:

```text
vortek-ml-publish-dispatch
```

a cada:

```text
15 segundos
```

Antes de chamar o app, o banco verifica se existe:

```text
outbox pending/retry disponível
ou
job publish on_hold
```

### Avaliação

**Manter.**

Esse fluxo possui uma necessidade diferente dos syncs periódicos:

```text
mudança desejada
→ publicar rapidamente
```

Não trazer a publicação de volta para o cron de 1 minuto apenas para reduzir um cron.

---

# 14. Estado operacional da publicação ML

A consulta operacional confirmou jobs `sync_ml_listings_publish` executando continuamente quando existe trabalho.

Durações recentes ficaram, em geral, na ordem de segundos/dezenas de segundos.

Também foram observadas execuções com falhas permanentes de anúncios não modificáveis, já registradas no Item 4.

### Avaliação

O scheduler realtime está operacional.

Os problemas de anúncio não modificável pertencem à regra de elegibilidade da outbox, não ao mecanismo de cron.

---

# 15. Refresh durável de catálogo

O catálogo possui um mecanismo próprio.

A migration:

```text
20260804001421_durable_catalog_price_refresh.sql
```

cria:

```text
catalogo_ml_refresh_items
```

e agenda:

```text
vortek-catalog-price-refresh
```

a cada:

```text
15 segundos
```

O cron só chama o worker quando encontra job:

```text
pendente
ou
on_hold
```

O processamento é feito em lotes retomáveis.

### Avaliação

**Manter a arquitetura durável.**

Refreshes completos recentes processaram aproximadamente:

```text
5,8 mil anúncios
```

e normalmente terminaram em cerca de 4–7 minutos.

Isso justifica não executar todo o refresh como uma única chamada simples.

---

# 16. P1 — refresh de catálogo `on_hold` órfão

Foi encontrado no banco operacional um job:

```text
catalogo_no_catalogo_refresh
status = on_hold
```

criado em:

```text
2026-08-27 00:29 UTC
```

O log registra uma falha transitória no primeiro estágio e intenção de retomada.

Horas depois:

- o job continuava `on_hold`;
- não havia nova atividade registrada;
- não havia manifesto pendente em `catalogo_ml_refresh_items`.

Isso conflita com o comportamento esperado do cron dedicado de 15 s, que deveria selecionar jobs `on_hold`.

### Avaliação

**P1 — recuperação automática não está confiável.**

A causa exata não foi comprovada nesta auditoria.

Pode estar em:

- cron operacional;
- chamada `pg_net`;
- configuração runtime;
- lifecycle do worker;
- estado da infraestrutura.

Não criar outro cron.

Primeiro deve ser verificado por que o cron já existente deixou de retomar o job.

---

# 17. Lacuna de saúde para jobs fora do registry

O monitor:

```text
alertStaleScheduledTasks
```

usa as tasks agendadas do:

```text
SYNC_TASKS
```

O refresh durável de catálogo não pertence a esse registry.

Por isso, o job `on_hold` observado pode permanecer parado sem entrar na mesma checagem de saúde das tasks agendadas.

### Avaliação

**P2 — observabilidade fragmentada.**

Não significa que todo job deva entrar em `SYNC_TASKS`.

A solução futura deve preservar categorias diferentes, mas permitir identificar claramente:

```text
job que deveria estar avançando
e
não está
```

independentemente da família.

---

# 18. Filas operacionais processadas pelo dispatcher central

Além de `SYNC_TASKS`, o `cron-dispatch` processa filas duráveis.

## WhatsApp de etiqueta

```text
whatsapp_label_send
```

Ele:

- lê jobs pendentes/on_hold;
- verifica retry;
- processa lote pequeno;
- reenvia jobs stale para `on_hold`.

## Hidratação de pedidos ML

```text
ml_orders_v2_hydration
```

Ele:

- possui dedupe key;
- é processado em lote pequeno;
- possui tratamento específico de stale;
- respeita bloqueio de autenticação Mercado Livre.

### Avaliação

**Manter.**

Essas filas são orientadas a evento/pedido, não tarefas periódicas globais.

Não precisam ser forçadas para dentro do mesmo modelo do registry.

---

# 19. Dedupe da hidratação ML

A migration da fila de hidratação criou chave única parcial para jobs ativos:

```text
tipo + dedupe_key
```

O banco mostrou várias hidratações do mesmo `ml_order_id` ao longo do tempo, mas não como jobs ativos simultâneos.

### Avaliação

**Manter.**

Uma nova hidratação posterior pode ser legítima porque o estado externo pode ter mudado.

Dedupe permanente por order ID seria incorreto.

---

# 20. Jobs de criação DSLite

Também existem jobs operacionais como:

```text
dslite_criar_pedido
```

Eles são criados por evento/fulfillment e utilizam:

```text
dedupe_key = pedido:{id}
```

Não fazem parte do scheduler periódico.

### Avaliação

**Manter fora de `SYNC_TASKS`.**

Eles representam execução de uma operação de negócio, não reconciliação global.

---

# 21. Recuperação de stale

O dispatcher verifica jobs:

```text
pendente
rodando
```

e usa por padrão:

```text
10 minutos
```

sem atividade recente como limiar de stale.

Existem tratamentos especiais para:

- hidratação ML;
- WhatsApp de etiqueta.

Nos demais casos, o job pode ser encerrado como `erro` e o lock associado é liberado quando possível.

### Avaliação

**Manter o conceito.**

Não foi encontrada evidência de que o limiar de 10 minutos esteja encerrando jobs saudáveis atuais.

---

# 22. Backoff das tasks periódicas

O dispatcher lê os jobs recentes.

Quando existe sequência de falha, pode aplicar:

```text
10 minutos de backoff
```

A exceção explícita é:

```text
sync_dslite_preco_estoque
```

que não recebe esse backoff.

### Avaliação

**Manter por enquanto.**

Essa exceção deve ser validada no Item 13 com volume real de falhas antes de ser alterada.

Não existe evidência suficiente neste item para dizer que a frequência está errada.

---

# 23. P1 carregado — Brasil NFe

O scheduler está fazendo exatamente o que o registry manda:

```text
2 min comercial
10 min fora
```

O problema encontrado no Item 5 é que um resultado:

```text
not_found
```

continua tornando o pedido elegível novamente.

Como o job pode terminar `completo`, o backoff genérico por falha não resolve.

### Conclusão

**Não remover nem desacelerar cegamente o reconciliador.**

A correção deve estar na regra:

```text
quem continua elegível para reconciliação
```

e na diferença entre:

```text
estado transitório
estado determinístico
```

### Prioridade

**P1 — mantido do Item 5.**

---

# 24. P1 carregado — Mercado Pago

O scheduler executa:

```text
sync_mercadopago_account_money
```

na frequência declarada.

O problema do Item 6 continua confirmado conceitualmente:

```text
relatório solicitado
→ job marcado completo
```

mesmo que a reconciliação financeira ainda não tenha terminado.

### Conclusão

O scheduler não deve criar outro job para compensar isso.

O lifecycle da própria task precisa representar:

```text
requested
processing
processed/imported
```

de forma coerente.

### Prioridade

**P1 — mantido do Item 6.**

---

# 25. Cancelamentos pós-NF não são duplicação do sync de pedidos

O sync:

```text
sync_ml_cancelamentos_pos_nfe
```

varre especificamente pedidos que já estão:

```text
situacao = cancelado
+
dslite_id existente
+
nfe_chave existente
+
nota_fiscal_emitida = true
```

Depois executa proteções adicionais para:

- vínculo seguro com compra DSLite;
- cancelamento fiscal;
- rejeição terminal por prazo;
- auditoria;
- aviso ao fornecedor;
- idempotência de eventos já concluídos.

### Avaliação

**Manter.**

Isso é um reconciliador especializado de efeito colateral pós-cancelamento.

Não é uma segunda ingestão genérica do Mercado Livre.

---

# 26. `/api/sync/run` x `/api/sync/disparar`

Existem duas rotas de despacho.

## `/api/sync/run`

Uso por API key/sistema.

## `/api/sync/disparar`

Uso por usuário autenticado/interface.

As duas implementam de forma muito semelhante:

- normalização de task;
- aliases legados;
- query;
- body;
- busca de job ativo;
- retomada de `on_hold`;
- criação de job;
- disparo background.

A diferença principal é:

- autenticação/origem;
- alguns detalhes de publicação ML;
- auditoria do ator.

### Avaliação

**P2 — duplicação de código confirmada.**

No plano futuro, a direção deve ser consolidar a lógica interna compartilhada e manter apenas as fronteiras de autenticação diferentes.

Não criar uma terceira rota.

---

# 27. Log de sistema marcado como manual

A chamada realtime de publicação passa por:

```text
/api/sync/run
```

O job observado no banco registrou:

```text
event_type = manual_dispatch
source = api/sync/run
```

apesar de o disparo ter sido automático pelo cron da outbox.

### Avaliação

**P3 — nomenclatura/auditoria.**

Não causa falha operacional, mas confunde investigação futura.

A origem deveria distinguir:

```text
system
cron
realtime
manual UI
```

sem depender apenas do nome da rota.

---

# 28. `processados` e `total` não têm semântica uniforme

Para várias tasks registradas, o wrapper grava:

```text
processados = 1
total = 1
```

porque representa uma etapa executada.

Já outros jobs usam os campos para volume real:

```text
catalogo_no_catalogo_refresh
→ ~5.800 / ~5.800

dslite_criar_pedido
→ etapas reais do pedido
```

### Avaliação

**P2 — observabilidade ambígua.**

Não é corrupção de dados.

Porém uma interface genérica de jobs pode interpretar os mesmos campos de formas diferentes.

A semântica precisa ficar explícita no Item 10/11 antes de qualquer alteração de schema.

---

# 29. Dispatcher central acumula responsabilidades

Além do scheduler, `/api/sync/cron-dispatch` executa:

- stale recovery;
- WhatsApp label queue;
- ML hydration queue;
- status de integrações;
- alertas de jobs;
- alerta de tasks paradas;
- alerta de etiquetas liberadas;
- push notifications;
- relatório semanal;
- relatório mensal;
- tasks agendadas.

### Avaliação

Isso parece grande, mas **não deve ser dividido automaticamente**.

Criar vários novos crons/endpoints pode deixar o sistema ainda mais fragmentado.

### Classificação

**P2 — responsabilidade operacional ampla; simplificar somente se houver ganho comprovado.**

A primeira limpeza deve ser:

```text
deixar ownership e categorias explícitas
```

e não:

```text
criar um cron por responsabilidade
```

---

# 30. Alertas possuem dedupe

A sobreposição do dispatcher poderia, em teoria, duplicar alertas.

O serviço de alertas utiliza:

- `dedupeKey`;
- TTL;
- lock de dedupe;
- auditoria.

Relatórios semanal e mensal também possuem dedupe próprio.

### Avaliação

**Manter.**

Não foi encontrada evidência de duplicação de relatório causada pela sobreposição do dispatcher.

---

# 31. Saúde das tasks registradas

O registry possui avaliação de saúde.

Uma task agendada é considerada stale com threshold:

```text
max(intervalo × 6, 30 minutos)
```

Essa informação alimenta alerta operacional.

### Avaliação

**Manter.**

É proteção importante contra task silenciosamente parada.

O problema atual é cobertura: jobs fora do registry precisam de mecanismo equivalente quando sua natureza exige retomada automática.

---

# 32. Aliases legados de taxonomy

O registry ainda traduz nomes antigos como:

```text
sync_dslite_stock
dslite_stock
sync_pedidos_ml
ml_pedidos
sync_anuncios_ml
ml_anuncios
...
```

para as task keys atuais.

### Avaliação

**P3 — candidato a limpeza posterior.**

Não remover no Item 7.

Primeiro o Item 11/15 precisa confirmar se UI, scripts ou integrações ainda enviam os nomes antigos.

---

# 33. Comparação com orientação oficial do Supabase

A documentação oficial atual do Supabase recomenda que Cron:

- tenha concorrência controlada;
- evite jobs muito longos;
- utilize `pg_cron` como scheduler;
- possa usar `pg_net` para chamadas HTTP assíncronas.

Os jobs de banco do Vortek apenas disparam requests e o trabalho pesado fica no aplicativo.

Os refreshes completos observados de catálogo ficaram abaixo de 10 minutos.

### Avaliação

A arquitetura geral é compatível com esse modelo.

O principal cuidado não é trocar de scheduler.

É controlar corretamente:

```text
sobreposição
claim
lock
retry
estado terminal
observabilidade
```

---

# 34. Inventário consolidado — famílias de jobs

## A. Tasks periódicas do registry

```text
sync_dslite_fornecedores
sync_dslite_catalogo
sync_dslite_preco_estoque
sync_dslite_xml_preco_estoque
sync_dslite_pedidos_compra
sync_ml_orders_ingest
sync_ml_cancelamentos_pos_nfe
sync_ml_listings_observed
sync_reconcile_brasilnfe
sync_mercadopago_account_money
```

## B. Task realtime do registry

```text
sync_ml_listings_publish
```

## C. Tasks manuais do registry

```text
sync_reconcile_fiscal
sync_pack_id_backfill
sync_municipios_seed
```

## D. Filas/jobs operacionais fora do registry

```text
ml_orders_v2_hydration
whatsapp_label_send
dslite_criar_pedido
catalogo_no_catalogo_refresh
```

## E. Serviços acionados pelo dispatcher, sem serem jobs de sync do registry

```text
alertIntegrationStatus
alertCriticalJobs
alertStaleScheduledTasks
scanAndAlertReleasedLabels
dispatchPushNotifications
sendSalesReport semanal/mensal
```

### Avaliação

Essa divisão por família é mais fiel ao sistema do que tentar colocar tudo em uma única lista homogênea.

---

# 35. Redundância real x recuperação legítima

## Recuperação legítima — manter

```text
sync de pedidos + hydration de pedido específico
outbox publish + sync observado
sync de pedido + cancelamento pós-NF
emissão fiscal + reconciliador Brasil NFe
jobs + stale recovery
catálogo + worker durável
alerta + dedupe
```

Esses pares possuem papéis diferentes.

## Duplicação/complexidade acidental confirmada

```text
/api/sync/run
≈
/api/sync/disparar
```

em grande parte do código interno.

## Sobreposição a investigar

```text
DSLite API preço/estoque
+
DSLite XML preço/estoque
```

porque atualizam as mesmas entidades e ainda não está documentado qual fonte deve prevalecer em cada cenário.

---

# 36. Complexidade essencial — preservar

- `SYNC_TASKS`;
- dispatch modes;
- jobs persistidos;
- `on_hold`;
- domain locks;
- claims condicionais;
- dedupe keys;
- retry;
- backoff;
- stale recovery;
- realtime outbox ML;
- sync observado ML;
- hidratação de pedidos;
- refresh durável de catálogo;
- cancelamento pós-NF;
- reconciliação fiscal;
- alertas com dedupe.

Nenhum desses mecanismos deve ser removido apenas para reduzir quantidade de arquivos.

---

# 37. Complexidade acidental / problemas confirmados

## P1 — refresh durável de catálogo pode ficar órfão em `on_hold`

Há evidência operacional atual.

A causa exata precisa ser investigada antes da correção.

## P1 — lifecycle do job Mercado Pago não representa conclusão real

Já confirmado no Item 6.

## P1 — Brasil NFe repete elegibilidade determinística

Já confirmado no Item 5.

O scheduler apenas executa a regra; a correção deve acontecer na elegibilidade do reconciliador.

## P2 — sobreposição do cron-dispatch é permitida e o controle é distribuído

Está protegida em boa parte, mas aumenta complexidade de raciocínio e depende de todos os consumidores serem idempotentes.

## P2 — `/sync/run` e `/sync/disparar` duplicam lógica

Candidato claro a consolidação interna.

## P2 — saúde fragmentada entre registry e jobs duráveis externos

O job de catálogo preso é o exemplo mais evidente.

## P2 — ownership API DSLite x XML DSLite não está explícita

Não remover nenhuma fonte antes de confirmar sua função operacional.

## P2 — métricas genéricas de jobs possuem significados diferentes

`1/1` pode representar uma etapa, enquanto outros jobs usam volume de registros.

## P3 — `manual_dispatch` é usado em disparo automático de sistema

Problema de clareza/auditoria.

## P3 — aliases de taxonomy antiga

Só remover após rastrear consumidores.

---

# 38. Estado desejado conceitualmente

Sem criar nova infraestrutura:

```text
EVENTO / SCHEDULE
↓
uma fonte explícita de ownership
↓
JOB persistido quando necessário
↓
claim
↓
lock do domínio
↓
execução
↓
estado coerente:
    completo
    on_hold
    erro terminal
↓
retry somente quando faz sentido
↓
health consegue detectar job que deveria avançar
```

A meta não é ter apenas um cron.

A meta é:

```text
cada mecanismo ter uma razão clara
+
nenhum job ficar órfão
+
nenhuma operação ser repetida sem necessidade
+
um único código compartilhado de despacho
```

---

# 39. O que NÃO fazer agora

Não devemos:

- trocar `pg_cron`;
- trocar `pg_net`;
- criar Redis;
- criar uma fila externa;
- criar um worker service separado;
- colocar todas as filas em `SYNC_TASKS`;
- transformar cada task em um cron próprio;
- remover o sync observado;
- remover o reconciliador Brasil NFe;
- remover o cancelamento pós-NF;
- remover o XML DSLite sem confirmar ownership;
- adicionar um lock global ao dispatcher sem medir impacto;
- criar novo cron para o catálogo preso;
- criar novo job para compensar Mercado Pago;
- implementar correções durante esta auditoria.

---

# 40. Dependências para itens futuros

## Item 8 — Webhooks + Eventos

Confirmar quais syncs são:

```text
primários por evento
reconciliadores periódicos
fallbacks
```

e se algum polling pode ser reduzido com segurança.

## Item 10 — Banco de Dados

Confirmar:

- constraints de jobs;
- unique active por tipo/dedupe;
- estados permitidos;
- `sync_domain_locks`;
- índices;
- semântica de `processados/total`;
- configuração runtime;
- estado real dos crons no banco.

## Item 12 — Regras Compartilhadas

Consolidar:

- elegibilidade de retry;
- estado terminal;
- classificação de erro;
- ownership API/XML;
- código compartilhado de despacho.

## Item 13 — Performance e Saúde Operacional

Medir:

- duração por task;
- concorrência real;
- quantidade de execuções;
- lock conflicts;
- retry rate;
- chamadas externas;
- XML failures;
- custo do sync observado;
- custo dos reconciliadores.

## Item 14 — Testes

Mapear proteção de:

- claims;
- locks;
- retry;
- on_hold;
- stale;
- dedupe;
- cursor/offset;
- scheduler health.

## Item 15 — Scripts + Documentação + Históricos

Rastrear:

- aliases antigos;
- endpoints de dispatch antigos;
- chamadas antigas de sync;
- documentação de schedules anteriores.

---

# 41. Resultado do checklist — Item 7

- [x] Inventariar todos os jobs/syncs operacionais atuais identificados.
- [x] Identificar quem dispara cada família.
- [x] Mapear frequência das tasks registradas.
- [x] Mapear dispatcher central de 1 minuto.
- [x] Mapear publicação ML realtime de 15 segundos.
- [x] Mapear refresh durável de catálogo de 15 segundos.
- [x] Mapear locks por domínio.
- [x] Mapear claim, retries, `on_hold`, backoff e stale recovery.
- [x] Confirmar execução operacional real dos jobs principais.
- [x] Identificar sobreposição real do dispatcher.
- [x] Separar filas por evento de tasks periódicas.
- [x] Confirmar cancelamento pós-NF como reconciliador legítimo.
- [x] Identificar ownership ambígua entre DSLite API e XML.
- [x] Identificar duplicação `/sync/run` x `/sync/disparar`.
- [x] Identificar refresh de catálogo `on_hold` sem retomada.
- [x] Confirmar problemas de lifecycle Mercado Pago e Brasil NFe.
- [x] Separar redundância de mecanismos legítimos de recuperação.

---

# 42. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhuma migration foi executada;
- nenhum cron foi criado/removido;
- nenhum job foi retomado/cancelado;
- nenhum lock foi alterado;
- nenhum dado foi modificado;
- nenhum deploy foi realizado;
- nenhum teste de código foi executado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise do registry, dispatcher, runners, locks e migrations;
- consultas somente leitura no banco operacional;
- consulta à documentação oficial atual do Supabase Cron/pg_net;
- reaproveitamento dos achados já comprovados nos Itens 4, 5 e 6.

Não foi possível consultar diretamente a tabela interna `cron.job` do PostgreSQL através das ferramentas disponíveis nesta auditoria.

Por isso, no caso do refresh de catálogo parado, foi comprovado:

```text
job deveria ser retomável pelo código/migration
+
job permanece on_hold no banco
```

mas a causa exata do cron não foi afirmada.

---

# 43. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Código Vortek — branch `dev`

Arquivos principais:

- `src/lib/sync/registry.ts`
- `src/lib/sync/domain-lock.ts`
- `src/lib/sync/stale-jobs.ts`
- `src/lib/sync/job-staleness.ts`
- `src/lib/sync/ml-order-hydration.ts`
- `src/lib/sync/runtime-config.ts`
- `src/services/sync-ml-job.ts`
- `src/services/catalog-refresh-job.ts`
- `src/services/whatsapp-label-job.ts`
- `src/services/whatsapp-alerts.ts`
- `src/app/api/sync/cron-dispatch/route.ts`
- `src/app/api/sync/run/route.ts`
- `src/app/api/sync/disparar/route.ts`
- `src/app/api/sync/cron-status/route.ts`
- `src/app/api/sync/preco-estoque/route.ts`
- `src/app/api/sync/preco-estoque-xml/route.ts`
- `src/app/api/sync/pedidos/cancelamentos-pos-nfe/route.ts`
- `src/app/api/catalogo/no-catalogo/refresh/job/worker/route.ts`

## Migrations principais

- `00018_cron_dispatch_schedule.sql`
- `20260528123000_sync_domain_locks_and_ml_publish_outbox.sql`
- `20260528123500_update_cron_dispatch_frequency.sql`
- `20260722222928_realtime_ml_publish_dispatch.sql`
- `20260801232600_durable_ml_order_hydration_queue.sql`
- `20260803231103_resume_on_hold_ml_publish.sql`
- `20260804001421_durable_catalog_price_refresh.sql`

## Banco operacional — somente leitura

Consultados:

- `jobs`;
- `sync_domain_locks`;
- `catalogo_ml_refresh_items`.

## Supabase — documentação oficial

Cron:

`https://supabase.com/docs/guides/cron`

pg_net:

`https://supabase.com/docs/guides/database/extensions/pg_net`

---

# 44. Conclusão final do Item 7

O Vortek não precisa de uma nova infraestrutura de jobs.

A base correta já existe:

```text
registry
+
pg_cron
+
pg_net
+
jobs
+
domain locks
+
outbox
+
durable queues
+
retry/on_hold
+
stale recovery
```

A limpeza futura deve concentrar-se em **coerência**, não em substituir essa base.

Os maiores ganhos serão:

```text
não deixar job on_hold órfão
+
não marcar operação parcial como completa
+
não repetir estado determinístico
+
consolidar código duplicado de dispatch
+
deixar ownership das fontes explícita
+
unificar observabilidade entre famílias
```

O **Item 7 está concluído**.

Nenhuma correção deve ser executada agora. Os achados seguem para os próximos itens e, somente após a consolidação da auditoria, para o checklist de execução.
