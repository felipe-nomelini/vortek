# BNT-PRICING-V2-00 — Dossiê AS_IS → TO_BE e contratos

**Data:** 05/09/2026. **Entrega:** documental, em `dev`. **Resultado:** dossiê concluído; liberado o planejamento de V2-01, não sua execução automática.

**Atualização vigente — BNT-M2M-RECON-01 (06/09/2026):** PRC-01/02/02A/03 e QTY-01 concluídas nos respectivos escopos; sequência e dependências reconciliadas na seção 18 e no plano. Próxima ação: planejar `M2M-PRC-04 — Precedência/revalidação ML viva`. O [Cânon Comercial 1.0 e seus complementos aprovados](VORTEK_CANON_COMERCIAL_V1.md) prevalece. As seções anteriores à 18 são fotografias datadas: suas próximas ações e contratos superados (inclusive validade de override anterior à decisão de proteção até revogação) não substituem os contratos vigentes. Nenhuma escrita comercial ou promoção liberada.

## 1. Escopo, autoridade e fotografia

A política e a fila pertencem a [VORTEK_BENTEVI_PRICING_V2_PLANO.md](VORTEK_BENTEVI_PRICING_V2_PLANO.md). Este dossiê especifica o encaixe técnico, sem substituir essa fonte. A execução continua no [checklist do Item 17](VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md). Os critérios `PRC-D01` a `PRC-D16` permanecem na seção 4.1 de [Paridade de regras](VORTEK_PARIDADE_REGRAS_PRODUCAO_BENTEVI.md); o complemento desta captura está na seção 4 abaixo.

| Referência | Fotografia usada nesta entrega |
| --- | --- |
| DEV inspecionado e testado | `18fce7165477af84f69dfbe2c837369446d00f9f`; branch `dev`; árvore inicialmente limpa |
| Último watermark já classificado | `b6e1b17eba58f0ec80a3d16357ac7ab2409f56de` |
| `origin/main` consultado | `cffc64d1fa8c26ef7b384bf35f9c007decf4c89e` |
| Delta adicional | 11 commits; 112 caminhos: 52 `src`, 19 scripts, 28 relatórios, 3 docs, 3 migrations, 5 testes, 2 configurações de projeto |
| Banco | Nenhuma conexão nesta execução; schema inferido dos arquivos, não certificado no servidor |
| Versões de banco de referência | Fotografia PARITY-13: DEV PostgreSQL 17.6; produção 15.8. Não reconfirmadas ao vivo nesta tarefa |
| Isolamento | `.162` é o único Supabase DEV gravável; `.160` é produção/read-only para banco; nenhum deles foi alterado |
| Aceite anterior | BNT-CFG-07 e seu refinamento tipográfico aprovados pelo responsável antes desta ação |

`origin/main` prova código versionado, não código implantado, execução noturna completa, configuração efetiva ou homologação comercial. Foram feitas leituras de arquivos/objetos Git e documentação pública. Não houve checkout de `main`, importação de módulos de `main`, consulta autenticada ML, execução de scripts históricos, migration, recálculo, mudança de configuração, deploy ou acesso a dados produtivos.

**Diagnóstico central:** DEV ainda usa faixas por custo e possui escritores implícitos de preço. A `main` já contém um motor por preço final e um Radar, mas seus defaults, armazenamento administrativo e governança não equivalem integralmente ao contrato Bentevi. Reaproveitamento seletivo exige adaptação e testes; não cabe merge/cherry-pick em massa.

## 2. AS_IS DEV e donos reais

Os caminhos desta seção são relativos à raiz do repositório e referem-se ao SHA DEV da seção 1. Os nomes de funções permitem localizar a evidência mesmo após mudanças de linha.

### 2.1 Matriz de regras e destinos

| Regra | AS_IS e evidência DEV | TO_BE / tratamento | Ação dona |
| --- | --- | --- | --- |
| Faixa comercial | `src/services/pricing.ts:getPricingStrategy` seleciona pelo custo; `src/lib/commercial-pricing.ts` define `PricingCostTier` | Substituir seleção por faixa do preço final, com política versionada e convergência | V2-01/03 |
| Sugestão | `calculateSuggestedPrice` usa `(custo + frete + custo × margem)/(1 − tributo − taxa ML)` e máximo com lucro nominal | Substituir markup sobre custo por margem operacional sobre receita; retirar nominal universal | V2-01/02/03 |
| Margem exata | `calculateExactMarginPrice` já usa margem sobre receita e admite tarifa fixa | Reutilizar intenção matemática, consolidando arredondamento e todos os componentes no cálculo único | V2-01/02 |
| Economia | `src/services/pricing-core.js:calculateNetProfitAtPrice` não recebe custos variáveis/tarifa fixa; outros helpers têm componentes diferentes | Um resultado econômico, com memória e origem; não manter fórmulas divergentes em UI/scripts | V2-02 |
| Tributação projetada | `pricing.ts` e `src/services/pricing-tax-context.ts`: RBT12, mínimo 4%, PGDAS/trava; helper preenche mês ausente com zero e confirmação não valida competência/evidência | Preservar proteção; diferenciar ausência de receita zero comprovada e validar competência da confirmação | V2-02/15 |
| Resultado de venda | `src/services/orders.ts:calculateOrderProfit` usa `total × 0.04`; `src/lib/ml/order-profit.ts:calculateFinalOrderProfit` aguarda frete final, sem custo variável | Mesmo núcleo aritmético, com dados efetivos da venda e competência histórica, não orçamento atual. Não reescrever ledger/histórico em massa | V2-02 |
| Oferta e atividade | `src/lib/preferred-offer.ts`, `src/lib/product-activity.ts` e testes de paridade | Preservar preferência manual válida, menor custo válido, atividade manual e elegibilidade separada | V2-02/03 e regressões de paridade |
| Configuração | `commercial-pricing-configuration.ts`, `src/lib/configuracoes/contracts.ts`, `src/components/configuracoes/ComercialTab.tsx`; tabelas tipadas de custo e quantidade | Adaptar contrato existente para faixas finais; manter auditoria administrativa, não criar dicionário genérico | V2-03/15 |
| Origem | Manual, automação de custo e sync escrevem `custom_price`; campo não identifica autor | Evento prospectivo com fonte, autor, motivo, preços, regra, job e grupo; legado sem prova = `unknown` | V2-04 |
| Proteções | `ml_manual_blocklist` e políticas de publicação existentes; não são lifecycle de override econômico | Preservar bloqueios, acrescentar override explícito; checar antes de escrita local e enqueue | V2-05/10 |
| Estoque interno em liquidação | Não foi encontrada entidade canônica `internal_stock_clearance` no fluxo DEV inspecionado | Exceção explícita, limitada ao estoque interno, sem autorizar venda de fornecedor abaixo do piso | V2-06 |
| Catálogo | `anuncios_ml` e produto identificam anúncios; conjunto de IDs do mesmo produto não comprova sincronização | Grupo com prova remota, membros e versão; sem preço conflitante nem contagem econômica duplicada | V2-07 |
| Buy Box | `preco-detalhe` consulta `price_to_win?version=v2`; atualização admite origem `catalog_price_to_win` | Evidência contextual; abaixo do permitido = conflito econômico, nunca ordem de desconto | V2-08 |
| Performance | Visitas e vendas disponíveis em fluxos de sync/listagens; não constituem contrato único de coortes/experimento | Janelas, cobertura, identidade, denominador e evidência separados da economia | V2-09/10/11 |
| Jobs/publicação | `src/lib/sync/registry.ts`, `domain-lock.ts`, `ml-publish-outbox.ts`; worker `sync/anuncios/publish` | Reusar scheduler, domínio, dedupe e entrega; acrescentar checkpoint/fencing necessários, sem scheduler paralelo | V2-04/12/13 |
| Notificação/UI | Templates Bentevi e Dashboard existentes | Reusar identidade e canais; filas acionáveis derivadas de alertas, não segundo cadastro de problemas | V2-13/14 e CFG-08/09 |

Os valores 15%/20%/25% do motor atual não têm a mesma semântica que as margens sobre receita da V2. Só trocar percentuais preservaria a fórmula errada. Também não basta trocar o helper: consumidores e escritores precisam migrar juntos no ponto de corte.

### 2.2 Inventário de escritores e fronteiras de execução

| Entrada / arquivo | Efeito encontrado | Contrato obrigatório na transição |
| --- | --- | --- |
| `src/app/api/ml/anuncio/atualizar-preco/route.ts` | Altera `custom_price`, publica preço e quantidade; possui caminho direto e retomada pelo outbox | Decisão vinculada à avaliação/preço/grupo; validação antes da alteração local; trilha e leitura de confirmação |
| `src/app/api/produtos/[id]/route.ts` | Aceita `custom_price` e enfileira preço | Não permitir bypass pelo CRUD; mesma autorização/proteções da ação explícita |
| `src/app/api/produtos/route.ts` | Cadastro aceita preço e pode enfileirar publicação | Origem manual comprovada pelo comando, não inferida do campo; criação também respeita governança |
| `src/lib/ml/automatic-pricing.ts:enqueueAutomaticPricesForCostChanges` | Custo/kit força cálculo; atualiza `custom_price` **antes** de filtrar bloqueio por SKU/item para enqueue | Trocar efeito implícito por avaliação/recomendação; bloqueio precisa preceder efeito local, não apenas ML |
| `src/app/api/sync/anuncios/route.ts` | Frete configurado alterado recalcula `custom_price` e enfileira | Sync observa origem ML/fornecedor e invalida avaliação; não decide novo preço comercial sozinho |
| `src/app/api/ml/anuncio/criar/route.ts` | Calcula preço inicial, recota frete e tem proteção pós-criação | Criar com avaliação autorizada; reconciliar regra protetiva legada antes do corte (DEC-04) |
| `src/app/api/sync/anuncios/publish/route.ts` | Produz/consome outbox com `desired_price`; etapas preço, atacado, quantidade e status | Revalidar decisão no consumo; preço e atacado protegidos, sem descartar estoque/status independentes |
| `src/services/mercadolibre.ts:updateItemPrice` e métodos de criação/PxQ | Transporte remoto de escrita | Não virar ponto alternativo de decisão; chamar somente por fluxo governado e rastreável |
| `src/app/api/anuncios/status-lote/route.ts` | Carrega `custom_price` em `desiredPrice`, mas `apply_price: false` | Não confundir transporte do campo com autorização de preço; preservar pausa/status independentes |
| Scripts operacionais em `scripts/` e helpers `src/lib/ml/catalog-cleanup.ts`, `seo-reactivation.ts` | Entradas históricas de publicação/cálculo fora da UI | Inventariar e fechar bypass no corte; não executar nesta tarefa, nem com `--dry-run` |

**Dupla proteção necessária:** validar antes de persistir/enfileirar e novamente antes do efeito remoto. Um comando válido pode ficar obsoleto na fila. O outbox atual não prova aprovação econômica nem unicidade de grupo só por deduplicar registros.

### 2.3 Consumidores e consolidação

| Consumidores DEV | Mudança prevista, sem novo motor |
| --- | --- |
| `src/components/configuracoes/ComercialTab.tsx` | Simulador usa o mesmo contrato do servidor; salvar política não dispara recálculo/publicação |
| `src/app/(app)/produtos/page.tsx`, `src/app/(app)/produtos/[id]/page.tsx` | Mostrar preço observado, proposto e aplicado sem confundi-los; origem/validade e ação explícita |
| `src/app/api/produtos/exportar-pdf/route.ts` | Consumir memória/DTO, mesma margem da tela; não esconder estimativa nem recalcular por conta própria |
| `src/lib/ml/listings-dashboard.ts` e listagem de Anúncios | Consolidar lucro/sugestão no DTO econômico usado também pelos relatórios de anúncios |
| `src/app/api/ml/anuncio/schema/route.ts`, `preco-detalhe/route.ts` | Prévia com contexto, cenários e evidência; consulta pode persistir observações, não é necessariamente read-only de banco |
| `src/app/api/catalogo/no-catalogo/analise-preco/route.ts` | Comparar competitivo/piso/alvo/break-even, sem automatizar redução |
| `src/lib/products/bnt-d07-visual-review.ts`, `src/lib/catalogo/visual-review.ts` | Adaptar fixtures sintéticas ao DTO; nunca importar preços/coortes produtivas como defaults |
| `src/services/orders.ts`, `src/lib/ml/order-profit.ts` | Resultado realizado compartilha aritmética, preservando quantidade, pack, custos efetivos e estado pendente |
| Criação, atualização e sync da seção 2.2 | Remover cálculo comercial próprio quando o contrato substituto estiver validado |

Busca de evidência: `calculateSuggestedPrice`, `calculateExactMarginPrice`, `calculateNetProfitAtPrice`, `custom_price`, `desiredPrice`, `apply_price` e transporte de preço. Este é o inventário do fluxo inspecionado, não certificação de inexistência de SQL dinâmico ou ferramentas externas. Repetir busca de escritores em V2-03/04/16 e PARITY-FINAL.

## 3. Contratos TO_BE

Na fotografia V2-00, todos os contratos abaixo eram **propostos para implementação posterior**. C01 foi posteriormente implementado apenas como seleção/estabilização pura (seção 11); C02–C08 e contratos do Radar continuam pendentes. A fila canônica é a fonte dos percentuais, níveis de autonomia e nomes dos diagnósticos.

### C01 — Política e solução por preço final (V2-01)

Entrada: política/versionamento, preço final em centavos BRL, objetivo `floor | target | limit | break_even` e componentes econômicos explícitos. Faixas: até 20.000 centavos; 20.001 a 100.000; acima de 100.000. Piso/alvo/limite: 5/7/10%, 7/10/15%, 10/15/20%, respectivamente. Taxas internas são frações, percentuais são apresentação; markup não é margem.

Saída discriminada: solução com preço, faixa, objetivo, iterações e memória, ou falha explícita. Estados mínimos de erro: política inválida, dados ausentes/inválidos, denominador inviável, cotação incompatível e `PRECIFICACAO_NAO_CONVERGIU`.

O solver deve estimar pela faixa candidata, verificar a faixa do preço resultante, recalcular ao cruzá-la e parar apenas quando faixa **e economia do preço final** forem consistentes. Detectar ciclos, limitar iterações e reavaliar após arredondamento. Decisão técnica aprovada em V2-01: candidatos em ordem crescente, menor solução estável e limite de 12 iterações por candidato; isso não é recomendação de reduzir preço vigente nem parâmetro comercial. A implementação pura verifica o ponto fixo da faixa; cumprimento econômico da margem pertence ao calculador injetado, que será integrado e validado em PRC-02/04. A fotografia da `main` não foi importada como motor ou configuração de runtime.

Valores monetários do contrato usam centavos; taxa mantém precisão separada. Proposta calculada deve subir ao próximo centavo quando necessário para cumprir o objetivo, seguida de recálculo do resultado. Não arredondar tarifa duas vezes nem substituir cotação oficial por percentual inferido. A regra de arredondamento do tributo projetado deve ficar explícita e testada em V2-02; não alterar arredondamento fiscal de documentos emitidos.

**Encaixe 01 → 02:** V2-01 entrega política/solver puro, com componentes e cotações sintéticas injetados e sem ligar escritores existentes. V2-02 consolida aritmética, fontes e DTO; V2-03 faz o corte. Não criar um segundo motor publicador para experimentar a fórmula.

### C02 — Economia única e fontes (V2-02)

Entrada conceitual por componente: `amountCents | null`, origem, `observedAt`, identidade da fonte, preço/contexto de cotação e condição `known | estimated | missing | invalid | stale`. Contexto: produto, oferta, fornecedor, anúncio/grupo, moeda, quantidade/base unitária, categoria, tipo de anúncio, logística, competência fiscal e versão de política.

Saída: receita, CMV, tarifa ML **total**, frete suportado pelo vendedor, custos variáveis, tributo, resultado unitário, margem operacional, estado `available | estimated | inconclusive`, razões, fingerprint e cenário. `available` descreve suficiência das fontes, não homologação da estratégia nem autorização de escrita. Todos os consumidores usam essa memória; resultado de pedido fornece componentes realizados, simulador fornece projeções identificadas.

Invariantes:

- `resultado = receita − CMV − tarifa ML total − frete vendedor − variáveis − tributo`; `margem = resultado / receita`;
- receita positiva e valores finitos; quantidade e unidade explícitas; quantidade do pedido não pode multiplicar de novo um total já agregado;
- tarifa total observada/cotada já pode incluir parcela fixa; breakdown explica, não soma novamente;
- preço, taxa e frete precisam do mesmo cenário e contexto; mudar preço exige cotação compatível antes da ação;
- zero comprovado é válido; ausência não vira zero. Estimativa autorizada exige fonte/fallback e estado explícitos; reconhecimento humano não transforma fonte ausente em confirmada;
- componente obrigatório ausente/inválido impede preço executável. Custos variáveis sem informação não comprovam lucro real; cenário hipotético não é autorização;
- tributação mantém mínimo operacional de 4%, RBT12 e trava PGDAS do contrato Bentevi. Confirmada exige competência/evidência; fonte estimada ou mês sem cobertura não pode ser rotulado como confirmado;
- receita operacional usada para estimar RBT12 não substitui escrituração/apuração fiscal. Reaproveitar a fonte de receita existente e resolver sua cobertura, não criar segunda RPC concorrente por cópia da `main`;
- oferta inativa/inválida, mudança de custo/frete/taxa/política/competência ou proteção invalida a proposta. TTL não substitui invalidação material;
- histórico contábil não é reprecificado pelo custo atual; nenhuma atualização em massa do ledger integra esta épica por inferência.

### C03 — Origem, operação e projeção do preço (V2-04)

Evento mínimo: `pricing_source`, `pricing_changed_at`, `pricing_changed_by`, `pricing_reason`, `previous_price`, `new_price`, `pricing_rule_id`, `pricing_job_id`, `source_ml_item_id`, `pricing_group_id`; acrescentar vínculo de avaliação/operação, versão do grupo e resultado da aplicação. Fontes permitidas são as da política: `manual`, `pricing_engine`, `scheduled_job`, `catalog_sync`, `mercado_livre`, `supplier_sync`, `migration`, `unknown`.

Produtores: todos os escritores da seção 2.2 e reconciliações observadas. Consumidores: UI, auditoria, decisões, experimentos e job. `custom_price` pode permanecer como projeção compatível do preço confirmado enquanto necessário, não como fonte de autoria, override ou comprovação de aplicação remota. Um evento de proposta não equivale a preço alterado.

Antes do primeiro efeito: persistir baseline/intenções. Depois: registrar confirmação ou efeito inconclusivo, preservando ID remoto e evidência sanitizada. Falha local após sucesso ML exige leitura/reconciliação da mesma operação antes de reenviar; não perder baseline nem fabricar sucesso. Não reconstruir autoria histórica sem prova.

### C04 — Override, liquidação e precedência (V2-05/06)

`manual_pricing_override`: escopo explícito produto/grupo, autor, motivo, início, validade opcional, estado `active | expired | revoked`, versão e revogação auditada. Alteração manual isolada não cria override. Expiração encerra proteção temporal e gera reavaliação; não autoriza mudança de preço automaticamente.

`internal_stock_clearance`: escopo de estoque interno/quantidade, motivo, autor, início, validade opcional, estado `active | expired | revoked | completed`, limite econômico autorizado e saldo elegível. A permissão de margem zero/negativa deve ser explícita; não se estende automaticamente a reposição nem oferta de fornecedor. Remover/ativar é `MANUAL_ONLY`.

Precedência única: trava crítica → liquidação válida → override → grupo/sincronização → política econômica → contexto comercial → otimização. Leitura inválida das proteções bloqueia proposta executável. Liquidação não contorna trava crítica. Não converter `ml_manual_blocklist`, `custom_price` ou estratégia histórica em override/liquidação automaticamente.

### C05 — Grupo e catálogo (V2-07)

Identidade: grupo, membros, anúncio de origem, `catalog_synchronized_pair`, evidência de sincronização, instante e versão de composição. Relação/SKU/GTIN igual não basta: `SYNC` deve ser comprovado; `UNSYNC`/falha/inconclusivo não autoriza fingir sincronismo. Reconfirmar a associação antes e depois de escrever.

Produtor: leitura de anúncios e prova de sincronização; consumidor: solver, outbox, origem, experimentos, alertas e agregações. Propagação registra `MANUAL → MLB_ORIGEM → CATALOG_SYNC → MLB_ESPELHO`. Não publicar alvos conflitantes nem pausar duplicidade somente porque há dois membros sincronizados.

Mudança de membros invalida decisões pendentes. Persistir identidade estável e versionar composição, evitando perder histórico quando um par se separa. Falha de um membro deixa operação parcial/inconclusiva e impede nova otimização concorrente; compensação requer confirmação e leitura posterior. Não existe promessa de transação atômica entre PostgreSQL e ML.

### C06 — Buy Box, diagnóstico e performance (V2-08/08A/09/11)

Avaliação competitiva contém preço atual, `price_to_win`, break-even, piso, alvo, margem competitiva, contexto, validade e evidência. Preço competitivo abaixo do permitido produz `CONFLITO_ECONOMICO_DE_BUY_BOX`. Piso é diagnóstico, limite é teto de busca automática; margem acima do limite não manda reduzir.

Classificações mínimas: `MARGEM_BAIXA_ESTRATEGICAMENTE_FUNCIONAL`, `MARGEM_BAIXA_SEM_RETORNO_COMERCIAL`, `MARGEM_BAIXA_SEM_EVIDENCIA_COMERCIAL`, `PREJUIZO_REAL`, `LIQUIDACAO_AUTORIZADA`, `MARGEM_PREMIUM_VALIDADA_PELO_MERCADO`. Fontes estimadas exigem distinção de prejuízo estimado. Evidência insuficiente não comprova funcionalidade ou prejuízo real. Recuperação começa pelo piso quando cabível, não força alvo.

Performance é contrato separado: janela 30/90/150 dias, início/fim/fuso, visitas, vendas, unidades, faturamento, recorrência, conversão, cobertura, origem e grupo. Primária 30 dias; ausente/incompleto = `SEM_AMOSTRA`. Deduplicar venda pelo vínculo ML verificado, preservar pack/unidades e excluir canceladas do indicador de venda concretizada. Visitas por anúncio não provam visitantes únicos do grupo: declarar semântica e não somar como se comprovassem unicidade. Coortes somente com amostra/critério homologados.

Zero tráfego: `ALERTA_AMARELO_SEM_TRAFEGO`, D7 observação, D15 amarelo, D30 auditoria de exposição/qualidade. Definir o marco inicial e continuidade da janela em V2-11; dias sem coleta não são zero tráfego. Reexecução atrasada atualiza o problema existente.

### C07 — Experimentos e confirmações (V2-10/13)

Experimento contém os campos da política canônica: ID, grupo, tipo, início/fim, preço/margem/visitas/vendas baseline, preço experimental, margem-alvo, autor, motivo, status `planned | running | completed | cancelled | safety_stopped`. Baseline é imutável e criado antes da primeira escrita. Monitor não aplica preço por conta própria. Mudança material de componentes/proteções interrompe otimização, reavalia risco e gera decisão; prejuízo não autorizado aciona safety stop sem venda/pausa silenciosa.

Decisão proposta: `pending | approved | rejected | deferred | expired | invalidated`. Vincular avaliação/fingerprint, preço anterior/novo, política, grupo/composição, proteções, usuário, motivo e prazo de validade. Rejeitar/adiar não publica; aprovação humana exige identidade/permissão no servidor e deve ser idempotente. Prazo expirado ou mudança material exige nova avaliação e decisão, não reaproveitamento silencioso.

Operação de aplicação: `pending → applying → applied | inconclusive | failed`. Decisão e aplicação não são o mesmo estado. Reservar/consumir aprovação atomicamente por operação; clique duplo/concorrência não pode criar duas escritas. Reutilizar outbox e lock por grupo, não construir outra fila. Após crash, `inconclusive` exige verificar origem/espelhos e versão antes de retomar. Sucesso do item de origem sozinho não conclui o grupo; intenção registrada sozinha não prova aplicação.

### C08 — Alertas, job e Dashboard (V2-12/13/14)

Alerta: chave estável por conta/grupo/regra/problema, severidade, SKU/produto, motivo, evidência, impacto, recomendação, timestamps, versão da regra e decisão/ação associada. Lifecycle `open | resolved`, com eventos de atualização, mudança de severidade e reabertura; decisão adiada não apaga o alerta. Não incluir execução diária/tentativa na chave de dedupe.

Mapear severidades à política P0/P1/P2/informativo. A matriz inicial de autonomia da fonte canônica permanece integral: observação para diagnósticos, confirmação para preço/prejuízo/identidade, operação manual para override/liquidação. Cada regra declara nível; nenhuma promoção automática para `AUTO_SAFE`.

Uma task diária `scheduled` no scheduler existente: atualizar fontes necessárias → reconstruir grupos → validar oferta/custo → economia → diagnósticos/Buy Box → performance/zero tráfego → experimentos/exceções → alertas → resumo/saúde. Usar fuso oficial `America/Sao_Paulo`; horário exato depende de CFG-09 e orçamento de execução, não copiar 02h da `main` como homologado.

Contrato de execução: ID da rodada, política, janela, cursor estável, cobertura, itens processados/falhos/pendentes, checkpoint, dono/fencing do lock, início/fim. Salvar lote e checkpoint coerentemente. Worker vencido não pode gravar progresso; falhas persistentes ficam rastreadas sem monopolizar o primeiro lote. Priorizar componente alterado sem abandonar cobertura completa. Não usar polling novo nem cron reparador de regra determinística.

Dashboard consome as seis filas da política: crítico/decisão, atenção, experimentos, saudável/resumo, falhas de automação e aguardando confirmação. Detalhe abre evidência e ações permitidas; não despejar log bruto. Reusar templates em `src/lib/notifications/templates.ts` e auditoria administrativa existente. Esta entrega não altera layout nem cria `/radar`.

## 4. Complemento de paridade: `b6e1b17..cffc64d`

### 4.1 Registro dos 11 commits

As referências abaixo existem apenas no objeto `main` capturado, salvo correspondência explicitamente indicada na seção 2. Inspeção estática não equivale a execução dos testes ou homologação dessa branch.

| Commit | Alteração principal | Destino Bentevi / classificação |
| --- | --- | --- |
| `d57b841` | Política final, economia, fiscal e conflitos | Reaproveitar conceitos/solver após adaptação a C01/C02; V2-01/02/08A |
| `deed680` | Avaliações/eventos persistidos, projeções e checkpoint com dono | Adaptar a banco/contratos DEV, trilha e concorrência C03/C08; V2-04/12/13 |
| `1d0488e` | Fontes vivas, grupo e aprovação vinculada | Reaproveitar validação de contexto; completar lifecycle de override/liquidação e operação; V2-04/05/06/07/13 |
| `94bab47` | Migração de consumidores e bloqueio de escrita implícita | Adaptar preservando telas Bentevi, PxQ e outbox misto; V2-02/03/04 |
| `b2de03c` | Radar/filas e job retomável de observação | Reaproveitar diagnóstico e checkpoint, integrar Dashboard/scheduler existente; V2-09/12/13/14 |
| `d93af46` | Aposentadoria de comandos e reprocessamento | Reaproveitar fechamento de bypass; não executar/importar coortes/reprocessadores; V2-03/16 |
| `63659f2` | Testes pricing/conflitos/Radar | Adaptar casos a contratos e testes DEV; não declarar executados nesta tarefa |
| `3955bac` | Catálogo de regras e procedimento de verificação | Referência datada; reconciliar com este dossiê e política, sem outra fonte canônica administrativa |
| `f76ca7f` | Vínculo de vendas verificado e revisão auditada | Reaproveitar critério de identidade/contagem com paridades de pedidos; V2-02/09/13 |
| `c94f864` | Invalidação de aprovações e bloqueio de entradas legadas | Adaptar regressões e inventário de escritores; V2-03/04/13/16 |
| `cffc64d` | Relatórios de rollout/reprocessamento | Evidência histórica, não aceite Bentevi nem autorização operacional; PARITY-FINAL |

### 4.2 Achados adicionais e lacunas explícitas

| ID | Evidência no SHA `cffc64d` | Decisão / responsável |
| --- | --- | --- |
| PRC-N01 | `src/services/pricing-policy.ts` tem bandas compatíveis, 12 iterações, validade 24h, job 02h, lote 50/concorrência 4 | Bandas derivam da política; demais parâmetros não entram como defaults homologados. V2-01/12/15, DEC-01/03 |
| PRC-N02 | `src/services/pricing.ts` oferece candidatos, solver com recotação e memória | Adaptar para centavos, falha explícita e testes de fronteira; não transportar dois helpers com divergência econômica. V2-01/02 |
| PRC-N03 | `src/services/pricing-context.ts` reúne fontes; alguns fallbacks usam campos/data de produto | Revalidar proveniência/frescor no contexto exato; data geral do produto não prova data da cotação. V2-02 |
| PRC-N04 | `src/services/pricing-tax.ts` valida competência/evidência e meses ausentes; confirmação aceita taxa desde zero | Reaproveitar validação de cobertura/competência, **não portar remoção da proteção mínima de 4%**. Preservar contrato Bentevi e resolver confirmação/proteção em V2-02/15 |
| PRC-N05 | `pricing-context.ts`/migration guardam política, tributo e mapa de variáveis em JSON de `configuracoes` | Não copiar coleções administrativas para mapa JSON. Adaptar às fontes tipadas CFG-01/03; custo variável exige modelo homologado. V2-02/15 |
| PRC-N06 | `pricing-approval.ts` vincula assinatura econômica, fonte viva, preço anterior, promoções/PxQ e experimento | Reaproveitar guardas; estratégia com validade limitada não substitui override/liquidação e seus estados. V2-05/06/10/13 |
| PRC-N07 | `ml-pricing-group.ts` consulta `SYNC`, grava grupos/evidência; rota de preço faz leitura de origem/espelhos | Não usar helper como diagnóstico read-only. Adaptar identidade versionada e conclusão do grupo inteiro. V2-07/04 |
| PRC-N08 | Rota `ml/anuncio/atualizar-preco`: evento `APPLY_REQUESTED`, PUT, `APPLIED` da origem e posterior reconciliação de espelhos/persistência | Eventos/lock são base, não prova de consumo atômico ou recuperação de todo crash. Testar concorrência e sucesso remoto antes de falha local. V2-04/07/13 |
| PRC-N09 | `opportunity-radar.ts` usa cursor, lotes e `save_radar_batch`; há falha por produto no processamento | Reaproveitar fencing/checkpoint; provar progresso com falhas persistentes e cobertura total, não só lote feliz. V2-12 |
| PRC-N10 | `commercialDiagnosis` reconhece margem premium com vendas e classificação funcional por estratégia | Não reduzir premium; critérios comerciais/coortes precisam do aceite próprio. V2-08A/09, DEC-02 |
| PRC-N11 | Mudanças em `orders.ts`, `order-profit.ts`, sync de pedidos e conflitos/identidade do Radar | Adaptar sem perder quantidade, pack, vínculo fornecedor, venda concretizada e idempotência já validados. V2-02/09 |
| PRC-N12 | Relatórios `07_PENDENCIAS_VALIDACAO.md`/`08_RISCOS_RESIDUAIS.md` registram fonte estimada, revisão comercial/fiscal e lote canário, não noite completa nem escrita real de preço testada | Não declarar homologação global ou autonomia. V2-12/16 e PARITY-FINAL |

Todos os 112 caminhos têm destino por classe: 52 de `src` são candidatos de adaptação pelos contratos acima (incluindo UI, identidade, pedidos e transporte); 19 scripts ficam sem execução/importação, com fechamento de bypass avaliado em V2-03/16; 28 relatórios ficam como evidência histórica, sem copiar dados; 3 migrations exigem reconciliação própria; 5 testes fornecem casos a adaptar, não resultados; 3 docs são referências datadas; `package.json`/`tsconfig.json` não devem ser copiados por arrasto. Essa classificação de destino não é revisão linha a linha de cada artefato nem dispensa reinspeção na ação dona.

Para reproduzir o inventário sem executar código: `git log --reverse --oneline b6e1b17..cffc64d` e `git diff --name-only b6e1b17..cffc64d`. A classificação anterior PRC-D continua vigente. Nenhum SKU, estado de experimento, preço real, alíquota da coorte, CSV/XLSX ou aprovação histórica foi importado.

## 5. Persistência e migrations previstas — sem SQL nesta entrega

Nomes abaixo descrevem entidades/finalidades; nomes SQL e granularidade serão fechados na ação dona, após preflight `.162`, histórico e schema atuais. Reusar os mecanismos existentes antes de acrescentar objetos. Não reescrever migrations antigas nem marcar migrations de `main` como aplicadas por equivalência presumida.

| Ação | Persistência necessária / reutilização | Compatibilidade e rollback |
| --- | --- | --- |
| V2-01 | Política/contrato puro; nenhuma migration necessária para testar bandas | Sem conexão aos escritores, reversão de código isolada |
| V2-02/03 | Componentes/origens e fonte fiscal; faixas por preço final substituem papel de `pricing_cost_tiers`; lucro nominal opcional desligado | Migração aditiva tipada e versão; preservar configuração anterior como histórico, não segundo motor ativo |
| V2-04 | Avaliações imutáveis, eventos e operação/ID idempotente; vincular à projeção existente/outbox | RLS/grants, dedupe e atomicidade local testados; conservar trilha em rollback; legado `unknown` |
| V2-05/06 | Override e liquidação tipados, escopo/estado/autor/validade; uma proteção efetiva por escopo segundo precedência | Não fabricar override no backfill; retirada de código não apaga proteção ativa nem a transforma em autorização |
| V2-07 | Grupo/membros versionados e evidência; integrar `anuncios_ml` | Não inventar sincronismo por SKU; mudança de membros invalida decisões, conserva histórico |
| V2-09/10/11 | Evidência de janelas quando não recuperável das fontes existentes; experimento e baseline imutável | Não duplicar pedidos nem fabricar visitas; preservar baseline/estado em reversão |
| V2-12 | Task no registry, checkpoint e resultado parcial no mecanismo de jobs atual | Lock/owner/fencing; desabilitar task em rollback sem apagar checkpoint; nenhuma agenda nova paralela |
| V2-13 | Alerta/decisão/eventos e vínculo de aprovação à operação; reusar auditoria/notificações | Dedupe estável e restrições de estados; não deletar histórico para resolver alertas |
| V2-15/CFG-09 | Contratos/RPCs administrativos tipados; faixas, variáveis, níveis, limites e agenda | Concorrência por versão, auditoria sanitizada; salvar não publica; `sync_runtime_config` não vira cadastro genérico |

Migrations recentes apenas em `main` a reconciliar por efeito e dependência:

- `20260905190000_m2m_canonical_pricing_radar.sql`: política JSON, avaliações/eventos/Radar, projeção, RPC fiscal/admin e lote;
- `20260905191000_m2m_canonical_pricing_projections.sql`: projeções de leitura;
- `20260905192000_m2m_radar_classification_audit.sql`: auditoria de classificação.

Comparar com DEV: `20260830233000_rule_02_dynamic_pricing.sql`, `20260904163000_bnt_cfg_01_admin_audit.sql`, `20260904223000_bnt_cfg_03_commercial_pricing.sql` e domínio/outbox existente. A fotografia PARITY-13 anterior não cobre automaticamente essas três novas migrations. Acrescentá-las ao delta de promoção futuro; esta tarefa não modifica o registro de migrations.

Cada ação de banco futura exige destino `.162` confirmado, inspeção no mesmo destino, ensaio com rollback quando aplicável, testes de RLS/grants/concorrência e regeneração dos tipos. Compatibilidade DEV 17/produção 15 deve ser verificada no gate de promoção; não inferir compatibilidade só pelo nome dos objetos.

## 6. Transição sem dois motores publicando

1. **V2-01/02:** construir e testar contratos puros, comparando cenários sintéticos; nada de publicar em paralelo ou trocar configuração em produção.
2. **V2-03:** retirar o legado do papel de motor e adaptar consumidores; encerrar comandos/bypass de cálculo/publicação comercial implícita. Revisar pendências de preço do outbox antigo sem apagar estoque/status independentes. A V2 permanece em observação enquanto faltarem trilha/proteções/decisão.
3. **V2-04 a 07:** ligar origem, proteções e grupo antes de qualquer novo escritor executável. Ausência de contrato/proteção significa bloqueio de escrita, não fallback ao legado.
4. **V2-08 a 15:** evoluir diagnósticos, experimentos, job, decisão/UI e administração, uma ação por tarefa. Job observa; experimentos sem fluxo completo de aprovação não começam a alterar anúncios.
5. **CFG-08/09 e V2-16:** validar integração visual/operacional e matriz; mudança automática de preço continua `REQUIRES_CONFIRMATION` salvo regra explicitamente homologada como `AUTO_SAFE`.
6. **PARITY-FINAL/release:** reconfirmar novos commits, SHA implantado, migrations e experimentos ativos. Continuidade/encerramento do histórico produtivo exige decisão; não executar em DEV o experimento produtivo.

Rollback deve interromper a nova escrita/task e manter observação, dados e trilha. Não reativar silenciosamente faixas de custo nem restaurar backup integral sobre vendas posteriores. Se houver efeito ML, reversão exige plano comercial e reconciliação da operação, não apenas revert Git. Nenhum rollback operacional foi necessário ou executado em V2-00.

## 7. Decisões e gates ainda abertos

| ID | Questão a fechar | Momento bloqueado |
| --- | --- | --- |
| DEC-01 | Modelo de custos variáveis e comprovação de zero, validade/contexto de cada fonte, arredondamento projetado e dados fiscais por competência | V2-02 antes de declarar economia executável; controles finais V2-15 |
| DEC-02 | Amostra mínima, recorrência, critérios de margem funcional/premium, severidade financeira e coortes | V2-08A/09 antes de classificar por limiar não homologado |
| DEC-03 | Horário/limites da janela noturna, volume e orçamento real de APIs; cobertura com falhas | V2-12/CFG-09 antes de habilitar rotina remota |
| DEC-04 | Direção comercial resolvida pela ordem definitiva: alvo canônico para publicação; proteção fixa de 50% não é motor alternativo. Revalidar ML antes de concluir por risco de frete/tarifa; inconclusivo não gera pausa automática | Retirada do caminho legado ainda pendente em V2-03/M2M-PRC-04, antes de liberar criação/ajuste pela V2 |
| DEC-05 | Prazo de decisões, alçadas e limites econômicos/quantidades de liquidação; políticas dos experimentos | V2-06/10/13 antes de ativar exceções/experimentos ou escrita por decisão |
| DEC-06 | Semântica de visitas/conversão por grupo e marco inicial D7/D15/D30 quando há pausas/falta de coleta | V2-09/11 antes dos indicadores/alertas correspondentes |

As decisões técnicas de V2-01 foram fechadas conforme seção 11; as demais pendências continuam nas ações responsáveis, sem exigir decisão antecipada. Não copiar como política global 24h/02h/50/4 da `main`, cinco iterações/limiares/alíquota de experimento histórico ou prazo de estratégia de outro fluxo.

## 8. Matriz de aceite e regressões futuras

Todos os itens abaixo são **testes a implementar/executar nas respectivas ações**, não resultados desta entrega documental.

| Ação | Aceite verificável / teste mínimo |
| --- | --- |
| V2-01 | 200,00 / 200,01 / 1.000,00 / 1.000,01; bandas sem sobreposição/lacuna; objetivo na faixa final; cruzamento em ambos sentidos, múltiplos candidatos, ciclos, limite de iterações, valores inválidos e efeito de centavos |
| V2-02 | Resultado único na UI/API/PDF e venda; tarifa total com parcela fixa sem duplicação; custos variáveis; zero comprovado versus ausente; frete/tarifa do preço candidato; mês faltante/competência/PGDAS/mínimo 4%; oferta válida e quantidades |
| V2-03 | Nenhum escritor usa custo/lucro nominal universal; opcional desligado; nenhum sync muda atividade; scripts/CRUD não contornam fluxo; pendência mista do outbox conserva estoque/status |
| V2-04 | Todas as fontes; legado unknown; baseline antes de efeito; falha após ML e antes do banco; duas aplicações concorrentes; proposta/observação/aplicação distintas |
| V2-05 | Manual sem override, override ativo/vencido/revogado, leitura inválida bloqueia, auditoria e precedência |
| V2-06 | Liquidação somente interna, quantidade/validade/limite autorizados, prejuízo explícito, expiração sem alteração automática |
| V2-07 | Par SYNC/UNSYNC/inconclusivo, composição alterada, preço de origem/espelho, falha parcial e compensação inconclusiva; contagens sem duplicação |
| V2-08/08A | Buy Box abaixo do permitido não escreve; prejuízo real versus estimado; margem baixa não gera ação cega; premium com vendas preservada; recuperação pelo piso |
| V2-09 | 30/90/150; janela parcial SEM_AMOSTRA; cancelada não converte; pack e unidades corretos; visitas agregadas sem alegar unicidade não comprovada |
| V2-10 | Baseline imutável, proteções em todos os escritores antes de custom_price/enqueue, promoção/PxQ/automação ML, custo alterado, crash, safety stop e retomada sem perder sucesso |
| V2-11 | D7/D15/D30, atraso de execução, falta de coleta, reexecução e dedupe |
| V2-12 | Duplo dispatch, lock vencido/worker antigo, interrupção entre lote/checkpoint, falha persistente, cobertura inteira e retomada sem sobreposição |
| V2-13 | Aprovar/rejeitar/adiar, autorização no servidor, decisão obsoleta/expirada, clique duplo, consumo atômico, operação parcial e alerta abre/atualiza/resolve/reabre sem duplicar |
| V2-14/15 | Seis filas com ação permitida; sem informação sensível/log bruto; memória igual à API; contrato tipado, concorrência/auditoria e salvar sem publicar |
| V2-16 | Matriz completa, prova de idempotência e de proteções; ausência de bypass; homologação `.162`/contas de teste; zero escrita produtiva; paridade e rollback aceitos |

## 9. Validação executada nesta entrega

- Branch `dev` e árvore limpa confirmadas antes das alterações documentais.
- Node `v22.23.1`; 76 testes passaram, zero falhas, com `node --test` nos nove arquivos: `rule-02-pricing.test.js`, `target-net-profit-pricing.test.js`, `bnt-cfg-03-commercial-pricing.test.js`, `automatic-pricing-force.test.js`, `preferred-offer.test.js`, `product-activity.test.js`, `ml-quantity-pricing.test.js`, `ml-price-publish-tracking.test.js`, `ml-publish-outbox.test.js`, todos em `tests/`.
- `npm run validate` passou: ESLint e TypeScript. Avisos `MODULE_TYPELESS_PACKAGE_JSON` nos testes foram não bloqueadores e não motivaram alteração de configuração.
- Consistência documental: 12 links locais dos três documentos e 37 referências explícitas de código/schema do dossiê resolvidos no DEV ou no objeto `main` indicado, sem ausência; `git diff --check` passou. Revisão da fila manteve V2-01 e demais ações funcionais pendentes.
- A baseline valida o comportamento atual, inclusive regras que serão substituídas. Não comprova implementação da política V2, execução de SQL ou integração remota.
- Build/homologação visual: N/A para três arquivos Markdown, sem alteração de runtime. Nenhum teste da nova `main`, script histórico ou migration foi executado.

## 10. Fontes externas consultadas e limites

Consulta em 05/09/2026. O acesso direto a páginas do ML apresentou bloqueio/erro; os trechos relevantes foram lidos no conteúdo indexado do domínio oficial. Não houve validação autenticada dos endpoints; reconfirmar o contrato completo na ação de integração.

- [ML — comissão por vender](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender): tarifa depende do cenário; `sale_fee_amount` total inclui parcela fixa, que não deve ser somada novamente.
- [ML — custos de envio](https://developers.mercadolivre.com.br/custos-de-envio) e [custos e cotações](https://developers.mercadolivre.com.br/pt_br/mercadolideres-lojas-oficiais/mercado-envios-custos-e-cotacoes): distinguir cotação para preço/logística e custo efetivo do shipment.
- [ML — publicação no catálogo](https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo): relação pode persistir após perda de sincronismo; consulta específica informa SYNC/UNSYNC. Essa prova orienta C05, não autoriza reparar sincronismo automaticamente.
- [ML — concorrência em catálogo](https://developers.mercadolivre.com.br/en_us/catalog-competition): dado competitivo contextual; decisão econômica pertence à política Bentevi.
- [ML — visitas](https://developers.mercadolivre.com.br/recurso-visits): consulta em janelas de até 150 dias; não comprova semântica de visitantes únicos entre anúncios.
- [ML — PxQ percentual B2B](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b): percentual relativo ao preço-base e versionamento. Preservar o procedimento local, sem reintroduzir contrato absoluto antigo.
- [Receita Federal — Manual PGDAS-D, seção 8.3](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf): leitura direta, proporcionalização da RBT12 no início de atividade. O documento não homologa a alíquota da empresa; mínimo 4% e travas deste dossiê são o contrato operacional Bentevi, não afirmação de taxa tributária universal.
- [PostgreSQL 15 — locks explícitos](https://www.postgresql.org/docs/15/explicit-locking.html): leitura direta; locks transacionais terminam com a transação e locks consultivos dependem de cooperação. Reusar lock do domínio e testar posse/concorrência não torna chamada ML parte da transação. A versão 15 é referência de compatibilidade histórica de produção, não prova da versão atual do DEV.

**Conclusão:** escopo V2-00 entregue sem alteração funcional. Próximo passo: planejar **BNT-PRICING-V2-01 — Faixas por preço final**. Permanecem bloqueados escrita autônoma, promoção e os aceites comerciais/operacionais das ações posteriores.

## 11. M2M definitivo e implementação PRC-01 / V2-01 — 05/09/2026

**Fotografia anterior à implementação:** `dev` em `880bfca`, árvore limpa. Inspeção confirmou `calculateSuggestedPrice/getPricingStrategy` ainda por custo em `src/services/pricing.ts`, tipos legados em `src/types/pricing.ts` e testes RULE-02/CFG-03 vigentes. Não houve nova captura de `main`, banco ou sistema produtivo; PRC-D/PRC-N continuam referências datadas.

**Fonte incorporada:** [ordem M2M integral](VORTEK_M2M_ORDEM_CANONICA_PRICING_RADAR.md). Confirmado pelo responsável: prevalece nos conflitos e preserva os complementos compatíveis. A [seção 14 do plano](VORTEK_BENTEVI_PRICING_V2_PLANO.md) contém uma fila única, respeitando a ordem M2M com os complementos/dependências Bentevi; os identificadores correspondentes não são tarefas duplicadas.

### Implementação e interfaces

- `src/services/pricing-policy.ts`: `FINAL_PRICE_POLICY` imutável e versionada `M2M-PRC-01-v1`, `isFinalPricePolicy`, `getFinalPriceBand`, `resolveFinalPrice` e teto técnico de 12 iterações por candidato. Não há agenda, fallback financeiro, acesso a banco/rede ou comando de publicação.
- `src/types/pricing.ts`: tipos readonly de política/faixa, objetivo (`floor | target | limit | break_even`), calculador e resultado discriminado de sucesso/falha. Contratos atuais dos consumidores não foram alterados.
- `resolveFinalPrice` recebe política opcional (omissão usa a canônica; política inválida não usa fallback), objetivo e calculador puro síncrono. O calculador recebe faixa/objetivo/margem sobre receita e retorna centavos positivos seguros já arredondados para cumprir o objetivo. PRC-01 não duplica fórmula econômica nem presume cotação atual; PRC-02/04 integrarão a economia/cotação compatível.
- Três candidatas em ordem crescente; recalcular ao cruzar faixa, detectar ciclo, escolher menor solução estável. Um ciclo em uma candidata não elimina outra solução estável; erro/valor inválido de cálculo interrompe a resolução inteira, mesmo após achar candidata estável. Saída sem sucesso não contém preço substituto.
- Sucesso informa versão, objetivo, faixa, centavos e total de cálculos. Falhas: `POLITICA_PRICING_INVALIDA`, `OBJETIVO_PRICING_INVALIDO`, `PRECO_CANDIDATO_INVALIDO`, `CALCULO_CANDIDATO_FALHOU`, `PRECIFICACAO_NAO_CONVERGIU`. Mensagem arbitrária do callback não é reproduzida.
- Não arredondar preços arbitrários na entrada: centavo fracionário/inseguro é inválido. A conversão/arredondamento econômico será do calculador central PRC-02. Com três faixas e callback determinístico, ciclos são detectados antes do teto de 12; não são necessárias 12 tentativas para provar impossibilidade.
- Limite de busca é informação da política; o módulo não recebe preço vigente ou performance nem produz ação de redução. Não foi implementado ainda o diagnóstico completo de margem premium.

### Complementos do Radar — especificados, não implementados

O catálogo de contratos passa a incluir **C09 — filtro de conflitos/identidade/vínculo/economia** e **C10 — demanda, funil e priorização do Radar**, com os estados exatos nas seções 8–16 da ordem. Os donos são CFL-01/02/03/04 e RAD-01. Reativação não é novo anúncio; fonte ausente/404 de ranking não reprova; identidade incompleta não é divergência comprovada; GTIN não contorna contradição de kit/quantidade. O grupo exige prova de sincronismo. Estado competitivo abaixo do piso positivo exige revisão, não piso universal de 10%.

C02 recebe a precedência viva e `INCONCLUSIVO_FONTE_ML_INDISPONIVEL` antes de bloqueio por frete/tarifa. C08 incorpora as sete filas do Radar, rotina única e reprocessamento futuro da planilha. As seis filas de decisão econômica já aprovadas continuam como complemento, sem duplicar alertas, economia ou cadastros. A ordem não autoriza publicação automática em massa.

Os entregáveis exigidos `00` a `08` e `manifest.json` estão associados às ações na seção 20 do plano. Não foram geradas planilhas reclassificadas, relatórios de implantação, testes remotos ou evidências de homologação fictícias nesta entrega.

### Validação e limites

- 26 testes novos executados por `node tests/m2m-prc-01-final-price-policy.test.js`: fronteiras, centavos, política inválida/imutável, objetivos, cruzamentos, ciclos, menor solução, erro explícito, repetibilidade e isolamento do módulo.
- `npm run validate` passou (ESLint + TypeScript). Testes de regressão anteriores e consistência documental registrados no checklist após execução.
- Regressão conjunta confirmada: 102 testes passaram (26 novos + 76 existentes). Conferência documental: 19 links locais válidos, 24 seções numeradas da ordem integral e 13 ações M2M na mesma ordem no plano/checklist; somente V2-00 e PRC-01 concluídos no bloco. `git diff --check` passou.
- Fontes técnicas lidas: [TypeScript — unions discriminadas](https://www.typescriptlang.org/docs/handbook/2/narrowing.html), [Node 22 — TypeScript e import type](https://nodejs.org/docs/latest-v22.x/api/typescript.html) e guia TypeScript instalado do Next.js. O módulo usa imports somente de tipos e é testado no Node existente, sem mudança de dependências ou tsconfig.
- Sem build/deploy: módulo puro não ligado aos consumidores, sem alteração de rotas/UI/configuração de framework. Sem migration, banco, segredo ou escrita ML. `AGENTS.md` preservado. Reversão desta ação é retirada do módulo/tipos/testes novos e atualização documental; não há efeito financeiro remoto a compensar.

**Resultado:** PRC-01/V2-01 implementado no escopo puro aprovado. **Ainda pendente:** integrar economia/cotações, migrar consumidores, governar escritas e implementar conflitos/Radar. Não afirmar que o sistema já opera integralmente pela nova política. Próxima ação: planejar **M2M-PRC-02 / BNT-PRICING-V2-02 — Economia unitária única**.

## 12. M2M-PRC-02 / V2-02 — Economia unitária única (05/09/2026)

### AS_IS → TO_BE e decisão de escopo

Base local: `dev`, árvore inicialmente limpa, PRC-01 disponível. O helper legado `pricing-core.js` considera percentual ML sem parcela fixa, enquanto `calculateExactMarginPrice` admite fixa; os contratos não compartilham memória/origem. Nenhum consumidor foi migrado nesta ação: a retirada dos helpers legados do caminho decisório pertence à PRC-03.

O responsável decidiu **não incluir custos variáveis adicionais**. A previsão anterior C02/DEC-01 não exige cadastro ou dados extras nesta versão. A memória mantém apenas o marcador `additionalVariableCosts = { amountCents: 0, status: 'not_applicable', source: 'user_scope_decision_2026_09_05' }`. Não se trata de valor externo confirmado nem de substituição silenciosa de dado ausente. Ausência dos componentes efetivos continua inconclusiva.

### Interfaces implementadas e ownership

- `src/services/pricing-economy.ts`: `evaluateEconomicMemory`, `projectEconomicPrice` e `ECONOMIC_MAX_REFINEMENTS = 12`. Módulo puro do domínio pricing, ao lado da política; reutiliza `pricing.ts` para o mínimo tributário existente e recebe seu `PricingTaxContext`, sem duplicar cálculo RBT12/Simples. Não foi ligado a rotas/escritores nem reexportado por `pricing.ts` (evita dependência circular).
- `src/types/pricing.ts`: contratos `EconomicContext`, `EconomicComponent`, `EconomicTax`, `EconomicInput`, `EconomicMemory`, `EconomicResult`, projeção e razões discriminadas. Tipos e helpers antigos permanecem intactos para o corte PRC-03.
- Todos os montantes representam **uma unidade vendida**, em centavos inteiros seguros e BRL. `quantity` é a quantidade do cenário de cotação, não multiplicador dos montantes. Um total de pedido não é aceito como unidade; sua normalização/rateio explícito será responsabilidade do consumidor, sem inventar divisão/arredondamento nesta etapa. Kits usam a unidade vendida do anúncio, não uma peça interna do kit.
- Entrada identifica produto, oferta/fornecedor, anúncio/grupo quando conhecidos, competência e `marketContextKey` do cenário ML. Oferta projetada exige elegibilidade e identidade da origem; realizado exige custo histórico, sem depender da atividade atual da oferta.
- Componentes guardam montante, condição, origem, identidade, instante UTC, validade opcional, base e preço/contexto cotado. Estado `stale`, expiração informada, preço/contexto/quantidade divergentes ou dado obrigatório ausente/inválido resultam em `inconclusive`, motivos tipados e memória nula. Nenhuma mensagem externa arbitrária é reproduzida.
- Não há TTL comercial presumido. Validade temporal/material e prova de oferta são recebidas do chamador; reconsulta, seleção viva/fallback e invalidação operacional pertencem à PRC-04. A suficiência declarada dos dados não prova sua aquisição remota.

### Aritmética, tributação e projeção

- Uma avaliação soma custo, tarifa ML **total**, frete do vendedor e tributo. Breakdown de tarifa não é um débito adicional. Origem fallback sempre produz estimativa, mesmo quando marcada `known` pelo chamador. Zero explícito é válido; ausente não vira zero.
- Taxas são frações, não percentuais de apresentação. Projeções monetárias usam frações decimais exatas internamente com `BigInt`, half-up uma única vez por componente e saída JSON em números/centavos seguros. Margem é resultado/receita; comparação de objetivo usa frações exatas, não margem arredondada da UI. Sem dependência ou mudança de tsconfig.
- O contexto tributário preserva mínimo operacional 4%, alíquota protegida, competência e trava PGDAS. `confirmed` exige prova com competência, instante e identificação, alíquota correspondente e cobertura completa. Estimativa/proteção/cobertura não comprovada não são promovidas a confirmação. Quando PGDAS é obrigatório e não comprovado, o cálculo é inconclusivo. Não mudou fonte/RPC/cadastro tributário nem alegou comprovação fiscal dos dados existentes.
- Realizado aceita montante tributário explícito e o preserva. Sem montante realizado, o valor é uma projeção pela alíquota recebida; não altera documento fiscal. Lucro negativo/positivo e margem alta não geram ações.
- Projeção aceita exclusivamente um modelo **de fallback explicitamente declarado**, com percentual e parcela fixa, mais custo/frete e contexto tributário. Não transforma tarifa total observada em percentual nem extrapola cotação ML vinculada. O modelo gera componentes e chama a mesma avaliação usada para preço informado.
- Reutiliza `resolveFinalPrice` da PRC-01 nos quatro objetivos, candidato arredondado para cima e até 12 refinamentos de centavo. Confere margem efetiva depois dos arredondamentos, trata denominador inviável/overflow/não convergência explicitamente e não retorna preço substituto em falha. Recotação viva para outros preços é entrega PRC-04, não simulada como integração pronta.
- Memória guarda cenário, componentes, resultado, margem, faixa/piso/alvo/limite e versões. `fingerprint` é serialização com chaves ordenadas, incluindo o instante fornecido; identifica entradas iguais, **não** é assinatura de aprovação, token, chave de dedupe diário ou prova de autorização. Snapshot não compartilha referências mutáveis com a entrada.

### Testes, fontes e limites

- Suíte `tests/m2m-prc-02-economic-memory.test.js`: 37 testes, incluindo tarifa fixa sem duplicação, ausentes/zero, bases, origem, competência/PGDAS, cálculo RBT12 existente, montante realizado, precisão, fronteiras, repetibilidade, igualdade projeção/avaliação, exemplo M2M de 7,3% e falha real de refinamento limitado.
- Regressão conjunta: **139 testes passaram** (37 PRC-02 + 26 PRC-01 + 76 regressões existentes). `npm run validate` passou (ESLint/TypeScript).
- Fontes: [comissão ML](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender) confirma `sale_fee_amount` total incluindo fixa; [custos/cotações](https://developers.mercadolivre.com.br/pt_br/mercadolideres-lojas-oficiais/mercado-envios-custos-e-cotacoes) diferencia frete vendedor/comprador; [Manual PGDAS-D](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf) orienta contexto RBT12. No planejamento desta ação, páginas ML retornaram 403 na abertura direta e foram consultadas pelo conteúdo oficial indexado; PDF direto teve timeout, com seção indexada consultada. Mínimo operacional 4% é contrato Bentevi, não afirmação fiscal universal. Guia TypeScript instalado do Next e [Node 22 TypeScript](https://nodejs.org/docs/latest-v22.x/api/typescript.html) orientaram compatibilidade; testes reutilizam loader existente e módulos reais.
- Sem banco, migration, publicação ML, mudança visual, build ou deploy. Build não aplicável ao módulo puro não importado por consumidores. Nenhum commit/push nesta ação; `AGENTS.md` preservado.
- Rollback: remover exclusivamente módulo/teste/tipos novos e atualização documental desta ação; não há dados, ledger ou efeitos externos a compensar. Não retirar a PRC-01 já entregue.

**Resultado:** núcleo econômico validado, sem ativação no ERP. **Próxima ação:** planejar **M2M-PRC-03 / BNT-PRICING-V2-03 — Aposentar consumidores legados**. Homologação visual e paridade entre telas reais não foram executadas nem declaradas; dependem da migração de consumidores. Autonomia e produção permanecem bloqueadas.

## 13. Reconciliação comercial — BNT-PARITY-CANON-01 (06/09/2026)

### Fonte e estado real

Importado integralmente `docs/canon-comercial-vortek-bentevi-1.0.md` de `origin/main` no SHA `7f0a2921fe986562c348e75b16c319ab25076a97`, preservado em [VORTEK_CANON_COMERCIAL_V1.md](VORTEK_CANON_COMERCIAL_V1.md). A [matriz de paridade, seção 11](VORTEK_PARIDADE_REGRAS_PRODUCAO_BENTEVI.md#11-bnt-parity-canon-01--reconciliação-comercial-06092026) classifica os 18 commits após `cffc64d`, suas regras, consumidores, destinos e riscos. Não duplicar essa matriz em código ou configuração.

DEV permanece em `7f15d9f60112fe49778b7a61118dbab1db3080e7`, com a implementação PRC-02 local preexistente. Nenhum consumidor foi migrado aqui. O código versionado de main não é prova do SHA implantado; a inspeção somente leitura do serviço/imagem não confirmou revisão. Não houve conexão ao banco, migration ou escrita externa.

### Decisão de arredondamento — DEC-CANON-01

O responsável aprovou, no planejamento desta reconciliação, alinhar a **projeção de tributo** ao arredondamento para cima ao centavo usado no código de main. Evidência: `src/services/pricing.ts` em `7f0a292`, `ceilMoney` e avaliação do tributo (referência de arquivo corrigida em PRC-02A). Na fotografia anterior à PRC-02A, DEV usava `roundedRate` (half-up) em `src/services/pricing-economy.ts`.

- Aplicar prospectivamente em PRC-02A, centralizando a regra; não trocar indiscriminadamente o arredondamento da tarifa ML.
- Valor fiscal realizado informado continua prevalecendo integralmente. Não recalcular imposto confirmado/histórico para impor arredondamento de projeção.
- Centavos exatos permanecem exatos; fração positiva sobe ao próximo centavo, sem artefato de ponto flutuante.
- Testar produto de preço/taxa exato, abaixo/meio/acima de meio centavo, centavo mínimo, limites das faixas, estabilidade após arredondamento e valores monetários inválidos.
- Preservar RBT12/PGDAS, origem e estados estimated/confirmed; esta decisão é de projeção econômica, não nova regra tributária legal.

### Aceites e dependências da fila ajustada

| Ação | Dependência | Mudança e critério de aceite | Testes/evidência exigidos |
| --- | --- | --- | --- |
| `M2M-PRC-02A` | Esta reconciliação | Aplicar DEC-CANON-01; retirar `additionalVariableCosts`, inclusive marcador zero/not_applicable, do novo contrato e memória; versionar modelo econômico em correspondência a ECON-2; preservar histórico e valores realizados | Mesmas entradas → mesma avaliação/projeção; ausência do campo no tipo/saída; testes fiscais/fronteiras/convergência e regressões PRC-01/02 |
| `M2M-PRC-03` | PRC-02A validada | Migrar inventário de consumidores para memória central, incluindo CMV unitário de kits; retirar faixas por custo, nominal, margem global e piso universal 10% do caminho decisório/configuração | API/UI/PDF/simulação/pedidos comparáveis; componentes × quantidade sem duplicar CMV; oferta inativa ausente/inconclusiva, nunca custo zero; demonstrar que writers não usam helpers antigos |
| `BNT-CANON-QTY-01` | PRC-03 validada | Retirar desconto por quantidade de UI/API/config e jobs; encerrar endpoint legado explicitamente; worker ignora somente intenção legada de desconto, preservando estoque/status; manter histórico legível | Tentativa antiga não publica desconto; outbox mista mantém outras operações; compra normal de múltiplas unidades e preço unitário não regridem; nenhuma remoção remota automática |
| `M2M-PRC-04` | PRC-03 e QTY-01 validadas | Cotação compatível e revalidação viva antes de decisão econômica/publicação; recuperação pelo piso, preço novo pelo alvo | Tarifa fixa sem dupla contagem; frete stale corrigido; indisponibilidade → inconclusivo; atualização material invalida cotação/decisão |
| V2-04/05/06/07 e CFL-01/02/03 | Ordem da fila, uma ação por vez | Trilha/override/liquidação/grupos e identidade por evidência; assinatura material ignora refresh sem mudança, mas reconhece custo/oferta/quantidade | Aprovação idempotente, precedência, revogação e conflito material; catálogo não duplica estoque/resultado; ausência de evidência não reprova |
| `BNT-CANON-WARRANTY-01` | CFL-02 e CFL-03/V2-07 validadas | Resolver garantia com fonte e atributos reais; distinguir legal/contratual; fabricante/fornecedor/classificação conforme cânon, sem prazo universal, soma inferida ou primeiro valor da categoria | 12 meses versus 1 ano; todas as declarações de duração; conflitos; ausência/classificação duvidosa → pendência; atributos aceitos pelo contrato oficial ML |
| `BNT-CANON-PUB-GATE` | PRC-02A/03/04, QTY-01, trilha/exceções/grupo, CFL-01 a 04 e WARRANTY-01 validadas | Provar fluxo sugestão → preparação → aprovação → publicação → read-back em homologação, sem alterar atividade manual, duplicar anúncio ou perseguir prejuízo | Produto simples, kit, ativo já anunciado, candidato a reativação, par de catálogo, prejuízo, dados inconclusivos, garantia ausente, retry/duplo clique e mudança de custo após aprovação |

O gate de publicação deve usar primeiro testes de contrato com respostas controladas e fixtures sanitizadas; uma prova externa usa somente conta/item DEV e autorização específica da ação, sem dados produtivos graváveis. Limitação do ambiente externo fica registrada como pendência, nunca como teste aprovado. Não avançar se faltar validação exigida da ação atual.

### Preservação, rollback e pendências

- Não copiar arquivos de main em bloco: adaptar comportamentos aos contratos, configurações tipadas, serviços e UI Bentevi existentes. Reutilizar somente após confrontar a versão vigente.
- A correção intermediária de kits em `69bfdd3` não autoriza reintroduzir os extras removidos por `9ddc899`.
- Garantias/descontos remotos existentes e coortes históricas não são alvo desta entrega. A autorização original de main não vale para DEV.
- Esta entrega não cria migrations. Futuras alterações de schema exigem inspeção .162, nova migration, ensaio/rollback aplicável e tipos regenerados. Não importar/reexecutar migrations ou reparos de produção.
- Rollback desta ação é exclusivamente documental e seletivo: restaurar os trechos adicionados pela reconciliação preservando as edições PRC-02 preexistentes; não usar reset/checkout da árvore. Nenhum rollback operacional é necessário porque não houve ativação.
- A rotina noturna, experimentos e Radar continuam pendentes nas ações próprias; o limite de monitoramento da entrega pontual de main não os cancela. Publicação automática em massa continua proibida.
- A paridade final deve reconfirmar os deltas posteriores a `7f0a292`, o SHA implantado e os gates de dados/schema. A classificação atual não certifica produção pronta nem equivalência funcional total.

**Resultado desta ação:** fonte canônica incorporada, 18 commits classificados e fila reconciliada. **Próxima ação:** planejar PRC-02A. Evidências de validação documental e preservação do código constam no checklist.

## 14. M2M-PRC-02A — Ajuste ao Cânon Comercial (06/09/2026)

**Causa:** o núcleo PRC-02 ainda usava half-up para tributo calculado e incluía um marcador zerado de extras, divergindo de DEC-CANON-01 e do cânon. A busca de chamadores confirmou uso restrito ao próprio núcleo e testes; nenhum consumidor operacional foi migrado.

**Implementação:** `pricing-economy.ts` reutiliza a fração decimal existente e calcula teto por divisão inteira BigInt; não copia tolerâncias float da main. A [especificação ECMAScript de BigInt](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-bigint-divide) fundamenta a divisão inteira. `realizedAmountCents ?? ceilRate(...)` preserva valor realizado, inclusive zero. Na ausência do montante realizado, o valor calculado usa o mesmo teto e permanece estimado. Tarifa percentual/fixa ML, RBT12, PGDAS, validações, objetivos e limites do solver não mudaram.

`EconomicMemory.version` e a constante tipada do serviço usam `VORTEK-CANON-1.0-ECON-2`. `additionalVariableCosts` foi retirado do tipo, objeto e fingerprint, sem substituto ou compatibilidade paralela. `policyVersion` permanece a mesma: não houve alteração das faixas. O fingerprint continua serialização determinística dos dados completos, não assinatura de autorização.

**Testes:** suíte existente ampliada de 37 para 52 casos. Antes da correção, 15 falharam contra o contrato novo; após o ajuste, 52 passaram, junto às regressões, totalizando 154 testes. Cobertura nova: centavo exato, frações abaixo/meio/acima de meio centavo, preço mínimo, taxa decimal, fronteiras das faixas, limite monetário seguro, realizado/estimado, zero realizado, versão/ausência de extras e independência do arredondamento ML. Avaliação/projeção, determinismo e convergência continuam cobertos.

**Limites e rollback:** alteração exclusivamente do núcleo puro, tipos, testes e documentação local; sem banco, migrations, rede autenticada, mudanças de consumidores, build, homologação visual, commit/push ou deploy. O trabalho PRC-02 preexistente foi preservado. Rollback seletivo somente dos hunks PRC-02A e de seus testes/registros, sem reset da árvore ou recálculo de histórico.

**Resultado:** núcleo ajustado ao cânon; próxima ação: planejar PRC-03. A implementação ainda não certifica equivalência entre telas/publicadores/Radar. Validação geral e evidência final no checklist.

## 15. M2M-PRC-03 — Checkpoint de implementação parcial (06/09/2026)

Registro histórico da primeira parcela. A conclusão está na seção 16 e na [evidência atual de PRC-03](evidencias/M2M-PRC-03-validacao.md). O estado anterior abaixo não descreve a implantação atual.

**Estado: EM ANDAMENTO, não homologado.** O corte inicial de escrita está implementado localmente; a migração integral de consumidores ainda não ocorreu. Não avançar para QTY-01 nem liberar publicação. Os bloqueios abaixo não estão implantados em homologação: não houve commit, push ou deploy.

### Fotografia e causa

Branch `dev`, HEAD inicial `7f15d9f60112fe49778b7a61118dbab1db3080e7`; alterações PRC-02/02A e documentais preexistentes preservadas. Além dos helpers TypeScript e do cálculo no browser/PDF, as RPCs `search_produtos_paginated` e `search_produtos_resumo` consomem `private.rule_02_projected_price`, ainda baseado em `pricing_cost_tiers`. Portanto, trocar apenas o valor exibido não resolve ordenação, filtros ou resumo.

Consulta READ ONLY no destino confirmado `192.168.1.162`, hostname `supabase-dev`, pelo pooler de sessão: PostgreSQL 17.6, 109 entradas no histórico, última versão `20260905120000`. Confirmadas as tabelas comerciais e a assinatura de cinco argumentos de `save_commercial_pricing_configuration`, incluindo `p_cost_tiers`. Nenhuma transação de escrita foi aberta; nenhuma migration foi criada/aplicada nesta parcela. Não houve acesso ao banco `.160` nesta implementação.

### Matriz de execução AS_IS → TO_BE

| Consumidor | Estado encontrado | Implementação / restante |
|---|---|---|
| Contexto econômico | Núcleo puro sem carregador operacional | `pricing-context.ts`: lote limitado, ofertas paginadas, fornecedores operacionais, preferência manual válida, DTO atual/alvo/piso/break-even. Testado isoladamente; **ainda não conectado às rotas/telas** |
| Kits e simulação | Contrato exigia oferta do produto pai | Composição tipada da oferta real do componente × quantidade; somente kit simples válido. Simulação explícita sem IDs operacionais fictícios; tarifa calculada no núcleo compartilhado |
| Custo/frete → preço | Sync sobrescrevia `custom_price` e enfileirava preço | Removido o motor de `automatic-pricing.ts` e o bloco de recomposição por frete no sync de anúncios. Sincronização de evidências preservada |
| Criação, preço e opt-in | Rotas podiam executar antes da governança | HTTP 409 `pricing_execution_not_ready` após autenticação, antes do processamento comercial/ML. Guardas também no transporte de criação, preço e atacado |
| Cadastro/edição de produto | `custom_price` podia ser gravado e propagado | Alteração de preço bloqueada antes do update; valor idêntico é retirado do payload para permitir edição dos outros campos sem reprecificar |
| Outbox | Filas antigas podiam publicar preço e entrar em retry | Preço puro não é enfileirado; fila antiga de preço é cancelada. Linha mista executa estoque/status e registra `pricing_block`, sem reconciliar preço que não foi executado |
| Scripts comerciais | Cinco entradas ainda utilizavam estratégias legadas | Guardado o primeiro comando de batch, preparação, prateleira e campanha; testes executaram apenas esse comando isolado, nunca os scripts operacionais |
| Produtos/lista/detalhe/PDF | Fórmulas locais e SQL legado | **Pendente:** consumir DTO canônico; distinguir preço atual/sugerido e estado inconclusivo, preservar filtros e paginação |
| Anúncios/catálogo/schema/preço-detalhe | Cálculos próprios e snapshots de custo/frete | **Pendente:** migrar análise, apresentação e simulação para o mesmo DTO; não extrapolar cotação de outro preço/contexto |
| Pedidos | Subtração independente e imposto fixo de 4% | **Pendente:** aritmética compartilhada para totais, tributo por competência, cobertura de todos os itens e preservação de valores históricos/realizados |
| Comercial e RPC | `costTiers` editável e motor SQL antigo | **Pendente:** remover contrato/formulário ativo legado, simulador no servidor, política final somente leitura e nova migration sem gravar faixas por custo |
| Helpers/scripts residuais | Ainda existem consumidores e fórmulas antigas | **Pendente:** concluir inventário transitivo, migrar ou retirar; não remover helpers enquanto houver chamadores não migrados |

O carregador não usa `produtos.custo` como substituto de oferta. Frete sem evidência não vira zero; texto de warning e timestamp genérico de produto não comprovam modalidade ou cotação. Fallback `not_specified` exige modalidade fornecida pelo chamador para o mesmo anúncio. Sem prova mensal de PGDAS quando exigível, o resultado permanece inconclusivo. Aquisição/validade/recotação ML da PRC-04 não foi antecipada.

### Validação e limites

Passaram os 12 arquivos de testes direcionados: memória PRC-02, contexto PRC-03, bloqueios PRC-03, outbox, seleção de automação, RULE-02, inativação de fornecedor, Produtos, Detalhe do Produto, Anúncios, atividade e lifecycle de identidade. Cobrem efeitos nulos nos caminhos bloqueados, fila mista, preferência inativa, paginação de ofertas, kit composto/aninhado/inativo/fracionário, ausência de frete e identidade hipotética de simulação. `npm run validate`, `npm run build` e `git diff --check` passaram. Testes fiscais/pedidos/SQL da migração completa e homologação visual ainda não foram executados.

`AGENTS.md` e cópia do cânon mantiveram seus hashes iniciais. Skills de implementação DEV e Supabase mantiveram o trabalho local e a inspeção self-hosted somente leitura no `.162`; o endereço antigo presente na skill não substitui o mapa de ambientes do AGENTS.

**Rollback:** somente hunks desta parcela, preservando PRC-02/02A e demais alterações do usuário. Não há rollback de banco ou reprocessamento de histórico, pois não houve escrita. Não retirar isoladamente o guard de execução: ainda há código legado atrás dele. A conclusão da PRC-03 depende das linhas pendentes da matriz e de suas evidências, não apenas do build passar.

## 16. M2M-PRC-03 — Fechamento e homologação DEV (06/09/2026)

**Estado:** concluído o corte de consumidores legados no escopo de transição aprovado. Código `a26bde1` publicado e validado em `dev.bentevi.shop`. Próxima ação: planejar `BNT-CANON-QTY-01`; não houve implementação da próxima ação.

| Pendência da fotografia | Resultado final |
|---|---|
| Produtos, detalhe e PDF | DTO econômico central conectado, alvo separado de preço registrado, ausência explícita; filtros/resumo/ordenação sobre conjunto completo antes de paginar |
| Anúncios, catálogo, schema e simulação | Mesma memória central; retirada de fórmulas locais e piso fixo de 10%; PDF reutiliza consulta completa sem reconstrução por página |
| Pedidos | Aritmética total compartilhada, tributo por competência e cobertura integral de itens; sem evidência histórica itemizada, lucro novo permanece inconclusivo e valor histórico é preservado |
| Configuração e SQL | Formulário/contrato/RPC sem costTiers; faixas finais somente leitura; simulador explícito no servidor; motor SQL antigo retirado em migration nova |
| Helpers, scripts e writers | Entradas comerciais antigas falham explicitamente antes de efeito; criação/preço/opt-in bloqueados; estoque/status da fila mista preservados |

**Validação:** 291 testes passaram, `npm run validate`, `npm run build` e typecheck após regeneração dos tipos afetados aprovados. Homologação autenticada: 40 produtos, 55 anúncios, telas, simulador e PDFs com HTTP 200; tentativas comerciais com HTTP 409 esperado e nenhuma publicação externa. Capturas, commits, inspeção do runtime, resultado do simulador e roteiro de reversão coordenada na [evidência final](evidencias/M2M-PRC-03-validacao.md).

**Banco:** destino confirmado `192.168.1.162 / supabase-dev`; migration `20260906120000` ensaiada com ROLLBACK e aplicada transacionalmente, histórico 109 → 110. Registros operacionais preservados e assinaturas regeneradas por introspecção. Nenhum acesso ao banco de produção. O host `.160` foi usado somente para a aplicação web DEV/Easypanel, não para escrita de banco.

**Limites:** conclusão da PRC-03 não significa conclusão global do pricing. Aquisição/revalidação ML viva é PRC-04; QTY-01 e contratos de governança seguem na fila. O guard de execução não deve ser removido isoladamente. Ausência de evidência não foi convertida em preço, custo zero ou lucro realizado. Não houve promoção, escrita autônoma ou liberação comercial. `AGENTS.md` e cópia imutável do cânon preservados.

## 17. BNT-CANON-QTY-01 — Fechamento e homologação DEV (06/09/2026)

**Estado:** concluído. Código `9898b71` publicado em `dev.bentevi.shop`. Próxima ação: planejar `M2M-PRC-04`, sem executá-la nesta tarefa.

Editor, contrato administrativo, escritores e etapas de atacado retirados. Endpoints legados retornam 410; fila exclusivamente de quantidade termina sem retry, enquanto estoque/status de fila mista continuam no fluxo existente. Compra normal de múltiplas unidades e leitura informativa de descontos existentes no ML preservadas; nenhum desconto remoto alterado.

Migration `20260906130000` ensaiada com ROLLBACK e aplicada exclusivamente no destino confirmado `.162 / supabase-dev`: RPC comercial de três argumentos, tipos conferidos com assinatura viva, ACL preservada e três faixas históricas intactas por hash. Histórico com 111 versões; nenhuma migration histórica reescrita.

**Validação:** 281 testes direcionados, validate e build passaram; execução adicional de 47 testes também aprovada, com sobreposição. Homologação autenticada de Produtos, detalhe, Anúncios, Comercial, simulador e PDFs; endpoints antigos 410, payload administrativo legado 422 e guard comercial 409. Salvamento válido comprovado no teste isolado da rota e no ensaio real da RPC com ROLLBACK, sem alteração de parâmetros pelo navegador. [Evidências, captura e reversão](evidencias/BNT-CANON-QTY-01-validacao.md).

**Limites:** nenhuma escrita no banco de produção, publicação no ML ou liberação dos guards da PRC-03. Fontes ML vivas e governança permanecem nas respectivas ações. Histórico de auditoria e cânon imutável preservados.

## 18. BNT-M2M-RECON-01 — Coerência e dependências (06/09/2026)

**Entrega:** exclusivamente documental, aprovada pelo responsável após análise da fila. A sequência canônica permanece na seção 14 do [plano](VORTEK_BENTEVI_PRICING_V2_PLANO.md); o [checklist](VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md) registra execução. Não são novas políticas ou um segundo motor. Esta seção atualiza dependências e aceites anteriores, sem apagar suas fotografias.

### Causa e reconciliação

- O procedimento operacional ainda orientava proteção fixa de 50%, enquanto DEC-04 a rejeitava como motor alternativo; marcado como superado/não executável, sem percentual substituto.
- A ordem M2M transcrita ainda contém extras por SKU; preservada como transcrição, agora com aviso inicial de precedência do cânon e das regras removidas.
- A fila exigia override por grupo antes de entregar grupos; aprovação na prova externa antes de V2-13; classificação comercial antes de performance. Reordenadas as entregas existentes, sem duplicar IDs ou criar contratos transitórios descartáveis.
- Cabeçalhos e estados correntes reconciliados com PRC-03 e QTY-01 concluídas. Próximas ações históricas não são comandos atuais.

### Responsabilidades e testes obrigatórios das próximas ações

| Dono | Aceite obrigatório e evidência |
|---|---|
| PRC-04 | Integrar tarifa/frete compatíveis com preço candidato, categoria/catálogo e logística. Testar fronteiras e nova cotação quando o contexto mudar, tarifa fixa sem dupla contagem, vivo válido sobre fallback, fonte stale e indisponível, recuperação pelo piso e preço novo pelo alvo. Fonte ausente não vira zero; estimativa não vira confirmação. Preservar guard comercial: consultar ML não autoriza publicar. |
| CFL-01/02 | Consolidar verificações existentes; ausência não é contradição. Testar score alto com conflito material, dado ausente, GTIN divergente com variação legítima comprovada, marca/modelo, unidade/kit/quantidade. Nenhum score neutraliza conflito; nenhum atributo ausente é fabricado. |
| CFL-03/V2-07 | Entregar identidade/composição versionada e leitura de sincronização antes das proteções. Não deduzir grupo apenas por SKU/GTIN/related_item_id. Testar ativo já anunciado, reativação, vínculo inconclusivo e par sincronizado. Definir bases de agregação: estoque compartilhado não soma exposição disponível, vendas não duplicam eventos, visitas por anúncio não provam visitantes únicos do grupo. Escrita/read-back integrado só será provado após os contratos de execução. |
| V2-04/05/06 | Consumir grupo existente; registrar origem prospectiva sem inventar autoria histórica. Override por grupo até revogação manual, sem expiração automática herdada do contrato antigo. Liquidação com término expresso ou até revogação, sem teto arbitrário; exceção não contorna trava crítica. Testar precedência, revogação, alteração manual sem override e mudança de composição do grupo. |
| WARRANTY-01 e CFL-04/V2-08 | Garantia por evidência segundo cânon; não reativar prazo universal. Viabilidade usa a memória única e contexto competitivo válido, sem preço concorrente funcionar como ordem de redução. Testar falta/conflito de evidência, margem abaixo do piso, prejuízo e Buy Box economicamente incompatível. |
| V2-13 | Entregar confirmação auditável/idempotente, vínculo com avaliação/grupo/proteções, aplicação controlada e lifecycle/dedupe de alertas para os fluxos existentes. Testar autorização, aprovação/rejeição/adiamento, duplo clique, mudança material, crash após efeito remoto e retomada por leitura. Reusar outbox/locks e auditoria; testes de contrato não exigem job noturno ou Dashboard novos prontos. Não liberar writers genericamente por concluir o módulo. |
| PUB-GATE | Depender explicitamente de PRC-04, CFL-01/02/03/04, V2-04/05/06/13, QTY-01 e WARRANTY-01 validados. Provar sugestão → preparação → confirmação → publicação → read-back com produto simples, kit, anúncio existente e reativação. Conta/item DEV e autorização específica para prova externa. Fixtures protegidas não viram alvos graváveis. Guard de transição só pode evoluir para a execução canônica controlada no escopo aprovado, nunca desaparecer sem substituto. |
| V2-09 → V2-08A | Performance antes dos diagnósticos comerciais. Testar janelas/cobertura, venda cancelada, ausência como SEM_AMOSTRA e semântica de grupo. Sem evidência não afirmar margem premium validada ou margem baixa estrategicamente funcional; separar prejuízo estimado de realizado. |
| V2-10/11 | Experimentos e zero tráfego usam contratos anteriores de decisão/alerta/performance. Não duplicar executor nem agenda. Baseline, concorrência, safety stop, checkpoints e D7/D15/D30 testados sem tratar falha de coleta como zero visitas. |
| RAD-01 | Funil/score explicáveis e separados do filtro de conflitos. Pesos/limiares comerciais não definidos exigem homologação específica; nenhum default inventado governa publicação ou prioridade comercial. Sem evidência de demanda não significa inviabilidade. |
| RAD-02/V2-12 | Reusar scheduler, domínio/locks, checkpoint e alertas já entregues. Testar retomada, falha parcial, cobertura, dedupe e ausência de sobreposição. Uma rotina observacional, sem ativação silenciosa de escrita. |
| RAD-03/V2-14 | Incorporar filas acionáveis preservando layout e indicadores aprovados. Separar realizado de projetado; detalhe explica evidência/impacto/regra/ação. Não duplicar memória, alertas ou contagem por anúncio sincronizado. |
| V2-15, CFG-08/09 | Configurações tipadas/auditadas e integração dos contratos já entregues, sem reconstruir motor, Dashboard ou scheduler. Salvar parâmetro não publica/reprecifica silenciosamente. |
| RAD-04 | Identificar caminho, versão/hash, cobertura e vínculo com universo revisado antes de processar. A busca anterior no repositório não localizou oportunidades-ml.xlsx; não atesta ausência fora dele nem comprova os 65 candidatos. Não trocar o universo por amostra conveniente. Insumo faltante é pendência explícita, não conclusão; sem nova pesquisa pesada ou alteração ML. |
| M2M-GATE/V2-16 | Consolidar testes integrados, fontes, riscos, rollback e evidências reais por ação. Não substituir prova funcional por soma de unitários, liberar massa autônoma ou dispensar BNT-PARITY-FINAL antes da promoção. |

### Autoridade, fontes e preservação

O [Cânon Comercial 1.0](VORTEK_CANON_COMERCIAL_V1.md), incluindo complementos aprovados, permanece intacto. A limitação de monitoramento da entrega pontual produtiva não cancela Radar, experimentos ou rotina noturna pedidos para a V2. O plano define sua fila e homologação próprias.

A análise precedente consultou o conteúdo indexado da documentação oficial de [custos por vender](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender), [catálogo](https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo) e [visitas](https://developers.mercadolivre.com.br/pt_br/envio-de-produto/recurso-visits); abertura direta apresentou bloqueios. Na implementação de cada integração, reconfirmar o contrato aplicável. Não houve chamada autenticada ML nesta reconciliação.

**Validação concluída:** plano/checklist com a mesma sequência (32 linhas, 40 identificadores únicos), dependências críticas ordenadas, links locais adicionados válidos, transcrição original M2M preservada integralmente e alterações restritas a cinco documentos. `git diff --check` e `npm run validate` aprovados. Cânon e AGENTS intactos, sem código, migration, banco, ML autenticado ou deploy. Fechamento registrado no checklist; testes funcionais das ações futuras continuam pendentes. Reversão, se necessária, é documental e seletiva, preservando outras alterações; não envolve banco, anúncios ou rollback de runtime. Próxima ação: **planejar M2M-PRC-04**, sem executá-la nesta tarefa.
