# Vortek — Auditoria de Limpeza e Organização

## Item 12 — Regras de Negócio Compartilhadas

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Observação:** o P0 de autorização identificado no Item 9 permanece aberto.  
**Objetivo:** localizar cálculos e decisões compartilhadas de preço, lucro, estoque, disponibilidade, fornecedor, status, retry e permissões; identificar regras implementadas em mais de um lugar; e definir qual mecanismo existente deve ser a fonte de verdade de cada regra confirmada, sem criar uma nova camada genérica de regras de negócio.

---

## 1. Conclusão executiva

O Vortek **já possui várias regras de negócio bem centralizadas**.

Exemplos positivos:

```text
fornecedor preferencial
→ src/lib/preferred-offer.ts

snapshot da oferta preferencial
→ src/lib/produto-fornecedor.ts

saldo do estoque interno
→ src/lib/estoque-interno-saldo.ts

composição/custo/estoque de kits
→ src/lib/produto-kits.ts

seleção persistida internal | supplier
→ RPC select_order_fulfillment
→ wrapper src/lib/orders/fulfillment-selection.ts

visões operacionais de pedidos
→ src/lib/orders/operational-view.ts

pricing automático principal
→ src/services/pricing.ts

permissões mobile
→ src/lib/mobile-permissions.ts
```

Essas fontes **não devem ser substituídas por uma nova pasta, framework ou serviço genérico de business rules**.

A dívida está nos pontos onde o crescimento do sistema criou interpretações paralelas.

### Principais achados

**P1 carregado do Item 9**
1. A matriz de permissões é aplicada no mobile, mas a origem web ignora a permissão passada a `authorizeApiRequest`.

**P1/P2**
2. Pricing possui dois contextos fiscais (`5%` e `4%`) no serviço central, enquanto Anúncios e `preco-detalhe` implementam cálculo de lucro de `4%` localmente. O código não documenta de forma suficiente qual contexto pertence a cada operação.
3. A quantidade segura anunciável ainda não possui uma única implementação. Dois fluxos calculam `max(snapshot do fornecedor preferencial, estoque interno)`, mas a regra de negócio definida nos Itens 2/4 é `max(Q_internal, Q_supplier)`, onde `Q_supplier` deve refletir toda capacidade válida do fulfillment supplier.
4. O modo de pagamento do fornecedor possui uma fonte persistida em `oferta.payment_mode`, mas o preview da tela de Pedidos infere apenas pelo ID do fornecedor e pode divergir do fluxo real DSLite.
5. A regra de produto inativo por custo já tem helper central (`> 2000`), mas o pricing automático repete `cost > 2_000` diretamente.
6. Status fiscais possuem normalização central para UI/técnico, mas ainda há aliases e decisões de status final implementados em outros arquivos.
7. Estados/retries de jobs não possuem semântica única. Isso precisa ser organizado por domínio, sem criar um retry genérico para integrações diferentes.
8. O preview de atacado é calculado no cliente, enquanto a publicação real passa pelo backend/serviço Mercado Livre. A regra de preview não deve existir independentemente da regra efetivamente publicada.
9. O tipo TypeScript do ledger de fornecedores não acompanha todos os `movement_type` usados no banco e nas regras atuais.

### Direção principal

A limpeza do Item 12 deve seguir:

```text
regra já centralizada
→ preservar

regra duplicada
→ reutilizar o dono existente

regra sem dono claro
→ consolidar no domínio existente responsável

regra externa
→ backend consulta/obedece contrato oficial

UI
→ apresenta regra
→ não inventa uma segunda fórmula
```

---

# 2. Regra: fornecedor preferencial

A escolha automática está centralizada em:

```text
src/lib/preferred-offer.ts
```

`choosePreferredOffer(...)` considera:

1. custo válido;
2. oferta ativa;
3. estoque disponível;
4. menor custo;
5. prioridade em empate;
6. maior estoque em empate;
7. ID como desempate final.

A preferência manual é tratada por:

```text
resolvePreferredOfferForProduct(...)
```

e prevalece enquanto a oferta continuar ativa e com custo válido.

### Evidência adicional

Existe teste dedicado cobrindo:

- troca por alternativa mais barata;
- preferência manual;
- oferta manual sem estoque;
- fallback quando manual fica inativa;
- custo zero;
- desempates;
- reconciliação de snapshot.

### Avaliação

**Fonte de verdade confirmada.**

```text
preferred-offer.ts
```

deve continuar sendo o dono dessa regra.

Não copiar os critérios para:

- APIs;
- páginas;
- jobs;
- syncs.

---

# 3. Regra: snapshot da oferta preferencial

`src/lib/produto-fornecedor.ts` centraliza:

```text
syncPreferredProductSnapshot(...)
```

A função:

1. carrega produto;
2. carrega ofertas;
3. resolve a oferta preferencial;
4. compara com o snapshot atual;
5. atualiza `produtos` somente quando necessário.

### Avaliação

**Fonte de verdade confirmada para a projeção.**

A regra é:

```text
produto_fornecedor_ofertas
= fonte das ofertas

produtos.custo/estoque/fornecedor/ids DSLite
= snapshot derivado da oferta preferencial
```

Nenhum consumidor deve atualizar esses campos como se fossem uma segunda fonte independente.

---

# 4. Regra: saldo do estoque interno

O cálculo puro está centralizado em:

```text
src/lib/estoque-interno-saldo.ts
```

A regra atual é:

```text
entradas:
tipo = entrada_devolucao
situacao_estoque = liberado

menos

saídas:
tipo = saida_envio_interno
estornada_em = null
```

### Avaliação

**Fonte de verdade atual confirmada.**

O problema futuro de reserva atômica identificado no Item 2 não exige uma segunda regra de saldo.

Quando o modelo de movimentações evoluir, essa mesma fonte deve evoluir junto.

---

# 5. Regra: composição e disponibilidade de kits

`src/lib/produto-kits.ts` é o dono atual de:

```text
kit → componentes
estoque do kit
custo do kit
```

A disponibilidade é derivada dos componentes.

### Regra de negócio confirmada no Item 2

```text
kit não possui estoque físico independente
```

### Avaliação

**Fonte de verdade confirmada.**

Não recalcular kit em:

- páginas;
- API de anúncio;
- sync de estoque;
- fulfillment;

com fórmula paralela.

---

# 6. Regra: escolha persistida da origem do fulfillment

A persistência de:

```text
internal
supplier
```

passa por:

```text
select_order_fulfillment
```

e o wrapper:

```text
src/lib/orders/fulfillment-selection.ts
```

### Avaliação

**Fonte de verdade confirmada para a seleção persistida.**

Essa regra resolve:

- conflito de origem;
- seleção única;
- concorrência na linha do pedido.

Ela não resolve sozinha:

```text
a origem consegue atender?
```

Esse é outro conceito e hoje ainda possui lógica distribuída.

---

# 7. P2 — disponibilidade de fulfillment está distribuída

O preview de `/api/pedidos` calcula se o estoque interno cobre o pedido inteiro:

```text
todos os itens resolvidos
+
saldo interno >= quantidade de cada produto
```

Quando cobre:

```text
internal_stock_available = true
```

Já a execução interna valida novamente por:

```text
validarEstoqueEnvioInterno(...)
```

no domínio de estoque.

O supplier, por sua vez, resolve ofertas e disponibilidade no fluxo DSLite.

### Problema

Existem três perguntas relacionadas, mas sem um contrato explícito compartilhado:

```text
internal consegue atender o pedido?
supplier consegue atender o pedido?
qual origem deve aparecer/ser sugerida?
```

### Avaliação

**P2 — consolidar a regra de capacidade, não a persistência.**

Não criar um “fulfillment engine”.

A direção mais simples é ter funções de domínio pequenas e explícitas para capacidade:

```text
capacidade internal
capacidade supplier
```

reutilizadas por:

- preview;
- quantidade segura;
- validação antes da seleção.

A seleção persistida continua na RPC existente.

---

# 8. Regra de negócio confirmada: pedido não pode ser dividido

O Item 2 definiu:

```text
pedido inteiro por internal
OU
pedido inteiro por supplier
```

Nunca:

```text
parte internal + parte supplier
```

### Consequência

Essa regra precisa ser respeitada por:

- preview;
- fulfillment;
- quantidade anunciável;
- kits.

### Avaliação

**Regra confirmada, mas implementação ainda distribuída.**

Ela deve ser representada pela mesma função de capacidade usada nos fluxos envolvidos.

---

# 9. P2 — quantidade segura anunciável não possui fonte única

A regra consolidada no Item 4 é:

```text
Q_segura = max(Q_internal, Q_supplier)
```

onde:

```text
Q_internal
=
capacidade realmente disponível e não reservada

Q_supplier
=
capacidade que o fulfillment supplier consegue assumir
com ofertas válidas
```

### Implementação atual encontrada

Em:

```text
src/lib/estoque-interno.ts
```

o Vortek calcula:

```text
Math.max(produto.estoque, saldoInterno)
```

Em:

```text
/api/sync/preco-estoque
```

faz novamente:

```text
Math.max(snapshot.next.estoque, estoqueInterno)
```

### Problema

`produto.estoque` / `snapshot.next.estoque` representa:

```text
estoque da oferta preferencial
```

e não necessariamente:

```text
maior capacidade válida de supplier
```

Exemplo conceitual:

```text
interno = 2
preferencial = 3
outra oferta válida = 8
```

A regra atual publica:

```text
3
```

enquanto a capacidade supplier pode ser:

```text
8
```

### Impacto

O risco mais evidente é:

```text
subutilização de estoque
```

A segurança de overselling depende ainda da reserva interna atômica do Item 2 e da atualização externa.

### Avaliação

**P2 importante — criar uma única regra de disponibilidade publicável.**

Não somar fornecedores entre si quando uma única origem precisa atender.

---

# 10. Mercado Livre — a publicação física do estoque já está centralizada

Depois que `desiredQuantity` chega à outbox, a escrita real passa por:

```text
src/lib/ml/stock-publish.ts
```

e o worker detecta:

```text
estoque tradicional
ou
User Products / warehouse
```

### Documentação oficial atual

Para contas com `warehouse_management`, o Mercado Livre exige atualização via User Products/depósito e não por `available_quantity` em `/items`.

### Avaliação

**Manter essa centralização.**

O problema do Item 12 não está em:

```text
como publicar no ML
```

Está em:

```text
qual quantidade o Vortek decidiu publicar
```

Esses conceitos não devem ser misturados.

---

# 11. P2 — pricing possui dois contextos sem contrato explícito suficiente

O serviço central:

```text
src/services/pricing.ts
```

possui:

```text
TAX_RATE = 5%
TARGET_NET_PROFIT_TAX_RATE = 4%
```

As funções gerais:

```text
calculateBreakEvenPrice
calculateNetProfitAtPrice
calculateExactMarginPrice
calculateSuggestedPrice
```

usam o imposto padrão de:

```text
5%
```

`calculateTargetNetProfitPrice(...)` usa por padrão:

```text
4%
```

### Ao mesmo tempo

A página:

```text
Anúncios
```

reimplementa lucro diretamente com:

```text
4%
```

e:

```text
/api/ml/anuncio/preco-detalhe
```

repete a mesma fórmula local de:

```text
4%
```

### Conclusão suportada pelas fontes

O código **não permite afirmar com segurança** que 4% ou 5% está globalmente errado.

Ele mostra que existem dois contextos e que a fronteira entre eles não está suficientemente explícita.

### Avaliação

**P2 — fonte de verdade ambígua.**

A futura correção deve:

1. definir semanticamente os dois contextos;
2. manter as taxas dentro de `pricing.ts`;
3. fazer API e UI chamarem a função correta;
4. eliminar fórmulas locais.

Nenhuma taxa deve ser alterada sem confirmação da regra de negócio/fiscal aplicável.

---

# 12. Pricing automático — ponto positivo

A automação:

```text
src/lib/ml/automatic-pricing.ts
```

já chama:

```text
calculateSuggestedPrice(...)
```

do serviço central.

### Avaliação

**Manter.**

Esse é o padrão correto:

```text
evento de custo
↓
pricing central
↓
outbox
↓
Mercado Livre
```

---

# 13. P2 — regra de produto inativo por custo está parcialmente duplicada

Existe helper central:

```text
src/lib/product-activity.ts
```

com:

```text
PRODUCT_COST_INACTIVE_THRESHOLD = 2000
shouldProductBeInactiveByCost(...)
```

O sync DSLite usa esse helper.

Porém `automatic-pricing.ts` repete:

```text
cost > 2_000
```

diretamente.

### Avaliação

**P2 — duplicação simples e confirmada.**

A regra deve permanecer em:

```text
product-activity.ts
```

e o pricing automático deve reutilizá-la.

Não criar outra constante.

---

# 14. P2 — modo de pagamento do fornecedor possui duas fontes

O domínio de ofertas persiste:

```text
produto_fornecedor_ofertas.payment_mode
```

O fluxo real DSLite usa:

```text
normalizeSupplierPaymentMode(
  selectedOffer.offer.payment_mode,
  fornecedorId
)
```

ou seja:

```text
valor persistido da oferta
→ prioridade

inferência pelo fornecedor
→ fallback
```

### Porém o preview de Pedidos

Depois de escolher a oferta, ele calcula:

```text
inferSupplierPaymentMode(first.fornecedorId)
```

e não usa:

```text
preferredOffer.payment_mode
```

### Consequência

Se uma oferta possuir modo explícito diferente da inferência padrão:

```text
preview da tela
≠
execução DSLite
```

Isso pode afetar:

- label da próxima ação;
- expectativa de pagamento;
- UX operacional.

### Avaliação

**P2 — fonte de verdade confirmada.**

A regra correta já existe no fluxo DSLite:

```text
payment_mode persistido
+
inferência apenas como fallback
```

O preview deve reutilizar a mesma resolução.

---

# 15. Regra: fornecedor permitido para dropshipping

Existe uma fonte central:

```text
src/lib/dslite/supplier-policy.ts
```

com:

- IDs bloqueados;
- filtro de fornecedores permitidos;
- seleção em colisão de SKU.

### Avaliação

**Fonte de verdade confirmada.**

Não duplicar lista de fornecedor bloqueado em rotas.

---

# 16. P2 — preview de atacado é fórmula independente no cliente

A página Anúncios monta:

```text
3 unidades  → 3% de desconto
5 unidades  → 4%
10 unidades → 5%
```

diretamente no browser.

A rota:

```text
/api/ml/anuncio/aplicar-atacado
```

não recebe as faixas.

Ela recebe apenas:

```text
basePrice
```

e delega a publicação real ao worker/serviço Mercado Livre.

### Problema

A UI possui uma regra de preview que pode divergir da regra efetivamente publicada.

### Mudança externa já conhecida

A documentação atual do Mercado Livre informa que, a partir de:

```text
26/10/2026
```

o modelo absoluto atual de Preços por Quantidade será substituído, para esse uso, pelo modelo percentual B2B e exige consulta de recomendações/versão na escrita.

### Avaliação

**P2 compartilhado + P1 de prazo já registrado no Item 4.**

A regra de faixas/descontos deve ter **um único dono no backend**, junto ao fluxo real de quantity pricing.

A UI deve apenas exibir o resultado dessa regra.

---

# 17. Regra: status operacional de pedidos

Existe um domínio compartilhado:

```text
src/lib/orders/operational-view.ts
```

com:

- statuses de preparação;
- statuses de envio;
- pós-despacho;
- urgência;
- atraso;
- labels/condições operacionais.

### Avaliação

**Fonte de verdade confirmada para as views operacionais.**

Novas telas/filtros de pedido devem reutilizar esse domínio quando tratarem do mesmo conceito.

---

# 18. P2 — status fiscal ainda possui normalização distribuída

Existe:

```text
src/lib/fiscal/nfe-status.ts
```

que normaliza aliases como:

```text
authorized / autorizada
cancelled / canceled / cancelada
rejected / rejeitada / denegada
processing / processando
```

Ao mesmo tempo:

```text
nfe-local-reconciliation.ts
```

possui sua própria checagem de estados finais externos.

### Avaliação

**P2 — consolidar semântica fiscal.**

Não significa transformar todo retorno externo imediatamente para português.

A regra deve distinguir claramente:

```text
status bruto externo
status técnico normalizado
status persistido canônico
```

Hoje essas três camadas ainda se sobrepõem.

---

# 19. Regra: estado observado do Mercado Livre

O worker utiliza:

```text
mapMlStatusToLocalStatus(...)
```

para reconciliar o estado remoto.

### Avaliação

**Manter.**

Não fazer páginas criarem sua própria tradução de:

```text
active
paused
closed
under_review
```

para estados locais de negócio.

---

# 20. P2 — elegibilidade de publicação ML aparece tarde demais

O worker de outbox classifica inline erros como:

```text
conflito
estado não publicável
autorização permanente
retry
hard fail
```

Isso é útil para recuperação.

Porém o Item 4 mostrou que alguns anúncios:

```text
under_review
closed
inactive
```

voltam a ser enfileirados por automações e só são bloqueados/cancelados no final.

### Avaliação

**P2 — compartilhar a regra dentro do domínio ML.**

Não criar um classificador genérico para todas as integrações.

A mesma regra Mercado Livre de:

```text
anúncio modificável?
erro transitório?
erro terminal?
```

deve ser reutilizada por:

- enqueue/automação;
- worker;
- reconciliação.

---

# 21. Retry não deve virar uma regra genérica global

O Vortek integra sistemas com contratos diferentes:

- Mercado Livre;
- Brasil NFe;
- DSLite;
- Mercado Pago;
- WAHA.

Um:

```text
404
```

ou:

```text
409
```

não significa a mesma coisa em todas as APIs.

### Avaliação

**Não criar `retry.ts` global com regras universais.**

O princípio compartilhado deve ser:

```text
cada domínio classifica:
transitório
terminal
reprocessável

o scheduler apenas executa essa decisão
```

Isso resolve os P1 já encontrados em:

- Brasil NFe `not_found`;
- Mercado Pago lifecycle;
- Mercado Livre item não modificável;

sem criar abstração incorreta.

---

# 22. P1 — permissões possuem fonte única apenas no mobile

A matriz:

```text
src/lib/mobile-permissions.ts
```

define claramente:

```text
admin
gerente
operador
visualizador
```

e suas permissões.

Os testes confirmam, por exemplo:

```text
operador:
pode operar DSLite
não pode confirmar pagamento

visualizador:
somente leitura
```

### Problema

`authorizeApiRequest(...)` aplica a permissão somente quando a origem é:

```text
mobile/Bearer
```

Na origem:

```text
web/cookie
```

ele valida apenas autenticação.

### Avaliação

**P1 já confirmado no Item 9.**

A matriz existente deve deixar de ser “mobile permissions” conceitualmente e virar:

```text
permissões do Vortek
```

usada por ambas as origens.

### Importante

Não criar:

```text
WEB_PERMISSIONS
```

em paralelo.

---

# 23. P2 — cargo ainda não é uma fonte confiável enquanto P0 estiver aberto

Mesmo com matriz de permissões correta:

```text
cargo
→ permissões
```

não é seguro enquanto o usuário puder controlar o próprio `cargo`.

### Avaliação

O P0 do Item 9 precisa ser corrigido antes de a consolidação de autorização ser considerada efetiva.

A ordem futura deve ser:

```text
1. proteger cargo
2. unificar permission check
3. fazer UI refletir permissions
```

---

# 24. P2 — tipos do ledger financeiro não representam a regra real completa

`src/lib/supplier-balance.ts` declara:

```text
topup
purchase_debit
adjustment
```

mas o domínio também usa:

```text
cancellation_credit
credit_usage
manual_credit
```

### Avaliação

**P2 — contrato compartilhado desatualizado.**

A fonte deve acompanhar o domínio real aceito pelo banco.

Não resolver com casts espalhados.

---

# 25. Regra: crédito de cancelamento

`src/lib/supplier-credits.ts` centraliza:

```text
pedido cancelado
+
compra existente
+
fornecedor não Hayamax
+
prepaid_pix
+
pagamento paid
+
valor positivo
→ cancellation_credit pending
```

Possui chave idempotente.

### Avaliação

**Fonte de verdade confirmada.**

Webhook e sync devem chamar essa função, não reimplementar a regra.

---

# 26. Regra: débito de compra Hayamax

`src/lib/supplier-balance.ts` centraliza o débito de compra por:

```text
movement_key = purchase:{dsid}
```

### Avaliação

**Fonte de verdade confirmada.**

Não recalcular débito em outros fluxos.

---

# 27. Regras de negócio que já devem permanecer compartilhadas

## Manter sem nova abstração

```text
preferred-offer.ts
produto-fornecedor.ts
produto-kits.ts
estoque-interno-saldo.ts
orders/fulfillment-selection.ts
orders/operational-view.ts
product-activity.ts
supplier-credits.ts
supplier-balance.ts
dslite/supplier-policy.ts
pricing.ts
mobile-permissions.ts  -- após deixar de ser mobile-only conceitualmente
```

### Observação

“Manter” não significa que nenhum arquivo precisará ajuste.

Significa que **esses domínios já possuem o lugar certo para a regra**.

---

# 28. Regras que precisam ser consolidadas

## P1/P2

### Pricing/lucro
Dono futuro:

```text
services/pricing.ts
```

Eliminar fórmulas locais equivalentes.

### Quantidade segura
Dono futuro:

```text
domínio de disponibilidade/estoque já existente
```

Deve ser uma única função reutilizada por syncs/publicação/preview.

O arquivo exato será decidido no plano para evitar criar camada desnecessária.

### Permissões
Dono futuro:

```text
uma matriz Vortek compartilhada
```

a partir da matriz mobile existente.

### Modo de pagamento
Dono futuro:

```text
oferta.payment_mode
+
inferência compartilhada como fallback
```

### Elegibilidade/retry ML
Dono futuro:

```text
domínio Mercado Livre
```

compartilhado entre enqueue e worker.

### Status fiscal
Dono futuro:

```text
domínio fiscal existente
```

com uma representação técnica canônica.

### Quantity pricing
Dono futuro:

```text
backend/serviço Mercado Livre
```

e UI apenas recebe o preview da mesma regra.

---

# 29. Fontes de verdade consolidadas

| Regra | Fonte atual/desejada |
|---|---|
| Oferta preferencial | `src/lib/preferred-offer.ts` |
| Snapshot preferencial | `src/lib/produto-fornecedor.ts` |
| Saldo interno | `src/lib/estoque-interno-saldo.ts` |
| Kit | `src/lib/produto-kits.ts` |
| Seleção persistida fulfillment | RPC `select_order_fulfillment` + wrapper |
| Capacidade fulfillment | consolidar em regra compartilhada do domínio |
| Quantidade segura ML | consolidar a partir das capacidades internal/supplier |
| Pricing principal | `src/services/pricing.ts` |
| Produto inativo por custo | `src/lib/product-activity.ts` |
| Política dropshipping fornecedor | `src/lib/dslite/supplier-policy.ts` |
| Modo pagamento fornecedor | `offer.payment_mode` + fallback compartilhado |
| Crédito por cancelamento | `src/lib/supplier-credits.ts` |
| Débito Hayamax | `src/lib/supplier-balance.ts` |
| View operacional de pedidos | `src/lib/orders/operational-view.ts` |
| Status ML local | `src/lib/ml/status.ts` |
| Status técnico NF-e | consolidar `src/lib/fiscal/nfe-status.ts` + reconciliação |
| Permissões | evoluir matriz atual para web + mobile |
| Retry ML | domínio ML |
| Retry fiscal/financeiro | respectivo domínio, não regra global |

---

# 30. Priorização dos achados do Item 12

## P1 — autorização compartilhada

Permissão existe, mas não é aplicada no web.

Carregado do Item 9.

---

## P1 de prazo — quantity pricing Mercado Livre

A regra de atacado precisa ser centralizada junto com a migração oficial anterior a:

```text
26/10/2026
```

Carregado do Item 4.

---

## P2 — pricing 4% x 5%

A semântica dos contextos precisa ser explicitada antes de remover duplicação.

---

## P2 — quantidade segura sem única implementação

Atual usa estoque da oferta preferencial, não capacidade supplier completa.

---

## P2 — capacidade de fulfillment distribuída

Preview e execução avaliam disponibilidade por caminhos distintos.

---

## P2 — modo de pagamento divergente no preview

UI/API de preview infere; execução respeita `payment_mode`.

---

## P2 — threshold de custo duplicado

Helper existe, mas pricing automático repete `2_000`.

---

## P2 — status fiscal distribuído

Aliases/finalidade ainda são interpretados por mais de um mecanismo.

---

## P2 — elegibilidade ML e retry separados entre producer/consumer

Anúncio impossível ainda pode entrar na outbox.

---

## P2 — movement types financeiros incompletos no TypeScript

Contrato não acompanha banco/regra atual.

---

# 31. O que NÃO centralizar

Não devemos criar uma função compartilhada única para conceitos que só parecem semelhantes.

## Não unificar

```text
retry Mercado Livre
retry Brasil NFe
retry Mercado Pago
retry DSLite
```

porque os contratos externos são diferentes.

## Não unificar

```text
status de pedido
status de NF-e
status de job
status de anúncio
```

em um enum genérico.

## Não criar

```text
BusinessRulesService
RulesEngine
DomainManager
AvailabilityEngine
PricingEngine
```

sem necessidade.

### Princípio

Compartilhar **a regra real repetida**, não palavras parecidas.

---

# 32. Estado desejado conceitualmente

A arquitetura de regras deve continuar simples:

```text
DOMÍNIO
↓
uma implementação da decisão
↓
API / job / webhook / UI reutilizam
```

Exemplo:

```text
ofertas
↓
resolvePreferredOfferForProduct
↓
produto
pedidos
DSLite
sync
```

Exemplo desejado de estoque:

```text
ofertas + estoque interno + reservas
↓
capacidade internal / supplier
↓
Q segura
↓
outbox ML
```

Exemplo desejado de autorização:

```text
profiles.cargo
↓
permission matrix
↓
cookie web
Bearer mobile
↓
mesma decisão
```

---

# 33. O que NÃO fazer agora

Não devemos:

- criar nova pasta genérica de regras;
- criar framework de domínio;
- mover toda função para `services`;
- transformar todo status em um enum global;
- unificar retries de provedores diferentes;
- alterar 4%/5% sem confirmação do significado;
- implementar Q segura em vários lugares;
- duplicar matriz web/mobile;
- criar outra fonte de payment mode;
- refatorar todos os arquivos apenas para trocar imports;
- executar as correções durante esta auditoria.

---

# 34. Dependências para Item 13 — Performance

Medir impacto das regras duplicadas, principalmente:

- publicações de estoque desnecessárias;
- reenfileiramento ML;
- cálculos repetidos;
- chamadas de preview/fulfillment;
- retries por regra terminal incorreta.

Performance deve remover trabalho desnecessário depois da fonte correta estar definida.

---

# 35. Dependências para Item 14 — Testes

As regras compartilhadas críticas precisam de testes em sua fonte única.

Prioridades:

```text
preferred offer
Q segura
capacidade internal
capacidade supplier
pricing por contexto
payment mode
product inactivity threshold
permissions web/mobile
status NF-e
retry terminal/transitório ML
```

Não duplicar o mesmo teste em UI e backend se ambos usam a mesma função.

---

# 36. Dependências para Item 15 — Históricos

Depois de consolidar writers/readers, o Item 15 poderá remover:

- helpers antigos;
- aliases sem consumidores;
- implementações locais substituídas;
- compatibilidades de regra sem uso.

Não remover antes de confirmar que a regra compartilhada cobre todos os consumidores.

---

# 37. Resultado do checklist — Item 12

- [x] Localizar cálculos de preço e lucro.
- [x] Localizar regras de estoque e disponibilidade.
- [x] Localizar regras de fornecedor preferencial.
- [x] Localizar regras de kits.
- [x] Localizar regras de fulfillment.
- [x] Localizar regras de status operacional.
- [x] Localizar regras fiscais de status.
- [x] Localizar regras de permissões.
- [x] Localizar regras de pagamentos/créditos de fornecedores.
- [x] Encontrar regras implementadas em mais de um lugar.
- [x] Confirmar fornecedor preferencial como regra já centralizada.
- [x] Confirmar saldo interno como regra já centralizada.
- [x] Confirmar kits como regra já centralizada.
- [x] Confirmar seleção persistida de fulfillment como regra já centralizada.
- [x] Identificar pricing 4%/5% com semântica duplicada/ambígua.
- [x] Identificar quantidade segura sem implementação única.
- [x] Identificar capacidade de fulfillment distribuída.
- [x] Identificar payment mode divergente entre preview e execução.
- [x] Identificar threshold de custo duplicado no pricing automático.
- [x] Identificar status fiscal com normalização distribuída.
- [x] Identificar elegibilidade/retry ML compartilhável dentro do domínio ML.
- [x] Confirmar permissions mobile como base que deve servir web + mobile.
- [x] Identificar tipos financeiros compartilhados desatualizados.
- [x] Definir a fonte de verdade desejada para cada regra confirmada.
- [x] Separar regras realmente compartilháveis de conceitos que não devem ser generalizados.

---

# 38. Restrições desta etapa

Nesta etapa:

- nenhum cálculo foi alterado;
- nenhuma taxa foi alterada;
- nenhuma regra de estoque foi modificada;
- nenhuma regra de fulfillment foi modificada;
- nenhuma permissão foi modificada;
- nenhum status foi migrado;
- nenhum retry foi alterado;
- nenhuma API foi alterada;
- nenhum código foi refatorado;
- nenhum teste foi executado;
- nenhum deploy foi realizado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- comparação entre rotas, serviços, libs e UI diretamente relacionados;
- análise dos testes existentes encontrados;
- consulta à documentação oficial atual do Mercado Livre para estoque e Preços por Quantidade;
- consolidação dos achados dos Itens 2 a 11.

---

# 39. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`
- `docs/mercado-livre-publicacao-operacional.md`

## Código Vortek — branch `dev`

Arquivos principais analisados:

- `src/services/pricing.ts`
- `src/lib/preferred-offer.ts`
- `src/lib/produto-fornecedor.ts`
- `src/lib/produto-kits.ts`
- `src/lib/estoque-interno.ts`
- `src/lib/estoque-interno-saldo.ts`
- `src/lib/product-activity.ts`
- `src/lib/dslite/supplier-policy.ts`
- `src/lib/orders/fulfillment-selection.ts`
- `src/lib/orders/operational-view.ts`
- `src/lib/fiscal/nfe-status.ts`
- `src/lib/fiscal/nfe-local-reconciliation.ts`
- `src/lib/ml/automatic-pricing.ts`
- `src/lib/ml/stock-publish.ts`
- `src/lib/mobile-permissions.ts`
- `src/lib/api-request-auth.ts`
- `src/lib/supplier-balance.ts`
- `src/lib/supplier-credits.ts`
- `src/app/api/pedidos/route.ts`
- `src/app/api/dslite/pedido/route.ts`
- `src/app/api/sync/preco-estoque/route.ts`
- `src/app/api/sync/anuncios/publish/route.ts`
- `src/app/api/ml/anuncio/preco-detalhe/route.ts`
- `src/app/api/ml/anuncio/aplicar-atacado/route.ts`
- `src/app/(app)/anuncios/page.tsx`

## Testes

- `tests/preferred-offer.test.js`
- `tests/mobile-permissions.test.js`
- demais testes relacionados serão inventariados formalmente no Item 14.

## Mercado Livre — documentação oficial

Gestão de estoque multiorigem / User Products:

`https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/gestao-de-estoque-multiorigem-user-products`

Estoque multi-origem:

`https://developers.mercadolivre.com.br/pt_br/estoque-multi-origem`

Preços por quantidade % B2B:

`https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b`

---

# 40. Conclusão final do Item 12

O Vortek **não sofre de ausência generalizada de regras compartilhadas**.

Várias áreas importantes já possuem uma fonte correta.

O problema é que, conforme o sistema cresceu, alguns consumidores passaram a reimplementar parte dessas decisões ou criaram uma segunda interpretação.

A limpeza futura deve seguir uma regra simples:

```text
se já existe dono
→ reutilizar

se existem duas fórmulas
→ definir semântica
→ manter uma

se não existe dono
→ colocar no domínio que já é responsável
→ não criar camada nova
```

Os três pontos mais importantes para consolidação são:

```text
1. autorização web + mobile
2. quantidade segura / capacidade de fulfillment
3. pricing por contexto
```

Depois deles:

```text
payment mode
status fiscal
eligibilidade ML
threshold de produto
tipos financeiros
```

O **Item 12 está concluído**.

O P0 do Item 9 continua pendente e permanece prioritário antes do futuro checklist de execução.
