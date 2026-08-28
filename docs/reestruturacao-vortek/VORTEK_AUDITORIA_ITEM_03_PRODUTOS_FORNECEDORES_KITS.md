# Vortek — Auditoria de Limpeza e Organização

## Item 3 — Produtos + Fornecedores + Kits

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** definir a identidade do produto no Vortek, mapear ofertas de fornecedores, custos, SKUs, estoque externo e kits, e separar fontes de verdade reais de projeções/duplicações necessárias antes de qualquer limpeza.

---

## 1. Conclusão executiva

O domínio atual possui uma separação conceitual válida:

```text
produto mestre do Vortek
        ↓
produto_fornecedor_ofertas
        ↓
uma ou mais ofertas externas
```

O produto principal do Vortek é a linha em:

```text
produtos
```

com identidade interna própria e SKU mestre no padrão:

```text
VTK000001
VTK000002
...
```

As ofertas de fornecedores não substituem o produto mestre. Elas representam fontes externas de:

- fornecedor;
- SKU externo;
- custo;
- estoque;
- identificação DSLite;
- disponibilidade.

O suporte a múltiplos fornecedores é real e está em uso operacional.

Os kits também são um domínio real. A estrutura correta já existe:

```text
produto do kit
↓
produto_kit_componentes
↓
produto(s) componente(s) + quantidade
```

O estoque e o custo do kit são derivados dos componentes.

Não foi identificado motivo para criar um segundo cadastro de produto, um segundo sistema de fornecedores ou uma estrutura paralela para kits.

---

# 2. Produto principal do Vortek

A tabela:

```text
produtos
```

é o cadastro mestre interno.

A migration `20260609193758_product_master_vtk_sku.sql` passou a gerar SKUs internos no formato:

```text
VTK + 6 dígitos
```

Também migrou produtos antigos para esse padrão e atualizou referências em anúncios.

### Avaliação

**Manter.**

A identidade interna do produto não deve depender do SKU de um fornecedor.

Isso permite que o mesmo produto continue existindo no Vortek mesmo quando:

- muda de fornecedor;
- ganha fornecedor adicional;
- um fornecedor fica sem estoque;
- um SKU externo muda;
- uma oferta externa é desativada.

---

# 3. Ofertas de fornecedor

A tabela principal é:

```text
produto_fornecedor_ofertas
```

Cada oferta pode manter:

- `produto_id`;
- `dslite_fornecedor_id`;
- `dslite_produto_id`;
- `sku_fornecedor`;
- `sku_oferta`;
- `fornecedor_nome`;
- `custo`;
- `estoque`;
- `ativo`;
- `prioridade`;
- `payment_mode`;
- `lead_time_dias`;
- `last_sync_at`;
- metadados do produto fornecidos pela fonte externa.

### Avaliação

**Manter.**

Essa tabela representa uma relação real de negócio:

```text
um produto Vortek
→ várias fontes externas possíveis
```

Ela não é duplicação desnecessária da tabela `produtos`.

---

# 4. Múltiplos fornecedores

A consulta operacional somente leitura confirmou produtos com duas ou mais ofertas externas.

Foram observados casos com combinações como:

```text
HAYAMAX + BKR1
HAYAMAX + EVOLUSOM
BKR1 + EVOLUSOM + HAYAMAX
```

Cada oferta mantém custo e estoque próprios.

Isso confirma que o Vortek já opera o conceito:

```text
produto mestre único
+
vários fornecedores
```

### Avaliação

**Manter.**

Não consolidar fornecedores diferentes em uma única linha de produto.

---

# 5. Oferta preferencial

A escolha automática é centralizada em:

```text
src/lib/preferred-offer.ts
```

A regra atual prioriza:

1. custo válido;
2. oferta ativa;
3. oferta com estoque;
4. menor custo;
5. prioridade para desempate;
6. maior estoque para desempate posterior.

Existe também suporte a preferência manual.

Quando uma oferta é escolhida manualmente, ela pode permanecer preferencial mesmo temporariamente sem estoque, enquanto continuar ativa e com custo válido.

Se ficar inativa ou inválida, o sistema volta à escolha automática.

### Avaliação

**Manter.**

A regra está isolada e possui testes dedicados.

No momento da consulta operacional realizada para esta auditoria, não foram encontrados produtos com:

```text
fornecedor_preferencial_manual = true
```

Isso não significa que o recurso esteja morto; apenas que não havia preferência manual ativa na amostra operacional consultada.

---

# 6. Snapshot da oferta preferencial em `produtos`

A tabela `produtos` ainda mantém campos como:

```text
custo
estoque
fornecedor
dslite_fornecedor_id
dslite_produto_id
dslite_ultima_sync
oferta_preferencial_id
fornecedor_preferencial_manual
```

Ao mesmo tempo, custo, estoque e identificação externa também existem em:

```text
produto_fornecedor_ofertas
```

À primeira vista isso parece duplicação.

Porém o código atual possui uma função explícita:

```text
syncPreferredProductSnapshot(...)
```

que recalcula os campos do produto a partir da oferta preferencial.

### Interpretação

Hoje existem duas funções diferentes:

```text
produto_fornecedor_ofertas
= fonte das ofertas individuais

produtos.custo / estoque / fornecedor / ids DSLite
= projeção da oferta atualmente preferencial
```

### Avaliação

**Manter por enquanto.**

Não remover esses campos na limpeza apenas por serem duplicados.

Há consumidores atuais que utilizam essa projeção.

O que precisa existir no futuro é uma documentação clara de que esses campos são **derivados**, e não uma segunda fonte independente de verdade.

---

# 7. Risco de divergência do snapshot

Como o produto mantém uma cópia dos dados da oferta preferencial, existe naturalmente o risco de:

```text
oferta atualizada
+
snapshot do produto desatualizado
```

O Vortek já possui mecanismos para detectar e reconciliar isso.

`shouldReconcilePreferredOfferCandidate` verifica divergências como:

- custo;
- estoque;
- fornecedor atual inativo;
- fornecedor atual sem estoque;
- oferta alternativa mais barata com estoque;
- preferência manual.

Existem testes específicos cobrindo essas regras.

### Avaliação

**Complexidade necessária.**

A solução futura não deve criar outro reconciliador paralelo.

Na consolidação, devemos apenas verificar se todos os caminhos de atualização realmente passam pelo mecanismo existente.

---

# 8. Identidade do SKU

Existem diferentes tipos de SKU e eles não devem ser misturados.

## SKU mestre

```text
produtos.sku
```

É o identificador interno do Vortek.

Formato atual:

```text
VTKxxxxxx
```

## SKU externo

Pode aparecer como:

```text
produto_fornecedor_ofertas.sku_fornecedor
produto_fornecedor_ofertas.sku_oferta
dslite_produto_id
```

Esses identificadores pertencem à oferta externa.

### Avaliação

**Manter a separação.**

O SKU externo nunca deve voltar a ser a identidade principal do produto Vortek.

---

# 9. Identidade de uma oferta externa — ponto a revisar

A migration inicial de múltiplos fornecedores criou restrições de identidade para as ofertas.

Porém a consulta operacional atual mostrou pelo menos casos em que o mesmo:

```text
produto_id
+
dslite_fornecedor_id
```

aparece em mais de uma oferta com SKU externo diferente.

Isso indica que o modelo evoluiu depois da migration inicial ou que a identidade atual da oferta é mais específica do que apenas:

```text
produto + fornecedor
```

### Avaliação

**P2 — Investigar mais no Item 10 (Banco de Dados).**

Não classificar essas linhas como duplicadas e não removê-las agora.

Antes de qualquer limpeza será necessário confirmar:

- constraint/index atual;
- migration que alterou a identidade;
- regra operacional para múltiplos SKUs do mesmo fornecedor;
- uso de `dslite_produto_id`, `sku_fornecedor` e `sku_oferta`.

---

# 10. Dados descritivos duplicados

Alguns atributos podem existir tanto em `produtos` quanto em `produto_fornecedor_ofertas`, por exemplo:

- nome;
- descrição;
- marca;
- imagens;
- GTIN;
- NCM;
- CEST.

O loader de ofertas usa dados da própria oferta quando presentes e faz fallback para o produto mestre.

Isso é útil para preservar o dado bruto/específico de cada fornecedor.

Por outro lado, cria uma possível ambiguidade se a aplicação passar a tratar os dois lados como igualmente canônicos.

### Direção conceitual

A separação mais simples é:

```text
produtos
= dado mestre/canônico do Vortek

produto_fornecedor_ofertas
= dado específico recebido daquela oferta externa
```

### Avaliação

**P2 — Consolidar conceito de fonte de verdade no Item 10/12.**

Não apagar colunas agora.

Primeiro precisamos mapear todos os consumidores de cada atributo.

---

# 11. Página/API de ofertas

A API:

```text
/api/produtos/ofertas
```

carrega as ofertas reais de:

```text
produto_fornecedor_ofertas
```

e associa cada uma ao produto mestre.

Ela permite:

- busca por SKU mestre;
- busca por SKU externo;
- filtro de fornecedor;
- filtro de estoque;
- filtro de status Mercado Livre;
- ordenação;
- paginação lógica da resposta;
- cálculo de métricas;
- inclusão do estoque interno como origem de filtro.

### Observação

O loader busca as ofertas em blocos de banco e depois:

```text
filtra
ordena
calcula métricas
pagina
```

em memória.

Isso não é necessariamente problema neste item.

O custo real deve ser medido no Item 13 — Performance antes de qualquer otimização.

---

# 12. Sincronização de fornecedores

A rota administrativa:

```text
/api/fornecedores/sync
```

não implementa uma segunda sincronização.

Ela autentica o usuário e delega para:

```text
/api/sync/fornecedores
```

usando o fluxo operacional existente.

### Avaliação

**Manter.**

É uma fachada administrativa para o mecanismo real, não um fluxo duplicado independente.

A sincronização completa será revisada no Item 7.

---

# 13. Kits — modelo de dados

Os kits usam:

```text
produto_kits
produto_kit_componentes
```

O kit referencia um produto mestre em `produtos`.

Os componentes também são produtos mestres.

Cada componente possui:

```text
componente_produto_id
quantidade
```

A tabela impede:

- quantidade menor ou igual a zero;
- kit contendo a si próprio diretamente.

### Avaliação

**Manter.**

Esse modelo é simples e suficiente para a regra de negócio definida no Item 2.

---

# 14. Estoque e custo dos kits

`recalculateProductKits(...)` calcula:

```text
estoque do kit
=
menor quantidade de kits montáveis entre os componentes
```

Para cada componente:

```text
floor(estoque_componente / quantidade_necessaria)
```

O custo do kit é:

```text
soma(custo_componente × quantidade)
```

Quando estoque ou custo muda, o snapshot do produto do kit é atualizado.

Alterações de estoque também podem gerar atualização dos anúncios Mercado Livre pela outbox já existente.

### Avaliação

**Manter.**

Isso está alinhado com a decisão de negócio do Item 2:

**kit não possui estoque físico independente; sua disponibilidade é derivada dos componentes.**

---

# 15. Estado operacional dos kits

A consulta operacional confirmou grande quantidade de kits ativos.

Na amostra consultada, os componentes estavam modelados explicitamente por:

```text
kit_produto_id
componente_produto_id
quantidade
```

Foram observadas quantidades variadas, incluindo kits com múltiplas unidades do mesmo componente.

Isso confirma que o domínio é operacional e não código histórico.

---

# 16. Limitação do fulfillment de kits

Existe diferença entre:

```text
cálculo de estoque/custo do kit
```

e:

```text
transformação do kit em linha para pedido fiscal/DSLite
```

`recalculateProductKits` suporta vários componentes.

Porém:

```text
resolveSimpleKitOrderPlan(...)
```

só considera pronto para o fluxo fiscal/DSLite um kit que possua exatamente **um componente**.

Quando há vários componentes, retorna:

```text
unsupported_composite
```

### Avaliação

**P2 — Limitação operacional conhecida.**

Não corrigir neste momento apenas para tornar o código mais genérico.

Só deve ser ampliado quando existir necessidade real de vender/fulfillar kits compostos por componentes diferentes nesse fluxo.

---

# 17. `produto_kits.fornecedor_dslite_id` e `sku_origem`

A tabela do kit ainda mantém:

```text
fornecedor_dslite_id
sku_origem
```

Esses campos registram a origem externa do kit.

A composição real, porém, está em:

```text
produto_kit_componentes
```

### Avaliação

**Investigar mais antes de remover.**

Esses campos podem ter função de:

- rastreabilidade;
- importação;
- deduplicação;
- reconciliação com o fornecedor.

Não há evidência suficiente neste item para classificá-los como lixo.

---

# 18. Complexidade necessária — preservar

Devem ser preservados:

### Produto mestre
- `produtos`;
- SKU interno VTK.

### Fornecedores
- `produto_fornecedor_ofertas`;
- múltiplas ofertas por produto;
- custo e estoque por oferta;
- identificação DSLite.

### Preferência
- escolha automática;
- override manual;
- reconciliação do snapshot.

### Kits
- produto de kit como produto mestre;
- componentes explícitos;
- quantidade por componente;
- custo e estoque derivados;
- atualização de anúncio quando disponibilidade muda.

---

# 19. Complexidade acidental / pontos de limpeza confirmados

## P2 — Fonte de verdade dos atributos descritivos precisa ficar explícita

Hoje existem atributos sobrepostos entre produto mestre e oferta externa.

Não é seguro remover nada sem mapear consumidores.

---

## P2 — Identidade atual da oferta precisa ser confirmada no schema final

O estado operacional permite situações que não correspondem à constraint da migration inicial analisada.

A regra atual precisa ser rastreada no Item 10.

---

## P2 — Snapshot preferencial é duplicação necessária, mas precisa ser tratado como derivado

Não pode existir código atualizando `produtos.custo/estoque/fornecedor` independentemente da oferta preferencial sem uma regra explícita.

Esse ponto deve ser conferido nos Itens 7, 10 e 12.

---

## P2 — Fulfillment de kit composto é limitado

O cálculo de disponibilidade é genérico, mas o plano fiscal/DSLite não é.

Não ampliar até existir necessidade operacional.

---

# 20. O que NÃO fazer na limpeza

Não devemos:

- eliminar `produto_fornecedor_ofertas`;
- transformar cada oferta em um produto mestre;
- voltar a usar SKU de fornecedor como SKU principal;
- somar ou fundir estoques de fornecedores dentro de uma única oferta;
- apagar os snapshots de `produtos` sem antes mapear consumidores;
- criar outro sistema de preferência de fornecedor;
- criar outra tabela de composição de kits;
- criar estoque próprio separado para kits;
- generalizar o fulfillment de kits sem necessidade real.

---

# 21. Estado desejado conceitualmente

O domínio deve continuar simples:

```text
PRODUTO MESTRE
produtos
SKU VTK
dados canônicos
        ↓
OFERTAS EXTERNAS
produto_fornecedor_ofertas
fornecedor + SKU externo + custo + estoque
        ↓
OFERTA PREFERENCIAL
automática ou manual
        ↓
SNAPSHOT OPERACIONAL
campos derivados em produtos
```

Para kits:

```text
PRODUTO MESTRE DO KIT
        ↓
COMPONENTES
produto_kit_componentes
        ↓
estoque/custo derivados
```

Nenhum conceito adicional é necessário neste momento.

---

# 22. Resultado do checklist — Item 3

- [x] Definir quem é o produto principal do Vortek.
- [x] Mapear ofertas de fornecedores, custos, SKUs e estoque externo.
- [x] Mapear produtos com vários fornecedores.
- [x] Mapear kits e seus componentes.
- [x] Identificar fontes de verdade duplicadas.
- [x] Separar produto mestre de oferta externa.
- [x] Confirmar o papel do snapshot da oferta preferencial.
- [x] Confirmar que kits calculam custo e estoque pelos componentes.
- [x] Identificar limitação de kits compostos no fulfillment.
- [x] Registrar pontos que dependem do Item 10 — Banco de Dados.
- [x] Separar complexidade necessária de complexidade acidental.

---

# 23. Dependências para itens futuros

## Item 4 — Mercado Livre

Validar como:

- estoque do produto;
- oferta preferencial;
- estoque interno;
- kits;

entram no cálculo da quantidade segura anunciável.

## Item 7 — Jobs + Sync

Confirmar todos os caminhos que atualizam:

- ofertas;
- snapshot preferencial;
- estoque/custo de kits.

## Item 10 — Banco de Dados

Confirmar:

- constraints atuais de `produto_fornecedor_ofertas`;
- identidade final de uma oferta;
- campos duplicados;
- índices;
- RLS;
- evolução das migrations.

## Item 12 — Regras Compartilhadas

Confirmar que preferência de fornecedor, custo, estoque e disponibilidade não são recalculados por regras paralelas.

## Item 13 — Performance

Medir o custo real do carregamento completo das ofertas antes de decidir qualquer otimização.

---

# 24. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhuma migration foi executada;
- nenhum dado foi modificado;
- nenhum deploy foi realizado;
- nenhum teste de código foi executado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise de código e migrations relacionadas;
- consulta somente leitura no Supabase operacional;
- consulta à documentação oficial DSLite.

---

# 25. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Código Vortek — branch `dev`

- `src/lib/preferred-offer.ts`
- `src/lib/produto-fornecedor.ts`
- `src/lib/produto-ofertas.ts`
- `src/lib/produto-kits.ts`
- `src/app/api/produtos/ofertas/route.ts`
- `src/app/api/fornecedores/sync/route.ts`
- `tests/preferred-offer.test.js`
- `tests/ml-virtual-kit-orders.test.js`

## Migrations principais

- `20260608123000_multi_supplier_product_offers.sql`
- `20260609193758_product_master_vtk_sku.sql`
- `20260714193934_kit_inventory.sql`

## DSLite

Documentação oficial:

`https://documenter.getpostman.com/view/5316990/RWaRNkaA`

---

# 26. Conclusão final do Item 3

A arquitetura de produto/fornecedor do Vortek possui uma base correta.

A principal fonte de identidade é:

```text
produtos
+
SKU VTK
```

As ofertas externas são subordinadas ao produto mestre e podem existir em múltiplas fontes.

A duplicação de custo, estoque e fornecedor dentro de `produtos` é atualmente uma **projeção operacional da oferta preferencial**, e não deve ser removida sem mapear todos os consumidores.

Os kits também possuem modelo adequado:

```text
kit
→ componentes
→ custo e estoque derivados
```

Não foi encontrado motivo para reestruturar agressivamente essa área.

Os pontos de limpeza identificados são principalmente de **clareza de fonte de verdade e identidade**, e devem ser consolidados nos Itens 10 e 12.

O **Item 3 está concluído**.
