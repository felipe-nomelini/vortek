# Vortek — Auditoria de Limpeza e Organização

## Item 6 — Compras + Fornecedores + Financeiro

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** mapear compras DSLite, pagamentos a fornecedores, saldo/créditos de fornecedores e Mercado Pago, identificar fontes de verdade e complexidade acidental, e preparar o entendimento mínimo necessário para futuras compras destinadas ao estoque próprio.

---

## 1. Conclusão executiva

O domínio de compras e fornecedores já possui uma base operacional válida.

Hoje existem dois modelos realmente ativos de pagamento:

```text
Hayamax
→ balance_account
→ débito automático no saldo do fornecedor

Demais fornecedores operacionais
→ prepaid_pix
→ compra criada
→ pagamento confirmado manualmente
→ comprovante armazenado/enviado
→ fluxo DSLite retomado
```

O tipo:

```text
postpaid
```

ainda existe no código e no banco, porém a consulta operacional encontrou apenas quatro compras antigas canceladas, entre abril e maio de 2026.

O controle de saldo/créditos também é real:

- Hayamax usa uma conta-saldo;
- compras Hayamax geram `purchase_debit` idempotente;
- recargas/créditos entram no mesmo ledger;
- cancelamentos de vendas já pagas a fornecedores PIX geram candidatos de crédito;
- créditos de fornecedores precisam de confirmação humana antes de ficarem disponíveis;
- existe consumo manual de crédito.

A principal fragilidade do Item 6 está no Mercado Pago.

O job:

```text
sync_mercadopago_account_money
```

está ativo e roda várias vezes ao dia.

Porém o caminho agendado atual não completa corretamente o ciclo assíncrono do relatório:

```text
solicita relatório
→ Mercado Pago responde 202 / pending
→ job Vortek termina como "completo"
→ próxima execução usa outra janela temporal
→ relatório anterior não é necessariamente recuperado/importado
```

A evidência operacional é consistente com isso:

- jobs continuam executando até 27/08/2026;
- a tabela `mercadopago_account_movements` não possui movimentos novos desde junho;
- créditos Hayamax recentes vieram de importação de extrato `legacy`, não da reconciliação Mercado Pago.

Além disso, o parser atual do CSV não prioriza os campos oficiais:

```text
SETTLEMENT_NET_AMOUNT
TRANSACTION_TYPE
SETTLEMENT_CURRENCY
```

e pode usar `TRANSACTION_AMOUNT`, que é o valor bruto, como `amount`.

Isso é especialmente importante porque o Vortek pretende usar esses movimentos para criar créditos automáticos no saldo Hayamax.

### Prioridades

**P1**
- fechar corretamente o ciclo assíncrono do relatório Mercado Pago;
- corrigir o parser para o contrato oficial antes de confiar em baixa automática financeira.

**P2**
- consolidar tipos/semântica de `supplier_balance_movements`;
- esclarecer `compras.valor_total` x `supplier_payment_amount`;
- revisar `postpaid` como possível legado;
- separar eventos de pagamento do audit log fiscal;
- reconciliar compras antigas `prepaid_pix` que continuam `pending` apesar da operação já concluída.

Não foi identificado P0.

---

# 2. Fluxo atual de uma compra DSLite

A compra DSLite nasce no fluxo de fulfillment de fornecedor.

O fluxo atual, de forma simplificada, é:

```text
pedido Mercado Livre
↓
resolver produto / quantidade
↓
selecionar fornecedor/oferta
↓
confirmar disponibilidade real no DSLite
↓
criar pedido DSLite
↓
persistir em compras
↓
aplicar regra financeira do fornecedor
↓
continuar fiscal / etiqueta / operação
```

Antes da compra, o Vortek não depende apenas do estoque local persistido.

O fluxo confirma a disponibilidade externa e pode usar outra oferta ativa quando a oferta inicialmente preferida não atende integralmente o pedido.

### Avaliação

**Manter.**

Essa validação reduz risco de compra em fornecedor sem disponibilidade real.

---

# 3. Tabela `compras`

A tabela `compras` representa o pedido de compra operacional ligado ao DSLite.

Entre os dados persistidos estão:

```text
dsid
status
status_dslite
nf_chave
valor_total
valor_frete
fornecedor_id
fornecedor_nome
destinatario
produto
quantidade
supplier_payment_mode
supplier_payment_status
supplier_payment_amount
supplier_payment_reference
supplier_payment_confirmed_at
supplier_payment_receipt_path
produto_fornecedor_oferta_id
```

### Avaliação

**Manter.**

Ela representa um evento comercial diferente de:

```text
pedido de venda
```

e diferente de:

```text
movimentação de saldo do fornecedor
```

Não deve ser fundida com `pedidos`.

---

# 4. Modos de pagamento existentes

O código define:

```text
postpaid
prepaid_pix
balance_account
```

A inferência atual é simples:

```text
Hayamax → balance_account
outros → prepaid_pix
```

Uma oferta também pode persistir explicitamente seu `payment_mode`.

### Estado operacional

A consulta do banco confirmou ofertas Hayamax ativas configuradas como:

```text
balance_account
```

O fluxo `prepaid_pix` também está ativo, com compras recentes aguardando pagamento em fornecedores como:

- Vanral;
- BKR1;
- Evolusom.

### Avaliação

**Manter os dois modos ativos.**

---

# 5. `postpaid` — candidato a legado

O tipo `postpaid` permanece:

- no tipo TypeScript;
- em normalizações;
- em dados históricos.

Porém a consulta operacional encontrou somente quatro compras `postpaid`, todas:

```text
Hayamax
+
canceladas
+
abril/maio de 2026
```

Não foram encontradas evidências de uso atual pela regra automática.

### Avaliação

**P2 — investigar para remoção/consolidação.**

Não remover agora.

No Item 10/15 deve ser confirmado:

- constraint atual;
- todos os leitores;
- todos os escritores;
- necessidade de compatibilidade histórica.

---

# 6. Pagamento Hayamax — conta-saldo

Hayamax utiliza:

```text
balance_account
```

Quando uma compra é criada, o Vortek resolve o custo real da oferta e grava:

```text
purchase_debit
```

com valor negativo no ledger:

```text
supplier_balance_movements
```

A chave:

```text
purchase:{dsid}
```

impede duplicidade do mesmo débito.

### Estado operacional

Foram encontrados débitos confirmados recentes até 27/08/2026.

Não foram encontrados movimentos Hayamax com status diferente de `confirmed` na consulta realizada.

### Avaliação

**Manter.**

O ledger é uma base correta para saldo auditável.

---

# 7. Fonte do valor debitado ao fornecedor

O débito Hayamax utiliza:

```text
custo da oferta externa
×
quantidade
```

e não o preço de venda do Mercado Livre.

O resultado é persistido também como:

```text
supplier_payment_amount
```

na compra.

### Avaliação

**Manter.**

Esse campo é hoje o candidato mais claro a representar:

```text
valor efetivamente devido ao fornecedor
```

---

# 8. Ambiguidade de `compras.valor_total`

Na criação da compra, o campo:

```text
compras.valor_total
```

é preenchido com:

```text
operationalOrderTotal
```

ou, como fallback:

```text
pedido.total
```

Ao mesmo tempo:

```text
supplier_payment_amount
```

guarda o valor resolvido do pagamento ao fornecedor.

Isso cria uma ambiguidade semântica.

Um campo chamado:

```text
valor_total
```

dentro de `compras` pode ser interpretado naturalmente como custo total da compra, embora no fluxo atual ele esteja ligado ao valor operacional da venda/pedido.

### Avaliação

**P2 — fonte de verdade financeira precisa ficar explícita.**

Não renomear nem remover agora.

No Item 10/12 devemos mapear os consumidores e definir claramente:

```text
valor da venda
valor da compra
valor devido ao fornecedor
frete
```

antes de qualquer alteração.

---

# 9. Fluxo PIX pré-pago

Para fornecedores `prepaid_pix`:

```text
pedido DSLite criado
↓
supplier_payment_status = pending
↓
Vortek interrompe continuação
↓
operador confirma pagamento
↓
supplier_payment_status = paid
↓
fluxo DSLite pode ser retomado
```

A própria rota de fulfillment impede retomada enquanto:

```text
supplier_payment_status != paid
```

### Avaliação

**Manter.**

É um gate financeiro necessário.

---

# 10. Confirmação manual do PIX

A confirmação de pagamento possui proteções e evidências relevantes:

- permissão específica;
- compra precisa ser `prepaid_pix`;
- pedido vinculado precisa ser identificado sem ambiguidade;
- comprovante pode ser armazenado;
- referência e observações são persistidas;
- usuário que confirmou e horário são registrados;
- o fluxo DSLite pode ser retomado com idempotência.

### Avaliação

**Manter.**

Não automatizar o pagamento apenas para reduzir etapas enquanto a operação real depende de confirmação humana.

---

# 11. Comprovante do fornecedor

O comprovante é persistido em Storage.

O fluxo aceita formatos de documento/imagem e guarda o caminho do arquivo.

Depois pode enviar o comprovante ao fornecedor por WhatsApp.

Existe fallback de envio como link quando o envio de arquivo não estiver disponível.

### Avaliação

**Manter.**

É evidência operacional real.

Não transformar uma URL pública/assinada na fonte principal da existência do comprovante; a fonte durável deve continuar sendo o Storage.

---

# 12. BKR1 possui regra operacional própria

O fluxo de BKR1 pode adiar a confirmação do PIX enquanto a etiqueta real do Mercado Livre ainda não estiver liberada.

Isso evita pagar/liberar o fornecedor cedo demais em um cenário de etiqueta placeholder.

### Avaliação

**Manter.**

É uma regra operacional específica, não duplicação estética.

A interação com jobs e liberação de etiqueta será revista no Item 7.

---

# 13. Estado operacional de pagamentos pendentes

A consulta somente leitura mostrou compras `prepaid_pix` atuais com:

```text
supplier_payment_status = pending
status = Aguardando Pagamento Fornecedor
```

Isso confirma que o gate está em uso real.

Também foi encontrado pelo menos um caso antigo em que:

```text
supplier_payment_status = pending
```

enquanto:

```text
pedido de venda = entregue
status DSLite = Confirmado
```

### Avaliação

**P2 — inconsistência de reconciliação financeira.**

Não é possível afirmar, somente pelos dados consultados, se houve:

- pagamento externo não registrado;
- crédito utilizado fora do fluxo;
- intervenção manual;
- estado histórico anterior à regra atual.

O ponto confirmado é que o estado financeiro local pode permanecer pendente mesmo depois de a operação logística terminar.

Isso precisa ser tratado no Item 7/10/12 antes de qualquer automação financeira mais forte.

---

# 14. Ledger de fornecedores

A tabela:

```text
supplier_balance_movements
```

é o ledger financeiro/auditável do fornecedor.

Ela registra movimentos positivos e negativos.

Na operação atual foram encontrados tipos como:

```text
topup
purchase_debit
adjustment
cancellation_credit
credit_usage
```

### Avaliação

**Manter um único ledger.**

Não há justificativa para criar outra tabela apenas porque existem fornecedores com modelos financeiros diferentes.

O problema atual é de clareza de domínio/tipos, não de ausência de estrutura.

---

# 15. Divergência entre tipo TypeScript e domínio real

O tipo principal atual declara:

```text
'topup' | 'purchase_debit' | 'adjustment'
```

Porém a própria aplicação e o banco utilizam também:

```text
cancellation_credit
credit_usage
```

### Avaliação

**P2 — tipo desatualizado em relação ao domínio real.**

Isso aumenta chance de:

- casts;
- tratamento parcial;
- regras diferentes por arquivo;
- manutenção confusa.

A consolidação deve ocorrer no Item 10/12.

---

# 16. Créditos após cancelamento

Quando uma venda é cancelada após um fornecedor PIX já ter sido pago, o Vortek pode criar:

```text
cancellation_credit
```

para o fornecedor.

A regra:

- exclui Hayamax;
- exige `prepaid_pix`;
- exige pagamento `paid`;
- usa `supplier_payment_amount`;
- cria uma chave idempotente por compra;
- começa como `pending`.

### Avaliação

**Manter.**

O crédito não deve ficar disponível automaticamente só porque a venda foi cancelada.

O fornecedor precisa reconhecer o crédito real.

---

# 17. Confirmação de crédito

A API administrativa permite:

```text
pending
→ confirmed
```

ou rejeição.

A atualização verifica o estado atual para evitar sobrescrever silenciosamente uma decisão concorrente.

### Avaliação

**Manter.**

É uma proteção correta contra crédito financeiro incorreto.

---

# 18. Uso de créditos

O mesmo ledger registra:

```text
credit_usage
```

quando um crédito do fornecedor é consumido.

A consulta operacional confirmou movimentos reais desse tipo.

### Avaliação

**Manter o conceito.**

No Item 12 deve ficar explícito como esse crédito participa do pagamento de uma nova compra, para evitar ter:

```text
saldo
pagamento PIX
crédito
```

como fontes concorrentes sem uma regra única.

---

# 19. Dois significados financeiros no mesmo ledger

Hoje `supplier_balance_movements` atende dois casos:

## Hayamax

```text
conta pré-carregada
+
débitos automáticos de compras
```

## Outros fornecedores

```text
créditos reconhecidos
+
uso de crédito
+
ajustes
```

Isso parece diferente, mas ambos representam:

```text
direitos/obrigações financeiras com um fornecedor
```

### Avaliação

**Não dividir em duas tabelas agora.**

A simplificação correta é deixar as regras explícitas e os tipos consistentes.

Criar dois ledgers aumentaria a complexidade sem necessidade comprovada.

---

# 20. Recargas Hayamax por extrato

Existe importação de extrato da Hayamax para reconciliar créditos/recargas.

A consulta operacional mostrou `topup` recentes carregados como dados `legacy`, incluindo importações de extrato realizadas em julho.

Esse mecanismo é atualmente a fonte efetiva de vários créditos Hayamax.

### Avaliação

**Manter por enquanto.**

Não classificar o importador de extrato como lixo enquanto o Mercado Pago automático não estiver comprovadamente confiável.

---

# 21. Mercado Pago — objetivo do fluxo

O Vortek possui uma integração específica para:

```text
Relatório Dinheiro em Conta
```

do Mercado Pago.

A intenção é:

1. gerar/obter relatório;
2. baixar CSV;
3. importar movimentos;
4. identificar movimentos ligados à Hayamax;
5. criar `topup` idempotente quando aplicável.

### Comparação oficial

O Mercado Pago documenta esse relatório justamente como fonte para:

```text
movimentos que impactaram o saldo da conta
```

e fornece um ciclo assíncrono de:

```text
criar relatório
→ acompanhar tarefa
→ obter arquivo processado
→ baixar relatório
```

### Avaliação

**O conceito é válido.**

O problema está na implementação do ciclo agendado atual.

---

# 22. P1 — ciclo assíncrono Mercado Pago não é fechado pelo scheduler

A rota possui suporte para:

```text
fileName
taskId
relatório já processado
```

quando esses identificadores são fornecidos.

Porém o job agendado usa apenas:

```text
windowDays = 7
```

A cada execução:

1. calcula uma nova janela baseada no horário atual;
2. procura relatório com `begin_date` e `end_date` exatamente iguais;
3. se não encontrar, solicita um novo relatório;
4. recebe `202`;
5. retorna `report_requested`;
6. o job é marcado como `completo`.

Na execução seguinte, a janela temporal já mudou.

Logo, o relatório anterior não é necessariamente reencontrado pelo teste de igualdade exata.

### Evidência operacional

Foi confirmado no banco:

- job executando várias vezes ao dia até 27/08/2026;
- jobs terminando `completo`;
- log do job registrando `report_requested` e relatório `pending`;
- ausência de movimentos novos na tabela do Mercado Pago desde junho.

### Avaliação

**P1 — confiabilidade financeira.**

O estado:

```text
relatório solicitado
```

não deve significar:

```text
reconciliação concluída
```

A futura correção deve fechar o ciclo assíncrono existente, não criar outro cron ou outro serviço.

---

# 23. Estado atual de `mercadopago_account_movements`

A tabela contém movimentos reais históricos.

Porém, na consulta realizada:

- o movimento mais recente era de 01/06/2026;
- os registros foram importados em junho;
- não havia movimentos atualmente associados automaticamente à Hayamax;
- jobs do Mercado Pago continuavam rodando em agosto.

### Avaliação

O fluxo não é código morto.

Ele está **ativo, mas operacionalmente ineficaz no caminho agendado atual**.

Isso é mais importante do que simplesmente apagar o job.

---

# 24. P1 — parser não usa o valor líquido oficial

O parser atual procura o valor em chaves como:

```text
net_amount
gross_amount
amount
transaction_amount
```

mas não inclui explicitamente:

```text
settlement_net_amount
```

A documentação oficial do Mercado Pago define:

```text
TRANSACTION_AMOUNT
= valor bruto

SETTLEMENT_NET_AMOUNT
= impacto real no saldo
```

O Vortek usa esse `amount` para decidir e criar créditos automáticos.

### Risco

Quando o CSV oficial possui:

```text
TRANSACTION_AMOUNT
+
SETTLEMENT_NET_AMOUNT
```

o parser atual pode usar o valor bruto como se fosse o impacto financeiro real.

### Avaliação

**P1 — não confiar em baixa automática até o parser seguir o contrato oficial.**

Não foi identificada corrupção recente causada por isso porque o fluxo agendado atual não está importando movimentos novos.

Mesmo assim, corrigir apenas o scheduler sem corrigir o parser criaria risco financeiro.

---

# 25. Outros campos oficiais não reconhecidos pelo parser

O CSV oficial também usa:

```text
TRANSACTION_TYPE
TRANSACTION_CURRENCY
SETTLEMENT_CURRENCY
```

O parser atual procura formas genéricas como:

```text
type
movement_type
currency
currency_id
```

mas não cobre diretamente todos os nomes oficiais principais.

### Avaliação

**Corrigir junto com o P1 do parser.**

Não criar um segundo parser.

O parser existente deve ser a única implementação.

---

# 26. Matching automático Hayamax

Depois de importar uma linha, o Vortek tenta identificar movimentos relacionados à Hayamax usando:

- texto/referências;
- valor mínimo;
- heurísticas de entrada/saída.

Quando considera Hayamax, cria:

```text
topup
```

com chave:

```text
mercadopago:{external_id}
```

### Avaliação

A idempotência é boa e deve ser preservada.

Porém o matching só pode ser considerado confiável depois de o parser utilizar:

```text
tipo oficial da transação
+
impacto líquido real
+
moeda correta
```

### Direção

**Não aumentar automação nem relaxar revisão enquanto os dados-base não forem confiáveis.**

---

# 27. Mercado Pago não substitui o ledger

A tabela:

```text
mercadopago_account_movements
```

é evidência/importação da conta Mercado Pago.

A tabela:

```text
supplier_balance_movements
```

é o ledger operacional de fornecedores.

Essas tabelas possuem propósitos distintos.

### Avaliação

**Manter separadas.**

A relação:

```text
movimento Mercado Pago
→ movimento de saldo de fornecedor
```

é útil para rastreabilidade.

Não fundir as duas estruturas.

---

# 28. Eventos de pagamento gravados na auditoria fiscal

A confirmação manual de PIX e o envio de WhatsApp ao fornecedor utilizam atualmente:

```text
registrarEventoNfAuditoria(...)
```

e registram eventos como:

```text
supplier_payment_confirmed_manual
supplier_payment_whatsapp_sent
supplier_payment_whatsapp_failed
```

na infraestrutura de auditoria fiscal.

### Avaliação

**P2 — mistura de domínio.**

Esses eventos são operacionais/financeiros, não fiscais.

Não criar agora uma tabela nova somente por organização.

No Item 10/12/15 deve ser verificado se já existe uma trilha de auditoria operacional adequada ou se a própria tabela pode ser generalizada/consolidada.

---

# 29. Compras atuais são compras para atender vendas

O modelo atual de `compras` nasceu para:

```text
venda Mercado Livre
↓
pedido DSLite
↓
fornecedor entrega para o destinatário da venda
```

Isso é visível porque a compra carrega:

- destinatário;
- documento;
- vínculo com pedido;
- DSID;
- NF da venda;
- fornecedor;
- item;
- pagamento.

### Avaliação

**Não tratar esse modelo como sistema geral de reposição de estoque próprio.**

Ele foi construído para fulfillment externo.

---

# 30. Futuras compras para estoque próprio

Quando o Vortek comprar para armazenagem própria, o fluxo conceitual precisa ser diferente no destino, mas deve reutilizar os mesmos domínios existentes.

Deve reutilizar:

```text
produto mestre
ofertas de fornecedor
custo
fornecedor
regra de pagamento
ledger financeiro
```

A diferença será a finalidade da compra.

Conceitualmente:

```text
compra para fulfillment de venda
→ destinatário final

compra para estoque próprio
→ estoque Vortek
```

### Direção

O sistema futuro precisa conseguir distinguir claramente esses dois propósitos.

Não definir schema neste Item 6.

---

# 31. Compra não significa estoque disponível

Para estoque próprio, a sequência mínima continua sendo a definida no Item 2:

```text
comprado
↓
recebido
↓
conferido
↓
disponível
```

Portanto:

```text
criar compra
```

ou:

```text
confirmar pagamento
```

nunca deve aumentar automaticamente o estoque vendável.

A entrada no estoque interno só deve acontecer quando a mercadoria realmente chegar e for conferida.

### Avaliação

**Regra necessária para o futuro planejamento.**

---

# 32. Não criar um segundo sistema de compras

Não há motivo para criar:

- outro cadastro de fornecedores;
- outra tabela de ofertas;
- outro ledger financeiro;
- outro módulo de pagamento;
- outro sistema paralelo de produtos;
- um WMS separado.

O objetivo futuro é evoluir o domínio de compras para reconhecer:

```text
destino/finalidade
```

e conectar o recebimento ao estoque interno existente.

### Avaliação

**Reutilizar antes de adicionar.**

---

# 33. Performance — registrar, não otimizar agora

Algumas rotas de compras/créditos carregam registros em blocos e fazem:

```text
filtro
ordenação
métricas
paginação
```

em memória.

Isso pode virar custo real com crescimento de volume.

### Avaliação

**Levar ao Item 13.**

Não otimizar sem medir.

---

# 34. Complexidade essencial — preservar

## Compras
- pedido DSLite;
- vínculo com oferta;
- fornecedor real;
- valor devido ao fornecedor;
- status externo.

## Pagamento PIX
- gate `pending → paid`;
- comprovante;
- confirmação humana;
- rastreabilidade;
- retomada idempotente.

## Conta Hayamax
- ledger;
- débito idempotente por compra;
- recarga;
- ajuste;
- reconciliação.

## Créditos de fornecedor
- candidato por cancelamento;
- confirmação humana;
- uso de crédito;
- idempotência.

## Mercado Pago
- tabela de movimentos brutos;
- vínculo com ledger;
- relatório oficial;
- idempotência por movimento.

Esses mecanismos resolvem problemas reais.

---

# 35. Complexidade acidental / problemas confirmados

## P1 — scheduler Mercado Pago não fecha o ciclo do relatório

Jobs aparecem como completos depois de apenas solicitar um relatório assíncrono.

---

## P1 — parser Mercado Pago não usa `SETTLEMENT_NET_AMOUNT`

O campo oficial de impacto real no saldo não é reconhecido diretamente, enquanto `TRANSACTION_AMOUNT` pode ser usado.

---

## P2 — estado de pagamento pode ficar `pending` após operação concluída

Foi encontrado caso real de venda entregue / DSLite confirmado com pagamento local ainda pendente.

---

## P2 — tipos do ledger estão incompletos no TypeScript

O domínio real possui tipos não declarados no union principal.

---

## P2 — `compras.valor_total` é semanticamente ambíguo

Não representa de forma inequívoca o valor devido ao fornecedor.

---

## P2 — `postpaid` aparenta ser legado

Existe no modelo, mas não foi observado em operação atual.

---

## P2 — auditoria financeira usa infraestrutura nominalmente fiscal

Eventos de pagamento/WhatsApp são gravados pela auditoria de NF.

---

# 36. Estado desejado conceitualmente

O domínio pode permanecer simples:

```text
VENDA
↓
FULFILLMENT SUPPLIER
↓
COMPRA DSLITE
↓
REGRA FINANCEIRA
   ├─ balance_account
   │    ↓
   │  ledger fornecedor
   │
   └─ prepaid_pix
        ↓
      pending
        ↓
      confirmação + comprovante
        ↓
      paid
↓
continuação operacional
```

Para créditos:

```text
cancelamento
↓
crédito candidato
↓
confirmação
↓
saldo disponível
↓
uso em compra
```

Para Mercado Pago:

```text
solicitar relatório
↓
acompanhar a MESMA tarefa
↓
processado
↓
baixar CSV
↓
parsear campos oficiais
↓
persistir movimento bruto
↓
classificar com segurança
↓
gerar movimento de fornecedor idempotente
```

Para estoque próprio:

```text
compra
↓
recebimento
↓
conferência
↓
entrada no ledger de estoque interno
```

Nenhuma nova infraestrutura é necessária neste momento.

---

# 37. O que NÃO fazer agora

Não devemos:

- substituir a DSLite;
- eliminar `compras`;
- eliminar o ledger de fornecedores;
- automatizar pagamento PIX sem necessidade;
- fundir Mercado Pago com saldo de fornecedor;
- apagar o importador de extrato Hayamax antes de o sync automático estar comprovadamente correto;
- remover `postpaid` sem rastrear consumidores/migrations;
- criar tabela nova só para separar crédito de saldo;
- criar novo parser Mercado Pago em paralelo;
- criar novo cron para compensar o ciclo quebrado;
- considerar compra como entrada imediata de estoque próprio;
- criar WMS;
- implementar as correções durante esta auditoria.

---

# 38. Dependências para itens futuros

## Item 7 — Sincronizações + Jobs + Scheduler

Confirmar:

- lifecycle completo de `sync_mercadopago_account_money`;
- semântica de `completo` para respostas 202;
- persistência/reuso de task/report;
- sincronização de compras DSLite;
- reconciliação de pagamentos pendentes antigos;
- sobreposição entre sync financeiro e importações manuais.

## Item 8 — Webhooks + Eventos

Verificar se algum evento externo pode complementar:

- mudança de estado DSLite;
- Mercado Pago;
- pagamento;
- cancelamento.

Não adicionar webhook sem necessidade oficial comprovada.

## Item 10 — Banco de Dados

Confirmar:

- constraints de `supplier_payment_mode`;
- constraints de `supplier_payment_status`;
- tipos permitidos em `supplier_balance_movements`;
- semântica de `compras.valor_total`;
- índices e relações;
- campos legados de pagamento;
- necessidade de um discriminador futuro de finalidade da compra.

## Item 12 — Regras Compartilhadas

Definir uma fonte única para:

- valor devido ao fornecedor;
- modo de pagamento;
- saldo disponível;
- crédito disponível;
- uso de crédito;
- elegibilidade para retomar fulfillment;
- parsing/classificação Mercado Pago.

## Item 13 — Performance

Medir:

- custo das listagens de compras;
- carregamento completo de movimentos/créditos;
- frequência/custo do relatório Mercado Pago;
- chamadas que não resultam em importação.

## Item 15 — Scripts + Documentação + Históricos

Classificar:

- importadores `legacy` de extrato;
- suporte `postpaid`;
- scripts financeiros antigos;
- documentação de reconciliação anterior.

---

# 39. Resultado do checklist — Item 6

- [x] Mapear compras DSLite.
- [x] Mapear pagamento de fornecedores.
- [x] Mapear saldo de fornecedores.
- [x] Mapear Mercado Pago.
- [x] Preparar o entendimento necessário para futuras compras destinadas ao estoque próprio.
- [x] Mapear `balance_account` e `prepaid_pix`.
- [x] Identificar `postpaid` como candidato a legado.
- [x] Confirmar débito idempotente Hayamax por compra.
- [x] Mapear confirmação manual de PIX e comprovantes.
- [x] Mapear créditos por cancelamento e uso de crédito.
- [x] Identificar divergência dos tipos do ledger.
- [x] Identificar ambiguidade entre `valor_total` e `supplier_payment_amount`.
- [x] Comparar o relatório Dinheiro em Conta com a documentação oficial atual.
- [x] Identificar ciclo assíncrono incompleto no scheduler Mercado Pago.
- [x] Identificar incompatibilidade do parser com `SETTLEMENT_NET_AMOUNT`.
- [x] Confirmar que compra futura para estoque próprio não deve liberar estoque antes do recebimento/conferência.
- [x] Separar complexidade necessária de complexidade acidental.

---

# 40. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhuma migration foi executada;
- nenhum dado foi modificado;
- nenhum pagamento foi realizado;
- nenhum saldo foi ajustado;
- nenhum crédito foi confirmado/rejeitado;
- nenhum pedido DSLite foi criado ou alterado;
- nenhum relatório Mercado Pago foi solicitado manualmente por esta auditoria;
- nenhum deploy foi realizado;
- nenhum teste de código foi executado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise de código de compras, fornecedores e financeiro;
- consultas somente leitura no banco operacional;
- consulta à documentação oficial atual do Mercado Pago;
- consulta à documentação oficial DSLite.

---

# 41. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Código Vortek — branch `dev`

Arquivos principais analisados:

- `src/app/api/dslite/pedido/route.ts`
- `src/app/api/compras/route.ts`
- `src/app/api/compras/[id]/confirmar-pagamento/route.ts`
- `src/app/api/fornecedores/creditos/route.ts`
- `src/app/api/fornecedores/creditos/[id]/route.ts`
- `src/app/api/fornecedores/saldo-hayamax/route.ts`
- `src/app/api/sync/mercadopago-account-money/route.ts`
- `src/lib/produto-fornecedor.ts`
- `src/lib/supplier-balance.ts`
- `src/lib/supplier-credits.ts`
- `src/lib/sync/registry.ts`
- `src/services/mercadopago.ts`

## Banco operacional — somente leitura

Consultados:

- `compras`;
- `produto_fornecedor_ofertas`;
- `supplier_balance_movements`;
- `mercadopago_account_movements`;
- `jobs`;
- `pedidos`.

Nenhuma credencial, token, chave PIX ou dado sensível foi reproduzido neste documento.

## Mercado Pago — documentação oficial

Relatório Dinheiro em Conta:

`https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/introduction`

Campos e uso do relatório:

`https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/how-to-use`

Criar relatório:

`https://www.mercadopago.com.br/developers/pt/reference/settlements-report/create-report/post`

Consultar tarefa:

`https://www.mercadopago.com.br/developers/pt/reference/settlements-report/query-task-status/get`

Buscar relatório:

`https://www.mercadopago.com.br/developers/pt/reference/settlements-report/search-report/get`

Baixar relatório:

`https://www.mercadopago.com.br/developers/pt/reference/settlements-report/download-report/get`

## DSLite — documentação oficial

`https://documenter.getpostman.com/view/5316990/RWaRNkaA`

---

# 42. Conclusão final do Item 6

O domínio de compras/fornecedores não precisa ser reconstruído.

A base correta é:

```text
compras DSLite
+
ofertas de fornecedor
+
modo de pagamento explícito
+
ledger auditável
+
confirmação de PIX
+
créditos de fornecedor
```

A maior limpeza necessária nesta área é tornar o financeiro mais coerente e confiável.

O principal risco é o Mercado Pago:

```text
job ativo
≠
reconciliação concluída
```

Hoje o scheduler pode terminar depois de apenas solicitar um relatório e o parser, quando recebe um CSV, não usa explicitamente o campo oficial de impacto líquido no saldo.

Esses dois problemas precisam ser corrigidos juntos no futuro checklist de execução.

Também foram registrados pontos P2 de estado, tipagem e nomenclatura que devem ser consolidados nos Itens 10 e 12 antes de qualquer remoção.

Para futuras compras destinadas ao estoque próprio, a direção é reutilizar o domínio atual e adicionar somente a distinção necessária de finalidade/recebimento:

```text
comprado
→ recebido
→ conferido
→ disponível
```

sem criar um sistema paralelo.

O **Item 6 está concluído**.

Nenhuma correção deve ser executada agora. Os achados seguem para os próximos itens e, somente após a consolidação da auditoria, para o checklist de execução.
