# Vortek — Auditoria de Limpeza e Organização

## Item 13 — Performance e Saúde Operacional

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Observação:** o P0 de autorização identificado no Item 9 permanece aberto.  
**Objetivo:** medir duração de jobs importantes, observar volume de chamadas externas, identificar retries e processamentos recorrentes, separar gargalos reais de trabalho legítimo e registrar somente otimizações sustentadas por evidência.

---

## 1. Conclusão executiva

Os principais problemas de performance encontrados **não são falta de cache nem falta de índices**.

Os maiores desperdícios confirmados estão em chamadas externas e reprocessamentos evitáveis:

### P1 — scan Mercado Livre repetido integralmente

O sync observado de anúncios processa apenas:

```text
100 anúncios por etapa
```

mas, antes de selecionar esses 100, reconstrói a lista completa de aproximadamente:

```text
5.900 anúncios
```

através de `search_type=scan`.

Em uma execução real:

```text
itens totais: 5.902
itens processados na etapa: 100
páginas de scan buscadas: 119
duração: ~73 s
```

O job seguinte avança o offset para os próximos 100, mas executa novamente o scan completo.

Mantido esse padrão, um ciclo completo de aproximadamente 60 etapas pode chegar à ordem de:

```text
~7.000 páginas de scan
```

somente para reconstruir repetidamente a mesma população de IDs, antes das consultas individuais de anúncios, performance, frete e reconciliação.

Esse é o maior gargalo de chamadas externas identificado no Item 13.

---

### P1 — estoque DSLite gera publicações repetidas sem mudança real

O sync de preço/estoque atualiza:

```text
last_sync_at
```

da oferta em toda sincronização.

O snapshot preferencial considera:

```text
dslite_ultima_sync
```

na detecção de mudança.

Além disso, a rota de sync trata todos os snapshots retornados como candidatos ao fluxo de estoque Mercado Livre.

Consequência:

```text
produto sincronizado
↓
timestamp muda
↓
snapshot é tratado como alterado
↓
nova outbox de estoque
↓
Mercado Livre recebe novamente a mesma quantidade
```

Foi confirmado operacionalmente um anúncio recebendo repetidamente:

```text
desired_quantity = 13
```

em muitas outboxes sucessivas entre 25 e 27 de agosto, mesmo com a mesma quantidade desejada.

Em uma única etapa rápida de DSLite:

```text
100 produtos vistos
100 atualizados
125 outboxes de estoque enfileiradas
duração total ~4,2 s
```

Isso mantém o worker de publicação ocupado com trabalho que pode não representar mudança de negócio.

---

### P1 — timeout DSLite pode parecer sincronização vazia bem-sucedida

O sync:

```text
sync_dslite_pedidos_compra
```

normalmente dura poucos segundos.

Porém foram observadas execuções próximas de:

```text
60 s
```

que terminaram:

```text
status = completo
seen = 0
total = 0
```

O cliente DSLite possui timeout de aproximadamente 60 s.

A rota usa o helper simplificado que pode retornar `null` quando a chamada falha/expira e, nesse fluxo, ausência de dados pode ser interpretada como:

```text
não existem pedidos
```

em vez de:

```text
a consulta externa falhou
```

### Avaliação

Isso é mais grave que lentidão.

É uma falha de **saúde operacional/observabilidade**, porque o dashboard pode mostrar sucesso enquanto a origem externa não foi consultada com sucesso.

---

## 2. Amostra operacional medida

As medições abaixo foram feitas em consultas somente leitura aos jobs recentes do ambiente operacional.

São amostras de 27/08/2026 e não benchmarks sintéticos.

| Job | Comportamento observado |
|---|---|
| `sync_ml_listings_observed` | normalmente ~1–1,5 min por lote de 100; amostra recente ~73 s |
| `sync_ml_listings_publish` | normalmente ~17–36 s por lote; amostra de 20 publicações ~18 s |
| `sync_ml_orders_ingest` | normalmente ~5–9 s |
| `sync_reconcile_brasilnfe` | normalmente ~2–3 s; falhas podem durar muito mais |
| `sync_dslite_preco_estoque` | normalmente ~2–7 s, com picos reais de ~60–80 s |
| `sync_dslite_xml_preco_estoque` | normalmente ~8–13 s; houve execução de erro ~70 s |
| `sync_dslite_pedidos_compra` | normalmente ~2–4 s; alguns ciclos ficam ~60 s mesmo com 0 registros |
| `sync_mercadopago_account_money` | ~2–3 s, porém o Item 6 confirmou que “completo” não significa reconciliação financeira concluída |
| `catalogo_no_catalogo_refresh` | ~4–7 min para ~5,8 mil anúncios |

### Avaliação

A duração sozinha não determina prioridade.

Exemplos:

```text
catálogo:
demora minutos
mas processa ~5.800 registros
com job durável
→ custo justificável

Brasil NFe:
normalmente demora ~2 s
mas repete not_found inutilmente
→ desperdício real
```

---

# 3. Mercado Livre — sync observado

A rota:

```text
/api/sync/anuncios
```

usa:

```text
search_type=scan
```

para obter todos os itens do seller.

Depois aplica:

```text
allItemIds.slice(offset, offset + limit)
```

e processa apenas o lote atual.

### Problema

O cursor persistido pelo scheduler representa:

```text
offset da lista
```

mas não preserva a população de IDs nem a sessão de scan.

Assim:

```text
offset 0
→ scan completo
→ processa 100

offset 100
→ novo scan completo
→ processa 100

offset 200
→ novo scan completo
→ processa 100
```

### Comparação oficial

A documentação oficial do Mercado Livre orienta que buscas acima de 1.000 itens utilizem:

```text
search_type=scan
+
scroll_id
```

e que o mesmo `scroll_id` seja usado para avançar pelas páginas do scan enquanto válido.

O `scroll_id` possui expiração de aproximadamente:

```text
5 minutos
```

### Avaliação

**P1 — eliminar o rescan completo por lote.**

Não definir a implementação final neste item.

A solução precisa respeitar a expiração do scroll e o fato de que o processamento dos anúncios pode durar mais que cinco minutos no total.

Possibilidades devem ser avaliadas no Item 16/17, priorizando a menor mudança que:

```text
obtém a população uma vez
+
processa essa população de forma retomável
```

sem adicionar nova fila externa.

---

# 4. Custo adicional por anúncio observado

Depois de obter os IDs, o sync também pode executar operações por anúncio, como:

- consultar detalhes;
- performance;
- dados de preço;
- frete;
- identidade;
- reconciliação local.

Na execução amostrada de 100 anúncios:

```text
performance_refreshed = 85
performance_failed = 3
pricing_fields_updated = 75
```

### Avaliação

Essas chamadas podem ser necessárias.

O desperdício comprovado antes delas é o scan repetido.

**Primeiro remover o scan repetido.**

Somente depois medir se performance/frete precisam de redução, cache ou alteração de frequência.

---

# 5. Mercado Livre — publisher

O worker realtime:

```text
sync_ml_listings_publish
```

processa no máximo:

```text
20 outboxes
```

por execução.

Uma execução observada:

```text
20 lidas
20 concluídas
0 retry
0 failed
~18 s
```

Outras execuções recentes ficaram aproximadamente entre:

```text
17 e 36 s
```

### Avaliação

O worker não está claramente lento para o trabalho que executa.

O problema maior é **quanto trabalho desnecessário chega até ele**.

Antes de aumentar:

- concorrência;
- batch size;
- frequência;
- workers;

devemos reduzir outboxes repetidas.

---

# 6. P1 — outbox de estoque repetida

Foi consultado um anúncio específico com histórico recente.

Entre 25 e 27 de agosto, foram encontradas muitas linhas:

```text
source = dslite_stock_automation
desired_quantity = 13
status = done
```

seguidas por nova linha com a mesma quantidade.

### Causa estrutural confirmada no código

O sync DSLite atualiza o timestamp externo:

```text
last_sync_at = agora
```

O snapshot do produto inclui esse timestamp em:

```text
changed
```

Depois a rota utiliza os snapshots retornados para recalcular/publicar estoque.

Além disso, a deduplicação da outbox evita principalmente duplicata ainda pendente.

Depois que uma linha fica:

```text
done
```

uma sincronização posterior pode criar uma nova linha idêntica.

### Avaliação

**P1 — reduzir trabalho na origem.**

A regra futura deve considerar alteração de **estado de negócio relevante**, por exemplo:

```text
quantidade publicável realmente mudou?
status publicável mudou?
```

e não:

```text
o timestamp de sincronização mudou?
```

Não resolver aumentando capacidade do publisher.

---

# 7. Pricing automático já é mais disciplinado

O fluxo de pricing automático utiliza:

```text
resolveAutomaticPricingProductIds(...)
```

e filtra snapshots por alteração real de custo, além de IDs forçados quando necessário.

### Avaliação

**Ponto positivo.**

O fluxo de estoque pode seguir o mesmo princípio:

```text
só gerar efeito externo quando o dado relevante mudou
```

sem necessariamente reutilizar a mesma função de pricing.

---

# 8. DSLite preço/estoque — latência variável

Foram observadas execuções do mesmo job com perfis muito diferentes.

### Exemplo rápido

```text
100 produtos vistos
100 atualizados
125 outboxes
~4,2 s
```

### Exemplo lento

```text
100 produtos vistos
77 atualizados
126 outboxes
~66,5 s
```

A execução lenta terminou sem erro de linha.

### Avaliação

**Não há evidência suficiente para afirmar N+1 como causa principal.**

A variação pode envolver:

- latência DSLite;
- fornecedor específico;
- banco;
- quantidade de ofertas;
- outbox;
- kits;
- rede.

O log atual não mede cada subetapa.

---

# 9. P2 — falta de instrumentação por subetapa no DSLite

O job informa bem:

- duração total;
- fornecedor/página;
- quantidade vista;
- quantidade atualizada;
- outboxes;
- erros.

Mas não informa duração separada para:

```text
request DSLite
upsert ofertas
snapshot preferencial
kits
estoque interno
outbox ML
pricing
```

### Avaliação

**P2 — instrumentação mínima antes de otimizar esse fluxo.**

Não adicionar APM novo.

Os logs estruturados já existentes podem receber tempos de subetapas importantes quando o plano de execução chegar.

---

# 10. P2 — padrão N+1 existe, mas ainda não é gargalo comprovado

No fluxo DSLite, para cada snapshot/produto pode ocorrer:

```text
obterSaldoEstoqueInternoProduto(productId)
```

com consulta individual.

Depois, para cada anúncio relacionado, a outbox também realiza operações de banco.

### Evidência contrária a uma conclusão prematura

Uma etapa completa de:

```text
100 produtos
+
125 outboxes
```

terminou em aproximadamente:

```text
4,2 s
```

### Avaliação

Existe um padrão que pode ficar caro em escala, mas **não foi comprovado como gargalo dominante agora**.

Ordem correta:

```text
1. parar outboxes redundantes
2. medir novamente
3. somente então considerar batch de saldos/outbox
```

---

# 11. DSLite pedidos de compra — normalmente rápido

O sync:

```text
sync_dslite_pedidos_compra
```

normalmente termina em aproximadamente:

```text
2–4 s
```

A janela automática observada foi:

```text
2 dias
```

### Avaliação

Não há motivo para otimizar seu processamento normal.

O problema são execuções próximas do timeout.

---

# 12. P1 — timeout DSLite mascarado como sucesso vazio

Foi inspecionado um job com duração:

```text
~60,0 s
```

e resultado:

```text
seen = 0
failed = 0
total = 0
status = completo
```

O cliente DSLite utiliza timeout de aproximadamente:

```text
60 s por tentativa
```

e existe uma versão de helper que preserva:

```text
status
erro
resultado
```

Porém o sync de pedidos de compra usa o helper simplificado de dados.

Quando o retorno vira `null`, o loop pode tratar como ausência de pedidos e encerrar normalmente.

### Avaliação

**P1 — saúde operacional.**

Falha externa não deve ser contabilizada como:

```text
sync bem-sucedido com zero registros
```

A futura correção deve reutilizar o helper que preserva o resultado/status, em vez de criar uma nova camada de retry.

---

# 13. DSLite XML

O sync XML normalmente ficou em:

```text
~8–13 s
```

com algumas execuções mais longas.

Também houve erro próximo de:

```text
70 s
```

já associado no Item 7 a lock/feed/retry.

### Avaliação

Não otimizar o XML apenas por duração.

Primeiro o Item 16 precisa decidir o papel definitivo:

```text
fonte principal?
fallback?
reconciliador?
legado?
```

Só depois faz sentido ajustar frequência ou remover trabalho.

---

# 14. Pedidos Mercado Livre

`sync_ml_orders_ingest` apresentou duração recente geralmente em:

```text
~5–9 s
```

### Avaliação

**Saudável na amostra atual.**

A combinação:

```text
webhook
+
hidratação durável
+
sync periódico
```

já foi justificada no Item 8.

Não reduzir a frequência somente porque “já existem webhooks” sem medir eventos perdidos.

---

# 15. Brasil NFe

O reconciliador normalmente termina em:

```text
~2–3 s
```

### Problema real

O Item 5 confirmou pedidos com resultado:

```text
not_found
```

sendo consultados repetidamente ao longo de horas.

### Avaliação

O gargalo é:

```text
quantidade de chamadas desnecessárias
```

e não:

```text
tempo de cada job
```

### Prioridade

**P1 carregado do Item 5.**

A correção é uma regra de elegibilidade/backoff terminal, não uma otimização SQL.

---

# 16. Mercado Pago

As execuções recentes de:

```text
sync_mercadopago_account_money
```

duram aproximadamente:

```text
2–3 s
```

### Porém

O Item 6 comprovou que o job pode terminar como:

```text
completo
```

após apenas solicitar um relatório assíncrono.

### Avaliação

A curta duração é enganosa.

**Não é indicador de saúde.**

O P1 continua sendo:

```text
job completo
≠
relatório processado/importado
```

---

# 17. Catálogo — job pesado, mas coerente

Refreshes completos recentes processaram aproximadamente:

```text
5.840–5.860 anúncios
```

em:

```text
~4–7 minutos
```

O processamento é:

- durável;
- em lotes;
- retomável;
- persistido em manifesto.

### Avaliação

**Não classificado como gargalo a corrigir.**

Esse é um trabalho grande executado como trabalho grande.

O P1 existente é outro:

```text
job on_hold que não foi retomado
```

identificado no Item 7.

---

# 18. Saúde do catálogo

O banco ainda possui um job:

```text
catalogo_no_catalogo_refresh
status = on_hold
```

desde:

```text
27/08/2026 00:29 UTC
```

### Avaliação

**P1 carregado do Item 7.**

Performance não resolve falta de retomada.

Antes de aumentar throughput, corrigir o lifecycle/health do job.

---

# 19. Consultas de banco — não foi comprovado gargalo dominante

O Item 10 encontrou índices úteis e estrutura razoável.

As ferramentas atuais desta auditoria não permitem executar livremente:

```text
EXPLAIN ANALYZE
pg_stat_statements
index_advisor
```

no banco operacional.

### Documentação oficial

A orientação do Supabase é avaliar:

```text
query plan
padrão real de filtros/join
índices utilizados
```

antes de adicionar novos índices.

Também alerta que índices aumentam custo de escrita.

### Avaliação

**Não recomendar índices no escuro.**

No plano futuro, queries realmente lentas devem ser medidas com:

```text
EXPLAIN
```

antes de qualquer migration de índice.

---

# 20. Compras — carregamento amplo

O endpoint de compras carrega registros em blocos e depois executa filtros/métricas/paginação em memória para parte do fluxo.

O Item 11 também identificou que a tela refaz indicadores independentes quando mudam filtros.

### Avaliação

**P2 candidato, não gargalo medido.**

Não priorizar antes dos dois grandes desperdícios externos:

```text
scan ML
outbox de estoque repetida
```

No Item 17, só deve entrar como ação de performance se medição de latência/volume justificar.

---

# 21. Perguntas — problema é correção, não performance

O Item 11 identificou filtros locais aplicados apenas sobre a página atual.

### Avaliação

Isso é principalmente:

```text
comportamento incorreto/enganoso
```

e não gargalo de performance.

Não usar “performance” como justificativa para misturar os problemas.

---

# 22. TV e polling da interface

Existem telas com polling frequente, principalmente TV e fluxos operacionais.

### Estado desta auditoria

Não foram obtidas métricas suficientes de:

- payload;
- CPU;
- bundle;
- render;
- chamadas simultâneas de clientes reais.

### Avaliação

**Não classificar como problema ainda.**

Se houver lentidão percebida na interface, medir no navegador/servidor antes de alterar intervalos.

---

# 23. Rate limit e chamadas externas

O Vortek integra APIs sujeitas a:

- latência;
- limites;
- retries;
- moderação;
- estados transitórios.

### Maior risco atual

Chamadas redundantes consomem a mesma capacidade necessária para chamadas úteis.

Prioridade:

```text
1. eliminar chamadas que sabemos serem redundantes
2. evitar chamadas impossíveis
3. só depois aumentar paralelismo
```

Isso vale especialmente para:

```text
scan ML repetido
outbox de estoque igual
NF-e PUT/POST JSON inválidos
Brasil NFe not_found repetido
anúncios under_review reenfileirados
```

---

# 24. Trabalho desnecessário já confirmado em itens anteriores

## Mercado Livre

```text
anúncios não modificáveis
→ nova outbox
→ tentativa
→ cancelamento
→ nova outbox depois
```

**P2/P1 operacional**, Item 4.

## Fiscal

```text
PUT JSON
POST JSON
POST XML correto
```

Duas chamadas inúteis antes da correta.

**P1**, Item 5.

## Brasil NFe

```text
not_found determinístico
→ retry frequente
```

**P1**, Item 5.

## Mercado Pago

```text
solicitar relatório
→ job completo
→ novo ciclo
```

**P1**, Item 6.

## Webhooks

Falha interna pode receber ACK positivo em alguns handlers.

**P2**, Item 8.

### Avaliação

O Item 13 confirma que a maior oportunidade geral é:

**eliminar trabalho desnecessário antes de cache/infraestrutura nova.**

---

# 25. Priorização de performance

## P1 — muito alto

### P1.1 — scan ML completo para cada lote de 100

Grande multiplicador de chamadas externas.

### P1.2 — outbox de estoque repetida sem mudança de quantidade

Mantém publisher ocupado e consome API externa.

### P1.3 — timeout DSLite de pedidos pode virar sucesso vazio

Problema de saúde/confiabilidade.

### P1.4 — Brasil NFe `not_found` recorrente

Carregado do Item 5.

### P1.5 — Mercado Pago lifecycle incompleto

Carregado do Item 6.

### P1.6 — catálogo `on_hold` órfão

Carregado do Item 7.

---

## P2

### P2.1 — instrumentação DSLite insuficiente por subetapa

Impede atribuir corretamente os picos de 60–80 s.

### P2.2 — N+1 de saldo/outbox no sync de estoque

Existe estruturalmente, mas ainda não provado como gargalo dominante.

### P2.3 — listagens que carregam dados amplos antes de paginação

Medir antes de alterar.

### P2.4 — chamadas impossíveis/reenfileiramento ML

Já identificadas no Item 4.

---

# 26. Métricas mínimas que devem existir após a limpeza

Sem adotar plataforma nova, os logs atuais deveriam permitir responder:

```text
quanto durou chamada externa?
quanto durou banco?
quantos registros foram realmente alterados?
quantas chamadas externas foram evitadas?
quantas outboxes foram novas vs iguais?
quantos retries foram transitórios?
quantos foram terminais?
```

### Avaliação

Não precisamos de observabilidade sofisticada antes de corrigir os desperdícios comprovados.

Adicionar somente métricas que permitam validar cada correção.

---

# 27. Estado desejado conceitualmente

```text
evento/schedule
↓
buscar somente o necessário
↓
comparar estado relevante
↓
se não mudou:
    não produzir efeito externo
↓
se mudou:
    enfileirar/publicar
↓
medir resultado real
```

Para syncs paginados:

```text
obter população/cursor
↓
avançar sem reconstruir tudo a cada lote
↓
retomar de forma segura
```

Para integrações:

```text
timeout/falha
≠
resultado vazio válido
```

---

# 28. O que NÃO fazer agora

Não devemos:

- adicionar Redis;
- adicionar CDN/cache interno;
- criar nova fila;
- aumentar concorrência do publisher antes de reduzir outboxes;
- aumentar batch size do ML sem entender rate limit;
- colocar cache em todo endpoint;
- adicionar índices por intuição;
- instalar APM apenas para esta limpeza;
- paralelizar indiscriminadamente chamadas externas;
- remover reconciliadores legítimos;
- reduzir polling apenas por aparência;
- otimizar Client Components sem medir;
- alterar frequência do catálogo apenas porque dura minutos.

---

# 29. Dependências para Item 14 — Testes

As correções futuras de performance precisam de testes que garantam:

```text
scan/cursor não pula anúncios
sync sem mudança não cria nova outbox
mudança real cria outbox
timeout DSLite vira falha/retry, não lista vazia
Q segura continua correta
job on_hold continua retomável
retry terminal não volta a rodar indefinidamente
```

---

# 30. Dependências para Item 15 — Históricos

Depois de eliminar fluxos antigos e estruturas não utilizadas, medir impacto de retenção em:

- jobs;
- auditoria;
- short links;
- tabelas temporárias;
- scripts de campanha.

Não apagar histórico operacional útil apenas para reduzir linhas.

---

# 31. Resultado do checklist — Item 13

- [x] Medir duração dos jobs importantes.
- [x] Medir amostras de volume de chamadas externas.
- [x] Identificar retries recorrentes.
- [x] Identificar consultas/processamentos desnecessários comprovados.
- [x] Identificar gargalos reais antes de otimizar.
- [x] Confirmar `sync_ml_listings_observed` como principal gargalo externo medido.
- [x] Identificar scan completo de ~5.900 anúncios repetido para cada lote de 100.
- [x] Comparar o scan atual com o contrato oficial `scroll_id` do Mercado Livre.
- [x] Identificar outboxes de estoque repetidas com a mesma quantidade.
- [x] Rastrear a repetição até timestamps/snapshot e processamento downstream.
- [x] Medir publisher ML e confirmar que reduzir entrada redundante deve preceder aumento de throughput.
- [x] Medir DSLite preço/estoque e confirmar grande variação de latência.
- [x] Registrar ausência de instrumentação por subetapa no DSLite.
- [x] Identificar padrão N+1 como candidato, mas não gargalo comprovado.
- [x] Identificar timeout DSLite de pedidos mascarado como sync vazio bem-sucedido.
- [x] Medir sync de pedidos ML e Brasil NFe.
- [x] Confirmar que Brasil NFe sofre mais por repetição do que por latência.
- [x] Medir refresh completo de catálogo e classificá-lo como trabalho pesado legítimo.
- [x] Manter P1 de catálogo `on_hold`.
- [x] Confirmar lifecycle enganoso do Mercado Pago.
- [x] Evitar recomendação de novos índices sem `EXPLAIN`/evidência.
- [x] Separar gargalo real de otimização especulativa.

---

# 32. Restrições desta etapa

Nesta etapa:

- nenhum benchmark sintético foi executado;
- nenhum load test foi executado;
- nenhum `EXPLAIN ANALYZE` foi executado no banco operacional;
- nenhum índice foi criado/removido;
- nenhum cache foi adicionado;
- nenhum cron foi alterado;
- nenhum batch size foi alterado;
- nenhum worker foi escalado;
- nenhum dado foi modificado;
- nenhum job foi cancelado/reprocessado;
- nenhuma API externa foi chamada manualmente para gerar carga;
- nenhum código foi alterado;
- nenhum deploy foi realizado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise de código dos fluxos medidos;
- consultas somente leitura aos jobs/outbox operacionais;
- comparação com documentação oficial atual do Mercado Livre;
- consulta à documentação oficial atual do Supabase sobre otimização de queries;
- consolidação dos problemas de performance já identificados nos Itens 4–12.

---

# 33. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Vortek — branch `dev`

Arquivos principais analisados:

- `src/lib/sync/registry.ts`
- `src/app/api/sync/cron-dispatch/route.ts`
- `src/app/api/sync/anuncios/route.ts`
- `src/app/api/sync/anuncios/publish/route.ts`
- `src/app/api/sync/preco-estoque/route.ts`
- `src/app/api/sync/preco-estoque-xml/route.ts`
- `src/app/api/sync/dslite-pedidos/route.ts`
- `src/services/dslite.ts`
- `src/services/catalog-refresh-job.ts`
- `src/lib/sync/ml-publish-outbox.ts`
- `src/lib/produto-fornecedor.ts`
- `src/lib/estoque-interno.ts`
- `src/lib/estoque-interno-saldo.ts`
- `src/lib/ml/automatic-pricing.ts`
- `src/lib/ml/automatic-pricing-selection.ts`
- `src/app/api/compras/route.ts`

## Banco operacional — somente leitura

Amostras consultadas:

- `jobs`;
- `anuncios_ml_outbox`.

Nenhum dado sensível foi reproduzido.

## Mercado Livre — documentação oficial

Itens e buscas / scan acima de 1.000 registros:

`https://developers.mercadolivre.com.br/pt_br/itens-e-buscas`

A documentação informa:

- uso de `search_type=scan`;
- `scroll_id`;
- mesmo `scroll_id` para avançar;
- expiração aproximada de 5 minutos;
- limite máximo de 100 por resposta.

## Supabase — documentação oficial

Query Optimization:

`https://supabase.com/docs/guides/database/query-optimization`

Indexes:

`https://supabase.com/docs/guides/database/postgres/indexes`

---

# 34. Conclusão final do Item 13

A performance do Vortek **não pede uma nova infraestrutura**.

O maior ganho disponível é eliminar trabalho que o sistema já sabe — ou pode saber — que não precisa fazer.

Os três achados mais importantes são:

```text
1. não reconstruir os ~5.900 IDs do ML para cada lote de 100

2. não publicar novamente a mesma quantidade de estoque
   apenas porque o timestamp de sync mudou

3. não considerar timeout DSLite como “zero pedidos”
```

Depois dessas correções, devem ser medidas novamente:

- duração do ML observado;
- volume da outbox;
- throughput do publisher;
- latência DSLite.

Somente então faz sentido avaliar:

- batch de queries;
- paralelismo;
- índices;
- cache.

O **Item 13 está concluído**.

O P0 do Item 9 continua pendente e permanece prioritário antes do futuro checklist de execução.
