# Vortek — Auditoria de Limpeza e Organização

## Item 16 — Consolidação da Auditoria

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Base consolidada:** Itens 1 a 15  
**Objetivo:** consolidar todos os achados em **manter / corrigir / simplificar / consolidar / remover / investigar mais**, separar complexidade necessária de complexidade acidental, classificar riscos P0–P3 e registrar dependências para o futuro plano de execução.

---

# 1. Conclusão executiva

A conclusão global da auditoria é:

**o Vortek não precisa ser reescrito nem receber uma nova arquitetura.**

O núcleo do sistema é funcional e, em vários domínios, possui boas decisões de engenharia:

```text
produto mestre
+
ofertas por fornecedor
+
fulfillment internal | supplier
+
ledgers auditáveis
+
outbox Mercado Livre
+
jobs persistidos
+
locks
+
webhooks + reconciliadores
+
Brasil NFe
+
snapshots externos
+
testes direcionados
```

A maior dívida está nas bordas e nas camadas acumuladas ao longo da evolução:

```text
regras duplicadas
+
estados derivados sobrepostos
+
compatibilidades antigas
+
chamadas externas repetidas
+
retries sem condição terminal
+
scripts/campanhas históricas
+
documentação/configuração antiga
+
permissões inconsistentes
```

Portanto, a estratégia correta não é:

```text
reestruturar tudo
```

e sim:

```text
corrigir riscos
→ consolidar fontes de verdade
→ eliminar trabalho inútil
→ simplificar fluxos
→ remover histórico confirmado
→ organizar a interface
```

A regra central para o futuro plano é a mesma definida no `AGENTS.md` atual:

```text
corrigir
→ remover
→ reutilizar
→ consolidar
→ simplificar
→ só então adicionar
```

---

# 2. Avaliação geral da arquitetura

## Núcleo

**Saudável e deve ser preservado.**

Não foi encontrada justificativa para:

- microserviços;
- Redis;
- nova fila externa;
- novo banco;
- WMS separado;
- IAM externo;
- novo framework de regras;
- reescrita da interface;
- substituição de Supabase;
- substituição do Brasil NFe;
- substituição da DSLite;
- substituição do mecanismo de jobs.

## Dívida operacional

**Relevante.**

Existem P0/P1 que podem causar:

- exposição de segurança;
- overselling futuro;
- erro financeiro;
- chamadas externas incorretas;
- falhas silenciosas;
- jobs que parecem saudáveis sem estarem;
- desperdício grande de API.

## Dívida de organização

**Média/alta.**

Principalmente em:

- UI;
- scripts;
- reports;
- estados históricos;
- regras duplicadas;
- auditoria/eventos;
- tipos;
- nomenclatura.

## Dívida estrutural profunda

**Baixa.**

A maior parte dos problemas pode ser resolvida evoluindo mecanismos que já existem.

---

# 3. Complexidade necessária — MANTER

Os itens abaixo não devem ser tratados como “lixo”.

## 3.1 Produtos + Fornecedores

**Manter**

```text
produtos
produto_fornecedor_ofertas
SKU VTK
oferta preferencial
snapshot operacional da oferta preferencial
```

Motivo:

- produto interno não depende de um fornecedor;
- múltiplos fornecedores são reais;
- snapshot preferencial é derivado operacional útil.

---

## 3.2 Kits

**Manter**

```text
produto_kits
produto_kit_componentes
estoque/custo derivados dos componentes
```

Não criar estoque físico independente de kit.

---

## 3.3 Fulfillment

**Manter**

```text
internal | supplier
select_order_fulfillment
bloqueio contra dupla origem
pedido integral por uma origem
```

Regra de negócio confirmada:

```text
nunca dividir pedido entre internal e supplier
```

---

## 3.4 Estoque interno

**Manter**

```text
ledger de movimentações
devolução em revisão
liberação física
não aproveitável
estorno sem apagar histórico
```

A movimentação auditável é uma boa base.

---

## 3.5 Mercado Livre

**Manter**

```text
anuncios_ml
anuncios_ml_outbox
catalogo_ml_snapshot
sync observado
worker de publicação
blocklist manual
verificação pós-publicação
reconciliação
```

A separação:

```text
estado desejado
≠
estado observado
```

é correta.

---

## 3.6 Fiscal

**Manter**

```text
Brasil NFe
ensure idempotente
reconciliação local
busca de NF existente
XML autorizado
chave/protocolo
auditoria
vínculo no shipment
verificação pós-upload
```

Não simplificar o fiscal eliminando recuperação legítima.

---

## 3.7 Compras + Financeiro

**Manter**

```text
compras DSLite
balance_account
prepaid_pix
supplier_balance_movements
mercadopago_account_movements
créditos de fornecedor
comprovantes
```

Mercado Pago bruto e ledger interno devem continuar separados.

---

## 3.8 Jobs + Scheduler

**Manter**

```text
SYNC_TASKS
pg_cron
pg_net
jobs
sync_domain_locks
on_hold
retry
backoff
stale recovery
outbox realtime
hidratação ML
refresh durável de catálogo
```

Não trocar a infraestrutura.

---

## 3.9 Webhooks + Reconciliadores

**Manter**

```text
webhook = reação rápida
reconciliador = garantia
```

Pares legítimos:

```text
orders_v2 + sync de pedidos
items + sync observado
shipments + sync de pedidos
claims + hidratação
Mercado Pago webhook + relatório contábil
```

---

## 3.10 Banco

**Manter**

- ledgers;
- snapshots necessários;
- views operacionais;
- migrations aplicadas;
- histórico fiscal/financeiro/estoque necessário;
- constraints e índices úteis.

---

## 3.11 Testes

**Manter**

```text
node:test
testes direcionados
npm run validate
build quando aplicável
```

Não adicionar framework de testes sem necessidade comprovada.

---

## 3.12 Scripts operacionais

**Manter**

- backup;
- restore;
- deploy;
- diagnóstico;
- proteção de secrets;
- recovery atual;
- smoke tests de integrações atuais.

---

# 4. CORRIGIR — P0

## SEC-01 — controle de `cargo`

**Prioridade:** P0  
**Área:** Auth / Banco / API

Problemas confirmados:

```text
/api/auth/register
→ aceita cargo controlado pelo caller

profiles
→ authenticated pode atualizar a própria linha
→ cargo está na mesma linha
```

Consequência potencial:

```text
autoelevação de privilégio
```

Decisão do usuário:

**risco aceito temporariamente para concluir a auditoria.**

Obrigatório no futuro plano antes de grandes refatorações:

```text
usuário não escolhe cargo
+
usuário não altera cargo
+
mudança de cargo somente administrativa
```

### Dependências

Antes de:

- consolidar permissões web;
- refatorar Configurações;
- confiar em UI por cargo.

---

## SEC-02 — credencial versionada em `GUIDE.md`

**Prioridade:** P0/P1  
**Área:** Segurança / Git / Documentação

Foi encontrada credencial administrativa literal no repositório.

A validade atual **não foi testada**.

Tratar como potencialmente comprometida:

```text
remover do estado atual
+
rotacionar/revogar se aplicável
+
avaliar histórico Git
```

A rotação tem prioridade sobre rewrite de histórico.

### Dependências

Independente das demais refatorações.

---

# 5. CORRIGIR — P1

## SEC-03 — autorização web não aplica matriz de permissões

**Prioridade:** P1

Hoje:

```text
mobile
→ permission check real

web
→ authorizeApiRequest valida principalmente autenticação
```

A matriz atual deve servir:

```text
web + mobile
```

### Depende de

`SEC-01`.

---

## SEC-04 — secrets retornados ao browser

**Prioridade:** P1

`/api/integracoes/config` devolve material sensível ao cliente admin.

Direção:

```text
browser recebe:
configured / masked state

backend recebe novo secret apenas quando alterado
```

Não mascarar apenas visualmente mantendo o valor no JavaScript.

---

## SEC-05 — links públicos sensíveis sem expiração real

**Prioridade:** P1

Afeta:

- XML;
- DANFE;
- etiqueta;
- comprovante fornecedor.

O schema de `short_links` já possui:

```text
expires_at
```

mas não está sendo usado nesses fluxos.

### Direção

Reutilizar o padrão expirável já existente nos links de fornecedor.

---

## SEC-06 — Next.js fora de suporte

**Prioridade:** P1

O projeto atual está em:

```text
Next.js 14.2.35
```

A linha 14 está fora da política LTS atual.

### Direção

Upgrade isolado para linha suportada, com:

```text
validate
build
testes afetados
```

Não misturar esse upgrade com refatoração grande de UI.

---

## SEC-07 — secrets em `sync_runtime_config`

**Prioridade:** P1

A tabela mistura:

```text
configuração comum
+
material sensível
```

Não foi comprovada exposição pública direta porque há proteção RLS.

### Direção

Separar secrets de configuração comum usando mecanismo já suportado no ambiente self-hosted.

Não criar criptografia própria.

---

## STO-01 — reserva de estoque interno não atômica

**Prioridade:** P1

Problema:

```text
selecionar internal
+
validar saldo
```

não ocorre na mesma operação atômica que:

```text
reservar quantidade
```

Risco:

```text
duas vendas enxergarem a mesma unidade
```

### Direção

Evoluir PostgreSQL/RPC/ledger existentes.

Não criar Redis/fila de estoque.

---

## STO-02 — origem `internal` gravada antes de estoque garantido

**Prioridade:** P1

Deve ser resolvido **junto de STO-01**, não por fallback.

### Dependência

Mesmo change-set conceitual de reserva.

---

## ML-01 — migração de Preços por Quantidade

**Prioridade:** P1 com prazo  
**Prazo externo:** antes de `2026-10-26`

O modelo atual de quantity pricing precisa migrar para o contrato percentual B2B atual do Mercado Livre.

### Dependências

- consolidar regra de atacado;
- teste dedicado;
- não depender de preview local divergente.

---

## ML-02 — scan completo repetido a cada lote

**Prioridade:** P1

Estado medido:

```text
~5.900 anúncios
119 páginas scan
→ processar apenas 100
→ repetir scan completo no próximo offset
```

Esse é o maior gargalo externo medido.

### Direção

Processar uma população/cursor de forma retomável sem reconstruir tudo a cada lote.

Sem nova fila externa.

---

## ML-03 — outbox de estoque repetida sem mudança

**Prioridade:** P1

Estado observado:

```text
mesma desired_quantity
→ novas outboxes em ciclos sucessivos
```

Causa estrutural:

```text
timestamp de sync participa da mudança
+
todos os snapshots seguem para automação
```

### Direção

Produzir efeito externo somente quando:

```text
quantidade/status relevante mudou
```

### Depende de

`STO-01/STO-02` e consolidação da quantidade segura para solução definitiva.

---

## FIS-01 — chamadas fiscais ML inválidas

**Prioridade:** P1

Hoje:

```text
PUT JSON
→ falha
POST JSON
→ falha
POST XML
→ sucesso
```

### Direção

```text
GET
→ POST XML se novo
→ PUT XML se atualização
→ GET verificar
```

---

## FIS-02 — upload sem gate de shipment

**Prioridade:** P1

Antes de enviar XML:

```text
status = ready_to_ship
substatus = invoice_pending
```

precisa estar válido.

Hoje existem `invalid_shipment` reais.

---

## FIS-03 — Brasil NFe `not_found` repetido indefinidamente

**Prioridade:** P1

Um resultado determinístico volta a ser consultado continuamente.

### Direção

Distinguir:

```text
transitório
terminal
reaberto por mudança real
```

Não adicionar outro reconciliador.

---

## FIN-01 — lifecycle assíncrono Mercado Pago incompleto

**Prioridade:** P1

Hoje:

```text
relatório solicitado
→ 202/pending
→ job completo
```

sem garantia de retomada da mesma tarefa.

### Direção

Fechar o mesmo lifecycle:

```text
requested
→ processing
→ processed
→ download
→ import
```

---

## FIN-02 — parser Mercado Pago não prioriza valor líquido oficial

**Prioridade:** P1

Antes de confiar em crédito automático, o parser deve tratar corretamente campos oficiais, principalmente:

```text
SETTLEMENT_NET_AMOUNT
```

e tipo/moeda oficiais.

### Dependência

Corrigir junto com `FIN-01`.

---

## JOB-01 — catálogo `on_hold` pode ficar órfão

**Prioridade:** P1

Há evidência operacional de job:

```text
catalogo_no_catalogo_refresh
→ on_hold
→ sem retomada por horas
```

### Direção

Descobrir por que o mecanismo existente não retomou.

Não criar outro cron.

---

## DSL-01 — timeout DSLite mascarado como sucesso vazio

**Prioridade:** P1

Foi observado:

```text
~60s
→ 0 registros
→ job completo
```

quando o helper pode ter retornado `null` por timeout/falha.

### Direção

Falha externa deve permanecer falha/retry, não “lista vazia válida”.

---

# 6. SIMPLIFICAR / CONSOLIDAR — P2

## RULE-01 — capacidade de fulfillment + quantidade segura

**Categoria:** Consolidar  
**Prioridade:** P2 estrutural / alta relevância

A regra confirmada é:

```text
Q_segura = max(Q_internal, Q_supplier)
```

Nunca:

```text
Q_internal + Q_supplier
```

Hoje não há implementação única.

### Direção

Criar/reutilizar funções de domínio explícitas:

```text
capacidade internal
capacidade supplier
Q segura
```

Sem `AvailabilityEngine`.

### Depende de

`STO-01/STO-02`.

---

## RULE-02 — pricing 4% x 5%

**Categoria:** Consolidar  
**Prioridade:** P2

Não foi comprovado que uma das taxas seja globalmente errada.

O problema é:

```text
dois contextos
+
fórmulas locais
+
ownership ambíguo
```

### Direção

`services/pricing.ts` deve ser a fonte e os contextos precisam ser nomeados/explicados.

---

## RULE-03 — modo de pagamento do fornecedor

**Categoria:** Consolidar  
**Prioridade:** P2

Fonte correta já existe:

```text
offer.payment_mode
+
inferência por fornecedor como fallback
```

O preview de Pedidos deve reutilizar essa regra.

---

## RULE-04 — threshold de produto inativo

**Categoria:** Consolidar  
**Prioridade:** P2

Já existe:

```text
product-activity.ts
```

O pricing automático não deve repetir `cost > 2000`.

---

## RULE-05 — status fiscal canônico

**Categoria:** Consolidar  
**Prioridade:** P2

Distinguir:

```text
status bruto externo
status técnico normalizado
status persistido
```

Sem enum global entre domínios.

---

## RULE-06 — elegibilidade de publicação ML

**Categoria:** Consolidar  
**Prioridade:** P2

Anúncios `under_review/closed/inactive` podem ser reenfileirados e só falham no worker.

### Direção

A regra ML de:

```text
modificável?
terminal?
retry?
```

deve ser reutilizada por producer e worker.

---

## RULE-07 — tipos do ledger financeiro

**Categoria:** Consolidar  
**Prioridade:** P2

TypeScript deve refletir tipos reais usados:

```text
topup
purchase_debit
adjustment
manual_credit
cancellation_credit
credit_usage
...
```

Sem casts dispersos.

---

## JOB-02 — `/sync/run` x `/sync/disparar`

**Categoria:** Consolidar  
**Prioridade:** P2

As rotas duplicam lógica interna de:

- resolver task;
- criar/retomar job;
- disparar.

### Direção

Compartilhar a implementação interna e manter fronteiras de autenticação/origem diferentes.

Não criar terceira rota.

---

## JOB-03 — saúde fragmentada das famílias de jobs

**Categoria:** Simplificar  
**Prioridade:** P2

Tasks do registry têm health.

Jobs duráveis externos podem não ter o mesmo monitoramento.

### Direção

Permitir detectar:

```text
job que deveria avançar e não avança
```

sem obrigar todas as filas a virar `SYNC_TASKS`.

---

## JOB-04 — status/métricas de jobs ambíguos

**Categoria:** Consolidar  
**Prioridade:** P2

Existem:

```text
completo
concluido
```

e `processados/total` possui significados diferentes.

### Direção

Normalizar writers antes de adicionar constraint.

---

## UI-01 — separar Pedidos por responsabilidades reais

**Categoria:** Simplificar  
**Prioridade:** P2

Extrair somente blocos independentes, por exemplo:

- fluxo DSLite;
- pagamento fornecedor;
- etiqueta/WhatsApp.

Não dividir a página por quantidade de linhas.

### Depende de

- fulfillment/Q segura;
- payment mode;
- autorização.

---

## UI-02 — separar Produtos/Catálogo por fluxo

**Categoria:** Simplificar  
**Prioridade:** P2

Principal oportunidade:

```text
tracking de publicação ML
```

duplicado entre Produtos e Catálogo.

### Direção

Uma implementação client-side específica desse fluxo.

---

## UI-03 — Configurações por seções

**Categoria:** Simplificar  
**Prioridade:** P2

Separar tabs/responsabilidades mantendo a mesma rota.

### Depende de

`SEC-01`, `SEC-03`, `SEC-04`.

---

## UI-04 — DTO real de Pedidos

**Categoria:** Consolidar  
**Prioridade:** P2

A UI tipa payload enriquecido como row bruta e usa muitos:

```text
as any
```

### Direção

Definir contrato real da API operacional.

Não executar campanha genérica de remoção de `any`.

---

## UI-05 — Perguntas filtra somente página atual

**Categoria:** Corrigir  
**Prioridade:** P2

A UI apresenta busca/data como se fossem globais, mas filtra somente as 100 perguntas carregadas.

### Direção

Alinhar semântica UI/API.

---

## UI-06 — Compras refaz chamadas independentes

**Categoria:** Simplificar  
**Prioridade:** P2

Separar:

```text
lista/resumo dependente de filtros
```

de:

```text
saldo Hayamax / alertas ML
```

Sem cache novo.

---

## DB-01 — campos derivados sobrepostos

**Categoria:** Consolidar  
**Prioridade:** P2

Exemplos:

```text
situacao_estoque x disponivel_venda
nfe_status x nota_fiscal_emitida
ml_invoice_reported / ml_invoice_id
```

### Direção

Mapear leitores/escritores e manter uma semântica canônica antes de remover.

---

## DB-02 — auditoria `nf_auditoria_eventos`

**Categoria:** Consolidar  
**Prioridade:** P2

Hoje guarda:

- fiscal;
- webhooks;
- WhatsApp;
- pagamento;
- alertas.

### Direção

Definir se vira auditoria operacional genérica ou se parte do conteúdo será removida.

Não criar outra tabela antes dessa decisão.

---

## DB-03 — disciplina de RLS/grants

**Categoria:** Corrigir/Consolidar  
**Prioridade:** P2

Antes de mudanças destrutivas, capturar o estado operacional real de:

```text
RLS
grants
policies
constraints
indexes
default privileges
```

Toda tabela em schema exposto deve ter postura explícita.

---

## WEBHOOK-01 — identidade de notificações ML

**Categoria:** Melhorar observabilidade  
**Prioridade:** P2

Persistir metadados úteis como `_id`/`attempts` quando aplicável.

Não deduplicar permanentemente por `resource`.

---

## WEBHOOK-02 — ACK positivo após falha interna

**Categoria:** Corrigir  
**Prioridade:** P2

`questions/items` podem responder 200 após falha de leitura.

Avaliar por domínio:

```text
há reconciliação real?
→ pode ACK

não há caminho posterior?
→ não confirmar silenciosamente
```

---

## WEBHOOK-03 — Mercado Pago `payment_lookup_failed`

**Categoria:** Corrigir  
**Prioridade:** P2

404 é persistido e ACK 200 encerra retry do provedor.

Deve ser resolvido dentro da estratégia financeira consolidada de `FIN-01/FIN-02`.

---

## TEST-01 — suíte crítica

**Categoria:** Consolidar  
**Prioridade:** P2

Depois da limpeza histórica, criar um comando estável conceitualmente como:

```text
test:critical
```

sem incluir campanhas antigas apenas porque existem.

---

# 7. REMOVER — após confirmação

Os itens abaixo são **candidatos fortes**, mas a remoção deve obedecer dependências.

## HIST-01 — cluster `ml-p0-*`

**Prioridade:** P2  
**Categoria:** Remover se campanha encerrada

Inclui:

- scripts;
- libs;
- 19 testes;
- reports;
- comandos npm;
- tabelas atuais;
- jobs/históricos relacionados.

### Condição

Confirmar que:

```text
campanha acabou
+
nenhum consumidor atual
+
evidências necessárias foram preservadas
```

### Banco

Remover tabelas por **nova migration**.

Não apagar migrations históricas.

---

## HIST-02 — `whatsapp_alert_events`

**Prioridade:** P2

Tabela vazia e fluxo atual usa outra auditoria.

### Condição

Buscar readers/writers restantes.

---

## HIST-03 — `ops_whatsapp_events`

**Prioridade:** P2

Sem atividade recente e sem inbound WAHA web atual.

### Condição

Confirmar ausência de serviço/script externo.

---

## HIST-04 — scripts/reports one-off

**Prioridade:** P2

Remover por cluster após confirmar função encerrada.

Exemplos de perfil:

- scripts datados;
- campanhas SEO;
- reparos específicos;
- batches aprovados;
- scripts de fornecedor.

---

## HIST-05 — `Panasonic.xls` + importador

**Prioridade:** P2

Remover/arquivar juntos se onboarding/importação já encerrou.

---

## HIST-06 — `scripts/build_dataset/`

**Prioridade:** P2

Forte candidato a experimento histórico se não existir iniciativa atual de fine-tuning.

---

## HIST-07 — `opencode.json`

**Prioridade:** P2

Aponta para caminho repo-local inexistente.

### Decisão

```text
OpenCode em uso
→ corrigir

não está em uso
→ remover
```

---

## HIST-08 — `RTK.md`

**Prioridade:** P2/P3

Contradiz `AGENTS.md`.

### Decisão

```text
consumido por ferramenta
→ reduzir para apontar AGENTS

sem consumidor
→ remover
```

---

## HIST-09 — aliases antigos

**Prioridade:** P3

Remover somente depois de migrar os consumidores:

- nomes de sync;
- tópicos antigos;
- status/compatibilidades sem uso.

---

# 8. INVESTIGAR MAIS antes de alterar

## INV-01 — DSLite API x XML

Ambos atualizam preço/estoque e compartilham lock.

Precisamos confirmar:

```text
fonte principal?
fallback?
reconciliador?
legado?
```

Não remover nenhum antes disso.

---

## INV-02 — helpers antigos de estoque Mercado Livre

Existem caminhos antigos além de `stock-publish.ts`.

Confirmar todos os chamadores antes de remover.

---

## INV-03 — identidade final de oferta

Migration inicial e estado operacional não parecem representar a mesma identidade.

Antes de alteração de schema:

```text
capturar constraints/indexes reais
```

---

## INV-04 — `postpaid`

Existe no domínio histórico, mas não foi observado em uso atual relevante.

Confirmar consumers antes de remover.

---

## INV-05 — automação de preço nativa ML

Antes de elevar prioridade do pre-check, confirmar se existem anúncios atuais com automação nativa ativa.

---

## INV-06 — tópicos ML modernos

Ex.:

```text
catalog_item_competition_status
stock_locations
```

Só adicionar se houver benefício operacional comprovado.

---

## INV-07 — secret store no Supabase self-hosted

Antes de mover secrets de `sync_runtime_config`, confirmar mecanismo disponível/configurado.

---

## INV-08 — índices/query plans

Não criar índices novos sem:

```text
EXPLAIN
pg_stat/medição
```

de query realmente problemática.

---

## INV-09 — retenção de jobs/auditoria/short links

Medir volume antes de definir políticas de purge.

---

# 9. Dependências entre mudanças

## 9.1 Segurança

```text
SEC-01 cargo
↓
SEC-03 permissions web/mobile
↓
UI por permissão / Sidebar / Configurações
```

```text
SEC-02 credencial GUIDE
→ independente
→ fazer cedo
```

```text
SEC-04 secrets browser
+
SEC-07 runtime secrets
→ antes de refatorar Configurações
```

---

## 9.2 Estoque / Fulfillment / Mercado Livre

```text
STO-01 + STO-02
reserva/seleção coerente
↓
RULE-01
capacidade internal/supplier
↓
Q_segura
↓
ML-03
publicar somente quantidade realmente alterada
```

Esse é um único encadeamento de fonte de verdade.

Não corrigir `Q_segura` copiando fórmulas antes da reserva.

---

## 9.3 Mercado Livre performance

```text
ML-02 scan
→ independente de fulfillment
```

Pode ser corrigido separadamente.

```text
ML-01 quantity pricing
→ prazo externo
→ precisa de regra atacado central
```

---

## 9.4 Fiscal

```text
FIS-01
+
FIS-02
+
FIS-03
```

são do mesmo domínio, mas devem ser mudanças pequenas separáveis:

1. contrato upload;
2. gate shipment;
3. retry terminal.

Não misturar com limpeza de campos fiscais P2.

---

## 9.5 Mercado Pago

```text
FIN-01 lifecycle
+
FIN-02 parser
```

devem ser tratados juntos antes de confiar em automação financeira.

Depois:

```text
WEBHOOK-03
```

pode ser integrado à mesma estratégia de reconciliação.

---

## 9.6 Jobs

```text
JOB-01 on_hold catálogo
→ corrigir causa
```

antes de:

```text
JOB-03 health genérico
```

Não criar observabilidade genérica para esconder um lifecycle quebrado.

---

## 9.7 Interface

Somente depois das fontes de verdade:

```text
auth
fulfillment
pricing
ML tracking
```

estarem consolidadas.

Evitar mover regra duplicada para componentes novos.

---

## 9.8 Limpeza histórica

Antes de remover cluster:

```text
consumidores confirmados
+
teste permanente separado
+
evidência arquivada
+
schema atual conhecido
```

Depois remover:

```text
referências
→ scripts
→ tests históricos
→ reports
→ dependências sem consumidor
→ objetos de banco por migration
```

---

# 10. Complexidade necessária x acidental

## Necessária

- integrações externas;
- webhooks;
- polling de reconciliação;
- retries transitórios;
- jobs duráveis;
- outbox;
- locks;
- snapshots;
- ledgers;
- auditoria;
- estados fiscais;
- confirmação manual de PIX;
- devolução em revisão;
- oferta preferencial;
- múltiplos fornecedores;
- kits;
- UI operacional rica.

## Acidental

- retry determinístico;
- chamada impossível repetida;
- regra copiada;
- estado derivado duplicado;
- rota de dispatch duplicada;
- script de campanha abandonado;
- report permanente de operação concluída;
- secret em documentação;
- token público sem expiração;
- job “completo” sem concluir operação;
- scan externo reconstruído repetidamente;
- UI grande por mistura de fluxos independentes.

---

# 11. Resumo de prioridades

## P0

1. controle de `cargo`;
2. credencial versionada — tratar como comprometida até confirmar/rotacionar.

## P1 — segurança/confiabilidade

- autorização web;
- secrets no browser;
- links públicos expirantes;
- Next.js suportado;
- secrets runtime;
- reserva interna atômica;
- upload fiscal correto;
- gate fiscal;
- Brasil NFe terminal;
- Mercado Pago lifecycle/parser;
- catálogo on_hold;
- timeout DSLite.

## P1 — eficiência/contrato externo

- scan ML repetido;
- outbox de estoque repetida;
- migração de quantity pricing antes de 26/10/2026.

## P2

- regras compartilhadas;
- UI;
- job taxonomy/health;
- campos derivados;
- auditoria/eventos;
- RLS consistency;
- scripts/reports históricos;
- tabelas antigas;
- aliases;
- tipagem.

## P3

- nomenclaturas;
- pequenos adapters/aliases;
- organização cosmética residual.

---

# 12. O que NÃO deve aparecer no Item 17

O futuro plano **não deve** propor:

- reescrita;
- microserviços;
- Redis;
- fila externa;
- WMS completo;
- novo design system;
- RulesEngine;
- IAM externo;
- nova tabela para cada problema;
- novo cron para corrigir retry;
- cache antes de eliminar trabalho inútil;
- novo framework de teste;
- refatoração estética;
- big bang de banco/interface.

---

# 13. Critério para cada futura ação

Cada ação do Item 17 deverá responder:

## Problema

O que está comprovadamente errado ou desnecessário?

## Fonte de verdade

Qual mecanismo atual deve ser o dono?

## Mudança

Qual é a menor alteração correta?

## Dependências

O que precisa estar resolvido antes?

## Validação

Qual teste/consulta/checagem prova que funcionou?

## Rollback

Como voltar com segurança, quando aplicável?

---

# 14. Gate de validação consolidado

Para cada ação futura:

```text
teste direcionado
+
npm run validate
+
build quando aplicável
+
validação de banco/integração quando aplicável
```

Quando o P0/P1 ainda não possui teste:

```text
teste de regressão nasce junto da correção
```

Depois da remoção das campanhas históricas, criar uma suíte crítica permanente.

---

# 15. Resultado do checklist — Item 16

- [x] Consolidar todos os achados dos Itens 1–15.
- [x] Registrar o que deve ser **manter**.
- [x] Registrar o que deve ser **corrigir**.
- [x] Registrar o que deve ser **simplificar**.
- [x] Registrar o que deve ser **consolidar**.
- [x] Registrar candidatos a **remover**.
- [x] Registrar pontos que precisam **investigar mais**.
- [x] Separar complexidade necessária de complexidade acidental.
- [x] Classificar riscos em P0, P1, P2 e P3.
- [x] Consolidar dependências entre mudanças.
- [x] Confirmar que a arquitetura principal deve ser preservada.
- [x] Confirmar que a limpeza deve ocorrer por mudanças pequenas e reversíveis.
- [x] Registrar o P0 do Item 9 como risco aceito temporariamente, mas obrigatório no futuro plano.
- [x] Registrar prazo do Mercado Livre de `2026-10-26`.
- [x] Definir critérios obrigatórios para cada ação do Item 17.
- [x] Definir gate mínimo de validação.

---

# 16. Restrições desta etapa

Nesta etapa:

- nenhum código foi alterado;
- nenhum arquivo do repositório foi removido;
- nenhuma migration foi criada/executada;
- nenhum dado foi modificado;
- nenhum secret foi rotacionado;
- nenhum cron/job foi alterado;
- nenhum teste foi executado;
- nenhum build foi executado;
- nenhum deploy foi realizado.

Foi realizada somente a consolidação dos achados já levantados nos Itens 1–15, com nova conferência do `AGENTS.md` e do estado atual do repositório `dev`.

---

# 17. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md` — branch `dev`, revisado em `2026-08-26`.

## Auditorias consolidadas

- Item 1 — Mapa Geral do Sistema
- Item 2 — Pedidos + Fulfillment + Estoque Interno
- Item 3 — Produtos + Fornecedores + Kits
- Item 4 — Mercado Livre — Anúncios e Catálogo
- Item 5 — Fiscal
- Item 6 — Compras + Fornecedores + Financeiro
- Item 7 — Sincronizações + Jobs + Scheduler
- Item 8 — Webhooks + Eventos
- Item 9 — Auth + Segurança + Permissões
- Item 10 — Banco de Dados
- Item 11 — Interface Web
- Item 12 — Regras de Negócio Compartilhadas
- Item 13 — Performance e Saúde Operacional
- Item 14 — Testes e Validação
- Item 15 — Scripts + Documentação + Arquivos Históricos

## Documentação oficial reconfirmada nesta consolidação

### Supabase
Row Level Security:
`https://supabase.com/docs/guides/database/postgres/row-level-security`

### Next.js
Support Policy:
`https://nextjs.org/support-policy`

### Mercado Pago
Relatório Dinheiro em Conta:
`https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/introduction`

### GitHub
Removing sensitive data:
`https://docs.github.com/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository`

### Mercado Livre
As decisões específicas e o prazo de quantity pricing permanecem baseados na documentação oficial consultada e registrada no Item 4.

---

# 18. Conclusão final do Item 16

A auditoria está consolidada.

A resposta para a pergunta central — “quanto o Vortek precisa ser reestruturado?” — é:

```text
reestruturação profunda: não

correções operacionais: sim, relevantes

consolidação de regras: sim

limpeza de bordas/histórico: bastante

organização da interface: sim, depois das regras

nova arquitetura: não
```

O Vortek deve sair deste processo:

```text
com menos código histórico
+
menos chamadas externas inúteis
+
menos fontes de verdade
+
permissões coerentes
+
estoque seguro
+
jobs mais confiáveis
+
regras mais centralizadas
+
UI mais simples
```

sem perder:

```text
automação
resiliência
auditoria
reconciliação
integrações
```

O **Item 16 está concluído**.

O próximo e último item da coleta é:

**Item 17 — criar o plano de execução.**

Esse plano deve transformar esta consolidação em um **checklist de ações pequenas, ordenadas por risco e dependência**, que serão executadas uma por vez e validadas antes da próxima.
