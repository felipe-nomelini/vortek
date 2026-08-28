# Vortek — Auditoria de Limpeza e Organização

## Item 2 — Pedidos + Fulfillment + Estoque Interno

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** entender o fluxo real de pedidos, escolha de origem de atendimento e estoque interno antes de qualquer limpeza, preservando automação, resiliência e capacidade futura de operar estoque próprio em escala.

---

## 1. Conclusão executiva

A base atual de fulfillment é melhor do que parecia numa análise superficial.

Existem mecanismos importantes que devem ser preservados:

- origem de atendimento explícita: `internal` ou `supplier`;
- escolha de origem protegida contra conflito no banco;
- fluxo interno separado do DSLite;
- movimentação de estoque com histórico;
- estorno sem apagar movimentação;
- devolução só entra no estoque interno quando realmente retorna ao endereço do Vortek;
- devoluções ficam bloqueadas até conferência;
- fornecedor externo é tratado com lógica operacional própria;
- o sistema evita somar cegamente estoque interno + estoque de fornecedor;
- pedidos só são considerados atendíveis internamente quando o estoque interno cobre o pedido completo.

Por outro lado, o módulo de estoque interno atual **ainda não é um sistema geral de estoque próprio**. Ele nasceu principalmente para devoluções e envio interno e foi expandido progressivamente.

O principal risco identificado é **concorrência na reserva do estoque interno**.

Hoje a escolha do pedido como `internal` é protegida, mas a quantidade de estoque não é reservada atomicamente junto com essa escolha. A validação ocorre antes, e a baixa só é registrada muito mais tarde, depois de etapas fiscais e de etiqueta.

Isso funciona no volume atual, mas é o principal ponto que precisa ser fortalecido antes de usar estoque próprio em escala.

---

# 2. Fluxo atual de uma venda

## 2.1 Entrada do pedido

O pedido chega principalmente pelo fluxo Mercado Livre e é persistido no Vortek.

A sincronização atual mantém:

- pedido;
- itens;
- shipment;
- situação;
- dados fiscais;
- claims/devoluções;
- informações necessárias para fulfillment.

O pedido pode permanecer sem origem definida até a operação decidir como ele será atendido.

---

## 2.2 Escolha da origem de atendimento

O Vortek possui duas origens explícitas:

```text
internal
supplier
```

A escolha é persistida em:

```text
pedidos.fulfillment_source
pedidos.fulfillment_selected_at
```

A função de banco `select_order_fulfillment` bloqueia a linha do pedido com `FOR UPDATE`.

Isso evita que o mesmo pedido seja selecionado simultaneamente para duas origens diferentes.

Também impede:

- selecionar `internal` quando já existe pedido DSLite;
- selecionar `supplier` quando já existe envio interno;
- trocar silenciosamente uma origem já escolhida por outra.

### Avaliação

**Manter.**

É uma proteção importante contra atendimento duplo.

Não é redundância.

---

# 3. Regra atual de estoque interno x fornecedor

A visualização de pedidos calcula se existe estoque interno suficiente para atender o pedido.

A regra atual é simples:

```text
todos os itens do pedido precisam existir
+
todo o volume de cada produto precisa estar disponível internamente
=
pedido pode ser atendido pelo estoque interno
```

Caso contrário, o sistema apresenta fornecedor(es).

### Avaliação

Essa regra de atendimento integral é simples e segura.

Hoje o sistema não tenta dividir automaticamente um pedido entre:

```text
parte estoque interno
+
parte fornecedor
```

Isso reduz muito a complexidade operacional.

**Recomendação atual: preservar essa regra enquanto não houver uma necessidade real de fulfillment misto.**

---

# 4. Fluxo pelo fornecedor / DSLite

O fluxo de fornecedor possui várias etapas porque precisa automatizar uma operação externa real.

Entre as responsabilidades observadas estão:

- identificar produto;
- determinar fornecedor/oferta;
- tratar prioridade de estoque interno quando aplicável;
- selecionar `supplier`;
- evitar duplicidade de processamento;
- confirmar disponibilidade externa;
- trabalhar com alternativas de fornecedor quando necessário;
- processar pedido de compra;
- fiscal;
- transportadora;
- etiqueta;
- persistência dos estados.

### Avaliação

A quantidade de etapas **não deve ser tratada como lixo por padrão**.

Esse fluxo precisa ser auditado posteriormente dentro das áreas:

- Produtos + Fornecedores;
- DSLite;
- Jobs + Sync.

No Item 2, o principal ponto é que o supplier fulfillment possui uma fronteira explícita contra o estoque interno.

---

# 5. Fluxo pelo estoque interno

O fluxo atual de envio interno segue aproximadamente:

```text
operador/sistema escolhe internal
↓
select_order_fulfillment('internal')
↓
valida saldo interno
↓
fluxo fiscal
↓
aguarda/processa etiqueta Mercado Livre
↓
salva etiqueta
↓
registra saida_envio_interno
↓
marca envio_interno_at
↓
sincroniza quantidade do anúncio
```

Esse fluxo é altamente automatizado e deve continuar assim.

O problema não é existirem muitas etapas.

O problema é **em que momento o estoque fica realmente comprometido**.

---

# 6. Modelo atual de estoque interno

A tabela principal é:

```text
estoque_interno_movimentacoes
```

Ela foi criada originalmente com apenas dois tipos:

```text
entrada_devolucao
saida_envio_interno
```

Depois recebeu estados e informações adicionais:

```text
situacao_estoque:
- revisao
- liberado
- nao_aproveitavel

status_devolucao
estornada_em
estorno_motivo
disponivel_venda
```

O saldo atual é derivado das movimentações:

```text
entradas liberadas
-
saídas internas não estornadas
```

Isso é uma base boa porque evita manter um saldo independente desconectado do histórico.

---

# 7. Origem histórica do módulo de estoque

O módulo atual nasceu principalmente para:

```text
devolução
→ conferência
→ liberação
→ reutilização na próxima venda
```

Isso fica evidente porque:

- o tipo de entrada é `entrada_devolucao`;
- os estados são orientados a devolução;
- a tela apresenta revisão, liberados, não aproveitáveis e vendidos;
- entradas manuais também são gravadas como `entrada_devolucao`;
- `status_devolucao='manual'` é usado para distinguir uma entrada manual.

### Problema

Uma entrada manual de estoque não é uma devolução.

Hoje isso funciona tecnicamente, mas mostra que o domínio foi expandido além do conceito original.

### Avaliação

**Não corrigir isoladamente agora.**

Quando o estoque próprio for estruturado, os tipos de movimentação deverão representar os eventos reais sem transformar toda entrada em devolução.

---

# 8. Auditoria e histórico

As saídas de estoque não são apagadas quando um pedido é cancelado.

O sistema grava:

```text
estornada_em
estorno_motivo
```

e a movimentação deixa de consumir saldo.

### Avaliação

**Manter.**

Esse é um comportamento adequado para auditoria.

O histórico explica:

- o que aconteceu;
- quando aconteceu;
- por qual pedido;
- por que foi revertido.

---

# 9. Cancelamentos

A sincronização de pedidos do Mercado Livre identifica cancelamentos e estorna saídas internas ativas.

O estorno é idempotente: apenas movimentações ainda não estornadas são afetadas.

Depois o estoque do produto é sincronizado novamente com o Mercado Livre.

### Avaliação

**Manter.**

É complexidade necessária.

---

# 10. Devoluções

O sistema não considera automaticamente toda devolução como estoque do Vortek.

Ele verifica se o produto realmente está sendo devolvido ao endereço de estoque interno.

Quando elegível:

```text
devolução
↓
entrada_devolucao
↓
revisao
↓
conferência física
↓
liberado OU nao_aproveitavel
```

Só itens `liberado` entram no saldo vendável.

### Avaliação

**Manter.**

Isso protege contra contabilizar como estoque um produto que:

- ainda está em trânsito;
- retornou para outro local;
- voltou danificado;
- ainda não foi conferido.

---

# 11. Estado operacional observado

Foi feita consulta somente leitura no Supabase operacional.

Foram encontrados casos reais de:

- `entrada_devolucao` em revisão;
- devoluções liberadas;
- itens não aproveitáveis;
- entradas manuais;
- `saida_envio_interno`;
- saídas estornadas;
- pedidos atendidos efetivamente por `internal`;
- quantidades maiores que uma unidade.

Também foi consultado:

```text
fulfillment_source = internal
AND envio_interno_at IS NULL
```

No momento da consulta, não havia pedido ativo nessa condição.

Isso mostra que o fluxo atual está funcionando operacionalmente na amostra observada.

**Isso não elimina o risco de concorrência descrito abaixo.**

---

# 12. Principal risco — reserva não atômica

Esse é o achado mais importante do Item 2.

A escolha da origem do pedido é atômica, mas a reserva da quantidade do produto não é.

Hoje:

```text
Pedido A escolhe internal
↓
valida saldo = 1
↓
continua fiscal/etiqueta
↓
...

Pedido B escolhe internal
↓
valida o mesmo saldo = 1
↓
continua fiscal/etiqueta
```

Cada pedido bloqueia apenas a **própria linha de pedido**.

Eles não bloqueiam o mesmo estoque/produto.

A função de validação:

1. consulta saldo;
2. decide que existe quantidade;
3. retorna.

A movimentação de saída só é inserida depois.

Não existe uma única transação envolvendo:

```text
verificar saldo
+
reservar quantidade
```

---

# 13. Por que isso será crítico com estoque próprio

Exemplo:

```text
Saldo interno: 1 unidade

Venda A: 1 unidade
Venda B: 1 unidade
```

Se A e B forem processadas próximas uma da outra, ambas podem observar a mesma unidade disponível antes de qualquer saída ser registrada.

O PostgreSQL oferece locks de linha justamente para serializar operações concorrentes quando necessário.

O Vortek já utiliza `FOR UPDATE` corretamente na escolha da origem do pedido.

Portanto, não é necessário criar fila externa, Redis ou serviço novo.

A própria infraestrutura atual permite resolver esse problema quando chegar a etapa de execução.

---

# 14. Segundo risco — origem internal é selecionada antes da reserva

No fluxo de etiqueta interna, a sequência atual é:

```text
seleciona fulfillment_source = internal
↓
valida estoque
```

Se a validação falhar, a origem já ficou gravada como `internal`.

Além disso, mesmo quando a primeira validação passa, a baixa só acontece depois de várias etapas.

Portanto existe uma janela entre:

```text
pedido comprometido com internal
```

e

```text
estoque realmente comprometido
```

### Consequência possível

Um erro de estoque ou concorrência pode deixar o pedido preso à origem interna mesmo sem quantidade reservada.

A proteção de fulfillment, que é correta, então passa a impedir o caminho fornecedor.

### Estado atual

Na consulta operacional realizada, não havia atualmente pedido `internal` sem `envio_interno_at`.

Ou seja: foi identificado um **risco estrutural**, não um conjunto de pedidos atualmente presos.

---

# 15. Terceiro risco — a chamada “reserva” já é saída

No código atual, funções e variáveis usam o conceito de “reserva”, mas a persistência feita é:

```text
tipo = saida_envio_interno
```

Portanto, conceitualmente:

```text
reserva
```

e

```text
saída
```

não são estados separados.

Isso foi suficiente para o módulo atual, porque estoque interno veio principalmente de devoluções e o processamento era próximo do despacho.

Para estoque próprio em escala, será importante distinguir:

```text
físico
reservado
disponível
despachado
```

sem necessariamente criar várias tabelas.

---

# 16. Estado duplicado a revisar

Existem hoje:

```text
situacao_estoque
disponivel_venda
```

O endpoint de conferência atualiza os dois juntos.

Porém o cálculo de saldo utiliza essencialmente:

```text
situacao_estoque = liberado
```

e não depende do booleano `disponivel_venda`.

Isso cria dois campos representando parcialmente a mesma ideia.

### Avaliação

Não é urgente.

Na futura revisão do modelo, deve existir uma fonte de verdade clara para “vendável”.

---

# 17. Estoque interno + estoque fornecedor

O sistema atual **não soma simplesmente** os estoques.

Para projeção operacional e sincronização do Mercado Livre é usado, em pontos relevantes:

```text
max(estoque_fornecedor, estoque_interno)
```

e não:

```text
estoque_fornecedor + estoque_interno
```

### Regra de negócio confirmada

O pedido não pode ser dividido entre:

```text
estoque interno
+
fornecedor
```

A origem escolhida precisa conseguir atender o pedido integralmente.

Por isso, a soma teórica das quantidades existentes em fontes diferentes **não é automaticamente uma quantidade segura para anunciar**.

Exemplo simples:

```text
estoque interno = 2
fornecedor = 3
total físico entre as fontes = 5
```

Anunciar `5` seria inseguro se nenhuma origem puder atender sozinha uma venda dessa quantidade.

Nesse exemplo, a capacidade segura não pode ultrapassar `3`.

### Quantidade segura anunciável

A regra consolidada é:

**o Vortek deve anunciar somente uma quantidade que possa ser atendida integralmente por uma origem válida.**

Não devemos transformar o exemplo acima em uma fórmula definitiva neste Item 2.

O cálculo final precisa ser definido no **Item 4 — Mercado Livre: Anúncios e Catálogo**, considerando o fluxo real de:

- estoque interno;
- fornecedores e múltiplas ofertas;
- reservas;
- kits;
- sincronização de anúncios;
- regras atuais do Mercado Livre.

### Avaliação

A regra atual de não somar cegamente as fontes está conceitualmente correta.

O cálculo usado hoje deve ser validado no Item 4 para confirmar se continua seguro em todos os cenários reais do Vortek.

---
# 18. Kits

Kits já são um domínio real e ativo no Vortek.

A disponibilidade de kits é derivada de componentes.

Existem muitos kits ativos no banco operacional.

Hoje a lógica de kits usa os estoques dos componentes para recalcular disponibilidade e custo.

Também existe limitação explícita em uma parte do fluxo para kits compostos mais complexos.

### Consequência para estoque próprio

A futura reserva interna precisa definir claramente se:

- um kit possui estoque físico próprio;
- um kit consome estoque dos componentes;
- ambos podem existir.

Isso não deve ser decidido implicitamente pelo código.

---

# 19. Complexidade essencial — não remover

Os seguintes mecanismos foram classificados como **complexidade necessária ou claramente justificada**:

### Fulfillment
- `internal | supplier`;
- bloqueio contra origem dupla;
- persistência da origem escolhida.

### Estoque
- movimentações auditáveis;
- estorno sem apagar histórico;
- revisão física de devolução;
- não aproveitável;
- vínculo com pedido.

### Devoluções
- verificar destino físico real;
- aguardar confirmação antes de liberar para venda.

### Fornecedor
- lógica própria de atendimento;
- confirmação operacional antes de compra;
- tratamento de ofertas/fornecedores.

### Mercado Livre
- sincronização do saldo após mudanças internas;
- shipment/etiqueta como parte do fluxo real de despacho.

### Automação
- execução de várias etapas em sequência.

O objetivo da limpeza não é transformar esses fluxos em operações manuais.

---

# 20. Complexidade acidental / fragilidades confirmadas

## P1 — Reserva de estoque interno não atômica

**Problema real.**

Risco de duas vendas consumirem logicamente a mesma quantidade disponível.

Deve ser prioridade quando for criado o plano de execução desta área.

---

## P1 — Origem internal é gravada antes da reserva efetiva

Pode deixar pedido comprometido com estoque interno sem estoque efetivamente garantido.

Deve ser corrigido junto com a reserva, não com um fallback separado.

---

## P2 — Modelo de movimentação é excessivamente orientado a devoluções

Entrada manual é registrada como devolução.

É dívida de domínio e vai limitar compras/recebimentos futuros.

---

## P2 — Reserva e saída são o mesmo conceito

Adequado ao fluxo atual, insuficiente para estoque próprio em escala.

---

## P2 — `situacao_estoque` e `disponivel_venda` representam estados sobrepostos

Pode gerar divergência futura.

Deve ser simplificado quando o modelo for evoluído.

---

# 21. Modelo mínimo necessário para o futuro

Não é necessário construir um WMS completo.

O Vortek precisa inicialmente controlar apenas conceitos fundamentais:

```text
estoque físico
reserva
disponível para venda
movimentações
```

Eventos mínimos futuros:

```text
entrada por compra/recebimento
entrada por devolução
ajuste positivo
ajuste negativo
reserva por venda
liberação de reserva
saída por despacho
estorno
```

A movimentação deve continuar sendo auditável.

---

# 22. Fluxo desejado conceitualmente

Sem definir implementação ainda:

```text
Venda
↓
resolver produtos/quantidades
↓
verificar disponibilidade
↓
decidir origem
↓
se internal:
    reservar atomicamente
↓
processar fiscal/etiqueta
↓
despachar
↓
converter reserva em saída definitiva
```

Se houver falha antes do despacho:

```text
reserva
↓
liberação
```

Se houver cancelamento após saída:

```text
saída
↓
estorno / fluxo correspondente
```

---

# 23. Compras futuras para estoque próprio

Quando o Vortek começar a comprar produtos para armazenagem própria, não deve simplesmente aumentar um campo de quantidade.

O mínimo necessário será distinguir:

```text
comprado
↓
recebido
↓
conferido
↓
disponível
```

Uma compra não significa automaticamente que a mercadoria existe fisicamente no estoque.

Essa evolução deve usar o mesmo domínio de movimentações, em vez de criar um segundo sistema de estoque paralelo.

---

# 24. O que NÃO construir agora

Não há evidência para criar agora:

- WMS separado;
- múltiplos depósitos;
- prateleiras/endereço físico;
- lote;
- validade;
- número de série;
- picking complexo;
- packing system;
- inventário cíclico sofisticado;
- Redis;
- fila exclusiva para estoque;
- microserviço de estoque.

Esses conceitos só devem existir quando uma necessidade operacional real aparecer.

---

# 25. Decisões de negócio confirmadas

A parte técnica do Item 2 está mapeada e as quatro decisões de negócio foram confirmadas.

## Decisão 1 — Prioridade do estoque interno

Regra definida:

- quando o estoque interno puder atender o pedido integralmente, ele terá prioridade no fluxo automático;
- o operador poderá alterar manualmente a origem e escolher fornecedor;
- a escolha manual de fornecedor só deve ser permitida quando o fluxo `supplier` puder atender o pedido integralmente.

---

## Decisão 2 — Pedido dividido

Regra definida:

```text
pedido inteiro pelo estoque interno
OU
pedido inteiro pelo fluxo de fornecedor
```

Não haverá atendimento misto:

```text
parte interno + parte fornecedor
```

A origem escolhida deve conseguir atender todos os itens e quantidades do pedido conforme as regras do respectivo fluxo.

---

## Decisão 3 — Quantidade anunciada no Mercado Livre

Regra definida:

**não somar cegamente estoque interno + estoque de fornecedor.**

O Vortek deve calcular uma **quantidade segura anunciável**, de forma que uma venda dentro dessa quantidade possa ser atendida integralmente por uma origem válida.

A fórmula exata não é definida neste Item 2.

Ela deve ser investigada e definida no **Item 4 — Mercado Livre: Anúncios e Catálogo**, depois de considerar:

- múltiplos fornecedores;
- estoque interno;
- reservas;
- kits;
- anúncios e catálogo;
- sincronizações de quantidade.

---

## Decisão 4 — Kits no estoque próprio

Regra definida:

**a disponibilidade do kit será calculada pelos componentes.**

O kit não deve criar uma fonte independente de estoque físico desconectada das quantidades dos componentes.

---
# 26. Direção técnica recomendada para o planejamento

Quando chegar a fase de execução, a primeira mudança estrutural desta área deve ser:

**tornar seleção de fulfillment interno + reserva de estoque uma operação coerente e protegida contra concorrência.**

O Vortek já possui:

- PostgreSQL;
- funções RPC;
- `FOR UPDATE`;
- ledger de movimentações;
- origem de fulfillment;
- estornos.

Portanto, a direção mais simples é evoluir esses mecanismos existentes.

Não há justificativa atual para introduzir uma nova infraestrutura.

A segunda dependência registrada por este Item 2 é a **quantidade segura anunciável**.

Ela não deve ser implementada isoladamente aqui. O cálculo deve ser definido no Item 4, depois de mapear completamente o fluxo atual de anúncios, catálogo e sincronização de estoque do Mercado Livre.

---
# 27. Resultado do checklist — Item 2

- [x] Mapear a venda do início ao fim dentro do domínio de fulfillment.
- [x] Mapear decisão `internal` x `supplier`.
- [x] Mapear validação/reserva/saída.
- [x] Mapear cancelamentos e estornos.
- [x] Mapear devoluções e liberação física.
- [x] Entender o modelo atual de estoque interno.
- [x] Consultar estado operacional real do estoque interno.
- [x] Identificar risco de concorrência.
- [x] Identificar riscos de atendimento duplo.
- [x] Registrar necessidades futuras de estoque próprio.
- [x] Considerar kits.
- [x] Separar complexidade essencial de complexidade acidental.
- [x] Confirmar prioridade automática do estoque interno com possibilidade de alteração manual.
- [x] Confirmar que o pedido não será dividido entre `internal` e `supplier`.
- [x] Confirmar necessidade de quantidade segura anunciável.
- [x] Confirmar que kits terão disponibilidade calculada pelos componentes.
- [x] Encerrar as decisões de negócio pendentes do Item 2.

---
# 28. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhuma migration foi executada;
- nenhum dado foi modificado;
- nenhuma regra de negócio foi alterada;
- nenhum deploy foi realizado;
- nenhum teste de código foi executado.

Foram realizadas apenas:

- leitura do repositório `dev`;
- análise das migrations;
- consultas somente leitura no Supabase operacional;
- consulta à documentação oficial relevante.

---

# 29. Fontes principais

## Vortek — branch `dev`

Arquivos principais analisados:

- `AGENTS.md`
- `src/lib/orders/fulfillment-selection.ts`
- `src/lib/estoque-interno.ts`
- `src/lib/estoque-interno-saldo.ts`
- `src/lib/produto-kits.ts`
- `src/app/api/pedidos/route.ts`
- `src/app/api/dslite/pedido/route.ts`
- `src/app/api/dslite/etiqueta-auto/route.ts`
- `src/app/api/sync/pedidos/route.ts`
- `src/app/api/estoque/route.ts`
- `src/app/api/estoque/[movimentoId]/situacao/route.ts`

Migrations principais:

- `20260720010000_estoque_interno.sql`
- `20260720155308_estoque_devolucao_fluxo.sql`
- `20260729213737_estornar_saida_estoque_pedido_cancelado.sql`
- `20260804192052_fix_internal_stock_product_projection.sql`
- `20260812160000_add_order_fulfillment_selection.sql`

Repositório:

`https://github.com/felipe-nomelini/vortek`

## PostgreSQL

Explicit Locking:

`https://www.postgresql.org/docs/17/explicit-locking.html`

## Supabase

Database Functions:

`https://supabase.com/docs/guides/database/functions`

## Mercado Livre

Sincronização de publicações — atualização de estoque (`available_quantity`):

`https://developers.mercadolivre.com.br/pt_br/servico-sincronizacao-de-publicacoes`

A gestão de estoque do Mercado Livre será revisada novamente no Item 4 antes de definir a fórmula de quantidade segura anunciável.

## DSLite

Documentação oficial:

`https://documenter.getpostman.com/view/5316990/RWaRNkaA`

---

# 30. Conclusão final do Item 2

O fluxo atual possui fundamentos bons e não deve ser simplificado de forma agressiva.

O principal risco técnico confirmado continua sendo a falta de uma reserva de estoque interno realmente atômica e separada da saída física.

A evolução futura deve preservar:

- automação;
- fulfillment explícito;
- rastreabilidade;
- devoluções;
- estornos;
- integração com fornecedor;
- integração com Mercado Livre.

E adicionar somente o que está faltando para estoque próprio:

```text
saldo físico confiável
+
reserva atômica
+
disponibilidade
+
movimentação auditável
```

As decisões de negócio deste item estão encerradas:

```text
estoque interno com prioridade automática
+
possibilidade de escolha manual do fornecedor
+
sem divisão entre internal e supplier
+
quantidade segura anunciável
+
kits calculados pelos componentes
```

O **Item 2 está concluído**.

A implementação não começa agora. Os achados serão levados para a consolidação da auditoria e para o plano de execução somente após as demais áreas previstas no checklist.

A fórmula de quantidade segura anunciável fica explicitamente vinculada ao **Item 4 — Mercado Livre: Anúncios e Catálogo**.
