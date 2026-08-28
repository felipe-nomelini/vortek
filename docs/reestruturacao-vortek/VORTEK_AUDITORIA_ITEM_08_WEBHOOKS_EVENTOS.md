# Vortek — Auditoria de Limpeza e Organização

## Item 8 — Webhooks + Eventos

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** mapear os webhooks e eventos atuais, identificar o que é processado imediatamente e o que é delegado para jobs, verificar idempotência, duplicidade e risco de perda, e confirmar quais reconciliadores periódicos continuam necessários antes de qualquer limpeza.

---

## 1. Conclusão executiva

O Vortek possui atualmente dois endpoints web inbound claramente operacionais no projeto web:

```text
/api/webhooks/ml/notifications
/api/webhooks/mercadopago
```

O desenho geral do Mercado Livre está correto:

```text
notificação rápida
↓
buscar estado atual no Mercado Livre
↓
aplicar apenas efeitos seguros/imediatos
↓
enfileirar hidratação quando necessário
↓
polling/reconciliação periódica como garantia
```

Esse modelo é importante porque notificações externas podem:

- chegar mais de uma vez;
- chegar próximas umas das outras;
- chegar antes do recurso externo estar completamente disponível;
- chegar enquanto outro sync do mesmo domínio está rodando;
- ser perdidas pelo provedor/rede.

A consulta operacional confirmou muitos eventos repetidos para o mesmo pedido em poucos segundos/minutos.

Também confirmou que a fila:

```text
ml_orders_v2_hydration
```

consegue:

```text
receber webhook
→ encontrar lock ocupado
→ ficar on_hold
→ ser retomada
→ concluir
```

Isso é resiliência legítima e deve ser preservado.

Os principais pontos de limpeza encontrados são:

### P2
1. O Vortek não persiste o identificador `_id` da notificação Mercado Livre nem `attempts`; com isso, não consegue distinguir precisamente uma repetição do mesmo delivery de uma nova notificação do mesmo recurso.
2. `questions` e `items` podem responder HTTP 200 mesmo quando a leitura do recurso notificado falhou; existe recuperação parcial por leitura ao vivo/polling, mas o alerta ou efeito imediato pode ser perdido.
3. O webhook Mercado Pago grava `payment_lookup_failed` em caso de HTTP 404 e responde sucesso ao provedor, sem um retry local específico.
4. `catalog_item_competition_status`, `stock_locations` e outros tópicos modernos do ML não são tratados pelo webhook atual; isso não justifica adicioná-los automaticamente, mas precisa permanecer explícito porque catálogo e estoque multiorigem já existem no Vortek.
5. `whatsapp_alert_events` está vazio, enquanto o fluxo atual de alertas WhatsApp grava auditoria em `nf_auditoria_eventos`; é forte candidato a estrutura redundante/histórica.
6. `ops_whatsapp_events` possui somente atividade antiga de junho e não foi encontrado endpoint WAHA inbound no web atual; forte candidato a fluxo histórico, a confirmar no Item 15.
7. A auditoria `nf_auditoria_eventos` acumula eventos fiscais, webhooks, WhatsApp e financeiro, deixando o nome da tabela incompatível com seu uso real.

### P3
8. Aliases como `shipment_update` e `claim_update` continuam aceitos embora a documentação atual utilize tópicos modernos como `shipments` e `claims/post_purchase`; manter até rastrear necessidade histórica.

Não foi identificado P0 ou um P1 novo específico deste Item 8.

Os P1 já encontrados em Fiscal, Mercado Pago e Jobs continuam válidos e se relacionam diretamente com a estratégia de recuperação dos eventos.

---

# 2. Endpoints inbound atuais

No projeto web atual foram identificados:

```text
src/app/api/webhooks/ml/notifications/route.ts
src/app/api/webhooks/mercadopago/route.ts
```

Não foi encontrado endpoint inbound atual específico para:

```text
DSLite
Brasil NFe
WAHA
```

### Interpretação

Isso não significa que esses serviços deveriam possuir webhook.

Hoje:

- DSLite é reconciliado por jobs/polling;
- Brasil NFe é reconciliado por polling/ensure;
- WAHA é utilizado principalmente para saída de alertas/mensagens pelo web atual.

### Avaliação

**Não adicionar webhooks apenas para uniformizar arquitetura.**

Um webhook novo só deve existir se o provedor oferecer contrato oficial útil e houver ganho operacional comprovado.

---

# 3. Mercado Livre — validação inicial

O endpoint recebe:

```text
topic
resource
user_id
```

e rejeita payload incompleto.

Também valida se:

```text
user_id
```

pertence à conta Mercado Livre autorizada pelo Vortek.

Quando não pertence, retorna sucesso com:

```text
ignored = true
```

sem processar o recurso.

### Avaliação

**Manter.**

O Vortek não confia simplesmente em qualquer `user_id` recebido.

A revisão completa de segurança do endpoint fica para o Item 9.

---

# 4. Mercado Livre — princípio correto: payload como sinal, API como verdade

Para os principais tópicos, o webhook não tenta executar regras de negócio usando apenas os campos do payload da notificação.

Ele utiliza:

```text
resource
↓
GET no Mercado Livre
↓
estado atual do recurso
```

### Avaliação

**Manter.**

Isso reduz risco de:

- evento fora de ordem;
- payload parcial;
- estado já alterado por uma notificação posterior;
- dados incompletos.

O estado atual do Mercado Livre é mais importante que a ordem em que callbacks chegaram.

---

# 5. `orders_v2`

O tópico mais importante é:

```text
orders_v2
```

O fluxo atual:

```text
webhook
↓
extrai order_id
↓
busca /orders/{id}
↓
procura pedido local
↓
persiste/atualiza stub
↓
executa efeitos imediatos seguros
↓
enfileira hidratação se necessário
↓
retorna 200
```

### Efeitos imediatos observados

Quando aplicável:

- atualização do stub;
- estorno de reserva/saída interna em cancelamento;
- criação de candidato de crédito de fornecedor;
- alerta de nova venda;
- push de nova venda somente na inserção inicial.

### Avaliação

**Manter.**

O webhook acelera a reação à venda sem tentar concluir todo o snapshot dentro do request.

---

# 6. Pedido notificado antes de estar disponível

O código trata explicitamente um comportamento assíncrono do Mercado Livre.

Pode ocorrer:

```text
notificação recebida
↓
/orders/{id} ainda não disponível
```

Nesse caso o Vortek:

- persiste um stub pendente;
- não cria imediatamente um job destinado a falhar;
- deixa o sync periódico hidratar posteriormente.

### Comparação oficial

A documentação atual do Mercado Livre reconhece propagação assíncrona em recursos relacionados ao pedido, inclusive shipment.

### Avaliação

**Manter.**

É um fallback simples e coerente com o comportamento externo.

---

# 7. Hidratação durável de `orders_v2`

Quando existe trabalho incompleto, o webhook cria:

```text
ml_orders_v2_hydration
```

A chave de dedupe é o próprio:

```text
ml_order_id
```

Antes da criação também são procurados jobs ativos do mesmo pedido.

A migration da fila possui proteção adicional contra job ativo duplicado.

### Avaliação

**Manter.**

Há defesa tanto no código quanto no banco.

---

# 8. Recuperação operacional da hidratação

Foram consultados eventos reais em:

```text
nf_auditoria_eventos
```

Foram encontrados vários casos onde a hidratação:

```text
iniciou
↓
encontrou pedidos:ml_ingest bloqueado
↓
HTTP 409 / domain_lock_conflict
↓
ficou on_hold
↓
foi retomada depois
↓
terminou completo
```

Os jobs `on_hold` amostrados entre 20 e 26 de agosto terminaram posteriormente como:

```text
completo
```

### Avaliação

**Recuperação legítima confirmada.**

Não remover:

- `on_hold`;
- dispatcher;
- domain lock;
- fila de hidratação.

---

# 9. Duplicidade real de notificações de pedido

A auditoria operacional mostrou muitos pares:

```text
webhook_received
webhook_acked
```

para o mesmo `ml_order_id` em intervalos muito curtos.

Em alguns casos havia:

- várias notificações em segundos;
- nova notificação depois da hidratação já concluir;
- novas notificações minutos depois.

### Importante

Não é possível afirmar que todas são retries idênticos do Mercado Livre.

Elas também podem representar eventos diferentes do mesmo recurso.

O problema é que o Vortek não persiste hoje informação suficiente para distingui-las.

---

# 10. P2 — ID da notificação Mercado Livre não é persistido

A documentação oficial mostra payloads com campos como:

```text
_id
attempts
sent
received
application_id
```

O handler atual extrai principalmente:

```text
topic
resource
user_id
```

e a auditoria de `orders_v2` guarda:

- topic;
- resource;
- timing;
- resultado do GET;
- estado do stub;
- se houve fila.

Porém não guarda o `_id` oficial da notificação.

### Consequência

Diante de várias notificações para o mesmo pedido, não conseguimos responder com certeza:

```text
é a mesma entrega repetida?
ou
é uma nova notificação sobre o mesmo recurso?
```

### Avaliação

**P2 — observabilidade/idempotência auditável.**

Não é necessário criar uma nova tabela só por isso.

Quando chegar o plano, a primeira opção deve ser reaproveitar a auditoria existente e registrar os metadados necessários.

---

# 11. Efeitos repetidos do `orders_v2`

Notificações repetidas podem executar novamente partes do handler.

As operações críticas principais já possuem proteção:

## Estoque interno

O estorno de cancelamento é idempotente e só afeta saída ainda ativa.

## Crédito de fornecedor

A criação de candidato utiliza chave/regra idempotente.

## Hidratação

Existe dedupe por pedido.

## Push de nova venda

O push é disparado apenas quando o stub foi realmente inserido.

## WhatsApp de nova venda

O serviço de alertas possui:

```text
dedupeKey = new_sale:{order}
+
lock
+
consulta de alerta já enviado
```

### Avaliação

**Boa proteção contra at-least-once delivery.**

Não criar uma deduplicação global que impeça uma nova notificação legítima do mesmo pedido de ser processada.

---

# 12. `questions`

O webhook:

```text
questions
```

faz:

```text
GET question resource
↓
se UNANSWERED:
    GET item resumido
    ↓
    alerta WhatsApp
    push
```

Não existe fila durável específica de perguntas.

### Avaliação

O fluxo é aceitável para alertas.

A fonte de verdade da tela de perguntas não é a notificação.

A rota:

```text
/api/perguntas
```

consulta diretamente:

```text
/questions/search
```

no Mercado Livre.

Portanto, perder o alerta não significa perder a pergunta do sistema.

---

# 13. P2 — falha de GET em `questions` é confirmada com HTTP 200

Se o GET da pergunta falha, o webhook:

- registra warning em log;
- não cria alerta;
- continua o request;
- responde sucesso ao Mercado Livre.

### Consequência

Uma falha transitória pode fazer o alerta imediato daquela pergunta não acontecer.

Porém a pergunta continua recuperável pela página que consulta o Mercado Livre ao vivo.

### Avaliação

**P2 — confiabilidade do alerta, não perda de dado operacional.**

Não criar uma fila de perguntas automaticamente.

Primeiro avaliar no Item 13 se esse tipo de falha realmente ocorre com frequência.

---

# 14. `items`

O tópico:

```text
items
```

faz:

```text
GET item
↓
reconcilia anuncio observado
↓
se deletado:
    remove vínculos locais
↓
se active/paused:
    compara/restaura estoque autoritativo do Vortek
    via outbox
```

### Avaliação

**Manter.**

O webhook de item e o sync periódico observado não são duplicados.

Eles possuem papéis diferentes:

```text
webhook
= resposta rápida

sync observado
= reconciliador de segurança
```

---

# 15. P2 — falha de GET em `items` também é confirmada com HTTP 200

Se o recurso do item não puder ser consultado:

- o erro é registrado em log;
- o webhook não reconcilia aquele evento;
- a rota continua e responde sucesso.

### Risco

O evento específico deixa de ser repetido pelo provedor.

### Mitigação existente

O Item 7 confirmou:

```text
sync_ml_listings_observed
```

executando periodicamente.

Logo, o estado do anúncio tende a ser reconciliado depois.

### Avaliação

**P2 — atraso de consistência, não ausência total de recuperação.**

O reconciliador observado deve permanecer.

---

# 16. `shipments`

O handler aceita:

```text
shipments
shipment_update
```

Ele consulta o shipment e atualiza:

- `ml_shipment_id`;
- situação operacional;
- janela de liberação fiscal;
- horário de checagem;
- devolução/retorno quando aplicável;
- alerta quando a janela fiscal é liberada.

Também consulta:

```text
/shipments/{id}/lead_time
```

para entender a janela fiscal.

### Avaliação

**Manter o tópico `shipments`.**

Ele acelera informações que afetam:

- fiscal;
- etiqueta;
- devolução;
- operação.

---

# 17. Shipment webhook não substitui o sync de pedidos

O sync periódico de pedidos continua necessário porque precisa reconciliar:

- vendas não notificadas;
- snapshot incompleto;
- shipment ainda em propagação;
- dados fiscais;
- claims;
- outros campos do pedido.

### Avaliação

```text
shipments webhook
+
orders sync
```

é redundância intencional de recuperação, não código duplicado.

---

# 18. Claims / pós-venda

O handler reconhece:

```text
claims
claim_update
post_purchase com actions claims / claims_actions
```

Ao receber claim:

```text
GET claim
↓
atualiza pedido
↓
marca devolvido quando aplicável
↓
push de reclamação aberta
↓
enfileira hidratação do pedido
```

### Comparação oficial

A documentação atual do Mercado Livre suporta:

```text
claims
post_purchase
claims_actions
```

### Avaliação

**Manter.**

Claims alteram estado operacional relevante e justificam reação rápida.

---

# 19. `invoices`

O webhook:

```text
invoices
```

é recebido, porém deliberadamente ignorado.

O código registra:

```text
ml_fiscal_webhook_ignored
```

com motivo:

```text
fiscal_ml_desativado_por_politica
```

### Avaliação

**Manter enquanto a política fiscal for Brasil NFe.**

Isso está alinhado com o Item 5:

```text
Brasil NFe = emissor
Mercado Livre = consumidor do XML autorizado
```

Não remover apenas porque o tópico não produz ação.

Ele também documenta explicitamente que um fluxo fiscal antigo não deve voltar a ser executado por engano.

---

# 20. P3 — aliases históricos de tópicos

O código ainda reconhece:

```text
shipment_update
claim_update
```

A documentação atual usa principalmente:

```text
shipments
claims
post_purchase
```

### Avaliação

**P3 — candidato a limpeza posterior.**

Não remover no Item 8.

Primeiro devemos confirmar no Item 15 se ainda aparecem em:

- logs;
- configuração antiga do app;
- scripts;
- documentação;
- integrações legadas.

---

# 21. Tópico de competição de catálogo

A documentação oficial do Mercado Livre disponibiliza:

```text
catalog_item_competition_status
```

para mudanças de competição / `price_to_win`.

O handler atual não possui tratamento desse tópico.

### Estado atual do Vortek

O catálogo possui:

```text
catalogo_ml_snapshot
+
refresh durável
```

e o Item 4 confirmou snapshots/Buy Box operacionais.

### Avaliação

**Investigar mais; não adicionar automaticamente.**

O refresh periódico continua necessário mesmo se o tópico for usado, porque notificações são sinal incremental e podem ser perdidas.

No futuro, o tópico só deve ser adotado se reduzir chamadas/latência de forma comprovada sem criar outro caminho concorrente de regra de negócio.

---

# 22. Tópicos modernos de estoque e preço

A documentação oficial atual também lista tópicos como:

```text
stock_locations
items_prices
user products families
```

O handler Vortek não trata esses tópicos.

### Relevância

O Item 4 confirmou que o código já suporta:

```text
warehouse_management
User Products
seller warehouse
```

na publicação de estoque.

### Avaliação

**P2 — lacuna a investigar para contas multiorigem.**

Não há evidência nesta auditoria de que a conta atual precise desses tópicos para funcionar corretamente.

Não criar handlers preventivos.

No Item 16 deve ser decidido somente após confirmar:

- modelo de estoque realmente ativo na conta;
- capacidade do sync observado de detectar alterações externas;
- volume real de chamadas;
- necessidade de reação imediata.

---

# 23. Histórico `missed_feeds`

A documentação atual do Mercado Livre fornece:

```text
GET /missed_feeds
```

para notificações que não receberam HTTP 200 após as tentativas do provedor.

A documentação informa que:

- a notificação é considerada perdida após múltiplas tentativas;
- o histórico fica disponível por apenas 2 dias.

Não foi identificado consumidor de:

```text
/missed_feeds
```

no Vortek atual.

### Avaliação

**Não classificar automaticamente como falha.**

Hoje já existem reconciliadores independentes para:

- pedidos;
- anúncios;
- catálogo;
- fiscal.

Perguntas são consultadas ao vivo na própria página.

Portanto, adicionar outro backstop pode apenas duplicar trabalho.

### Direção

**Investigar somente se houver evidência de eventos perdidos que os reconciliadores atuais não recuperam.**

---

# 24. Mercado Pago — segurança do webhook

O endpoint Mercado Pago exige:

```text
MERCADOPAGO_WEBHOOK_SECRET
```

e valida:

```text
x-signature
x-request-id
data.id
```

com HMAC.

Assinatura inválida retorna:

```text
401
```

### Comparação oficial

A implementação segue o mecanismo oficial de validação da origem da notificação.

### Avaliação

**Manter.**

É uma proteção importante contra crédito financeiro disparado por callback forjado.

---

# 25. Mercado Pago — escopo do webhook

O webhook atual processa apenas:

```text
type = payment
```

Outros tipos são:

```text
ignored = true
```

Simulações também são ignoradas de forma explícita.

### Avaliação

**Manter o escopo mínimo.**

Não implementar todos os tipos de evento disponíveis apenas porque existem.

---

# 26. Idempotência do webhook Mercado Pago

O movimento bruto utiliza:

```text
external_id = payment:{payment_id}
```

com upsert.

O crédito Hayamax utiliza:

```text
movement_key = mercadopago:{external_id}
```

e procura o movimento antes de criar outro.

Depois o movimento bruto pode ser vinculado ao movimento de saldo.

### Avaliação

**Manter.**

Há duas barreiras de idempotência para uma operação financeira sensível.

---

# 27. P2 — `payment_lookup_failed` recebe HTTP 200

O fluxo atual:

```text
webhook payment
↓
GET /v1/payments/{id}
↓
se 404:
    grava payment_lookup_failed
    ↓
    responde success=true / HTTP 200
```

### Comparação oficial

O Mercado Pago informa que:

- espera HTTP 200/201 para considerar a notificação recebida;
- quando não recebe, realiza novas tentativas;
- após resposta de sucesso, a notificação é considerada confirmada.

### Consequência

Depois de um `404`, o provedor não é solicitado a repetir aquele webhook.

Também não foi identificado um job específico para reprocessar:

```text
payment_lookup_failed
```

### Estado operacional

Na consulta realizada não foram encontrados movimentos:

```text
payment_webhook
payment_lookup_failed
```

no banco operacional atual.

Portanto, isso é um **risco estrutural**, não uma perda financeira comprovada.

### Avaliação

**P2 — revisar junto do P1 Mercado Pago do Item 6.**

Não criar uma fila nova isoladamente.

O ciclo financeiro deve ter uma estratégia única de reconciliação.

---

# 28. Processamento síncrono antes do ACK Mercado Pago

O webhook Mercado Pago faz o GET completo do pagamento e gravações financeiras antes de retornar sucesso.

A documentação do Mercado Pago informa janela de:

```text
22 segundos
```

para o ACK antes de iniciar retries.

### Avaliação

**P2 — medir antes de alterar.**

Não há evidência operacional de timeout deste webhook.

Mover tudo para background sem necessidade comprovada criaria mais infraestrutura.

O Item 13 deve medir a duração/erros antes de qualquer decisão.

---

# 29. Mercado Pago webhook x relatório Dinheiro em Conta

Esses dois fluxos não são substitutos perfeitos.

## Webhook

```text
evento imediato de payment
```

## Relatório Dinheiro em Conta

```text
reconciliação contábil dos movimentos que impactaram saldo
```

O Item 6 identificou problemas no lifecycle e parser do relatório.

### Avaliação

**Manter conceitualmente os dois papéis.**

A limpeza futura precisa fazê-los se reconciliar, não escolher um arbitrariamente e apagar o outro.

---

# 30. WAHA no projeto web atual

No web atual foram encontrados serviços para:

- envio de mensagens;
- QR/session;
- alertas operacionais.

Não foi encontrado endpoint inbound WAHA dentro de:

```text
src/app/api/webhooks
```

ou outra rota web diretamente relacionada aos eventos atuais.

### Documentação oficial

WAHA suporta webhooks de:

- mensagens;
- status de sessão;
- ack;
- reações;
- vários outros eventos;

com:

- HMAC opcional;
- request ID;
- timestamp;
- retries configuráveis.

### Avaliação

**Não adicionar WAHA inbound se o Vortek não precisa receber mensagens atualmente.**

Isso seria expansão de escopo sem necessidade.

---

# 31. `ops_whatsapp_events`

A tabela:

```text
ops_whatsapp_events
```

possui registros de entrada/saída relacionados a comandos operacionais via WhatsApp.

### Estado operacional

Na consulta realizada, os eventos mais recentes eram de:

```text
22/06/2026
```

Não foram encontrados eventos atuais de agosto.

O fluxo parece relacionado a comandos antigos de:

- issues;
- aprovação;
- consulta de erros;
- operações GitHub.

### Avaliação

**P2 — forte candidato a histórico.**

Não remover agora.

O Item 15 deve confirmar:

- scripts externos;
- serviço fora deste repositório;
- documentação antiga;
- eventual automação ainda existente.

---

# 32. `whatsapp_alert_events`

Existe também a tabela:

```text
whatsapp_alert_events
```

Na consulta operacional ela estava:

```text
vazia
```

Ao mesmo tempo, o serviço atual de alertas grava os estados:

```text
whatsapp_alert_sent
whatsapp_alert_failed
whatsapp_alert_skipped
```

em:

```text
nf_auditoria_eventos
```

### Avaliação

**P2 — forte candidato a tabela redundante/não adotada.**

Não remover neste item.

O Item 10 deve confirmar:

- migrations;
- RLS;
- índices;
- qualquer leitor/escritor restante.

O Item 15 poderá classificar como histórico/removível depois disso.

---

# 33. Auditoria de alertas WhatsApp

O serviço atual possui:

```text
dedupeKey
+
domain lock
+
consulta de alerta já enviado
```

antes de enviar.

Exemplos:

```text
new_sale:{order}
new_question:{question_id}
claim_opened:{claim_id}
```

### Avaliação

**Manter.**

Isso evita que notificações repetidas do Mercado Livre gerem spam repetido no WhatsApp.

---

# 34. P2 — `nf_auditoria_eventos` deixou de ser apenas fiscal

Hoje essa tabela registra eventos de:

- NF-e;
- Mercado Livre;
- webhooks;
- WhatsApp;
- pagamento a fornecedor;
- alertas operacionais.

### Problema

O nome:

```text
nf_auditoria_eventos
```

já não representa o domínio real da tabela.

Isso aumenta confusão e incentiva dependências cruzadas.

### Avaliação

**P2 — consolidar conceito no Item 10/12.**

Não criar agora outra tabela genérica e duplicar todos os eventos.

Primeiro precisamos mapear:

- consumidores;
- retenção;
- volume;
- índices;
- consultas;
- quais eventos precisam realmente ser duráveis.

---

# 35. DSLite

Não foi identificado webhook DSLite inbound no projeto web atual.

A operação depende de:

```text
sync_dslite_fornecedores
sync_dslite_catalogo
sync_dslite_preco_estoque
sync_dslite_xml_preco_estoque
sync_dslite_pedidos_compra
```

### Documentação oficial consultada

A documentação pública atual utilizada pelo Vortek descreve as APIs necessárias para integração.

Nesta auditoria ela não estabeleceu um contrato de webhook que justificasse substituir os reconciliadores existentes.

### Avaliação

**Manter polling/jobs atuais até existir evidência em contrário.**

---

# 36. Brasil NFe

Não foi identificado webhook Brasil NFe inbound no Vortek atual.

O fluxo usa:

```text
ensure
+
consulta
+
reconciliação periódica
```

O Item 5 já confirmou que esses mecanismos protegem contra emissão duplicada e falha parcial.

### Avaliação

**Não adicionar webhook por uniformidade.**

O problema atual do Brasil NFe é retry/elegibilidade de `not_found`, não ausência de webhook.

---

# 37. Evento primário x reconciliador

A classificação correta atual é:

## Evento rápido / primário

```text
orders_v2
items
shipments
claims/post_purchase
questions
Mercado Pago payment
```

## Reconciliador / garantia

```text
sync_ml_orders_ingest
sync_ml_listings_observed
catalog refresh
sync_reconcile_brasilnfe
sync_mercadopago_account_money
```

### Importante

Esses reconciliadores não existem porque “o webhook é ruim”.

Eles existem porque sistemas distribuídos precisam recuperar:

- callback perdido;
- callback fora de ordem;
- recurso ainda não propagado;
- processo que caiu após ACK;
- estado alterado fora do Vortek.

### Avaliação

**Preservar o princípio webhook + reconciliação.**

---

# 38. Onde existe redundância legítima

## `orders_v2` + sync de pedidos

Legítimo.

## `items` + sync observado

Legítimo.

## claims + hidratação de pedido

Legítimo.

## shipment webhook + sync de pedido

Legítimo.

## Mercado Pago webhook + relatório contábil

Conceitualmente legítimo, embora o relatório esteja com P1 de implementação.

## alertas + dedupe

Legítimo.

---

# 39. Onde existe complexidade acidental confirmada

## P2 — falta de identidade da entrega ML na auditoria

Muitos eventos iguais por recurso, sem `_id`/`attempts`.

## P2 — ACK positivo depois de falha interna em `questions/items`

O provedor considera concluído, embora o efeito imediato não tenha ocorrido.

## P2 — Mercado Pago `404` vira ACK positivo sem redrive específico

Risco financeiro estrutural.

## P2 — tabelas WhatsApp aparentemente históricas/redundantes

`ops_whatsapp_events` sem atividade recente e `whatsapp_alert_events` vazia.

## P2 — auditoria nominalmente fiscal virou event store transversal

Fonte de confusão entre domínios.

## P3 — aliases antigos de tópicos

Compatibilidade potencialmente legada.

---

# 40. Perda de eventos — avaliação por domínio

## Pedidos

**Proteção boa.**

Webhook + stub + fila + sync periódico.

## Anúncios

**Proteção boa.**

Webhook `items` + sync observado.

## Shipments

**Proteção boa.**

Webhook + sync de pedidos.

## Claims

**Proteção razoável.**

Webhook + hidratação/sync.

## Perguntas

**Dado recuperável, alerta não totalmente garantido.**

A página consulta o ML ao vivo.

## Mercado Pago

**Proteção incompleta.**

Webhook possui idempotência, mas `404` pode ser encerrado sem retry; relatório de reconciliação também possui P1 conhecido.

## Catálogo/Buy Box

**Proteção por refresh periódico.**

Sem tópico de competição no handler.

---

# 41. Estado desejado conceitualmente

Sem criar nova infraestrutura:

```text
PROVEDOR
↓
webhook pequeno
↓
validar origem/conta
↓
registrar identidade do evento quando disponível
↓
buscar estado atual externo
↓
efeito imediato idempotente
OU
fila durável existente
↓
ACK coerente
↓
reconciliador periódico como backstop
```

Para duplicidade:

```text
mesma entrega
→ auditável/deduplicável

novo evento do mesmo recurso
→ permitido
→ buscar estado atual novamente
```

Para falha:

```text
falha transitória
→ deve existir caminho real de retry/reconciliação

falha terminal
→ registrar e encerrar

não:
falhar internamente
+
responder sucesso
+
não ter nenhum caminho posterior
```

---

# 42. O que NÃO fazer agora

Não devemos:

- criar uma fila genérica de webhooks;
- criar tabela nova de eventos antes de revisar `nf_auditoria_eventos`;
- remover polling de pedidos;
- remover sync observado de anúncios;
- remover refresh de catálogo;
- adicionar todos os tópicos Mercado Livre disponíveis;
- criar webhook DSLite sem contrato oficial necessário;
- criar webhook Brasil NFe por estética;
- reativar inbound WAHA sem necessidade de negócio;
- remover `ops_whatsapp_events` apenas por estar antigo;
- remover `whatsapp_alert_events` apenas por estar vazio;
- deduplicar toda notificação ML somente por `resource`;
- implementar correções durante esta auditoria.

---

# 43. Dependências para itens futuros

## Item 9 — Auth + Segurança + Permissões

Revisar:

- proteção do endpoint ML;
- validação `user_id`;
- exposição pública das rotas webhook;
- rate limiting/abuso quando aplicável;
- HMAC Mercado Pago;
- eventual segurança WAHA se existir inbound externo.

## Item 10 — Banco de Dados

Confirmar:

- função e consumidores de `nf_auditoria_eventos`;
- `whatsapp_alert_events`;
- `ops_whatsapp_events`;
- índices/volume de auditoria;
- retenção;
- possíveis campos para identidade do evento sem criar nova tabela.

## Item 12 — Regras Compartilhadas

Consolidar:

- erro transitório x terminal;
- quando ACK pode ser 200;
- elegibilidade de retry;
- dedupe por evento x dedupe por recurso;
- regra única de reconciliação Mercado Pago.

## Item 13 — Performance e Saúde Operacional

Medir:

- volume de webhooks;
- duração dos ACKs;
- quantidade de notificações repetidas;
- falhas de fetch de questions/items;
- valor do refresh/polling em relação aos webhooks;
- custo de chamadas externas dentro do request.

## Item 15 — Scripts + Documentação + Históricos

Classificar definitivamente:

- `ops_whatsapp_events`;
- `whatsapp_alert_events`;
- aliases antigos de tópicos;
- eventual fluxo WAHA inbound antigo;
- integrações de comandos GitHub via WhatsApp.

---

# 44. Resultado do checklist — Item 8

- [x] Mapear todos os endpoints inbound atuais do projeto web.
- [x] Identificar o que webhooks processam imediatamente.
- [x] Identificar o que delegam para jobs.
- [x] Verificar idempotência do `orders_v2`.
- [x] Verificar dedupe da hidratação de pedidos.
- [x] Confirmar retomada operacional de jobs `on_hold`.
- [x] Confirmar notificações repetidas para o mesmo pedido.
- [x] Identificar ausência do `_id`/`attempts` na auditoria ML.
- [x] Mapear `questions`.
- [x] Mapear `items`.
- [x] Mapear `shipments`.
- [x] Mapear claims/post_purchase.
- [x] Confirmar `invoices` ignorado por política fiscal.
- [x] Comparar tópicos atuais com documentação oficial Mercado Livre.
- [x] Mapear Mercado Pago payment webhook.
- [x] Confirmar validação HMAC Mercado Pago.
- [x] Confirmar idempotência financeira do payment webhook.
- [x] Identificar `payment_lookup_failed` confirmado com HTTP 200 como risco estrutural.
- [x] Confirmar ausência atual de movimentos payment webhook na amostra operacional.
- [x] Revisar estado operacional das tabelas de eventos WhatsApp.
- [x] Separar evento primário de reconciliador legítimo.
- [x] Confirmar quais reconciliadores atuais precisam permanecer.
- [x] Registrar tópicos ML adicionais apenas como investigação, sem adicionar arquitetura.
- [x] Separar complexidade necessária de complexidade acidental.

---

# 45. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhum webhook foi reconfigurado;
- nenhuma notificação foi reenviada;
- nenhum job foi criado/cancelado;
- nenhum dado foi modificado;
- nenhum cron foi alterado;
- nenhum secret foi consultado ou reproduzido;
- nenhum deploy foi realizado;
- nenhum teste de código foi executado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise das rotas de webhook e serviços diretamente relacionados;
- consultas somente leitura no banco operacional;
- consulta à documentação oficial atual do Mercado Livre;
- consulta à documentação oficial atual do Mercado Pago;
- consulta à documentação oficial atual do WAHA;
- consulta à documentação pública DSLite já utilizada pelo Vortek.

---

# 46. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Código Vortek — branch `dev`

Arquivos principais analisados:

- `src/app/api/webhooks/ml/notifications/route.ts`
- `src/app/api/webhooks/mercadopago/route.ts`
- `src/app/api/perguntas/route.ts`
- `src/lib/sync/ml-order-hydration.ts`
- `src/services/whatsapp-alerts.ts`
- `src/lib/sync/registry.ts`
- `src/app/api/sync/cron-dispatch/route.ts`
- serviços de integração Mercado Livre/Mercado Pago diretamente chamados pelos webhooks.

## Banco operacional — somente leitura

Consultados:

- `nf_auditoria_eventos`;
- `jobs`;
- `mercadopago_account_movements`;
- `ops_whatsapp_events`;
- `whatsapp_alert_events`.

Nenhuma credencial, assinatura, token, telefone completo sensível ou secret foi reproduzido neste documento.

## Mercado Livre — documentação oficial

Notificações:

`https://developers.mercadolivre.com.br/pt_br/lojas-oficiais/produto-receba-notificacoes`

Tópicos de notificações / competição de catálogo:

`https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-receba-notificacoes`

## Mercado Pago — documentação oficial

Webhooks:

`https://www.mercadopago.com.br/developers/pt/docs/loja-integrada/additional-content/your-integrations/notifications/webhooks`

## WAHA — documentação oficial

Eventos e webhooks:

`https://waha.devlike.pro/docs/how-to/events/`

Segurança:

`https://waha.devlike.pro/docs/how-to/security/`

## DSLite — documentação pública utilizada pelo Vortek

`https://documenter.getpostman.com/view/5316990/RWaRNkaA`

---

# 47. Conclusão final do Item 8

A estratégia correta para o Vortek não é escolher entre:

```text
webhook
OU
polling
```

A arquitetura saudável é:

```text
webhook
= reação rápida

reconciliador
= garantia de consistência
```

Essa combinação já funciona bem principalmente em:

```text
orders_v2
+
ml_orders_v2_hydration
+
sync_ml_orders_ingest
```

e:

```text
items
+
sync_ml_listings_observed
```

Os maiores ganhos futuros do Item 8 não exigem nova infraestrutura.

Eles estão em:

```text
melhor identidade/auditoria das notificações
+
não confirmar sucesso quando uma falha ficou sem caminho de recuperação
+
consolidar estados/eventos históricos
+
manter apenas reconciliadores que cobrem uma falha real
```

O **Item 8 está concluído**.

Nenhuma correção deve ser executada agora. Os achados seguem para os próximos itens e, somente após a consolidação da auditoria, para o checklist de execução.
