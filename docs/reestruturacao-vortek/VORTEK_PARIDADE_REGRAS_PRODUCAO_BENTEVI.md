# Vortek/Bentevi — Paridade de regras entre produção e nova versão

**Ação:** `BNT-PARITY-00 — Fotografia e catálogo de regras`

**Fotografia:** 04/09/2026

**Produção auditada:** `origin/main` e serviço `vortek-erp` no SHA `95941f1924efa42e890fba592fe400f9e25ae706`

**Bentevi auditada:** `origin/dev` no SHA `0d415b59711ef15d686953fb87d5ef6d814870aa`

**Ancestral comum:** `08b6237428c406b55a876578b63dbc553e8c9584`

**Último delta remoto classificado:** `origin/main` em `b6e1b17eba58f0ec80a3d16357ac7ab2409f56de` em 05/09/2026. Os cinco commits posteriores à fotografia estão classificados na seção 4.1, por regra e destino; nenhum modifica o contrato `ORD-09`. Classificação documental não significa incorporação funcional ou liberação do gate. O SHA implantado não foi reconfirmado nesta ação.

**Resultado:** fotografia concluída; `BNT-PARITY-01` a `BNT-PARITY-08` incorporadas e demais divergências permanecem bloqueadas para ações `BNT-PARITY-N` separadas.

**Atualização em 05/09/2026:** a fila `BNT-PARITY-01` a `BNT-PARITY-13` foi concluída no escopo aprovado de cada ação. A fotografia original abaixo permanece datada. `BNT-PARITY-13` concluiu o mapa e o comparador, não a promoção de schema. A decisão Evolusom foi confirmada e implementada em `BNT-PARITY-DEC-01`, com validação local e sem ativação remota. Os deltas de pricing foram classificados; sua incorporação e os gates continuam pendentes.

**Estado atual após o gate de 05/09/2026:** `BNT-PARITY-GATE` concluído exclusivamente para a sequência DEV, com aceite explícito do responsável para encaminhar as lacunas de pricing à V2. `BNT-CFG-07` liberada para planejamento. A seção 8 registra a decisão vigente; as referências anteriores a gate pendente são históricas. Produção, ativação Evolusom, delta de migrations, continuidade dos experimentos e gate de autonomia não foram liberados.

---

## 1. Conclusão executiva

A Bentevi preserva a maior parte das regras estruturais do Vortek e já substituiu conscientemente vários modelos antigos por fontes tipadas, estoque próprio estruturado, pricing dinâmico, segurança de banco e configuração administrativa.

Foram encontrados **13 commits exclusivos em produção**, envolvendo 83 arquivos e quatro migrations. A análise funcional identificou:

- **14 regras produtivas identificadas para incorporação**, das quais `PRC-11`, `PRD-02`, `SUP-02`, `SUP-05`, `SUP-06`, `SUP-07`, `ORD-09`, `ORD-10` e `ML-04` foram concluídas em `BNT-PARITY-01` a `BNT-PARITY-08`; as demais continuam organizadas em ações controladas;
- **1 decisão operacional identificada na fotografia**, sobre destinatário adicional de etiqueta da Evolusom, posteriormente confirmada e implementada em `BNT-PARITY-DEC-01`;
- comportamentos intermediários ou históricos que não devem ser copiados;
- uma colisão real de versão de migration que bloqueia promoção automática do histórico;
- ausência, na Bentevi, da deduplicação de alerta de nova venda por inserção;
- atividade manual de `produtos.ativo`, preferência por oferta ativa, inativação de fornecedor, fallback da retomada DSLite, venda concretizada pelo ML e lifecycle do bloqueio automático de identidade já reconciliados; as demais divergências continuam isoladas nas próximas ações.

Nenhuma regra foi aplicada nesta ação. Não houve alteração funcional, migration, escrita em banco, chamada mutável a integração, deploy ou acesso a PII.

---

## 2. Método e limites da fotografia

1. `origin/main` e `origin/dev` foram atualizados e comparados pelo ancestral comum.
2. O SHA efetivamente implantado em produção foi confrontado com `origin/main`.
3. Os 13 commits exclusivos de produção foram lidos individualmente, incluindo código, migrations e testes.
4. Regras anteriores ao ancestral comum foram rastreadas pelas fontes atuais de código, schema, testes e consumidores web/mobile.
5. Os bancos foram fotografados com o coletor `scripts/capture-db-03-snapshot.js` e sessão PostgreSQL `READ ONLY`:
   - `192.168.1.160`: produção, somente leitura;
   - `192.168.1.162`: `supabase-dev`, também somente leitura durante esta ação.
6. Consultas de negócio usaram somente configuração, agregados e presença de runtime; nenhum nome de cliente, telefone, documento, payload bruto ou secret foi extraído.
7. O worktree local `vortek-prod` estava com alterações do usuário e não foi usado como fonte. A referência produtiva foi o objeto Git imutável do SHA implantado.

O uso de transação `READ ONLY` segue o contrato do PostgreSQL, que bloqueia DML/DDL sobre tabelas não temporárias. A semântica externa foi confrontada com documentação oficial atual listada na seção 10.

---

## 3. Watermarks e fotografia estrutural

| Evidência | Produção `.160` | Bentevi DEV `.162` |
| --- | --- | --- |
| PostgreSQL | 15.8 | 17.6 |
| Horário UTC da captura | 2026-09-04 21:58:47 | 2026-09-04 21:58:55 |
| Fingerprint estrutural | `2d701acd81b25ed38c18f07ba1e27463fd2ba689b9eee2728d17deb45670e4ca` | `2337d46c87c84a996a8cd9b3977cd710e7fb67798c48728df66d681275033e21` |
| Migrations registradas | 87 | 108, iguais ao repositório DEV |
| Tabelas públicas | 39 | 51 |
| Tabelas públicas sem RLS | 3 | 0 |
| Policies | 9 | 5 |
| Constraints | 134 | 230 |
| Índices | 159 | 197 |
| Funções `SECURITY DEFINER` | 13 | 16 |

Não existe relação presente somente em produção. As 13 relações exclusivas da Bentevi são evoluções do Item 17: recebimento e posição de estoque próprio, manifestação de NF-e, devoluções fiscais, auditoria administrativa, pricing configurável, observação durável de anúncios e configuração de Push.

### Divergências do registro de migrations

- Produção possui, sem versão homônima no repositório DEV, `20260903183000_reactivate_products_with_eligible_active_supplier` e `20260904041000_add_concretizada_ml_order_status`. A Bentevi incorporou somente o contrato necessário de `concretizada_ml` na migration nova `20260905120000_bnt_parity_07_concretizada_ml`, sem copiar o histórico produtivo.
- A versão **`20260830143000` colide**:
  - produção: `internal_purchase_stock_origin`;
  - Bentevi: `atomic_internal_stock_reservation`.
- Produção também registra nomes históricos diferentes em `00008`, `20260709120000` e `20260709121500`.
- A correção funcional de schema, quando necessária, deve usar migrations novas. É proibido renomear, reescrever ou reaplicar silenciosamente qualquer migration já registrada. Conforme o escopo aprovado de `BNT-PARITY-13`, não foi criada migration artificial para igualar históricos: o delta real permanece bloqueador de release.

**Reconciliação atualizada:** [BNT-PARITY-13 — Reconciliação do histórico](VORTEK_BNT_PARITY_13_RECONCILIACAO_MIGRATIONS.md), com 109 registros DEV e 87 produtivos reconfirmados em leitura. A análise identificou ainda diferenças de conteúdo em `00001`/`00008`, registros com notas no lugar de SQL e duas versões de julho ausentes no registro produtivo apesar de efeitos estruturais presentes. As 91 linhas de revisão estão classificadas na evidência sanitizada. Nenhum registro, schema ou arquivo histórico foi modificado. `DELTA_PROMOCAO` exige migrations novas ordenadas pelas dependências e ensaio antes de release.

---

## 4. Inventário dos commits exclusivos de produção

| Commit | Efeito produtivo confirmado | Regras do catálogo | Destino |
| --- | --- | --- | --- |
| `8ee94fe` | retoma worker de catálogo e preserva estágio real em falha | `ML-05`, `ML-06` | rota equivalente; incorporar estágio de falha |
| `9794116` | índices operacionais de jobs | `JOB-01` | equivalente |
| `ce96e0d` | URL interna no servidor sem alterar identidade pública do cookie | `SEC-06` | equivalente |
| `420cd64` | inativação de fornecedor preserva produto com estoque interno e pausa anúncio | `SUP-05`, `SUP-06` | incorporar |
| `b1f9e58` | regenera tipos do schema produtivo | `DB-02` | não copiar arquivo gerado |
| `f3e9199` | reprocessamento explícito e idempotente da inativação | `SUP-07` | incorporar |
| `649aa4f` | bloqueio de identidade inserido inicialmente no fluxo de venda | `ML-03` | não copiar; supersedido por `4bdca2c` |
| `dc60a2b` | fallback seguro de retomada e envio idempotente por destinatário | `ORD-09`, `NTF-04`, `NTF-05` | `ORD-09` incorporado em `BNT-PARITY-06`; notificações permanecem em ações próprias |
| `4bdca2c` | move identidade para criação/ativação de anúncio e limpa bloqueio automático resolvido | `ML-03`, `ML-04` | gate equivalente; limpeza incorporada em `BNT-PARITY-08` |
| `9302353` | POST de deploy com JSON explícito | `OPS-01` | incorporado em `BNT-PARITY-12`, com teste HTTP local sem deploy |
| `2ac64cc` | torna atividade do produto decisão manual e rejeita oferta inativa | `PRD-02`, `SUP-02` | incorporado por `BNT-PARITY-01` e `BNT-PARITY-02` sem copiar comportamentos substituídos |
| `b95ba98` | cria lifecycle `concretizada_ml` sob evidências financeiras/operacionais | `ORD-10` | incorporado em `BNT-PARITY-07` com migration própria e guards Bentevi |
| `95941f1` | alerta WhatsApp somente para venda paga recém-inserida | `NTF-03` | incorporar |

---

### 4.1 Classificação dos deltas de pricing — 05/09/2026

**Escopo concluído:** leitura de `95941f1..b6e1b17` contra DEV `0b04a09`, sem executar o experimento. O inventário contém cinco commits e 18 caminhos distintos: oito arquivos de código/teste e dez artefatos históricos. Nenhuma migration integra o intervalo. A referência remota foi conferida por `git ls-remote`, sem trocar de branch. Não houve acesso aos bancos, APIs operacionais ou servidores; esta evidência descreve o código versionado e o relatório D0, não o estado vivo da produção.

| Commit | Mudança observada no diff | Regras abaixo / destino |
| --- | --- | --- |
| `83a5586` | executor D0, helpers/testes, proteção do recálculo, monitor e registro no scheduler | `PRC-D01` a `PRC-D03`, `PRC-D06` a `PRC-D16`; portar requisitos nas ações V2, sem importar a coorte nem o executor |
| `d1dee8c` | escrita de todos os membros do grupo, verificação/compensação, retomada e estado `executing` que suspende o monitor | `PRC-D03`, `PRC-D04`, `PRC-D06`; preservar objetivos, não prometer atomicidade nem copiar o mecanismo de retomada |
| `8e987f7` | leituras de produtos divididas em lotes de 100 | `PRC-D05`; incorporar batching no job canônico, sem fixar 100 como regra comercial |
| `a9f91d8` | preço/tarifa/frete remotos antes da decisão de prejuízo; lotes rotativos de 25 e priorização por custo alterado | `PRC-D02`, `PRC-D05`, `PRC-D13`; incorporar evidência atual e observabilidade, não a pausa automática genérica |
| `b6e1b17` | ZIP, resumo, seis CSVs, plano de monitoramento e manifest do D0 | `PRC-D16`; evidência histórica referenciada, não transportada como configuração ou autorização |

#### Matriz de regras e destino

Cada linha possui **uma** classificação. `INCORPORAR` significa requisito ainda aberto, mesmo quando a etapa V2 já existe. `SUBSTITUÍDA` identifica a decisão canônica aprovada, não afirma que a implementação futura está pronta. Prioridade indica o risco da capacidade final, sem autorizar reordenar ou executar a fila nesta ação.

Fontes produtivas abreviadas: **helper** = `scripts/lib/ml-pricing-experiment.js`; **executor** = `scripts/run-ml-high-margin-pricing-experiment.js`; **estado** = `src/lib/ml/pricing-experiment.ts`; **monitor** = `src/app/api/sync/pricing-experiment/monitor/route.ts`. Todas referem-se ao SHA `b6e1b17`.

| Regra | Fonte / comportamento e consumidor | Estado DEV e classificação | Destino, prioridade e aceite necessário |
| --- | --- | --- | --- |
| `PRC-D01` | helper/executor: faixa por preço final, alvo/limite, recálculo ao cruzar fronteira, até cinco iterações; consumidor D0 | motor DEV ainda seleciona por custo; **INCORPORAR** | V2-01/03, P0: fronteiras 200/200,01/1.000/1.000,01 e não convergência explícita; limites de busca não viram teto de margem |
| `PRC-D02` | executor/monitor: resultado com custo, tarifa, frete e tributo; `a9f91d8` substitui leitura econômica obsoleta por cotação remota por anúncio | funções centrais e coleta existem, mas não há economia única por grupo com origem/frescor em todos os consumidores; **INCORPORAR** | V2-02/08A, P0: valor ausente não vira zero, evidência incompleta não prova prejuízo, tarifa/frete correspondem ao preço avaliado; preservar tributação central |
| `PRC-D03` | estado + `automatic-pricing.ts` + sync de anúncios: bloquear recálculo antes de gravar `custom_price`, também enquanto aguarda decisão; falha de leitura bloqueia automação | DEV recalcula e escreve `custom_price`, sem a proteção de experimento; **INCORPORAR** | V2-10, P0: proteger todos os escritores/outbox sem bloquear estoque/status independentes; configuração ilegível não libera preço; concorrência testada |
| `PRC-D04` | executor `putGroupPrice`/`executeGroup`: deduplica origem/espelhos, verifica preço e tenta restaurar baseline em falha remota/local | não existe unidade econômica canônica nem recuperação do experimento; **INCORPORAR** | V2-07/10, P0: confirmar todos os membros, rastrear falha parcial e restauração não confirmada; sem preços concorrentes ou dupla contagem |
| `PRC-D05` | monitor + `src/lib/sync/registry.ts`: lotes, prioridade de custo alterado e última checagem, métricas de sucesso/falha parcial, registro scheduled | scheduler/locks existem, mas não o monitor de pricing; **INCORPORAR** | V2-12, P0 operacional: reusar jobs, provar retomada e cobertura de todos os grupos, inclusive sob falhas repetidas; não importar agenda de cinco minutos |
| `PRC-D06` | estado/executor/monitor: baseline, IDs de grupo, execução/retomada, checkpoints, proteção após D30 até decisão | lifecycle tipado de experimento ausente; **INCORPORAR** | V2-04/10, P0: autoria/origem, baseline durável, retomada após escrita antes do checkpoint, nenhum monitor concorrente com aplicação e nenhum sucesso anterior perdido |
| `PRC-D07` | executor `visitWindows`/`orderMetrics` e monitor `runCheckpoint`: visitas/vendas, janelas 30/90/150 e pedidos deduplicados | métricas de anúncios existem, mas não contrato de performance por grupo; **INCORPORAR** | V2-09/10, P1: ausência de dados = SEM_AMOSTRA; vendas canceladas não comprovam conversão; janela e baseline coerentes; não somar exposição duplicada sem validar semântica |
| `PRC-D08` | helper/monitor: D7 observação, D15 alerta e D30 diagnóstico, sem exigir redução de preço em cada checkpoint | não há lifecycle canônico desses diagnósticos; **INCORPORAR** | V2-11/13, P1: idade/janela explícitas, reexecução sem alerta duplicado, atrasos e checkpoints pendentes observáveis |
| `PRC-D09` | executor/helper: veto a produto inativo, promoção, preço por quantidade, automação ML, vínculo/economia inconclusivos, outbox de preço em processamento e recorrência | proteções pontuais existem, não o preflight completo de experimento; **INCORPORAR** | V2-10/16, P0: travas independentes e rechecadas antes de escrever; exceção comercial não elimina trava crítica; preservar contratos B2B e atividade manual |
| `PRC-D10` | helper `resolvePreferredOffer`: preferência manual ativa com custo válido, senão menor custo válido; estoque e desempates | núcleo equivalente em `preferred-offer.ts`, com filtragem operacional própria dos fornecedores; **EQUIVALENTE** | SUP-01/02 e paridades 01/02: manter donos existentes e testes; não copiar o segundo seletor do script |
| `PRC-D11` | executor/helper: imposto 8,2799%, universo 430, listas fixas de SKUs, até cinco visitas/150 dias, recorrência a partir de duas vendas, frescor 30 min | parâmetros datados da coorte, não configuração geral homologada; **NÃO COPIAR** | V2-02/06/09/10/15: preservar contexto RBT12/PGDAS e política tipada; não universalizar limiares nem reproduzir listas como regras permanentes |
| `PRC-D12` | estado: coleção inteira em JSON, chave única datada em `sync_runtime_config`, estados próprios do experimento | contrato V2 exige coleções tipadas, lifecycle e auditoria próprios, ainda não implementados; **SUBSTITUÍDA** | V2-04/10/15: implementar fonte canônica, sem segundo motor, snapshot administrativo genérico ou tratar `custom_price` como prova de ação manual |
| `PRC-D13` | monitor `pauseLossGroup`: prejuízo implica PUT paused, até três tentativas, depois falha de execução | autorização específica do D0 não é autorização geral da V2; **SUBSTITUÍDA** | V2-10/13/16, P0: safety stop do experimento impede novas otimizações e alerta; ação comercial externa segue REQUIRES_CONFIRMATION salvo regra específica homologada |
| `PRC-D14` | monitor: WhatsApp por perda/tentativa e D15, sem centro de confirmações com lifecycle completo | templates Bentevi existem; contrato aprovado prevê alertas/decisões tipados e dedupe estável; **SUBSTITUÍDA** | V2-13/14: reusar templates BNT-MSG-01, não transportar texto avulso ou dedupe por tentativa como identidade do problema |
| `PRC-D15` | executor: endpoint legado de multiget, carregamento de ambiente e renovação/persistência de token inclusive antes do bloco APPLY; temporizações fixas e recuperação por CSV | contradiz procedimento atual de bulk e isolamento operacional desta tarefa; **NÃO COPIAR** | V2-00/07/10: reusar contratos atuais; script não é ferramenta de leitura segura nem mesmo com --dry-run; não executar/importar seu entrypoint |
| `PRC-D16` | relatório D0/manifest: execução autorizada datada e memória financeira | artefatos comprovam o que foi registrado, não estado vivo, conclusão dos 30 dias ou permissão futura; **NÃO COPIAR** | V2-00/10 e PARITY-FINAL: referenciar por SHA, sem copiar coorte ativa; reconfirmar continuidade/encerramento no release autorizado |

**Saldo:** 16 regras classificadas — 9 `INCORPORAR`, 1 `EQUIVALENTE`, 3 `SUBSTITUÍDA` e 3 `NÃO COPIAR`. Nenhuma foi implementada por esta ação. As nove incorporações permanecem abertas nas ações V2 indicadas; as substituições também exigem a implementação prevista, não são paridade funcional concluída.

#### Evidências, limitações e riscos que não devem reaparecer

- `d1dee8c` usa chamadas sequenciais ao ML e atualizações locais separadas, seguidas de compensação quando necessário. O título do commit contém “atomic”, mas o código não oferece transação atômica entre ML e banco. Falha durante compensação continua possível e deve ser testada na V2.
- Segundo o resumo D0, 23 grupos foram pausados por frete local ainda relativo ao preço anterior e depois reativados após cotação remota. O manifest registra 320 grupos e 467 anúncios confirmados naquele momento. Não verificamos esses números em runtime; conferimos em memória os hashes SHA-256 e tamanhos dos oito arquivos listados no manifest, todos coincidentes. O ZIP não foi extraído nem validado internamente.
- O teste produtivo `tests/ml-pricing-experiment.test.js` cobre seis cenários de helpers (faixas, convergência, elegibilidade, travas, checkpoints e alvos deduplicados). Sua existência não comprova concorrência, retomada do executor, ausência de starvation no monitor, rollback remoto ou confirmação humana. Esse teste não foi executado/importado nesta ação.
- O monitor usa `produtos.custo` e imposto da coorte; não revalida a oferta preferencial no mesmo fluxo. Isso não satisfaz sozinho a economia unitária com origem e validade exigida pela V2. Os critérios das seções 3, 5 e 9 do plano canônico permanecem superiores.
- A retomada produtiva grava a coorte antes dos envios, exclui IDs já presentes e depende de artefatos anteriores. Não há evidência suficiente para declarar seguro todo crash entre efeito remoto e checkpoint; essa lacuna permanece no aceite V2-10.
- Os registros antigos `PRC-03/04/05/08` descrevem a fotografia do motor de custo, não o objetivo final da V2. Em DEV `enqueueAutomaticPricesForCostChanges` também escreve `custom_price`; a presença desse campo não comprova origem manual nem override. A substituição comercial continua planejada, sem alteração das faixas atuais nesta ação.

**Dependências e gate:** não criar uma implementação provisória do experimento para depois descartá-la. Manter os destinos V2 e a ordem `PARITY-GATE → CFG-07 → V2-00`. A classificação não concedeu aceite automático ao adiamento das lacunas P0/P1. O aceite foi obtido posteriormente, no planejamento do gate de 05/09/2026, e está registrado na seção 8, mantendo os bloqueios de promoção/autonomia até os aceites V2 e PARITY-FINAL. Nova divergência crítica não está coberta por esse aceite. Nenhuma política comercial nova foi escolhida nesta classificação.

**Continuidade operacional de release:** antes da promoção, reconfirmar por leitura autorizada se há experimentos ainda ativos ou aguardando decisão. Definir e aprovar continuidade/mapeamento ou encerramento, preservando baseline, checkpoints, travas e responsabilidade. Não supor que D30 encerra automaticamente a proteção, não zerar estado produtivo e não habilitar o monitor legado na Bentevi. A configuração Evolusom e o delta de migrations continuam pendências independentes.

**Validação local desta classificação:** 41 testes passaram em `rule-02-pricing`, `target-net-profit-pricing`, `bnt-cfg-03-commercial-pricing`, `automatic-pricing-force`, `preferred-offer` e `product-activity`; `npm run validate` e `git diff --check` passaram. O Node emitiu aviso preexistente de formato de módulo em `pricing-core.js`, sem falha. A conferência local confirmou os cinco commits presentes na matriz, 18 caminhos de origem, 16 IDs únicos e uma classificação por regra; somente os três documentos previstos foram alterados. O remoto foi reconfirmado em `b6e1b17` ao fechamento. Build/homologação visual não se aplicam.

**Consulta externa:** a documentação oficial do Git sobre [intervalos de commits](https://git-scm.com/docs/git-log) e [referências remotas](https://git-scm.com/docs/git-ls-remote) foi consultada. As páginas ML abertas diretamente retornaram HTTP 403; o conteúdo oficial indexado de [Preços de produtos](https://developers.mercadolivre.com.br/pt_br/api-de-precos) permitiu conferir a distinção standard/promotion e a necessidade de verificar automação antes de escrever preço. Não se declara reconfirmação integral de visitas, catálogo, tarifas ou frete nesta ação documental; os endpoints exatos devem ser reabertos na implementação V2 pertinente. Nenhuma autorização foi inferida desse acesso parcial.

## 5. Catálogo canônico de regras

Cada linha representa uma decisão de negócio ou contrato operacional. A coluna **Entrada → decisão** inclui cálculo e unidade; **Precedência/fallback** declara qual fonte vence e o comportamento quando a evidência falta.

### 5.1 Pricing, impostos e comercial

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PRC-01` | `src/services/pricing.ts` | RBT12 mensal → alíquota efetiva do Simples; mínimo 4% | confirmada só protege quando maior que estimada | pricing, produtos, anúncios | mesma fonte central | `EQUIVALENTE` | testes de pricing; manter |
| `PRC-02` | `src/services/pricing.ts` | RBT12 acima de R$ 3,6 mi → exige alíquota PGDAS confirmada | sem confirmada, cálculo bloqueado | pricing automático | igual | `EQUIVALENTE` | `requirePricingTaxRate`; manter |
| `PRC-03` | pricing produtivo legado | custo + frete + taxa ML + margem → preço sugerido em BRL | configuração persistida vence constante | produtos/anúncios | Bentevi usa três faixas tipadas, mais recentes | `SUBSTITUÍDA` | `pricing_cost_tiers`; não restaurar margem global |
| `PRC-04` | `src/services/pricing.ts` | custo em BRL → primeira faixa cujo teto atende | exatamente 3 faixas; última ilimitada | pricing | fonte configurável Bentevi | `SUBSTITUÍDA` | migration `BNT-CFG-03`; manter |
| `PRC-05` | `calculateSuggestedPrice` | preço = maior entre margem por faixa e lucro mínimo por faixa | piso nominal prevalece | pricing/anúncios | igual na Bentevi | `EQUIVALENTE` | testes de limites; manter |
| `PRC-06` | produto/anúncio ML | taxa observada válida [0,1) → usar; ausente → fallback | taxa real do anúncio vence fallback | pricing | fallback Bentevi 15% | `EQUIVALENTE` | `resolveMlFee`; manter configurável |
| `PRC-07` | pricing ML | frete observado em BRL → usar; indisponível → valor configurado | frete real vence fallback | criação e recálculo de anúncio | fallback Bentevi R$ 30 | `EQUIVALENTE` | `resolveCurrentMlPricing`; manter |
| `PRC-08` | produto/anúncio | `custom_price` válido → não sobrescrever automaticamente | decisão manual vence automação | sync/preço/anúncio | preservado | `EQUIVALENTE` | testes `RULE-02`/`INV-05`; manter |
| `PRC-09` | atacado ML | quantidade mínima 1–100 → desconto crescente 0–100% | preço líquido retornado pelo ML vence fallback percentual | oferta/anúncio | 1–5 faixas tipadas; defaults 3/3%, 5/4%, 10/5% | `SUBSTITUÍDA` | `ml_quantity_pricing_tiers`; manter |
| `PRC-10` | `configuracoes.margem_lucro` | percentual global legado | fonte antiga somente histórica | telas antigas | produção 10%, DEV 30%, ambos obsoletos pelo pricing por faixa | `NÃO COPIAR` | não usar para preço novo |
| `PRC-11` | regra de custo | custo acima do limite → oferta inelegível/inativa | limite configurado; não decide atividade manual do produto | sync, elegibilidade | limite tipado/configurável aplicado somente à oferta; Q segura reconcilia a publicação | `EQUIVALENTE` | `BNT-PARITY-01`; testes `product-activity` e `fulfillment-capacity` |

### 5.2 Produtos, ofertas, fornecedores e kits

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PRD-01` | `produto_fornecedor_ofertas` + `produto-fornecedor.ts` | ofertas → snapshot de custo, estoque e fornecedor em `produtos` | oferta é fonte; produto é projeção | catálogo, anúncios, pedidos | igual | `EQUIVALENTE` | manter fonte única |
| `PRD-02` | commit `2ac64cc` | ação do usuário → `produtos.ativo` | decisão manual exclusiva | produto, publicação, sync | catálogo, preço/estoque, custo alto e atualização de kit preservam atividade manual | `EQUIVALENTE` | `BNT-PARITY-01`; regressão estrutural de sync |
| `SUP-01` | `preferred-offer.ts` | ofertas válidas → menor custo; prioridade, estoque e ID desempatem | preferência manual válida vence | catálogo, pricing, fulfillment | centralizado | `EQUIVALENTE` | testes de oferta preferencial |
| `SUP-02` | commit `2ac64cc` | nenhuma oferta ativa → nenhuma preferencial automática | oferta inativa nunca é fallback | produto/anúncio/compra/fiscal | seleção central e fluxos DSLite rejeitam oferta inativa e não usam snapshot legado como fonte operacional | `EQUIVALENTE` | `BNT-PARITY-02`; regressões de preferência e criação DSLite |
| `SUP-03` | `supplier-policy.ts` | fornecedor ativo e sem aposentadoria → operacional | aposentadoria vence flag ativa | sync, DSLite, capacidade | igual | `EQUIVALENTE` | testes HAYA |
| `SUP-04` | decisões HAYA | Hayamax → somente histórico; sem dropshipping ou conta-saldo operacional | decisão Item 17 vence produção histórica | compras/financeiro | aposentada | `SUBSTITUÍDA` | não reativar integrações exclusivas |
| `SUP-05` | commit `420cd64` | fornecedor inativado + estoque interno disponível → produto continua ativo | capacidade interna válida preserva operação | fornecedor/produto/anúncio | capacidade canônica preserva atividade manual, exclui estoque interno do fluxo destrutivo e reconcilia a Q segura | `EQUIVALENTE` | `BNT-PARITY-03`; testes de inativação, capacidade e outbox |
| `SUP-06` | commit `420cd64` | produto sem alternativa → anúncio pausado com quantidade 0 | pausar é reversível; não fechar/excluir | inativação de fornecedor | anúncios ativos sem fonte recebem pausa idempotente com estoque zero; vínculos e atividade manual são preservados | `EQUIVALENTE` | `BNT-PARITY-04`; regressões de inativação e worker |
| `SUP-07` | commit `f3e9199` | `reprocess=true` → reexecuta inativação sem duplicar job concluído/ativo | chave da operação preserva idempotência | API fornecedor/jobs | contrato explícito, lock por fornecedor, reparo integral das ofertas e dedupe pela outbox canônica | `EQUIVALENTE` | `BNT-PARITY-05`; regressões de rota, UI e outbox |
| `KIT-01` | `produto-kits.ts` | componentes e quantidades → custo/saldo do kit | kit não possui estoque físico independente | catálogo/estoque/fulfillment | igual | `EQUIVALENTE` | testes de kits |
| `KIT-02` | capacidade de fulfillment | capacidade do kit = mínimo inteiro por componente | componente limitante vence | estoque/anúncio | igual | `EQUIVALENTE` | `fulfillment-capacity.ts` |

### 5.3 Estoque, reserva e fulfillment

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `INV-01` | `estoque-interno-saldo.ts` | entradas liberadas − saídas não estornadas → unidades disponíveis | movimentos persistidos são fonte | produtos, anúncios, pedidos | preservado e ampliado | `EQUIVALENTE` | testes de saldo |
| `INV-02` | RPC `select_order_fulfillment` | pedido + itens + origem interna → reserva atômica | lock/conflito impede dupla reserva | pedidos/estoque | Bentevi é mais forte que produção | `SUBSTITUÍDA` | migration atômica DEV; manter |
| `INV-03` | seleção de fulfillment | primeira origem `internal/supplier` → imutável para fluxo concorrente | mesma origem é idempotente; diferente conflita | API web/mobile/DSLite | igual | `EQUIVALENTE` | testes de conflito |
| `INV-04` | `fulfillment-capacity.ts` | `Q_segura = max(Q_internal, Q_supplier)` em unidades | origens incompatíveis não somam | produto, kit, anúncio | centralizado | `EQUIVALENTE` | testes `RULE-01` |
| `INV-05` | capacidade por fornecedor | cesta inteira deve caber em um único fornecedor | estoques de fornecedores distintos não somam | fulfillment | igual | `EQUIVALENTE` | testes de capacidade |
| `INV-06` | cancelamento ML | reserva interna ativa de pedido cancelado → estorno único | movimento já estornado não repete | webhook/sync pedidos | igual | `EQUIVALENTE` | evento fiscal de auditoria |
| `INV-07` | origem de estoque produtiva | compra interna registra origem/custo simples | produção antiga | estoque | Bentevi substituiu por recebimento, itens, mapping e idempotency key | `SUBSTITUÍDA` | não copiar migration produtiva colidente |
| `INV-08` | BNT-D05 | NF-e de entrada + manifestação + itens → recebimento rastreável | documento/itens persistidos vencem campo solto | estoque/fiscal | exclusiva e validada em DEV | `SUBSTITUÍDA` | manter arquitetura atual |

### 5.4 Vendas, compras, pagamentos e devoluções

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ORD-01` | API Orders ML | `order.status=paid` → pagamento aprovado no marketplace | recurso consultado vence payload resumido do webhook | pedidos/alertas | igual | `EQUIVALENTE` | contrato oficial Orders |
| `ORD-02` | bundle ML | pack → grupo cart; kit virtual → mesmo parent | grupo explícito vence coincidência de NF-e | pedidos/DSLite/fiscal | igual | `EQUIVALENTE` | `purchase-link.ts` |
| `ORD-03` | vínculo DSLite | NF-e só liga pedido único ou grupo cart/kit explícito | ambiguidade bloqueia mutação | compra/pedido | igual | `EQUIVALENTE` | testes de cardinalidade |
| `ORD-04` | desvínculo manual | DSLite removido manualmente → sincronizador não religa o mesmo ID | ação manual vence sync | pedidos | igual | `EQUIVALENTE` | `isDsliteRelinkBlockedByManualUnlink` |
| `ORD-05` | retomada reativada | status, DSID, NF-e, fornecedor e itens exatos → reutilização segura | qualquer divergência bloqueia | criação/retomada DSLite | Bentevi é mais restritiva e tipada | `SUBSTITUÍDA` | testes `purchase-link` |
| `ORD-06` | `oferta.payment_mode` | `postpaid/prepaid_pix/balance_account` → lifecycle de pagamento | modo persistido da oferta vence inferência por fornecedor | compras/pedidos | centralizado; conta-saldo apenas histórica | `EQUIVALENTE` | testes `RULE-03` |
| `ORD-07` | confirmação de compra | `prepaid_pix` + comprovante → paid; então retomada opcional | sem comprovante bloqueia, salvo retomada já paga | compras/DSLite | igual | `EQUIVALENTE` | rota confirmar pagamento |
| `ORD-08` | créditos de fornecedor | venda cancelada após PIX pago → candidato idempotente de crédito | movement key impede duplicata | compras/financeiro | preservado para fornecedores operacionais | `EQUIVALENTE` | testes supplier credits |
| `ORD-09` | commit `dc60a2b` | URLs interna/pública → tentar próxima somente se houve exceção de rede | uma resposta HTTP, inclusive erro ou corpo inválido, encerra fallback | retomada DSLite | helper puro encerra na primeira resposta e preserva o erro; URL pública somente após rejeição do `fetch` | `EQUIVALENTE` | `BNT-PARITY-06`; testes `dslite-resume-request` |
| `ORD-10` | commit `b95ba98` | pago + shipment `shipped/stale` + sem claim/return + pagamentos aprovados/liberados/sem reembolso → `concretizada_ml` | consulta incompleta bloqueia; não inferir em erro; entrega/recusa/devolução/cancelamento posteriores vencem | pedidos/financeiro/UI | helper puro, auditoria, webhook, UI e guards operacionais incorporados sem classificar como entrega | `EQUIVALENTE` | `BNT-PARITY-07`; 80 regressões direcionadas e migration DEV `20260905120000` |

### 5.5 Fiscal

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `FIS-01` | `configuracoes.nfe_provider` | provider `brasilnfe` → fluxo fiscal ativo | configuração persistida; sem provider, bloquear | emissão/etiqueta | igual; ambiente DEV tipo 2 | `EQUIVALENTE` | testes fiscais; secret só como configurado |
| `FIS-02` | XML autorizado | XML com chave, número e valor → upload ao shipment ML | vínculo fiscal existente evita duplicação | etiqueta/ML | igual | `EQUIVALENTE` | FIS-01 e parser XML |
| `FIS-03` | gate do shipment | sem XML/vínculo fiscal quando obrigatório → etiqueta não avança | fiscal precede logística | DSLite/etiqueta | igual | `EQUIVALENTE` | testes FIS-02 |
| `FIS-04` | reconciliação Brasil NFe | busca inequivocamente ausente → `not_found` terminal | não repetir reconciliação automática | notas/jobs | igual | `EQUIVALENTE` | `nfe-status.ts`; FIS-03 |
| `FIS-05` | cancelamento | prazo externo rejeitado → `cancel_rejected_deadline`, nota continua tecnicamente autorizada | estado específico não regride para `authorized/other` | fiscal/UI | igual | `EQUIVALENTE` | normalizador central |
| `FIS-06` | BNT-D04 | venda elegível → nota de devolução separada e auditável | devolução não altera NF-e de venda | fiscal | evolução exclusiva DEV | `SUBSTITUÍDA` | manter |
| `FIS-07` | BNT-D05 | XML/NF-e de entrada → aba e recebimento controlado | fixture de homologação é inerte | fiscal/estoque | evolução exclusiva DEV | `SUBSTITUÍDA` | manter |

### 5.6 Mercado Livre, catálogo, perguntas e reclamações

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ML-01` | `stock-publish.ts`/outbox | quantidade desejada igual à observada → não publicar | estado observado vence envio redundante | anúncios/jobs | igual | `EQUIVALENTE` | testes ML-03 |
| `ML-02` | scan observado | um scan → manifesto persistido; lotes de 100, até 3 falhas | só marcador completo permite retomar sem novo scan | anúncios/jobs | igual | `EQUIVALENTE` | `ml-listings-observed-job` |
| `ML-03` | commits `649aa4f`/`4bdca2c` | identidade remota divergente de produto/ofertas → bloquear item na criação/ativação | evidência material vence SKU coincidente | anúncio/sync | gate por item já existe; bloqueio em venda foi supersedido | `EQUIVALENTE` | manter no lifecycle de anúncio |
| `ML-04` | commit `4bdca2c` | identidade novamente correta → desativar somente bloqueio automático `ml_identity_gate` | bloqueio manual do usuário permanece | sync/anúncio | lifecycle automático reconciliado | `EQUIVALENTE` | `BNT-PARITY-08` concluída; testes de lifecycle e identidade |
| `ML-05` | refresh de catálogo | scan/detalhes/price-to-win → job em lotes de 100 e retomável | `on_hold` é estado ativo retomável | catálogo/job | rota interna e retomada já equivalentes | `EQUIVALENTE` | testes `JOB-01` |
| `ML-06` | commit `8ee94fe` | falha → registrar estágio corrente real | estágio conhecido vence constante | observabilidade catálogo | último estágio conhecido preservado; fallback somente sem evidência | `EQUIVALENTE` | `BNT-PARITY-09` concluída; testes de refresh e jobs |
| `ML-07` | API Items | `paused` é reversível; `closed` encerra anúncio | pausar para indisponibilidade recuperável | inativação/publicação | regra geral existe, mas SUP-06 ainda exclui | `EQUIVALENTE` | contrato oficial; correção em `BNT-PARITY-04` |
| `ML-08` | Questions API | pergunta sem resposta → ação Responder; respondida → leitura | recurso ML consultado vence cache | perguntas/UI/alerta | igual | `EQUIVALENTE` | UI-05/BNT-D16 |
| `ML-09` | Claims/post-purchase | claim aberto → persistir estado, alertar e reidratar pedido | recurso consultado vence evento resumido | reclamações/pedidos | igual | `EQUIVALENTE` | webhook + BNT-D17 |

### 5.7 Jobs, webhooks, notificações e operação

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `JOB-01` | tabela/jobs + contratos | status e unidade de progresso por tipo de job | constraint e registry vencem texto livre | dashboard/cron/jobs | DEV possui constraints, índice e unidade central | `EQUIVALENTE` | commits `9794116`, JOB-04 |
| `JOB-02` | stale jobs | job sem atividade por 10 min → elegível a recuperação; hidratação ML 3 min | regra específica do domínio vence default | cron/jobs | igual | `EQUIVALENTE` | `stale-jobs.ts` |
| `JOB-03` | alertas críticos | timeout técnico + 15 min de graça → alerta | job retomado/concluído antes disso não alerta | observabilidade | igual | `EQUIVALENTE` | `critical-job-alert.ts` |
| `JOB-04` | Push outbox | falha → até 5 tentativas; disponibilidade adiada por tentativa em minutos | entregue não repete | notificações | igual e configurável por canal | `EQUIVALENTE` | `push-notifications.ts` |
| `NTF-01` | webhook ML | responder rapidamente e consultar recurso indicado | recurso atual vence payload da notificação | pedidos/perguntas/claims | fluxo assíncrono/hidratação preservado | `EQUIVALENTE` | contrato oficial Notifications |
| `NTF-02` | BNT-MSG-01 | evento → template tipado Bentevi; dados essenciais e ação | template central vence mensagem local | WhatsApp/Push/e-mail | exclusiva DEV | `SUBSTITUÍDA` | manter identidade Bentevi |
| `NTF-03` | commit `95941f1` | alerta de nova venda somente se persistência=`inserted` e order=`paid` | update/notificação duplicada não alerta | WhatsApp e Push | gate de origem compartilhado; dedupe de transporte preservado | `EQUIVALENTE` | `BNT-PARITY-10` concluída; regressões de decisão/canais e homologação do commit `4e2471b` |
| `NTF-04` | commit `dc60a2b` | etiqueta por destinatário → message ID e confirmação persistidos por chave | destinatário já confirmado não reenvia no retry | WhatsApp etiqueta | ID e confirmação por destinatário em `jobs.log`; falha no checkpoint interrompe o processamento | `EQUIVALENTE` | `BNT-PARITY-11` concluída; 43 testes aprovados e commit `76fbc7f` homologado |
| `NTF-05` | commit `dc60a2b` | Evolusom oficial → destinatário principal + contato adicional, sem duplicar número | contato confirmado pelo responsável; teste genérico usa só principal | WhatsApp etiqueta | seleção implementada no worker DEV com configuração privada e checkpoints existentes | `EQUIVALENTE` | `BNT-PARITY-DEC-01` validada localmente; configuração de runtime e deploy pendentes para ativação |
| `NTF-06` | etiqueta WhatsApp | download aguarda até 60 s, consulta a cada 5 s; fila retenta em 1/5/15/30 min | erro não-retryable encerra | WhatsApp/jobs | igual | `EQUIVALENTE` | `whatsapp-label-job.ts` |
| `OPS-01` | commit `9302353` | webhook Easypanel POST → `Content-Type: application/json` e corpo `{}` | método configurado; erro HTTP falha comando | deploy homologação | POST JSON explícito; GET e proteções existentes preservados | `EQUIVALENTE` | `BNT-PARITY-12` concluída; 13 testes de contrato HTTP local, sem deploy |

### 5.8 Autenticação, permissões, runtime, API e mobile

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SEC-01` | `permissions.ts` | cargo → conjunto fechado de permissões | backend autoriza; UI apenas representa | web/mobile/API | matriz central corrigida no Item 17 | `SUBSTITUÍDA` | SEC-03; manter |
| `SEC-02` | matriz de cargos | admin/gerente = total; operador = operacional; visualizador = leitura | menor privilégio por cargo | rotas e ações | igual | `EQUIVALENTE` | testes de permissão |
| `SEC-03` | service client | credencial elevada somente no servidor após autorização própria | sessão do usuário nunca recebe service role | APIs/jobs | igual e endurecido | `EQUIVALENTE` | SEC-04/SEC-07 |
| `SEC-04` | RLS/grants | tabela exposta → RLS + grants mínimos | grants e policy atuam em conjunto | Data API | DEV: 51/51 tabelas com RLS; produção: 3 sem RLS | `SUBSTITUÍDA` | fotografia DB-03; manter hardening |
| `SEC-05` | runtime | secret → somente configurado/não configurado; nunca browser/log/doc | env do ambiente vence fallback | integrações/jobs | DEV endurecido; nenhum valor catalogado | `EQUIVALENTE` | SEC-07 |
| `SEC-06` | commit `ce96e0d` | servidor usa URL interna; cookie mantém host público canônico | URL pública define identidade do cookie | Supabase SSR/proxy | implementação equivalente em `supabase-url.ts`/proxy | `EQUIVALENTE` | testes de URL/cookie |
| `SEC-07` | fixtures BNT-D01 | `snapshot_source` de homologação → operações externas e mutações bloqueadas | marcador de fixture vence ação solicitada | pedidos/fiscal/jobs/UI | exclusiva DEV | `SUBSTITUÍDA` | manter até remoção BNT-D24 |
| `SEC-08` | API mobile | JWT + cargo + permissão por operação → permitir/negar | backend é fonte; app não duplica regra | mobile | centralizado | `EQUIVALENTE` | typecheck mobile quando afetado |
| `DB-01` | históricos de migration | versão registrada identifica conteúdo imutável | registro real de cada ambiente vence nome presumido | promoção/schema | colisão `20260830143000` mapeada; replay continua bloqueado | `INCORPORAR` | `BNT-PARITY-13` concluída no mapa/comparador; `DELTA_PROMOCAO` novo e ensaiado obrigatório antes de release |
| `DB-02` | `types/database.ts` | schema aplicado → tipos gerados | schema/migration vence arquivo gerado | TypeScript | tipos DEV são mais novos, mas não incluem regras produtivas ainda ausentes | `NÃO COPIAR` | regenerar apenas após migrations de paridade |

---

## 6. Parâmetros numéricos e limites

| Parâmetro | Produção observada | Bentevi DEV | Destino |
| --- | ---: | ---: | --- |
| Margem global legada | 10% | 30% | obsoleta; não copiar |
| Faixa de custo 1 | não existe no modelo produtivo | até R$ 400; margem 15%; lucro mínimo R$ 20 | manter Bentevi |
| Faixa de custo 2 | não existe no modelo produtivo | até R$ 1.000; margem 20%; lucro mínimo R$ 60 | manter Bentevi |
| Faixa de custo 3 | não existe no modelo produtivo | ilimitada; margem 25%; lucro mínimo R$ 150 | manter Bentevi |
| Taxa ML fallback | regra legada dispersa | 15% | manter configurável |
| Frete ML não informado | regra legada dispersa | R$ 30 | manter configurável |
| Limite de custo inelegível | R$ 2.000 no fluxo produtivo corrigido | R$ 2.000 | preservar, sem alterar atividade manual |
| Alíquota mínima Simples | 4% | 4% | equivalente |
| Limite para alíquota manual | RBT12 > R$ 3.600.000 | igual | equivalente |
| Lote de catálogo | 100 itens | 100 itens | equivalente |
| Lote do scan observado | 100 itens | 100 itens | equivalente |
| Falhas máximas de item no scan/refresh | 3 | 3 | equivalente |
| Stale genérico de job | 10 min | 10 min | equivalente |
| Stale de hidratação ML | 3 min | 3 min | equivalente |
| Graça de alerta crítico | 15 min | 15 min | equivalente |
| Espera de etiqueta | 60 s, polling 5 s | igual | equivalente |
| Retry de etiqueta WhatsApp | 1/5/15/30 min | igual | equivalente |
| Tentativas Push | 5 | 5 | equivalente |
| Tentativas DSLite HTTP | 3; espera 0,75/2 s | igual | equivalente |
| Verificação após criar DSLite | 3; espera 1,5/3 s | igual | equivalente |

Parâmetros de integração e runtime foram registrados apenas como **configurado/não configurado**. Nenhum token, senha, URL assinada, webhook secreto ou credencial integra este catálogo.

---

## 7. Fila obrigatória `BNT-PARITY-N`

A fila respeita risco, dependência e uma mudança coerente por tarefa:

| Ordem | Ação | Regra | Prioridade | Aceite mínimo |
| ---: | --- | --- | --- | --- |
| 1 | `BNT-PARITY-01 — Atividade manual do produto` **(concluída)** | `PRC-11`, `PRD-02` | P0 | sync/preço não alteram `produtos.ativo`; threshold atua só em oferta/elegibilidade |
| 2 | `BNT-PARITY-02 — Oferta preferencial somente ativa` **(concluída)** | `SUP-02` | P0 | oferta inativa nunca vira preferencial automática |
| 3 | `BNT-PARITY-03 — Capacidade interna na inativação do fornecedor` **(concluída)** | `SUP-05` | P1 | produto com estoque interno permanece operacional |
| 4 | `BNT-PARITY-04 — Pausar anúncio ao inativar fornecedor` **(concluída)** | `SUP-06`, `ML-07` | P1 | quantidade 0/paused; nunca excluir/closed |
| 5 | `BNT-PARITY-05 — Reprocessamento idempotente da inativação` **(concluída)** | `SUP-07` | P1 | reprocess explícito sem duplicar job/efeito |
| 6 | `BNT-PARITY-06 — Fallback seguro da retomada DSLite` **(concluída)** | `ORD-09` | P1 | próxima URL apenas em exceção de rede |
| 7 | `BNT-PARITY-07 — Venda concretizada pelo ML` **(concluída)** | `ORD-10` | P1 | migration nova, helper puro, auditoria e transições testadas |
| 8 | `BNT-PARITY-08 — Limpeza do bloqueio automático de identidade` **(concluída)** | `ML-04` | P1 | remove só bloqueio automático resolvido; preserva manual |
| 9 | `BNT-PARITY-09 — Estágio real do refresh de catálogo` **(concluída)** | `ML-06` | P2 | falha registra estágio corrente |
| 10 | `BNT-PARITY-10 — Deduplicação do alerta de nova venda` **(concluída)** | `NTF-03` | P1 | WhatsApp e Push apenas em `inserted + paid` |
| 11 | `BNT-PARITY-11 — Idempotência de etiqueta por destinatário` **(concluída)** | `NTF-04` | P1 | retry não reenvia destinatário já confirmado |
| 12 | `BNT-PARITY-12 — Contrato do webhook Easypanel` **(concluída)** | `OPS-01` | P1 | POST JSON `{}` validado por teste sem deploy |
| 13 | `BNT-PARITY-13 — Reconciliação do histórico de migrations` **(reconciliação concluída)** | `DB-01` | P0 release | mapa/comparador validados; nenhum histórico reescrito; delta de promoção permanece pendente |
| — | `BNT-PARITY-DEC-01 — Destinatário adicional Evolusom` **(confirmada e implementada localmente)** | `NTF-05` | decisão | ambos mantidos, dedupe/retomada testados; sem envio real ou deploy |

As ações acima não autorizam agrupar várias correções num único commit. Quando uma ação exigir banco, o preflight deve confirmar o destino exato `192.168.1.162`, ensaiar com `ROLLBACK` e nunca escrever em `.160`.

**Evidência DEC-01:** o responsável confirmou manter os dois destinos em 05/09/2026. Foram validados o seletor no worker existente, chave `evolusom_additional`, normalização/dedupe, retomada parcial e tratamento terminal da configuração inválida. Passaram 40 testes TAP, regressão de nova venda, validate, build e check de build-secrets. Nenhum número operacional integra código novo, testes ou este catálogo. Antes da ativação, configurar `EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE` privadamente no servidor e publicar em tarefa própria; em DEV usar somente destinatário de teste. Não houve migration, escrita em banco, mensagem real, push ou deploy.

---

## 8. Gate e bloqueios

**Resultado em 05/09/2026: `BNT-PARITY-GATE` concluído — sequência DEV liberada.** O responsável aprovou explicitamente “Liberar sequência DEV”, mantendo as lacunas de pricing nas etapas V2 previstas, sem liberar produção nem novas ações autônomas. O registro completo e a suíte reproduzível estão na seção `BNT-PARITY-GATE` do [checklist](VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md).

- Os 18 commits de `08b6237..b6e1b17` estão classificados, incluindo os cinco deltas da seção 4.1. A revisão conferiu destinos, evidências das paridades 01–13/DEC-01 e inventário de migrations/configuração exigido pela fila.
- As nove regras de pricing `INCORPORAR` e implementações das três substituições continuam pendentes. O aceite permite manter sua execução nas etapas V2, **não** marcá-las equivalentes ou concluídas. Prioridades e critérios permanecem os mesmos.
- `BNT-CFG-07` está liberada **para planejamento**, não foi executada nem aprovada visualmente. Pricing V2 continua aguardando sua aprovação antes de V2-00.
- Validação deste gate: 168 testes locais em 22 arquivos, lint e typecheck passaram; comparador de migrations offline e contrato Easypanel apenas em loopback. Referência DEV `7ed8112`, remoto reconfirmado em `b6e1b17`; sem nova certificação de deploy ou schema vivo.
- Release continua bloqueado por `DELTA_PROMOCAO`, ativação operacional Evolusom, tratamento da continuidade dos experimentos produtivos, aceites funcionais V2, gate de autonomia e `BNT-PARITY-FINAL`, além dos demais gates do Item 17.
- A futura promoção deve conferir novamente `origin/main`, SHA implantado, schema e configurações. Se a produção mudar, classificar o novo delta antes da ação afetada; divergência crítica não contemplada reabre o gate. O aceite presente não cobre fatos futuros.

Não houve acesso a banco/servidor, alteração de código, migration, configuração runtime, preço, mensagem real, push ou deploy. As evidências antigas de build e homologação não foram reexecutadas nem generalizadas para commits locais ainda não publicados.

---

## 9. Validação da fotografia

Validações exigidas para esta ação documental:

- referências Git, merge-base e SHA implantado confirmados;
- inventário completo `08b6237..95941f1` confirmado;
- snapshots estruturais dos dois bancos capturados em `READ ONLY`;
- comparação de relações, constraints, índices, RLS, funções privilegiadas e migrations concluída;
- valores sensíveis omitidos;
- teste dirigido do coletor de schema: `npm run test:db-schema-snapshot`;
- validação integral do repositório: `npm run validate`;
- `git diff --check`;
- build: **N/A**, pois esta ação altera somente documentação e checklist.

Os resultados executados após a criação deste documento são registrados no checklist operacional do Item 17.

---

## 10. Referências oficiais atuais

- PostgreSQL 15 — `SET TRANSACTION`, incluindo `READ ONLY`: <https://www.postgresql.org/docs/15/sql-set-transaction.html>
- Git — `merge-base`: <https://git-scm.com/docs/git-merge-base>
- Mercado Livre — notificações e recomendação de fila/consulta do recurso: <https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-receba-notificacoes>
- Mercado Livre — Orders: <https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas>
- Mercado Livre — Envios: <https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios>
- Mercado Livre — atualização de publicações e estados `paused/closed`: <https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/atualiza-tuas-publicacoes>
- Mercado Pago — Account Money: <https://www.mercadopago.com.br/developers/en/docs/reports/account-money/introduction>
- Mercado Pago — referência atual de relatórios: <https://www.mercadopago.com.br/developers/pt/reference/reports/overview>
- Supabase — RLS, grants e `service_role`: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase — segurança da Data API: <https://supabase.com/docs/guides/api/securing-your-api>

Contratos específicos de DSLite e Brasil NFe continuam vinculados às implementações e evidências já validadas nas ações `DSL-01`, `INV-01` e `FIS-01` a `FIS-03`. Antes de qualquer mudança nesses contratos, a ação `BNT-PARITY-N` correspondente deve reabrir a documentação oficial do endpoint exato; esta fotografia não autoriza inferir comportamento externo.
