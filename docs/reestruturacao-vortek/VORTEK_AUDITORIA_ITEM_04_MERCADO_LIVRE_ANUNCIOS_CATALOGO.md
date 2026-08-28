# Vortek — Auditoria de Limpeza e Organização

## Item 4 — Mercado Livre: Anúncios e Catálogo

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** mapear criação, importação, preço, estoque, status, catálogo, Buy Box, bloqueios, retries, outbox e reconciliações do Mercado Livre; comparar os fluxos com a documentação oficial atual; e definir a regra conceitual da quantidade segura anunciável antes de qualquer limpeza ou alteração.

---

## 1. Conclusão executiva

A integração Mercado Livre do Vortek possui uma base operacional mais organizada do que a quantidade de rotas e mecanismos sugere à primeira vista.

O núcleo correto é:

```text
estado interno / regra de negócio
        ↓
anuncios_ml_outbox
        ↓
worker de publicação
        ↓
Mercado Livre
        ↓
verificação
        ↓
reconciliação local
```

Também existe um fluxo separado para observar o estado real do marketplace:

```text
Mercado Livre
        ↓
sync de anúncios
        ↓
anuncios_ml / snapshots
        ↓
reconciliação
```

Essa separação entre:

```text
estado desejado
e
estado observado
```

é importante e deve ser preservada.

A outbox é ativa no banco operacional e recebe mudanças reais de:

- estoque de fornecedor;
- estoque interno;
- kits;
- preço.

O catálogo também é operacional: há snapshots recentes de milhares de anúncios com estados de competição e `price_to_win`.

Os principais pontos encontrados nesta auditoria são:

1. **P1 — adaptação obrigatória de Preços por Quantidade antes de 26/10/2026.**
2. **P2 — anúncios não modificáveis são cancelados corretamente, mas alguns voltam a ser enfileirados repetidamente.**
3. **P2 — o cálculo atual de estoque publicável usa principalmente a oferta preferencial + estoque interno e não representa toda a capacidade segura possível do fluxo supplier.**
4. **P2 — o Vortek precisa manter explícita a diferença entre kits locais e Kits Virtuais nativos do Mercado Livre.**
5. **P2 — atualização de preço deve considerar a Automação de Preços nativa do Mercado Livre antes de enviar `price`.**
6. **Investigar — ainda existem helpers antigos de estoque direto em `mercadolivre.ts`; não devem ser removidos até confirmar todos os chamadores no Item 7/15.**

Não foi identificado P0 nesta área.

---

# 2. Fontes de verdade do domínio Mercado Livre

Existem várias tabelas e campos relacionados ao Mercado Livre, mas eles possuem papéis diferentes.

## `anuncios_ml`

É o espelho operacional local do anúncio.

Mantém informações como:

- `ml_item_id`;
- produto;
- SKU;
- título;
- preço;
- status;
- catálogo;
- métricas;
- bloqueios de sincronização;
- erro de sincronização.

### Papel

```text
estado operacional local observado/conhecido do anúncio
```

---

## `anuncios_ml_outbox`

Representa mudanças que o Vortek deseja publicar no Mercado Livre.

Pode carregar:

- preço desejado;
- quantidade desejada;
- status desejado;
- flags de aplicação;
- tentativas;
- erro;
- momento disponível para retry;
- processamento.

### Papel

```text
intenção de mudança pendente
```

---

## `catalogo_ml_snapshot`

Representa o estado observado do anúncio no catálogo e na competição.

Mantém:

- preço;
- `price_to_win`;
- estado de competição;
- se está ganhando;
- vínculo de catálogo;
- produto relacionado;
- sincronização.

### Papel

```text
snapshot de catálogo / Buy Box
```

---

## `produtos`

Mantém vínculos operacionais derivados, como `ml_item_id` e `ml_status`.

Esses campos não devem se tornar uma segunda fonte independente do estado real do anúncio.

### Avaliação

**Manter as estruturas atuais.**

A limpeza futura deve documentar melhor os papéis, não fundir tabelas que representam estados diferentes.

---

# 3. Criação de anúncios

A criação passa pelo serviço Mercado Livre.

O payload atual contempla, conforme o anúncio:

- categoria;
- preço;
- moeda;
- quantidade;
- condição;
- tipo de anúncio;
- atributos;
- imagens;
- SKU;
- termos de venda;
- envio;
- `family_name` / título.

A publicação é feita através do recurso oficial de itens.

### Avaliação

**Manter a centralização do cliente Mercado Livre.**

Não há motivo para criar outro serviço de publicação.

### User Products

O Mercado Livre está migrando progressivamente vendedores para o modelo User Products.

Nesse modelo:

- `user_product_id` passa a existir;
- itens antigos e novos podem coexistir;
- certas informações passam a pertencer ao User Product/família;
- o título deixa de ser livre em alguns fluxos;
- estoque pode passar a ser controlado por localização.

O Vortek já possui adaptação importante para estoque, descrita mais adiante.

Não há evidência suficiente para criar agora uma nova camada de User Products ou novas tabelas apenas por antecipação.

---

# 4. Importação / observação de anúncios

O sync observado:

```text
/api/sync/anuncios
```

busca os itens do vendedor no Mercado Livre, usando scan, e depois consulta os detalhes necessários.

O vínculo com o produto local tenta utilizar:

1. `ml_item_id`;
2. SKU mestre VTK;
3. SKU de oferta externa quando necessário.

Depois o fluxo persiste e reconcilia:

- status;
- preço;
- título;
- permalink;
- thumbnail;
- catálogo;
- SKU;
- produto relacionado;
- informações operacionais.

### Avaliação

**Manter.**

Esse fluxo é o mecanismo de observação/reconciliação e não deve ser misturado com a publicação de alterações.

---

# 5. Estado desejado x estado observado

O Vortek deliberadamente não trata toda leitura do Mercado Livre como uma autorização para sobrescrever o estado desejado do produto.

Existe diferença entre:

```text
quero que o anúncio fique ativo
```

e

```text
Mercado Livre colocou o anúncio em under_review
```

A reconciliação possui fontes diferentes, como:

```text
publish_reconcile
observed_sync
items_webhook
```

### Avaliação

**Manter.**

Essa separação evita que uma moderação externa destrua silenciosamente a intenção operacional interna.

Porém essa separação exige um mecanismo eficiente para impedir que o Vortek continue tentando publicar mudanças enquanto o anúncio estiver temporariamente não modificável.

Esse segundo ponto ainda precisa ser melhorado.

---

# 6. Outbox de publicação

A tabela:

```text
anuncios_ml_outbox
```

é atualmente o ponto central para publicação assíncrona.

O enqueue consegue agrupar alterações pendentes para o mesmo produto/anúncio e reabrir determinados estados quando necessário.

O worker:

```text
/api/sync/anuncios/publish
```

possui:

- lock de domínio;
- recuperação de processamento antigo;
- retries;
- backoff;
- limite de tentativas;
- classificação de falhas;
- cancelamento de operações impossíveis;
- aplicação de preço;
- aplicação de preço por quantidade;
- aplicação de estoque;
- aplicação de status;
- verificação;
- reconciliação após sucesso.

### Avaliação

**Manter.**

A outbox resolve problemas reais:

- falha parcial;
- retry;
- concorrência;
- processamento assíncrono;
- recuperação;
- rastreabilidade.

Não é complexidade acidental.

---

# 7. Estado operacional da outbox

Foi realizada consulta somente leitura no banco operacional.

Foram encontrados eventos recentes de:

```text
dslite_stock_automation
dslite_price_automation
kit_stock_automation
internal_stock_automation
```

A maioria dos eventos recentes consultados foi processada normalmente.

Também existem cancelamentos corretos quando o Mercado Livre informa que o anúncio está, por exemplo:

```text
closed
under_review
inactive
```

e o campo não pode ser alterado.

### Avaliação

O worker está distinguindo erro transitório de operação impossível em vários cenários.

Isso deve ser preservado.

---

# 8. Problema confirmado — chamadas impossíveis são recriadas

Embora o worker cancele corretamente algumas operações impossíveis, a automação de origem pode voltar a criar uma nova outbox posteriormente.

Na amostra operacional foram encontrados os mesmos anúncios `under_review` recebendo, repetidamente:

```text
nova outbox
↓
chamada ao Mercado Livre
↓
field_not_updatable
↓
cancelled
↓
nova outbox posteriormente
```

Isso ocorreu em automações de:

- preço;
- estoque de kit.

Também foi observado um anúncio com estado local `pausado`, enquanto o Mercado Livre o considerava `under_review`, sem bloqueio atual preenchido em:

```text
ml_sync_blocked_until
ml_sync_block_reason
ml_sync_last_error
```

### Avaliação

**P2 — simplificar e reduzir chamadas impossíveis.**

O objetivo futuro deve ser fazer o começo do fluxo respeitar o estado observado/bloqueio já conhecido, em vez de descobrir novamente no final de cada tentativa.

Não é necessário criar novo mecanismo de fila.

O schema já possui conceitos de bloqueio que podem ser reaproveitados.

A forma exata deve ser consolidada nos Itens 7, 8 e 12.

---

# 9. Bloqueio manual

Existe:

```text
ml_manual_blocklist
```

A consulta operacional confirmou diversos bloqueios ativos.

Os motivos observados incluem divergências materiais de identidade, como:

- marca;
- tensão;
- GTIN;
- Seller SKU.

### Avaliação

**Manter.**

Isso protege o Vortek de atualizar automaticamente um anúncio cuja identidade pode não corresponder ao produto local.

Não é lixo histórico.

---

# 10. Estoque — arquitetura atual de publicação

O fluxo moderno está centralizado em:

```text
src/lib/ml/stock-publish.ts
```

Antes de publicar estoque, o Vortek verifica o contexto da conta.

Existem dois caminhos.

## Modelo tradicional

Publica:

```text
PUT /items/{item_id}
available_quantity
```

## Gestão multiorigem / warehouse management

O Vortek:

1. identifica `warehouse_management`;
2. obtém o `user_product_id`;
3. consulta o estoque do User Product;
4. identifica `seller_warehouse`;
5. utiliza `x-version`;
6. publica no endpoint de estoque do User Product;
7. trata conflito de versão;
8. consulta novamente para verificar.

### Comparação com documentação oficial

A documentação atual do Mercado Livre determina que contas com gestão multiorigem não devem atualizar estoque por `available_quantity` em `/items`.

Nessas contas o estoque deve ser gerenciado através dos recursos de User Products/depósitos.

### Avaliação

**Manter o fluxo moderno.**

Ele está alinhado com a documentação oficial atual.

---

# 11. Full / estoque controlado pelo Mercado Livre

A documentação oficial também diferencia estoque controlado pelo vendedor de estoque Fulfillment.

Em itens de Fulfillment, a disponibilidade pode depender do estoque físico no centro de distribuição do Mercado Livre.

Portanto:

```text
seller_warehouse
```

não deve ser tratado como substituto universal do estoque Full.

### Avaliação

Não criar lógica adicional agora.

O fluxo moderno já detecta o modelo de estoque antes da escrita.

Se o Vortek passar a operar estoque Full de forma relevante, o comportamento específico deve ser auditado a partir de casos reais.

---

# 12. Helpers antigos de estoque

Além do fluxo moderno em:

```text
src/lib/ml/stock-publish.ts
```

ainda existem helpers antigos de atualização direta de estoque dentro de:

```text
src/services/mercadolivre.ts
```

incluindo lógica baseada em `available_quantity`.

### Avaliação

**P2 — candidato a consolidação/remoção, mas ainda não remover.**

Nesta etapa foi confirmada a existência das duas gerações de código, mas não foi provado que todos os helpers antigos estão sem chamadores.

O Item 7 deve mapear quem ainda chama cada caminho.

O Item 15 poderá classificar definitivamente o código antigo como:

```text
operacional
manutenção
histórico/morto
```

Somente depois disso ele poderá ser removido.

---

# 13. Quantidade atual publicada

Em pontos importantes, a quantidade desejada atualmente é calculada aproximadamente como:

```text
max(
    estoque da oferta preferencial projetado em produtos,
    estoque interno
)
```

Isso evita o erro de simplesmente somar:

```text
estoque fornecedor + estoque interno
```

### Avaliação

A direção é segura, mas incompleta.

O `produtos.estoque` é o snapshot da **oferta preferencial**, conforme definido no Item 3.

Ele não necessariamente representa toda a capacidade que o fluxo `supplier` consegue atender.

Exemplo:

```text
interno = 2
fornecedor preferencial = 3
outro fornecedor elegível = 8
```

O cálculo atual pode publicar:

```text
3
```

quando o supplier talvez consiga atender:

```text
8
```

Isso é principalmente risco de **subutilização de estoque**, não evidência de overselling.

---

# 14. Regra definitiva — quantidade segura anunciável

A regra de negócio confirmada no Item 2 é:

```text
um pedido inteiro por internal
OU
um pedido inteiro pelo fluxo supplier
```

Nunca:

```text
parte internal + parte supplier
```

Portanto a quantidade segura deve representar a maior quantidade que **uma origem operacional válida** consegue assumir integralmente.

Definimos conceitualmente:

```text
Q_internal
=
capacidade vendável do estoque interno
já descontando reservas válidas

Q_supplier
=
capacidade realmente atendível pelo fluxo supplier,
calculada somente com ofertas elegíveis
e respeitando exatamente as regras de fulfillment externo

Q_segura
=
max(Q_internal, Q_supplier)
```

### Importante

`Q_supplier` não deve ser apenas:

```text
produtos.estoque
```

por definição.

Ele deve reutilizar a mesma regra que determina se o supplier realmente consegue atender a venda.

Também não devemos somar `Q_internal + Q_supplier`, porque o pedido não pode ser dividido entre essas duas origens.

### Avaliação

**Regra de negócio definida.**

A implementação deve ser centralizada posteriormente, depois de os Itens 7 e 12 confirmarem todos os pontos que hoje calculam disponibilidade.

---

# 15. Reserva e quantidade segura

A fórmula de quantidade segura não resolve sozinha concorrência.

O Item 2 já identificou que a reserva de estoque interno ainda não é atômica.

Enquanto existir uma janela entre:

```text
saldo observado
e
saldo reservado
```

uma sincronização pode republicar uma quantidade que ficou obsoleta.

### Dependência

A garantia completa depende de:

```text
quantidade segura
+
reserva interna atômica
+
estoque externo suficientemente atualizado
```

Não criar uma correção isolada no Mercado Livre ignorando o fulfillment.

---

# 16. Kits locais do Vortek

Conforme definido no Item 3:

```text
kit local
→ componentes
→ custo e disponibilidade derivados
```

Para o estoque seguro de um kit local:

```text
Q_internal
```

e

```text
Q_supplier
```

devem ser calculados pela capacidade dos componentes.

O kit não deve possuir uma quantidade física independente que possa divergir dos componentes.

### Avaliação

**Manter.**

---

# 17. Kits Virtuais nativos do Mercado Livre

O Mercado Livre possui também um conceito próprio chamado:

```text
Kit Virtual
```

Esse conceito não deve ser confundido com o cadastro local `produto_kits`.

A documentação oficial informa que, no Kit Virtual nativo:

```text
estoque do kit
=
calculado automaticamente pelo Mercado Livre
a partir dos componentes
```

e o seller não deve alterar manualmente `quantity / available_quantity` do kit.

### Estado operacional

A consulta somente leitura em `pedidos` confirmou vendas reais com:

```text
ml_bundle_type = virtual_kit
```

O Vortek já possui código específico para interpretar pedidos desse tipo.

### Avaliação

**Manter a distinção.**

**P2 — tornar explícito no cálculo/publicação que um Kit Virtual nativo do ML não deve receber atualização manual de estoque do Vortek.**

Não há evidência suficiente nesta etapa para afirmar que o Vortek está atualmente atualizando o estoque do item pai nativo de forma incorreta.

---

# 18. Preço automático do Vortek

O Vortek possui automação própria de preço.

A regra utiliza dados como:

- custo;
- frete;
- fee;
- margem/regra de preço.

A mudança é enviada para a outbox:

```text
dslite_price_automation
```

e publicada pelo worker.

### Avaliação

**Manter a regra própria enquanto ela representar a estratégia de preço do Vortek.**

Não misturar automaticamente `price_to_win` com o preço calculado pelo Vortek.

---

# 19. Automação de Preços nativa do Mercado Livre

A documentação oficial atual determina que, desde:

```text
18/03/2026
```

um anúncio com **Automatização de Preços do Mercado Livre ativa** não aceita edição direta de preço pela API da forma tradicional.

Antes de atualizar o preço, a integração deve identificar se a automação nativa está ativa.

### Estado atual do Vortek

O worker atual envia o campo:

```text
price
```

diretamente ao item.

Na análise do fluxo não foi encontrado um pré-check da Automatização de Preços nativa antes dessa escrita.

Na amostra operacional consultada não foram encontrados erros explicitamente relacionados a automação nativa; os erros de preço recentes observados estavam associados principalmente a anúncios `under_review`/não modificáveis.

### Avaliação

**P2 — incompatibilidade potencial com uma regra oficial já vigente.**

Se o Vortek não utiliza a automação nativa do ML, o problema não produz impacto atual.

Mesmo assim, o fluxo deve conhecer essa condição para não depender de uma suposição externa permanente.

No Item 16 a prioridade pode ser elevada se for confirmado que existem anúncios com automação nativa ativa.

---

# 20. Preços por quantidade

O Vortek publica preços por quantidade junto com sua automação de preço.

A implementação atual usa o modelo de preço por quantidade com valores absolutos calculados a partir do preço-base.

### Mudança oficial

A documentação do Mercado Livre, atualizada em:

```text
24/08/2026
```

informa que em:

```text
26/10/2026
```

o endpoint atual deixará de aceitar a configuração de Preços por Quantidade com valor absoluto.

O desenvolvimento deve migrar para a nova estrutura percentual B2B.

### Avaliação

**P1 — mudança obrigatória com prazo definido.**

Não precisamos executar agora durante a auditoria.

Mas ela deve entrar no futuro checklist de ação com prazo anterior a **26 de outubro de 2026**.

---

# 21. Catálogo

O Vortek possui fluxo específico para catálogo.

Entre as responsabilidades observadas estão:

- identificar anúncios de catálogo;
- buscar itens do seller;
- obter detalhes em lote;
- consultar `price_to_win`;
- persistir estado de competição;
- resolver item relacionado;
- limpar snapshots antigos;
- registrar job de refresh.

### Avaliação

**Manter.**

O catálogo tem estado e regras externas suficientes para justificar um snapshot próprio.

---

# 22. Buy Box / competição

A tabela:

```text
catalogo_ml_snapshot
```

mantém:

```text
price
price_to_win
buy_box_status
buy_box_winning
```

Foram observados estados operacionais reais como:

```text
winning
sharing_first_place
competing
not_listed
```

A documentação oficial atual utiliza exatamente esses conceitos para competição em catálogo.

### Estado operacional

A consulta realizada mostrou snapshots atualizados em 27/08/2026, com anúncios:

- ganhando;
- compartilhando primeiro lugar;
- competindo;
- fora da competição.

### Avaliação

**Manter.**

Não foi encontrada evidência de que o Vortek esteja alterando automaticamente o preço apenas para atingir `price_to_win`.

Isso é positivo: monitorar Buy Box não significa que o sistema deve sempre reduzir preço.

---

# 23. Elegibilidade e opt-in de catálogo

O fluxo de opt-in valida o anúncio/produto antes da criação da publicação de catálogo.

São considerados aspectos como:

- elegibilidade;
- produto de catálogo;
- atributos;
- GTIN;
- compatibilidade de identidade.

Depois o Vortek usa o recurso oficial para criar a listing de catálogo e sincroniza o resultado.

### Comparação oficial

O Mercado Livre recomenda verificar:

```text
catalog_listing_eligibility
buy_box_eligible
```

antes do opt-in.

### Avaliação

**Manter.**

As verificações locais evitam associar o produto errado ao catálogo.

---

# 24. Job de refresh do catálogo

O refresh completo utiliza um job persistido.

A consulta operacional mostrou execuções recentes processando aproximadamente:

```text
5,8 mil itens
```

por refresh.

Há execuções:

```text
completo
completo_parcial
```

e também foi observado um job recente em:

```text
on_hold
```

### Avaliação

O job durável é **complexidade necessária**.

Não transformar o refresh grande em request síncrona simples.

A frequência, origem dos disparos, estados `on_hold` e possíveis sobreposições devem ser analisados no:

```text
Item 7 — Sincronizações + Jobs + Scheduler
```

O custo real de API deve ser medido no:

```text
Item 13 — Performance e Saúde Operacional
```

---

# 25. Notificações de competição

A documentação oficial do Mercado Livre disponibiliza o tópico:

```text
catalog_item_competition_status
```

para notificar mudanças de competição.

O Vortek já possui polling/refresh de catálogo.

### Avaliação

**Investigar no Item 8 — Webhooks + Eventos.**

Não criar automaticamente uma nova integração de notificação.

Primeiro precisamos verificar:

- se o tópico já está configurado;
- se o webhook atual já recebe o evento;
- se o refresh periódico continua necessário como reconciliador;
- se a notificação realmente reduziria trabalho sem diminuir resiliência.

---

# 26. Chamadas repetidas x mecanismos legítimos de recuperação

Não devemos tratar como duplicação apenas porque existe:

```text
webhook
+
sync observado
+
outbox
+
refresh
```

Eles possuem papéis diferentes:

```text
webhook
= evento rápido

sync observado
= reconciliação do estado real

outbox
= publicação confiável

refresh catálogo
= fotografia aprofundada de competição
```

### Duplicação real confirmada

O caso confirmado nesta auditoria é:

```text
operação sabidamente impossível
→ cancelada
→ recriada repetidamente
```

Isso é trabalho repetido sem ganho operacional.

---

# 27. Complexidade essencial — preservar

## Publicação
- outbox;
- worker;
- retries;
- verificação após escrita;
- reconciliação.

## Estoque
- detecção do modelo de estoque;
- suporte a User Products;
- `x-version`;
- retry de conflito;
- verificação após atualização.

## Segurança operacional
- blocklist manual;
- bloqueios de sincronização;
- distinção desired/observed.

## Catálogo
- snapshot próprio;
- `price_to_win`;
- estados de competição;
- job persistido;
- opt-in validado.

## Integração
- sync observado;
- webhook;
- reconciliadores.

Nenhum desses mecanismos deve ser removido somente para reduzir quantidade de arquivos.

---

# 28. Complexidade acidental / problemas confirmados

## P1 — Preços por Quantidade precisa migrar antes de 26/10/2026

O endpoint/modelo atual de valor absoluto será descontinuado para essa finalidade.

---

## P2 — Reenfileiramento recorrente de operações impossíveis

Anúncios `under_review`, fechados ou não modificáveis podem voltar a gerar novas outboxes depois de uma tentativa já cancelada.

---

## P2 — Quantidade segura ainda não possui fonte única

Existem cálculos semelhantes em diferentes fluxos e o estoque externo considerado é principalmente o snapshot da oferta preferencial.

A regra deve ser consolidada no Item 12.

---

## P2 — Automação de preço nativa do ML não é verificada antes do PUT de preço

A regra oficial já está vigente desde 18/03/2026.

Impacto operacional atual não foi comprovado na amostra consultada.

---

## P2 — Kits locais e Kits Virtuais nativos precisam de regra explícita de publicação

Kit Virtual nativo do Mercado Livre possui estoque controlado pelos componentes dentro do próprio marketplace.

---

## P2 — Helpers antigos de estoque coexistem com `stock-publish.ts`

São candidatos a limpeza, mas somente após rastrear os chamadores.

---

# 29. Quantidade segura — decisão consolidada do Item 4

A regra a ser utilizada no futuro planejamento é:

```text
Q_segura = max(Q_internal, Q_supplier)
```

onde:

```text
Q_internal
=
quantidade realmente disponível e não reservada
que o fulfillment internal consegue assumir

Q_supplier
=
quantidade que o fluxo supplier consegue assumir
integralmente com ofertas válidas e atuais
```

Nunca:

```text
Q_internal + Q_supplier
```

porque o pedido não será dividido entre essas duas origens.

Para kits:

```text
a capacidade vem dos componentes
```

Para Kit Virtual nativo do Mercado Livre:

```text
o Vortek não controla manualmente a quantidade do item pai
```

Essa regra deve ter **uma única implementação compartilhada** quando chegar o Item 12/plano de execução.

---

# 30. O que NÃO fazer agora

Não devemos:

- remover a outbox;
- substituir tudo por chamadas síncronas diretas;
- remover o sync observado;
- remover o refresh de catálogo sem medir sua função;
- apagar snapshots de catálogo;
- somar estoque interno + supplier;
- usar somente a oferta preferencial como definição conceitual definitiva de capacidade supplier;
- adicionar Redis/fila nova;
- criar um novo serviço de Mercado Livre;
- criar tabela nova de User Products sem necessidade comprovada;
- fazer `price_to_win` substituir automaticamente o preço do Vortek;
- remover a blocklist manual;
- remover helpers antigos antes de confirmar chamadores;
- implementar agora as correções encontradas.

---

# 31. Dependências para itens futuros

## Item 7 — Sincronizações + Jobs + Scheduler

Confirmar:

- quem dispara a outbox em tempo real;
- todos os chamadores dos helpers antigos de estoque;
- frequência do sync observado;
- frequência do refresh de catálogo;
- motivo e recuperação de jobs `on_hold`;
- sobreposição entre mecanismos.

## Item 8 — Webhooks + Eventos

Confirmar:

- eventos de itens;
- eventos de preço;
- Item Competition;
- User Products;
- quais eventos substituem trabalho periódico e quais apenas aceleram reconciliação.

## Item 10 — Banco de Dados

Confirmar:

- papel definitivo de `anuncios_ml`;
- `catalogo_ml_snapshot`;
- `anuncios_ml_outbox`;
- campos de bloqueio;
- necessidade ou não de persistir `user_product_id`.

## Item 12 — Regras Compartilhadas

Criar uma única fonte de verdade para:

- quantidade segura anunciável;
- elegibilidade de publicação;
- disponibilidade;
- estado modificável;
- preço automático.

## Item 13 — Performance

Medir:

- volume de chamadas do scan de anúncios;
- chamadas de `price_to_win`;
- verificações após publicação;
- chamadas desperdiçadas por anúncios não modificáveis;
- custo do refresh completo de catálogo.

## Item 15 — Scripts + Documentação + Históricos

Classificar os helpers antigos do serviço Mercado Livre depois de confirmar que não possuem função operacional.

---

# 32. Resultado do checklist — Item 4

- [x] Mapear criação de anúncios.
- [x] Mapear importação/observação de anúncios.
- [x] Mapear preço.
- [x] Mapear estoque.
- [x] Mapear status.
- [x] Mapear catálogo.
- [x] Mapear Buy Box e `price_to_win`.
- [x] Mapear bloqueios.
- [x] Mapear retries.
- [x] Mapear outbox.
- [x] Mapear reconciliações.
- [x] Comparar estoque com documentação oficial multiorigem/User Products.
- [x] Comparar preço com documentação oficial atual.
- [x] Identificar mudança obrigatória de Preços por Quantidade em 26/10/2026.
- [x] Definir a regra conceitual da quantidade segura anunciável.
- [x] Diferenciar kits locais de Kits Virtuais nativos do Mercado Livre.
- [x] Identificar chamadas impossíveis recriadas repetidamente.
- [x] Identificar código antigo de estoque candidato a consolidação.
- [x] Separar complexidade necessária de complexidade acidental.

---

# 33. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhuma migration foi executada;
- nenhum dado foi modificado;
- nenhum deploy foi realizado;
- nenhum teste de código foi executado;
- nenhum anúncio foi alterado no Mercado Livre.

Foram realizadas apenas:

- leitura do repositório na branch `dev`;
- análise dos arquivos relacionados;
- consultas somente leitura no Supabase operacional;
- consulta à documentação oficial atual do Mercado Livre.

Não foi possível consultar diretamente, por esta interface, as tags da conta Mercado Livre usando o token operacional.

Isso não impede a conclusão sobre o fluxo de estoque, pois o código atual detecta o modelo em runtime e a documentação oficial define os dois caminhos.

---

# 34. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`
- `docs/mercado-livre-publicacao-operacional.md`

## Código Vortek — branch `dev`

Arquivos principais analisados:

- `src/lib/ml/stock-publish.ts`
- `src/lib/ml/reconcile-anuncio.ts`
- `src/lib/ml/automatic-pricing.ts`
- `src/lib/ml/automatic-pricing-selection.ts`
- `src/lib/ml/operational-listing.ts`
- `src/lib/ml/virtual-kit-orders.ts`
- `src/lib/sync/ml-publish-outbox.ts`
- `src/lib/sync/registry.ts`
- `src/lib/estoque-interno.ts`
- `src/lib/produto-kits.ts`
- `src/services/mercadolibre.ts`
- `src/services/catalog-refresh-job.ts`
- `src/app/api/sync/anuncios/route.ts`
- `src/app/api/sync/anuncios/publish/route.ts`
- `src/app/api/sync/preco-estoque/route.ts`
- `src/app/api/sync/preco-estoque-xml/route.ts`
- `src/app/api/catalogo/no-catalogo/refresh/route.ts`
- `src/app/api/catalogo/optin/route.ts`

## Banco operacional — somente leitura

Consultados:

- `integracoes`;
- `anuncios_ml`;
- `anuncios_ml_outbox`;
- `catalogo_ml_snapshot`;
- `jobs`;
- `ml_manual_blocklist`;
- `pedidos`.

## Mercado Livre — documentação oficial

Gestão de estoque multiorigem / User Products:

`https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/gestao-de-estoque-multiorigem-user-products`

Automatizações de preços:

`https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos`

Preços de produtos:

`https://developers.mercadolivre.com.br/devcenter/api-de-precos`

Preços por quantidade:

`https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/precos-por-quantidade`

Preços por quantidade % B2B:

`https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b`

Elegibilidade de catálogo:

`https://developers.mercadolivre.com.br/pt_br/elegibilidade-de-catalogo`

Competição:

`https://developers.mercadolivre.com.br/concorrencia-em-catalogo`

Kits virtuais:

`https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos/kits-virtuais`

Preço por variação / User Products:

`https://developers.mercadolivre.com.br/pt_br/variacoes/preco-variacao`

---

# 35. Conclusão final do Item 4

O Vortek já possui a infraestrutura correta para manter o Mercado Livre sincronizado com segurança:

```text
outbox
+
worker
+
retry
+
verificação
+
reconciliação
```

Essa base não deve ser substituída.

A limpeza deve se concentrar em remover trabalho desnecessário e deixar as regras mais explícitas.

A decisão central de estoque ficou definida:

```text
Q_segura = max(Q_internal, Q_supplier)
```

sem somar internal + supplier.

Também ficaram registrados:

- prazo obrigatório de Preços por Quantidade em 26/10/2026;
- necessidade de respeitar automação nativa de preço do Mercado Livre;
- reenfileiramento repetido de operações impossíveis;
- distinção entre kits locais e Kits Virtuais nativos;
- candidatos antigos de sincronização de estoque que só poderão ser removidos após rastrear chamadores.

O **Item 4 está concluído**.

Nenhuma correção deve ser executada agora. Os achados seguem para a consolidação da auditoria e, somente após o Item 16, para o checklist de execução.
