# Vortek — Auditoria de Limpeza e Organização

## Item 14 — Testes e Validação

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Observação:** o P0 de autorização identificado no Item 9 foi aceito temporariamente como risco conhecido pelo usuário e continua obrigatório no futuro plano de execução.  
**Objetivo:** mapear os testes existentes por domínio, identificar operações críticas protegidas e sem proteção, e definir o conjunto mínimo de validação que deve acompanhar cada ação futura de limpeza.

---

## 1. Conclusão executiva

O Vortek **já possui uma quantidade relevante de testes**, mas a cobertura é desigual.

Foram identificados:

```text
74 arquivos *.test.js
```

no diretório:

```text
tests/
```

O projeto usa principalmente o test runner nativo do Node:

```text
node:test
node:assert
```

A base de testes protege bem várias regras puras e invariantes importantes:

- oferta preferencial;
- estoque interno;
- seleção de fulfillment;
- idempotência de jobs;
- stale jobs;
- registry/scheduler;
- hidratação Mercado Livre;
- contratos/safety DSLite;
- permissões mobile;
- pricing específico;
- estados/listings Mercado Livre;
- catálogo;
- GTIN;
- partes fiscais.

Porém os riscos mais importantes encontrados nesta auditoria estão justamente em áreas que ainda não possuem teste de regressão claro.

### Lacunas prioritárias

**P0/P1**
1. autoelevação/alteração de `cargo`;
2. autorização web usando a mesma matriz de permissões do mobile;
3. quantidade segura `Q_segura`;
4. reserva interna atômica;
5. sync ML sem rescan completo por lote;
6. sync sem mudança não criar nova outbox de estoque;
7. timeout DSLite não virar lista vazia bem-sucedida;
8. lifecycle/parser Mercado Pago;
9. upload fiscal ML sem PUT/POST JSON inválidos e com gate `invoice_pending`;
10. Brasil NFe `not_found` terminal não repetir indefinidamente;
11. links públicos sensíveis realmente expirarem;
12. job de catálogo `on_hold` ser retomado.

### Conclusão principal

O Vortek **não precisa de uma campanha genérica de cobertura** antes da limpeza.

A regra futura deve ser:

```text
cada correção crítica
→ ganha o teste mínimo que prova aquela regra

cada refatoração
→ reutiliza os testes existentes do domínio

mudança transversal
→ validate/build quando aplicável
```

Não buscar cobertura percentual arbitrária.

---

# 2. Ferramenta de testes atual

O projeto root declara:

```text
Node >=22 <23
```

e os testes usam o módulo nativo:

```text
node:test
```

A documentação oficial atual do Node 22 confirma que o test runner é estável e que:

```text
node --test
```

descobre arquivos no padrão:

```text
*.test.js
```

entre outros.

### Avaliação

**Manter o test runner nativo.**

Não existe justificativa atual para adicionar:

- Jest;
- Vitest;
- Mocha;
- Playwright;
- Cypress;

apenas para padronizar testes existentes.

Adicionar uma ferramenta nova só deve ocorrer se um tipo de comportamento crítico não puder ser validado de forma simples com a infraestrutura atual.

---

# 3. Scripts de validação do projeto

O `package.json` atual possui:

```text
npm run typecheck
npm run lint
npm run validate
npm run build
```

onde:

```text
validate = lint + typecheck
```

Também existem scripts `test:*` direcionados.

### Ponto importante

Não existe atualmente:

```text
"test": "..."
```

como script raiz que represente a suíte geral ou crítica do Vortek.

### Avaliação

**P2 — organização de validação.**

No futuro plano, vale criar um comando explícito para a suíte crítica estável.

Não precisa ser toda a pasta `tests/` enquanto os testes de campanhas históricas ainda não forem classificados no Item 15.

---

# 4. Testes expostos em scripts npm

O `package.json` expõe scripts direcionados principalmente para:

```text
ml-p0-*
ml-order-status
mobile-auth
```

Ao mesmo tempo, o diretório `tests/` contém muitos outros testes operacionais importantes que não possuem script dedicado.

### Avaliação

Isso não torna os testes inúteis, porque podem ser executados diretamente com `node --test`.

Porém dificulta responder rapidamente:

```text
qual é o gate mínimo antes de deploy?
```

A futura consolidação deve criar um comando simples para isso.

---

# 5. Testes de campanha `ml-p0-*`

Dos 74 arquivos encontrados:

```text
19
```

possuem prefixo:

```text
ml-p0-
```

e estão ligados às fases da campanha/auditoria P0 de publicações Mercado Livre.

### Avaliação

**Não misturar automaticamente esses testes ao gate crítico permanente.**

No Item 15 será necessário decidir:

```text
regra permanente ainda protegida?
→ manter/mover para nome de domínio

teste só valida script/campanha encerrada?
→ histórico/removível junto do artefato
```

Não apagar teste antes de decidir o futuro do código que ele protege.

---

# 6. Tipos de testes encontrados

A suíte atual mistura pelo menos dois estilos úteis.

## Testes comportamentais de funções

Exemplos:

```text
internal-stock.test.js
preferred-offer.test.js
order-fulfillment-selection.test.js
mobile-permissions.test.js
stale-jobs.test.js
```

Eles importam a regra e validam entrada/saída.

### Avaliação

**Preferir esse estilo quando a regra pode ser isolada.**

---

## Guards estruturais/source-level

Exemplo:

```text
dslite-create-order-safety.test.js
```

lê arquivos fonte e verifica invariantes como:

```text
não existir retry automático de POST
usar lock de domínio
não manter fallback inseguro
```

### Avaliação

Esse estilo é válido para invariantes arquiteturais importantes.

Porém ele não substitui teste comportamental quando o risco é de estado/resultado.

Não transformar toda refatoração em comparação de strings de source.

---

# 7. Produtos + Fornecedores — cobertura boa

Testes relevantes encontrados incluem:

```text
preferred-offer.test.js
product-operational-state.test.js
gtin.test.js
internal-supplier-filter.test.js
```

`preferred-offer.test.js` cobre cenários importantes como:

- alternativa mais barata com estoque;
- preferência manual;
- preferência manual sem estoque;
- custo zero inválido;
- desempates;
- snapshot obsoleto;
- fornecedor atual indisponível/inativo.

### Avaliação

**Boa base.**

Mudanças futuras em preferência de fornecedor devem reutilizar essa suíte.

---

# 8. Estoque interno — cobertura parcial boa

Existe:

```text
internal-stock.test.js
```

cobrindo:

- saída estornada não reduz saldo;
- saída ativa reduz saldo;
- visibilidade de entradas;
- saída parcial/FIFO;
- itens em revisão.

Também existe:

```text
internal-supplier-filter.test.js
```

cobrindo a interpretação de estoque interno na filtragem de pedidos.

### Lacuna

Não foi identificado teste específico para:

```text
verificar saldo
+
reservar atomicamente
```

porque essa operação ainda não existe como regra consolidada.

### Avaliação

**P1 futuro — a correção da reserva atômica deve nascer com teste de concorrência/transação apropriado.**

Não basta testar somente uma função pura de saldo.

---

# 9. Fulfillment — cobertura parcial

Existe:

```text
order-fulfillment-selection.test.js
```

cobrindo:

- pedido sem origem;
- supplier bloqueando internal;
- internal bloqueando supplier;
- conflito;
- migration ausente.

### Ponto positivo

A regra de seleção já possui proteção de regressão.

### Lacuna

Não cobre ainda:

```text
seleção internal
+
reserva de quantidade
```

como uma única operação coerente.

### Avaliação

O futuro teste deve proteger exatamente a causa do P1 do Item 2.

---

# 10. Quantidade segura — lacuna crítica

A regra definida na auditoria é:

```text
Q_segura = max(Q_internal, Q_supplier)
```

sem somar as duas origens.

Não foi identificado teste atual dedicado a essa regra completa.

### Casos mínimos futuros

```text
internal 2 / supplier 3 → 3

internal 5 / supplier 3 → 5

preferencial 3 / alternativa válida 8 → supplier = 8

oferta sem estoque/inativa → não entra

kit → capacidade pelos componentes

reserva interna → reduz Q_internal

nenhuma origem → 0
```

### Avaliação

**P1 de proteção futura.**

Esse teste deve ser criado junto da consolidação da regra.

---

# 11. Kits — cobertura presente, mas fragmentada

Existem testes ligados a:

```text
ml-virtual-kit-orders.test.js
ml-catalog-pack-quantity.test.js
```

e outras regras Mercado Livre relacionadas.

### Lacuna

A regra local geral:

```text
custo e disponibilidade do kit
=
componentes
```

não aparece como uma suíte dedicada claramente nomeada no inventário atual.

### Avaliação

Quando a regra de Q segura/estoque for consolidada, incluir casos de kit no mesmo domínio de disponibilidade.

Não criar teste duplicado somente por nomenclatura.

---

# 12. DSLite — cobertura relevante

Foram encontrados testes como:

```text
dslite-api-contract.test.js
dslite-create-order-safety.test.js
dslite-create-order-verification.test.js
dslite-purchase-link.test.js
dslite-supplier-policy.test.js
dslite-vanral-placeholder-label.test.js
```

### Pontos positivos

Existem guards para:

- contrato de etiqueta;
- ausência de retry inseguro de criação;
- lock;
- reconciliação;
- política de fornecedor;
- vínculo de compra.

### Lacuna P1 do Item 13

Não foi identificado teste para:

```text
timeout/erro DSLite
≠
resultado vazio válido
```

### Avaliação

Adicionar teste específico quando esse P1 for corrigido.

---

# 13. Jobs + Scheduler — boa cobertura de regras puras

Testes encontrados:

```text
job-idempotency.test.js
stale-jobs.test.js
sync-task-resilience.test.js
ml-order-hydration-queue.test.js
critical-job-alert.test.js
order-sync-lock-fallback.test.js
```

### Cobertura confirmada

`sync-task-resilience.test.js` protege, entre outros:

```text
task scheduled precisa ter schedule
dispatchMode explícito
timeouts/retry de tasks lentas
health de tasks
```

`ml-order-hydration-queue.test.js` cobre:

```text
dedupe/order id
lock conflict → on_hold
falha transitória → on_hold
```

### Avaliação

**Boa base.**

---

# 14. P1 — job de catálogo `on_hold` precisa teste de retomada real

O Item 7 encontrou job durável do catálogo preso em:

```text
on_hold
```

apesar do mecanismo de retomada esperado.

Existem testes de:

```text
catalog-refresh-batch.test.js
```

e regras de sync/resilience.

### Lacuna

O comportamento operacional completo:

```text
job on_hold existente
↓
dispatcher/worker o encontra
↓
retoma
↓
avança/termina
```

não ficou protegido de forma clara pelo inventário atual.

### Avaliação

Criar teste de lifecycle quando a causa for identificada/corrigida.

---

# 15. Mercado Livre — cobertura numerosa

Existe grande quantidade de testes envolvendo:

- listing status;
- listing deletion;
- SKU;
- critical attributes;
- catalog competition;
- catalog refresh;
- shipping cost;
- labels;
- fiscal release;
- order hydration;
- order sale alert;
- virtual kits;
- webhook stub;
- pricing;
- SEO;
- campanhas P0.

### Avaliação

Quantidade de arquivos não significa que os P1 novos estejam cobertos.

A cobertura deve ser lida por comportamento crítico.

---

# 16. P1 — scan de anúncios não possui proteção adequada identificada

O Item 13 encontrou:

```text
scan completo ~5.900 IDs
para cada lote de 100
```

Não foi identificado teste atual dedicado a:

```text
cursor/população retomável
não repetir scan completo
não pular anúncios
não duplicar anúncios
```

### Casos mínimos futuros

```text
lote 1 e lote 2 usam continuidade
todos os IDs são processados exatamente uma vez por ciclo
retomada não perde posição
expiração/reinício não corrompe ciclo
```

### Avaliação

**P1 de regressão futura.**

---

# 17. P1 — outbox de estoque igual não possui teste identificado

O Item 13 confirmou repetição de:

```text
desired_quantity = mesma quantidade
```

em ciclos sucessivos.

Não foi identificado teste atual para:

```text
estado relevante não mudou
→ não criar nova outbox
```

e:

```text
quantidade mudou
→ criar outbox
```

### Avaliação

**P1.**

Esse deve ser um dos testes mais simples e valiosos do futuro plano.

---

# 18. Fiscal — cobertura parcial

Testes encontrados incluem:

```text
brasil-nfe-identifier.test.js
fiscal-ie-policy.test.js
ml-fiscal-release.test.js
```

Eles protegem partes importantes de:

- identidade;
- IE;
- janela/liberação fiscal.

### Lacunas P1 do Item 5

Não foi identificado teste dedicado a:

```text
criação nova no shipment
→ POST XML direto

shipment fora de ready_to_ship/invoice_pending
→ não enviar XML

not_found Brasil NFe terminal
→ não repetir continuamente
```

### Avaliação

Esses testes devem acompanhar as correções fiscais.

---

# 19. Mercado Pago / financeiro — maior lacuna de cobertura

No inventário de `tests/` não foi identificado arquivo claramente dedicado a:

```text
mercadopago
supplier-balance
supplier-credits
supplier-payment
```

apesar de o domínio possuir operações financeiras sensíveis.

### P1 já confirmado

O Item 6 encontrou:

```text
job pode terminar antes de consumir relatório
parser não usa SETTLEMENT_NET_AMOUNT
```

### Casos mínimos futuros

```text
202/requested ≠ completo

mesma task/report é retomada

SETTLEMENT_NET_AMOUNT prevalece sobre bruto

movimento importado é idempotente

matching Hayamax só usa movimento elegível

crédito/débito não duplica
```

### Avaliação

**P1 — uma das maiores lacunas do projeto.**

Não criar uma suíte financeira extensa antes da correção.

Criar testes diretamente nos pontos corrigidos.

---

# 20. Segurança/Auth — cobertura mobile boa, web insuficiente

Existem:

```text
mobile-auth-token.test.js
mobile-permissions.test.js
ml-account-guard.test.js
supabase-service-url.test.js
```

`mobile-permissions.test.js` cobre claramente diferenças entre:

```text
admin
gerente
operador
visualizador
```

### Lacuna crítica

Não foi identificado teste atual para:

```text
caller público não escolhe cargo admin
authenticated não altera próprio cargo
web aplica purchases.payment.confirm
operador web não confirma pagamento
```

### Avaliação

**P0/P1 — obrigatório junto da correção do Item 9.**

A matriz mobile existente deve ser reutilizada, não duplicada em testes web separados com regras diferentes.

---

# 21. Links públicos — cobertura desigual

Existe:

```text
public-evolusom-gtin-links.test.js
```

para fluxo público com HMAC/expiração.

### Ponto positivo

Esse fluxo já serve como referência de link temporário corretamente delimitado.

### Lacuna

Não foram identificados testes equivalentes para expiração de:

```text
NF-e/XML
DANFE
etiqueta
comprovante fornecedor
short_links
```

### Avaliação

**P1 do Item 9 precisa de teste de expiração.**

---

# 22. Interface Web — quase sem testes de comportamento visual

O inventário atual não mostra uma suíte E2E/browser baseada em:

```text
Playwright
Cypress
```

e essas dependências também não aparecem no `package.json` root.

### Lacunas do Item 11

Não há proteção clara para:

- busca de Perguntas em paginação global;
- workflow visual de publicação ML duplicado;
- Sidebar/permissões;
- modais extraídos durante futura limpeza.

### Avaliação

**Não adicionar Playwright/Cypress automaticamente.**

Para as correções atuais, preferir:

- mover regra para função/endpoint testável;
- testar comportamento no Node;
- validar manualmente a tela afetada quando necessário.

Uma suíte browser só deve ser adicionada se, após a limpeza, houver fluxos críticos cuja validação manual seja recorrente e arriscada.

---

# 23. Banco de dados — falta de testes de integração do schema

Há muitos tests de regra em JavaScript, mas não foi identificada uma suíte automatizada dedicada a validar no PostgreSQL real:

- RLS;
- grants;
- FK;
- constraints;
- migrations;
- concorrência transacional.

### Relevância

Isso é especialmente importante para:

```text
cargo / profiles
reserva atômica
dedupe por índice
constraints financeiras
```

### Avaliação

**Não criar um framework de banco separado agora.**

Para migrations críticas futuras, o plano deve incluir validação segura específica:

```text
aplicar em ambiente controlado
consultar schema
executar casos permitidos/proibidos
verificar rollback/preflight
```

Quando uma regra puder ser colocada em função SQL/RPC crítica, incluir teste do comportamento transacional apropriado.

---

# 24. Cobertura vs testes históricos

A suíte atual tem bastante código de campanhas anteriores, principalmente:

```text
ml-p0-*
SEO
family names
reactivation
```

### Risco

Se simplesmente executarmos:

```text
todos os testes para sempre
```

podemos transformar regras históricas de campanha em dependências permanentes acidentais.

### Avaliação

Item 15 precisa classificar:

```text
teste protege regra operacional atual
→ manter

teste protege apenas script/campanha encerrada
→ remover/arquivar junto do código correspondente
```

---

# 25. Gate mínimo atual antes de uma mudança

O `AGENTS.md` atual exige a menor validação significativa para a área alterada.

### Gate universal de código

Para mudanças normais de TypeScript/Next.js:

```text
npm run validate
```

### Teste direcionado

Executar:

```text
node --test tests/<arquivo-relevante>.test.js
```

ou o `npm run test:*` existente quando houver.

### Build

Executar:

```text
npm run build
```

quando a mudança afetar:

- framework/configuração;
- boundaries server/client;
- rotas/compilação;
- dependências;
- código com risco de build.

### Banco

Não substituir validação de migration por build.

Verificar o schema/comportamento afetado de forma segura.

### Integrações

Testar contrato/função com mocks/fixtures quando possível e usar caminho externo seguro apenas quando necessário.

---

# 26. Gate mínimo desejado para a limpeza futura

O futuro checklist de execução deve ter, para cada ação:

```text
ANTES
1. identificar teste existente que protege o comportamento
2. se o bug crítico não possui teste:
   criar teste que falha pelo motivo correto

ALTERAÇÃO
3. executar mudança mínima

DEPOIS
4. rodar teste direcionado
5. npm run validate
6. build somente quando aplicável
7. validação operacional específica se necessária
```

### Avaliação

**Esse é o padrão principal do Item 14.**

Não exigir build completo para uma alteração pura de regra quando teste + typecheck já provam o comportamento afetado.

---

# 27. Suíte crítica desejada

Depois do Item 15 separar histórico de operação, vale existir um comando como:

```text
npm run test:critical
```

O nome é conceitual; não foi criado neste item.

Ele deve executar apenas testes estáveis dos fluxos que não podem quebrar silenciosamente.

### Núcleo existente candidato

- `preferred-offer.test.js`
- `internal-stock.test.js`
- `order-fulfillment-selection.test.js`
- `dslite-api-contract.test.js`
- `dslite-create-order-safety.test.js`
- `dslite-create-order-verification.test.js`
- `dslite-supplier-policy.test.js`
- `job-idempotency.test.js`
- `stale-jobs.test.js`
- `sync-task-resilience.test.js`
- `ml-order-hydration-queue.test.js`
- `ml-listing-status.test.js`
- `ml-fiscal-release.test.js`
- `mobile-auth-token.test.js`
- `mobile-permissions.test.js`
- `target-net-profit-pricing.test.js`

### Testes novos que devem entrar quando as correções forem feitas

- cargo/auth web;
- Q segura;
- reserva interna;
- ML scan/cursor;
- outbox de estoque sem alteração;
- DSLite timeout;
- fiscal upload/gate;
- Brasil NFe retry terminal;
- Mercado Pago report/parser;
- links públicos expirantes;
- catálogo `on_hold` recovery.

---

# 28. P2 — não existe hoje um gate único de regressão

Existem:

```text
validate
build
test:* específicos
```

mas não há um comando simples que responda:

```text
as regras críticas do Vortek continuam protegidas?
```

### Avaliação

**P2 de organização.**

Criar esse gate somente depois do Item 15, para não eternizar testes de campanha como suíte permanente.

---

# 29. Mobile

O projeto mobile possui hoje:

```text
npm run typecheck
npm run doctor
```

no próprio `mobile/package.json`.

Os testes de auth/permissões mobile estão no diretório root e possuem script:

```text
npm run test:mobile-auth
```

### Avaliação

Para mudança mobile futura:

```text
teste root relevante
+
mobile npm run typecheck
+
mobile npm run doctor quando configuração/dependência mudar
```

Não aplicar build/validação web como substituto da validação mobile.

---

# 30. Testes que não devem ser criados

Não devemos:

- testar implementação privada sem valor;
- criar snapshot tests de páginas gigantes apenas por cobertura;
- testar Ant Design;
- duplicar teste da mesma regra em UI e backend;
- testar chamadas reais destrutivas de produção;
- criar mocks gigantes de toda a aplicação;
- criar E2E para cada modal;
- perseguir 100% de coverage;
- manter teste de campanha depois que o comportamento/código deixou de existir.

---

# 31. Prioridades de testes para o plano de execução

## P0

### Segurança de cargo
- caller público não define cargo privilegiado;
- usuário comum não altera `cargo`;
- apenas operação administrativa autorizada altera papel.

---

## P1

### Fulfillment/estoque
- reserva atômica;
- Q segura.

### Performance ML
- cursor/população não rescanear;
- nenhuma perda/duplicação de anúncios;
- estoque igual não gera outbox.

### DSLite
- timeout não vira sucesso vazio.

### Fiscal
- upload novo usa POST XML correto;
- gate de shipment;
- `not_found` terminal não fica elegível eternamente.

### Mercado Pago
- lifecycle de relatório;
- parser usa valor líquido;
- idempotência financeira.

### Segurança
- permissões web iguais às do domínio;
- links sensíveis expiram.

### Jobs
- catálogo `on_hold` retoma.

---

# 32. Cobertura de UI

Os problemas de UI do Item 11 devem ser protegidos preferencialmente no nível mais simples que comprova a regra.

Exemplo:

```text
Perguntas
```

Em vez de começar por E2E, a correção pode ser testada no contrato da API/query:

```text
filtro enviado ao backend/provider
ou
semântica explícita de filtro da página
```

### Avaliação

Só adicionar teste browser se a regra não puder ser validada de forma confiável em nível inferior.

---

# 33. O que NÃO fazer agora

Não devemos:

- executar toda a suíte remotamente e afirmar saúde sem ambiente adequado;
- criar CI novo durante a auditoria;
- adicionar framework de testes;
- adicionar Playwright/Cypress por padrão;
- criar centenas de testes antes das correções;
- testar cada detalhe visual;
- migrar todos os tests de campanha;
- apagar tests históricos antes do Item 15;
- modificar scripts `package.json` neste item;
- executar testes destrutivos em produção.

---

# 34. Resultado do checklist — Item 14

- [x] Mapear os testes existentes por domínio.
- [x] Identificar o test runner atual.
- [x] Confirmar scripts de validação existentes.
- [x] Inventariar 74 arquivos de teste atuais.
- [x] Identificar 19 testes ligados à campanha `ml-p0-*`.
- [x] Confirmar boa cobertura de fornecedor preferencial.
- [x] Confirmar cobertura do saldo de estoque interno.
- [x] Confirmar cobertura parcial da seleção de fulfillment.
- [x] Confirmar cobertura de jobs, stale, idempotência e scheduler.
- [x] Confirmar cobertura relevante DSLite.
- [x] Confirmar cobertura relevante Mercado Livre.
- [x] Confirmar cobertura mobile de auth/permissões.
- [x] Confirmar cobertura parcial fiscal.
- [x] Identificar ausência de teste de Q segura.
- [x] Identificar ausência de teste da reserva atômica.
- [x] Identificar ausência de regressão para scan ML repetido.
- [x] Identificar ausência de regressão para outbox de estoque sem mudança.
- [x] Identificar ausência de teste para timeout DSLite mascarado.
- [x] Identificar lacuna de testes Mercado Pago/financeiro.
- [x] Identificar lacuna de segurança web/cargo.
- [x] Identificar lacuna de links públicos sensíveis.
- [x] Identificar lacunas dos P1 fiscais.
- [x] Identificar falta de teste de retomada real do catálogo `on_hold`.
- [x] Identificar ausência de suíte browser/E2E e decidir não adicioná-la sem necessidade comprovada.
- [x] Definir gate mínimo por alteração.
- [x] Definir conjunto crítico desejado antes/depois da futura limpeza.
- [x] Separar testes operacionais de candidatos históricos.

---

# 35. Restrições desta etapa

Nesta etapa:

- nenhum teste foi executado;
- nenhum teste foi criado;
- nenhum teste foi alterado;
- nenhum script npm foi alterado;
- nenhum CI foi criado;
- nenhum build foi executado;
- nenhum typecheck/lint foi executado;
- nenhuma migration foi executada;
- nenhum dado foi modificado;
- nenhum deploy foi realizado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- inventário do diretório `tests`;
- análise dos scripts atuais em `package.json`;
- leitura de testes diretamente relacionados aos domínios críticos;
- consulta ao `AGENTS.md` atual;
- consulta à documentação oficial atual do Node.js Test Runner;
- consolidação dos achados dos Itens 2–13.

---

# 36. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Repositório Vortek — branch `dev`

- `package.json`
- `mobile/package.json`
- `tests/`

Testes inspecionados diretamente incluem:

- `tests/internal-stock.test.js`
- `tests/internal-supplier-filter.test.js`
- `tests/order-fulfillment-selection.test.js`
- `tests/preferred-offer.test.js`
- `tests/dslite-api-contract.test.js`
- `tests/dslite-create-order-safety.test.js`
- `tests/job-idempotency.test.js`
- `tests/stale-jobs.test.js`
- `tests/sync-task-resilience.test.js`
- `tests/ml-order-hydration-queue.test.js`
- `tests/mobile-permissions.test.js`
- `tests/ml-fiscal-release.test.js`
- `tests/target-net-profit-pricing.test.js`
- `tests/public-evolusom-gtin-links.test.js`

## Node.js — documentação oficial

Test runner Node 22:

`https://nodejs.org/download/release/latest-jod/docs/api/test.html`

A documentação confirma que:

- `node:test` é estável;
- `node --test` é o runner nativo;
- arquivos `*.test.js` são descobertos automaticamente.

---

# 37. Conclusão final do Item 14

O Vortek **não está sem testes**.

Há uma base útil e relativamente ampla, principalmente para regras puras e invariantes que já amadureceram.

O problema é que a cobertura cresceu junto com necessidades pontuais e ainda não representa claramente:

```text
o conjunto mínimo que não pode quebrar
```

A limpeza futura deve melhorar isso sem transformar testes em um projeto paralelo.

A regra será:

```text
bug crítico
→ teste de regressão

refatoração
→ teste existente do domínio

mudança transversal
→ validate/build quando aplicável

código histórico removido
→ teste histórico sai junto
```

Os maiores testes novos necessários já correspondem diretamente aos P0/P1 encontrados nesta auditoria.

O **Item 14 está concluído**.

O próximo item é **Item 15 — Scripts + Documentação + Arquivos Históricos**, onde os 19 testes `ml-p0-*` e outros artefatos de campanha serão classificados junto do código que protegem.
