# Vortek — Auditoria de Limpeza e Organização

## Item 5 — Fiscal

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** mapear o fluxo fiscal da venda até a autorização da NF-e e o vínculo com o Mercado Livre, revisar Brasil NFe, dados fiscais, polling, retries, reconciliações e estados persistidos, separando mecanismos de recuperação necessários de duplicações e chamadas externas desnecessárias.

---

## 1. Conclusão executiva

A arquitetura fiscal principal do Vortek está correta e não deve ser reconstruída.

O fluxo conceitual atual é:

```text
Pedido Mercado Livre
        ↓
snapshot fiscal do comprador
        ↓
validações fiscais
        ↓
Brasil NFe
        ↓
NF-e autorizada
        ↓
XML + chave + protocolo persistidos
        ↓
importação do XML no shipment Mercado Livre
        ↓
confirmação do vínculo
        ↓
liberação logística / etiqueta
```

O **Brasil NFe é o emissor fiscal do Vortek**.

O Mercado Livre não é tratado como emissor da NF-e nesse fluxo. Ele recebe o XML já autorizado para vincular a nota ao shipment e liberar a operação logística.

Também existem bons mecanismos de proteção que devem ser preservados:

- reconciliação local antes de emitir novamente;
- busca de NF já existente no Brasil NFe;
- identificador interno estável por pedido;
- rejeição de XML de homologação;
- validação de XML autorizado;
- opção controlada entre usar nota existente ou cancelar/reemitir;
- auditoria dos eventos fiscais;
- recuperação de DANFE;
- consulta do vínculo da NF-e no shipment;
- polling/reconciliação como fallback operacional.

Os principais problemas encontrados são mais específicos:

1. **P1 — toda criação de vínculo de NF-e no Mercado Livre tenta duas chamadas sabidamente inválidas antes do POST XML correto.**
2. **P1 — o Vortek tenta importar a NF-e sem validar antes `ready_to_ship + invoice_pending`, gerando erros reais `invalid_shipment`.**
3. **P1 — o reconciliador Brasil NFe repete indefinidamente consultas `not_found` para alguns pedidos antigos, a cada poucos minutos.**
4. **P2 — o endpoint legado de `billing_info` é chamado mesmo quando o novo endpoint já retornou os dados fiscais.**
5. **P2 — existem campos fiscais persistidos que parecem derivados, históricos ou obsoletos e precisam ter sua função consolidada antes de qualquer remoção.**
6. **P2 — os estados de NF-e aceitam aliases diferentes, aumentando ambiguidade de domínio.**

Não foi identificado P0 nesta área.

---

# 2. Fonte fiscal principal

A emissão de NF-e no Vortek passa pelo:

```text
Brasil NFe
```

O provider fiscal é abstraído internamente, mas o fluxo operacional atual utiliza Brasil NFe.

A integração suporta operações necessárias como:

- emissão;
- consulta;
- recuperação de nota existente;
- cancelamento;
- carta de correção;
- download de documentos.

### Avaliação

**Manter.**

Não existe justificativa para criar outro emissor fiscal ou uma segunda arquitetura de emissão.

---

# 3. Mercado Livre não é o emissor deste fluxo

É importante separar dois conceitos.

## Emissão fiscal

```text
Vortek
→ Brasil NFe
→ SEFAZ
→ NF-e autorizada
```

## Vínculo logístico no Mercado Livre

```text
NF-e autorizada
→ XML
→ shipment Mercado Livre
```

O Vortek possui proteções que bloqueiam fluxos antigos de emissão fiscal pelo próprio Mercado Livre.

### Avaliação

**Manter a separação.**

Não confundir os endpoints de notas emitidas pelo faturador Mercado Livre com o endpoint utilizado para importar o XML autorizado no shipment.

---

# 4. Entrada dos dados fiscais do comprador

O sync de pedidos monta um snapshot fiscal com dados como:

- nome;
- CPF/CNPJ;
- tipo de pessoa;
- inscrição estadual;
- endereço fiscal;
- UF;
- município;
- código IBGE;
- política de IE.

O Vortek já suporta o fluxo novo do Mercado Livre:

```text
/orders/{order_id}
↓
buyer.billing_info.id
↓
/orders/billing-info/{site_id}/{billing_info_id}
```

### Comparação com documentação oficial

A documentação atual do Mercado Livre recomenda utilizar esse novo recurso.

O endpoint antigo:

```text
/orders/{order_id}/billing_info
```

está depreciado e é mantido apenas temporariamente para convivência/migração.

---

# 5. Problema — billing legado é chamado mesmo quando o novo funciona

O código atual:

1. consulta o endpoint novo quando existe `billing_info.id`;
2. depois consulta também o endpoint legado;
3. combina os resultados, priorizando o novo.

Portanto, mesmo quando o endpoint novo respondeu corretamente, ainda ocorre uma chamada extra ao recurso depreciado.

### Avaliação

**P2 — simplificar.**

O legado deve futuramente funcionar apenas como fallback comprovadamente necessário, não como segunda chamada obrigatória em todo pedido.

Não remover durante esta auditoria.

Primeiro deve ser validado se existem casos reais onde o endpoint novo responde incompleto e o legado ainda complementa algum campo necessário.

---

# 6. Snapshot fiscal do pedido

Os dados fiscais são persistidos junto ao pedido para que a emissão não dependa de uma nova consulta ao Mercado Livre em cada tentativa.

Isso é importante porque os dados externos podem:

- mudar;
- ficar temporariamente indisponíveis;
- ser parcialmente retornados;
- depender de propagação assíncrona.

### Avaliação

**Manter.**

O snapshot fiscal é parte da evidência do pedido no momento da operação e não deve ser confundido com duplicação acidental.

---

# 7. Validações antes da emissão

O Vortek valida informações necessárias antes de chamar o emissor fiscal.

Entre elas:

- documento;
- tipo de pessoa;
- IE;
- UF;
- município;
- código IBGE;
- NCM;
- CEST quando aplicável;
- origem fiscal;
- CSOSN;
- CFOP;
- dados dos itens.

Existem helpers específicos para:

- CFOP;
- política de IE;
- município IBGE;
- recipient IE.

### Avaliação

**Manter.**

Essas regras fiscais são complexidade de domínio necessária.

No Item 12 será verificado se alguma delas está duplicada em outros pontos.

---

# 8. Emissão idempotente no Brasil NFe

A função central:

```text
ensureBrasilNfeInvoice(...)
```

não envia imediatamente uma nova NF-e.

Antes ela tenta resolver o estado já existente.

O fluxo considera:

```text
XML local válido?
        ↓
NF já existe no Brasil NFe?
        ↓
é a mesma operação?
        ↓
está autorizada?
        ↓
somente então decidir se precisa emitir
```

O identificador interno do pedido é utilizado para localizar uma NF já criada.

### Avaliação

**Manter.**

Isso protege contra emissão duplicada em:

- retry;
- queda de processo;
- timeout;
- resposta perdida;
- reprocessamento manual;
- reconciliação posterior.

Não é duplicação.

---

# 9. Reconciliação local antes de emissão

O Vortek verifica primeiro o que já possui localmente.

Quando encontra XML:

- valida o documento;
- extrai informações fiscais;
- confere ambiente;
- atualiza o estado persistido quando necessário.

### Avaliação

**Manter.**

Eliminar essa etapa para “simplificar” aumentaria risco de segunda emissão da mesma venda.

---

# 10. Proteção contra homologação

O fluxo fiscal distingue XML de:

```text
produção
homologação
```

XML de homologação não pode ser tratado como nota fiscal válida para operação real.

A documentação oficial do Brasil NFe também distingue:

```text
TipoAmbiente = 1 → produção
TipoAmbiente = 2 → homologação
```

O Mercado Livre igualmente informa que XMLs do ambiente de homologação não são aceitos na importação da NF-e.

### Avaliação

**Manter.**

É proteção fiscal essencial.

---

# 11. NF existente no Brasil NFe

Quando a aplicação não possui toda a informação local, o Vortek pode buscar no Brasil NFe uma nota já existente pelo identificador interno.

Se encontrada, o fluxo pode:

- recuperar chave;
- número;
- XML;
- protocolo;
- DANFE;
- estado.

### Avaliação

**Manter.**

Esse mecanismo é uma reconciliação real contra falhas parciais.

Não substituí-lo por “emitir novamente se estiver faltando dado local”.

---

# 12. Uso de nota existente x reemissão

Existem cenários em que o operador pode precisar decidir entre:

```text
usar NF existente
```

ou:

```text
cancelar e reemitir
```

A reemissão não ignora a nota anterior: o fluxo considera o cancelamento antes de gerar outra.

### Avaliação

**Manter.**

É uma decisão fiscal explícita e auditável.

Não transformar em fallback silencioso.

---

# 13. Persistência do estado fiscal

O pedido mantém hoje vários campos relacionados à NF-e.

Entre os principais:

```text
nfe_status
nfe_chave
nfe_xml
nfe_protocolo
nota_fiscal_numero
nota_fiscal_emitida
nfe_provider
nfe_external_id
nfe_danfe_url
nfe_last_sync_at
nfe_cfop
```

Além desses, existem campos relacionados ao vínculo com Mercado Livre.

### Direção conceitual

A identidade fiscal forte é composta principalmente por:

```text
status fiscal
+
chave NF-e
+
XML autorizado
+
protocolo
```

O identificador externo do provider é uma referência operacional, não deve ser tratado como identidade fiscal principal.

---

# 14. `nfe_external_id` é referência do provider, não fonte principal

A consulta operacional encontrou diversas NF-es recentes:

```text
nfe_status = authorized
+
chave válida
+
XML/DANFE existentes
```

mesmo quando:

```text
nfe_external_id = null
```

### Avaliação

**Manter como campo auxiliar.**

Não exigir `nfe_external_id` para considerar uma NF-e válida.

Isso também confirma a importância da reconciliação por chave/XML/identificador interno.

---

# 15. `nota_fiscal_emitida` não representa sozinho o ciclo de vida

Existe o booleano:

```text
nota_fiscal_emitida
```

ao mesmo tempo em que existe:

```text
nfe_status
```

Uma nota pode ter sido emitida historicamente e posteriormente estar:

```text
cancelada
```

sem que isso transforme o fato histórico de emissão em falso.

### Avaliação

**P2 — fonte semântica precisa ficar explícita.**

`nfe_status` deve representar o ciclo de vida atual.

`nota_fiscal_emitida` deve ser tratado, se ainda necessário, como informação derivada/histórica.

No Item 10/12 será necessário mapear todos os consumidores antes de decidir manter, renomear ou remover.

---

# 16. Status fiscais com aliases

O helper atual aceita diferentes representações, por exemplo:

```text
authorized
autorizada

cancelled
canceled
cancelada
```

Isso ajuda compatibilidade com estados antigos e retornos externos.

Porém aumenta a quantidade de formas possíveis para representar a mesma situação.

### Avaliação

**P2 — consolidar fonte de verdade de estados.**

Não remover a normalização agora.

Primeiro o Item 10 deve confirmar quais valores realmente existem no banco e quais constraints permitem.

---

# 17. DANFE

O Vortek armazena o DANFE em Storage e mantém uma URL para acesso.

A recuperação consegue:

- usar arquivo já armazenado;
- recuperar documento do provider quando necessário;
- regenerar acesso assinado.

### Avaliação

**Manter o Storage como evidência durável.**

A URL assinada é temporária por natureza e não deve ser tratada conceitualmente como a própria existência do DANFE.

### P2

Revisar no Item 10/12 se:

```text
nfe_danfe_url
```

está sendo usado como fonte de verdade de disponibilidade do documento.

A fonte durável deve ser o arquivo/storage, não uma URL temporária.

---

# 18. Auditoria fiscal

Existe:

```text
nf_auditoria_eventos
```

registrando eventos importantes do fluxo.

A auditoria operacional mostrou eventos reais de:

- tentativa de upload no ML;
- sucesso;
- reconciliação;
- falha de localização no Brasil NFe;
- mudanças de estado.

### Avaliação

**Manter.**

Em fluxo fiscal, rastreabilidade é necessária.

A limpeza deve reduzir eventos inúteis causados por chamadas inúteis, e não remover a auditoria.

---

# 19. Importação da NF-e no Mercado Livre

Depois da autorização, o XML é vinculado ao shipment.

A documentação oficial atual orienta:

```text
GET shipment
↓
confirmar:
status = ready_to_ship
substatus = invoice_pending
↓
POST /shipments/{shipment_id}/invoice_data/?siteId=MLB
Content-Type: application/xml
↓
GET /shipments/{shipment_id}/invoice_data
para verificar
```

Se já existir uma nota e for necessária atualização, o recurso documentado é:

```text
PUT /shipment_invoice/{invoice_id}/
Content-Type: application/xml
```

---

# 20. Parte correta do helper atual de vínculo

O helper atual primeiro consulta:

```text
GET /shipments/{shipment_id}/invoice_data
```

Se a mesma chave fiscal já estiver vinculada:

```text
already_linked
```

e não recria a nota.

Se existe um `invoice_id`, ele utiliza:

```text
PUT /shipment_invoice/{invoice_id}/
application/xml
```

para atualização.

### Avaliação

**Manter.**

Essa parte está alinhada com o contrato atual do Mercado Livre e protege idempotência.

---

# 21. P1 — duas chamadas inválidas antes do POST XML correto

Na criação de um vínculo novo, o helper atual executa explicitamente:

```text
PUT JSON
↓
POST JSON
↓
POST XML
```

A documentação atual do Mercado Livre define diretamente:

```text
POST XML
```

para criar a NF-e no shipment.

### Evidência operacional

A consulta somente leitura em `nf_auditoria_eventos` confirmou repetidamente o padrão:

```text
PUT JSON
→ 404 not_found_shipment_invoice

POST JSON
→ 415 unsupported content-type JSON

POST XML
→ 201 sucesso
```

Ou seja, as duas primeiras chamadas não são apenas código histórico sem uso.

Elas acontecem na operação real antes de vários uploads bem-sucedidos.

### Avaliação

**P1 — remover trabalho externo comprovadamente desnecessário.**

A direção futura é simples:

```text
GET para verificar existente
↓
se novo:
    POST XML
↓
se existente e precisa atualizar:
    PUT XML
↓
GET para verificar resultado
```

Não implementar agora.

---

# 22. P1 — importação sem validar `invoice_pending`

A documentação oficial do Mercado Livre orienta que o XML seja enviado quando o shipment estiver:

```text
status = ready_to_ship
substatus = invoice_pending
```

O fluxo atual de etiqueta/fiscal chega à rotina de upload sem uma validação específica desse par de estados imediatamente antes da importação.

### Evidência operacional

A auditoria encontrou tentativas reais de:

```text
POST XML
→ 400 invalid_shipment
→ Shipment status is wrong
```

### Avaliação

**P1 — causa de chamadas inválidas e retries desnecessários.**

A correção futura deve reutilizar a consulta de shipment já existente e só tentar a importação quando o estado oficial permitir.

Não criar novo job ou novo serviço para resolver isso.

---

# 23. `invoice_pending` e liberação de etiqueta

O Vortek possui também conceitos como:

```text
ml_fiscal_release_at
ml_fiscal_release_reason
ml_fiscal_release_source
ml_fiscal_release_checked_at
```

Eles ajudam a controlar quando o fluxo deve prosseguir para etiqueta.

Essa lógica não é a mesma coisa que validar:

```text
ready_to_ship + invoice_pending
```

antes do upload da NF-e.

### Avaliação

**Manter por enquanto.**

No Item 8 será verificado se notificações de shipment e reconciliadores podem tornar parte desse polling redundante.

---

# 24. Verificação pós-upload

Depois da importação, o Vortek consulta novamente:

```text
/shipment/{id}/invoice_data
```

e confere a chave fiscal vinculada.

Também existem casos onde novas execuções detectam:

```text
already_linked
```

sem tentar criar novamente.

### Avaliação

**Manter.**

É verificação de efeito externo e idempotência necessária.

---

# 25. Webhooks relacionados

A documentação oficial do Mercado Livre recomenda receber notificações do tópico:

```text
shipments
```

para acompanhar o estado logístico/fiscal.

No código fiscal atual não foi identificado um webhook próprio do Brasil NFe.

A recuperação do estado Brasil NFe é feita principalmente por consulta/reconciliação.

### Avaliação

Isso não é automaticamente errado.

A análise completa de:

- quais webhooks chegam;
- o que eles disparam;
- se shipment notification já acelera o fiscal;
- quais pollings continuam necessários;

fica explicitamente para:

```text
Item 8 — Webhooks + Eventos
```

---

# 26. Reconciliador agendado Brasil NFe

Existe a tarefa:

```text
sync_reconcile_brasilnfe
```

Ela chama:

```text
/api/sync/nf/reconciliar-brasilnfe
```

A frequência atual é:

```text
horário comercial: a cada 2 minutos
fora do horário: a cada 10 minutos
```

O job seleciona pedidos dentro de uma janela de aproximadamente 30 dias e prioriza os menos recentemente sincronizados por:

```text
nfe_last_sync_at
```

### Avaliação

A existência do reconciliador é justificável.

Ele recupera falhas parciais e notas que existem externamente mas não ficaram completas localmente.

O problema está na elegibilidade/retry de alguns estados.

---

# 27. P1 — `not_found` Brasil NFe repetido indefinidamente

A consulta operacional mostrou pedidos antigos sendo consultados repetidamente no Brasil NFe com o mesmo resultado:

```text
não existe correspondência exata
para o identificador interno
```

O mesmo `not_found` foi registrado diversas vezes ao longo de horas.

O job continua executando normalmente e o pedido volta a ser elegível nas rodadas seguintes.

### Problema

Um resultado determinístico:

```text
not_found
```

não deve virar:

```text
tentar a cada 2/10 minutos
por vários dias
```

sem mudança de estado.

Isso:

- aumenta chamadas externas;
- aumenta logs;
- dificulta enxergar falhas novas;
- consome processamento;
- não aumenta a chance de recuperação depois de certo ponto.

### Avaliação

**P1 — reconciliador sem condição de parada/backoff suficiente para falha determinística.**

A correção futura deve reutilizar os estados já existentes e criar uma regra clara de elegibilidade/reabertura.

Não criar um segundo reconciliador.

A forma mínima será decidida junto dos Itens 7, 10 e 12.

---

# 28. Polling x recuperação legítima

Nem todo polling fiscal é lixo.

São legítimos:

```text
consultar NF em processamento
verificar autorização
recuperar resposta perdida
verificar vínculo com Mercado Livre
reconciliar falha parcial
```

São problemáticos:

```text
repetir operação determinística inválida
repetir not_found indefinidamente
consultar endpoint legado sem necessidade
```

### Princípio para a limpeza

O objetivo é:

**preservar recuperação de estados transitórios e eliminar repetição de estados determinísticos.**

---

# 29. Cancelamentos após NF-e

Existe sincronização específica relacionada a cancelamentos Mercado Livre após emissão fiscal:

```text
sync_ml_cancelamentos_pos_nfe
```

O banco operacional confirma que o job está ativo.

### Avaliação

**Investigar no Item 7.**

Cancelamento após emissão fiscal é um caso real e pode exigir processamento próprio.

A existência do job não deve ser classificada como redundância sem mapear:

- disparador;
- condição;
- idempotência;
- frequência;
- sobreposição com sync de pedidos;
- tratamento de NF cancelada.

---

# 30. Campos de vínculo Mercado Livre aparentemente antigos

Existem no pedido campos como:

```text
ml_invoice_reported
ml_invoice_id
```

Na amostra operacional consultada, várias NF-es autorizadas e comprovadamente vinculadas ao shipment por eventos de sucesso continuavam com:

```text
ml_invoice_reported = false
ml_invoice_id = null
```

### Avaliação

**P2 — forte candidato a estado legado/sem função atual.**

Não remover agora.

No Item 10/15 precisamos:

- localizar todos os leitores;
- localizar todos os escritores;
- confirmar se alguma interface ainda depende deles;
- comparar com a fonte real atual: `shipment invoice_data` + auditoria.

---

# 31. Rotas antigas do emissor fiscal Mercado Livre

Existem proteções e rotas históricas relacionadas a mecanismos fiscais antigos do Mercado Livre.

Em pontos atuais, o sistema bloqueia emissão pelo emissor ML porque a política operacional é:

```text
Brasil NFe como emissor
```

### Avaliação

**Candidato a histórico/compatibilidade para Item 15.**

Não remover ainda.

Alguns endpoints antigos podem existir deliberadamente para:

- retornar erro explícito;
- impedir uso acidental;
- preservar compatibilidade de UI antiga.

Primeiro devem ser rastreados os chamadores.

---

# 32. Complexidade essencial — preservar

## Emissão
- Brasil NFe;
- validação fiscal;
- CFOP;
- IE;
- município IBGE;
- dados fiscais de itens.

## Idempotência
- identificador interno;
- reconciliação local;
- busca externa antes de emitir;
- uso de nota existente;
- cancelamento antes de reemissão.

## Evidência fiscal
- XML autorizado;
- chave;
- protocolo;
- número;
- Storage de DANFE.

## Mercado Livre
- GET da nota atual;
- POST XML para nova nota;
- PUT XML para atualização;
- GET de verificação;
- estados de shipment.

## Recuperação
- retry de falhas transitórias;
- reconciliação de falha parcial;
- auditoria.

A limpeza não deve transformar o fiscal em uma operação linear sem recuperação.

---

# 33. Complexidade acidental / problemas confirmados

## P1 — PUT JSON + POST JSON antes do POST XML

Duas chamadas externas inúteis por criação nova de vínculo fiscal no shipment, confirmadas em produção.

---

## P1 — falta de gate `ready_to_ship + invoice_pending`

Gera `invalid_shipment` reais e chamadas sem possibilidade de sucesso naquele estado.

---

## P1 — reconciliador Brasil NFe repete `not_found` indefinidamente

Falha determinística volta a ser consultada em ciclos frequentes sem mudança de estado.

---

## P2 — billing legado chamado junto com o endpoint novo

O recurso legado está depreciado e deveria ser fallback, não consumo padrão paralelo.

---

## P2 — `ml_invoice_reported` / `ml_invoice_id` aparentam estar obsoletos

O estado atual do vínculo é confirmado por outro fluxo e esses campos não acompanham a realidade na amostra operacional.

---

## P2 — `nota_fiscal_emitida` sobrepõe parcialmente `nfe_status`

Precisa de semântica clara para não virar uma segunda fonte de ciclo de vida.

---

## P2 — URL temporária de DANFE pode ser confundida com existência do arquivo

A fonte durável deve ser o Storage/documento, não a URL assinada.

---

## P2 — aliases de `nfe_status`

A normalização é necessária hoje, mas indica domínio persistido pouco uniforme.

---

# 34. Estado desejado conceitualmente

Sem definir implementação ainda, o domínio deve permanecer simples:

```text
PEDIDO
↓
snapshot fiscal
↓
validação fiscal
↓
ENSURE NF-e
    ├─ local já válida → usar
    ├─ provider já possui → reconciliar
    └─ não existe → emitir
↓
NF-e autorizada
↓
XML + chave + protocolo
↓
SHIPMENT ML
    ├─ não está invoice_pending → aguardar evento/estado válido
    ├─ já possui mesma chave → concluído
    └─ precisa importar → POST XML
↓
verificar vínculo
↓
liberar continuação logística
```

Para polling/reconciliação:

```text
estado transitório → retry controlado
estado determinístico terminal → não repetir continuamente
mudança real/manual → tornar elegível novamente
```

Nenhuma nova infraestrutura é necessária para atingir esse desenho.

---

# 35. O que NÃO fazer agora

Não devemos:

- trocar o Brasil NFe;
- criar outro provider fiscal;
- remover reconciliação;
- remover auditoria;
- remover o snapshot fiscal do pedido;
- emitir novamente sempre que faltar `nfe_external_id`;
- tratar `nota_fiscal_emitida` como única fonte de estado;
- criar nova fila fiscal;
- criar novo cron para compensar os retries atuais;
- manter chamadas inválidas “por segurança” quando o contrato oficial já é conhecido;
- remover campos históricos antes de mapear consumidores;
- implementar as correções durante esta auditoria.

---

# 36. Dependências para itens futuros

## Item 7 — Sincronizações + Jobs + Scheduler

Confirmar:

- necessidade e frequência do `sync_reconcile_brasilnfe`;
- regra de parada/backoff;
- função do `sync_ml_cancelamentos_pos_nfe`;
- possíveis sobreposições com sync de pedidos/fiscal;
- locks e dedupe.

## Item 8 — Webhooks + Eventos

Confirmar:

- recebimento de `shipments`;
- quais eventos alteram liberação fiscal;
- se webhooks podem reduzir polling;
- quais reconciliadores continuam necessários como garantia.

## Item 10 — Banco de Dados

Confirmar:

- constraints de `nfe_status`;
- necessidade de `nota_fiscal_emitida`;
- necessidade de `ml_invoice_reported`;
- necessidade de `ml_invoice_id`;
- papel de `nfe_external_id`;
- fonte durável do DANFE;
- índices e campos de retry/reconciliação.

## Item 12 — Regras de Negócio Compartilhadas

Definir uma fonte única para:

- estado fiscal;
- elegibilidade para reconciliação;
- elegibilidade para importação no shipment;
- retry transitório x terminal;
- disponibilidade do DANFE.

## Item 13 — Performance e Saúde Operacional

Medir:

- chamadas Brasil NFe repetidas;
- chamadas ML inválidas removíveis;
- volume de reconciliação;
- latência entre autorização e vínculo no shipment.

## Item 15 — Scripts + Documentação + Históricos

Classificar:

- rotas antigas do emissor fiscal Mercado Livre;
- helpers fiscais antigos;
- campos e documentos legados;
- scripts de backfill encerrados.

---

# 37. Resultado do checklist — Item 5

- [x] Mapear NF-e do pedido até autorização.
- [x] Mapear Mercado Livre + Brasil NFe.
- [x] Mapear webhooks, polling, retries e reconciliação.
- [x] Identificar estados duplicados ou mecanismos de recuperação necessários.
- [x] Confirmar Brasil NFe como emissor fiscal operacional.
- [x] Mapear snapshot fiscal e dados do comprador.
- [x] Comparar billing info com a documentação atual do Mercado Livre.
- [x] Confirmar reconciliação/idempotência antes de nova emissão.
- [x] Confirmar proteção contra XML de homologação.
- [x] Mapear importação da NF-e no shipment.
- [x] Comparar importação com a documentação oficial atual.
- [x] Identificar PUT/POST JSON desnecessários antes do POST XML.
- [x] Identificar ausência de gate `ready_to_ship + invoice_pending`.
- [x] Identificar retries recorrentes de `not_found` no Brasil NFe.
- [x] Identificar campos fiscais derivados/possivelmente históricos.
- [x] Separar recuperação legítima de repetição desnecessária.
- [x] Registrar dependências para Jobs, Webhooks, Banco, Regras Compartilhadas e Históricos.

---

# 38. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhuma migration foi executada;
- nenhum dado foi modificado;
- nenhuma NF-e foi emitida;
- nenhuma NF-e foi cancelada;
- nenhum documento foi enviado ao Mercado Livre;
- nenhum deploy foi realizado;
- nenhum teste de código foi executado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise de código fiscal;
- análise de jobs e sincronizações relacionados;
- consultas somente leitura no banco operacional;
- consulta à documentação oficial atual do Mercado Livre;
- consulta à documentação oficial atual do Brasil NFe.

---

# 39. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Código Vortek — branch `dev`

Arquivos principais analisados:

- `src/services/fiscal-provider.ts`
- `src/services/fiscal-recipient-ie.ts`
- `src/services/integration.ts`
- `src/services/nf-auditoria.ts`
- `src/lib/fiscal/brasil-nfe-identifier.ts`
- `src/lib/fiscal/cfop.ts`
- `src/lib/fiscal/danfe-storage.ts`
- `src/lib/fiscal/ensure-brasilnfe-invoice.ts`
- `src/lib/fiscal/ie-policy.ts`
- `src/lib/fiscal/municipio-ibge.ts`
- `src/lib/fiscal/nfe-live-sync.ts`
- `src/lib/fiscal/nfe-local-reconciliation.ts`
- `src/lib/fiscal/nfe-status.ts`
- `src/lib/sync/registry.ts`
- `src/app/api/sync/pedidos/route.ts`
- `src/app/api/sync/nf/reconciliar-brasilnfe/route.ts`
- `src/app/api/dslite/etiqueta-auto/route.ts`
- rotas relacionadas em `src/app/api/notas-fiscais`
- rotas relacionadas em `src/app/api/nf`

## Banco operacional — somente leitura

Consultados:

- `pedidos`;
- `nf_auditoria_eventos`;
- `jobs`;
- `integracoes`.

Nenhuma credencial, token ou URL assinada foi reproduzida neste documento.

## Mercado Livre — documentação oficial

Importar Nota Fiscal:

`https://developers.mercadolivre.com.br/pt_br/produto-autenticacao-autorizacao/importar-nota-fiscal`

Billing info:

`https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas/faturamento-billing-info`

Orders:

`https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas`

Gerenciamento de Envios:

`https://developers.mercadolivre.com.br/pt_br/registre-o-seu-aplicativo/gerenciamento-de-envios`

## Brasil NFe — documentação oficial

API:

`https://brasilnfe.com.br/api/`

---

# 40. Conclusão final do Item 5

O fiscal do Vortek não precisa de uma nova arquitetura.

A base correta é:

```text
Brasil NFe
+
idempotência
+
reconciliação
+
XML autorizado
+
auditoria
+
vínculo verificado no shipment Mercado Livre
```

Essa complexidade deve ser preservada.

A limpeza futura deve remover principalmente comportamento que não agrega resiliência:

```text
PUT JSON inválido
+
POST JSON inválido
+
uploads antes do shipment estar apto
+
not_found repetido indefinidamente
+
chamada billing legada desnecessária
```

Também ficaram registrados estados/campos que precisam de consolidação antes de qualquer remoção.

O **Item 5 está concluído**.

Nenhuma correção deve ser executada agora. Os achados seguem para os demais itens e, somente após a consolidação da auditoria, para o checklist de execução.
