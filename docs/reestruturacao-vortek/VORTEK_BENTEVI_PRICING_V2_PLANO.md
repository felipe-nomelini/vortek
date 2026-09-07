# Bentevi V2 — Política Canônica de Pricing

**Função:** contrato técnico e fila controlada de implementação
**Ambiente:** desenvolvimento/homologação
**Produção:** somente leitura até gate formal
**Data de incorporação:** 04/09/2026
**Situação (07/09/2026):** V2-05 implementada e validada localmente e no Supabase DEV `.162`; sem deploy ou homologação ML externa. Próxima ação: planejar `BNT-PRICING-V2-06 — Liquidação interna`. [Evidências V2-05](evidencias/BNT-PRICING-V2-05-validacao.md). Por decisão do usuário, push e deploy ficam para o final das etapas. Frete vivo ME2 permanece para a conexão autorizada da conta real: não bloqueia o desenvolvimento seguinte, mas continua bloqueador do aceite comercial do PUB-GATE, do M2M-GATE e da liberação comercial em produção. [Decisão PRC-04](evidencias/M2M-PRC-04-validacao.md#decisão-do-usuário--frete-na-conexão-da-conta-real). Nenhuma conexão de conta real ou escrita externa autorizada por esta atualização.
**Condição de início:** `BNT-PARITY-GATE` concluído e `BNT-CFG-07` aprovado

**Reconciliação documental — BNT-M2M-RECON-01 (06/09/2026):** concluída sem alteração funcional. Autoridade e dependências corrigidas na seção 14; aceites vigentes na seção 18 do dossiê e evidência no fechamento do checklist. Nenhuma etapa funcional posterior foi executada; próxima ação continua sendo planejar PRC-04.

**Atualização em 06/09/2026 — QTY-01:** o [Cânon Comercial 1.0](VORTEK_CANON_COMERCIAL_V1.md), importado de `origin/main` em `7f0a292`, atualiza as regras conflitantes da [ordem M2M](VORTEK_M2M_ORDEM_CANONICA_PRICING_RADAR.md); complementos compatíveis permanecem. PRC-02A, PRC-03 e QTY-01 concluídos nos respectivos escopos. Fechamentos nas seções 16/17 do dossiê e nas evidências [PRC-03](evidencias/M2M-PRC-03-validacao.md) e [QTY-01](evidencias/BNT-CANON-QTY-01-validacao.md). PRC-04 e governança continuam nas ações próprias. Nenhuma escrita comercial/autônoma ou promoção foi liberada.

**Transição PRC-02A concluída:** o campo de extras foi retirado do tipo, objeto e fingerprint da nova memória, sem substituto. Tributo calculado usa teto exato ao centavo; montante realizado informado, inclusive zero, prevalece. Cenário realizado sem montante continua estimado; tarifa ML mantém half-up. Custos de aquisição pertencem ao CMV; despesas corporativas não entram como extras por SKU. Decisão na seção 13 e implementação na seção 14 do dossiê; histórico preservado.

---

## 1. Missão e princípio

Adequar a Bentevi V2 à política comercial homologada, substituindo o motor baseado em faixas de custo e margens fixas por uma política baseada em preço final, economia unitária, piso, alvo, limite de busca, governança, catálogo, performance e experimentos.

A Bentevi deve operar como motor de decisão auditável:

`MEDIR → DIAGNOSTICAR → ALERTAR → CONFIRMAR QUANDO NECESSÁRIO → EXECUTAR COM TRILHA → AUDITAR`

A rotina noturna observa, calcula, diagnostica, consolida e alerta. Decisões comerciais relevantes ou com risco material permanecem sob confirmação humana até o gate de autonomia.

## 2. Encaixe obrigatório no Item 17

A ordem bloqueante permanece; os passos 1 a 4 foram concluídos no nível aplicável (00 é exclusivamente documental):

1. concluir `BNT-PARITY-01` a `BNT-PARITY-13`;
2. resolver a decisão registrada e concluir `BNT-PARITY-GATE`;
3. executar e aprovar `BNT-CFG-07`;
4. executar `BNT-PRICING-V2-00`;
5. executar uma única ação por tarefa na **fila unificada da seção 14**, com os identificadores M2M como correspondências, não tarefas duplicadas;
6. executar `BNT-CFG-08`, consumindo os alertas e indicadores já estabilizados;
7. executar `BNT-CFG-09`, incluindo agenda e saúde do job noturno;
8. executar `BNT-PRICING-V2-16`;
9. concluir `BNT-D20`.

`BNT-PARITY-FINAL` continua obrigatório imediatamente antes de qualquer promoção.

Não haverá dois motores publicando preços em paralelo. Até o gate `BNT-PRICING-V2-16`, alterações automáticas de preço permanecem `REQUIRES_CONFIRMATION`.

## 3. Comportamentos que devem ser preservados

- RBT12, Simples Nacional e trava PGDAS quando aplicável;
- taxa real do Mercado Livre antes do fallback;
- frete observado antes do fallback;
- fallbacks configuráveis;
- oferta como fonte de custo e estoque;
- preferência manual somente quando a oferta estiver ativa;
- menor custo entre ofertas válidas quando a preferência manual não for válida;
- `produtos.ativo` exclusivamente manual;
- custo alto afetando elegibilidade, nunca atividade do produto;
- configurações tipadas e auditoria administrativa sanitizada;
- jobs com idempotência, dedupe, locks, retries controlados e saúde;
- separação absoluta entre DEV e produção.

As paridades bloqueadoras, inclusive `BNT-PARITY-01`, não podem regredir.

## 4. Política comercial canônica

As faixas são determinadas pelo **preço final**, não pelo custo:

| Preço final | Piso | Alvo | Limite de busca |
|---|---:|---:|---:|
| Até R$ 200,00 | 5% | 7% | 10% |
| R$ 200,01 a R$ 1.000,00 | 7% | 10% | 15% |
| Acima de R$ 1.000,00 | 10% | 15% | 20% |

- **Piso:** mínimo operacional normal. Resultado abaixo do piso gera diagnóstico, não alteração cega.
- **Alvo:** referência para preço novo, publicação, simulação e experimento autorizado. Recuperação de preço existente prioriza o piso, não recomposição automática ao alvo.
- **Limite de busca:** teto para a busca automática de aumento; não é margem máxima permitida.
- Margem acima do limite com vendas deve ser preservada.

O cálculo por faixa deve ser determinístico:

1. calcular a economia unitária;
2. estimar o preço pela faixa candidata;
3. verificar a faixa do preço resultante;
4. recalcular quando cruzar uma fronteira;
5. repetir até estabilizar;
6. limitar iterações e falhar explicitamente se não convergir.

Os limites R$ 200,00, R$ 200,01, R$ 1.000,00 e R$ 1.000,01 são casos obrigatórios de teste.

Os pisos nominais de R$ 20, R$ 60 e R$ 150 são retirados do motor e das configurações, sem opção de reativação. Estruturas históricas podem permanecer somente sem novos consumidores.

Também retirar do caminho decisório a margem global legada e o piso universal de 10% para oportunidades. Não criar consumidores novos dos contratos antigos. Migrations/histórico não serão reescritos.

## 5. Economia unitária única

A fórmula canônica é:

`resultado_unitario = receita - CMV - taxa_ml - frete_vortek - tributo`

`margem_operacional = resultado_unitario / receita`

Todo cálculo deve registrar a origem do custo, taxa, frete, tributo e preço. Fórmulas paralelas divergentes são proibidas.

**Precedência definitiva:** taxa ML observada/viva válida vence fallback; frete/cotação ML viva vence local/fallback; custo vem de oferta elegível/preferencial ativa. Antes de pausar, bloquear publicação ou confirmar prejuízo por frete/tarifa, consultar ML vivo e recalcular. Fonte viva indisponível com dado local duvidoso gera `INCONCLUSIVO_FONTE_ML_INDISPONIVEL`, sem pausa automática. A implementação dessa revalidação pertence a `M2M-PRC-04`, após a economia central e o corte dos consumidores.

Tributação deve preservar RBT12, alíquota efetiva, mínimo de 4% e PGDAS quando exigível, diferenciando sempre valores `estimated` e `confirmed`.

## 6. Origem, auditoria e precedência

Toda alteração prospectiva de preço deve registrar conceitualmente:

- `pricing_source`;
- `pricing_changed_at`;
- `pricing_changed_by`;
- `pricing_reason`;
- `previous_price`;
- `new_price`;
- `pricing_rule_id`;
- `pricing_job_id`;
- `source_ml_item_id`;
- `pricing_group_id`.

Valores admitidos para `pricing_source`:

`manual`, `pricing_engine`, `scheduled_job`, `catalog_sync`, `mercado_livre`, `supplier_sync`, `migration`, `unknown`.

`custom_price` não comprova ação manual e não pode ser usado como trilha de origem. `manual_pricing_override` deve ser explícito, separado, auditável, por grupo e válido até revogação; editar preço não cria override implicitamente.

Precedência:

1. trava crítica;
2. liquidação autorizada;
3. override manual;
4. pricing group e sincronização;
5. política econômica;
6. contexto comercial;
7. otimização automática.

## 7. Exceções comerciais controladas

### Liquidação interna

`internal_stock_clearance` deve registrar autor, início, motivo, validade por data ou até revogação e estado, sem teto arbitrário de 30 dias. Pode autorizar margem abaixo do piso, zero ou prejuízo controlado. O impacto continua visível, mas não é corrigido automaticamente enquanto a exceção estiver válida.

### Pricing group e catálogo

`pricing_group_id` é a unidade econômica. Um par padrão/catálogo sincronizado deve ser representado por `catalog_synchronized_pair`.

Quando sincronizado:

- não pausar por duplicidade;
- não criar preços conflitantes;
- não duplicar estoque, exposição, resultado ou alertas;
- registrar origem e propagação;
- validar a sincronização após cada escrita.

Fluxo de exemplo: `MANUAL → MLB_ORIGEM → CATALOG_SYNC → MLB_ESPELHO`.

### Buy Box

`price_to_win` é evidência, não ordem. A decisão deve confrontar preço atual, `price_to_win`, break-even, piso, alvo e margem competitiva.

Quando `price_to_win` for inferior ao preço economicamente permitido, gerar `CONFLITO_ECONOMICO_DE_BUY_BOX`. Nunca perseguir Buy Box com prejuízo não autorizado.

## 8. Diagnósticos econômicos e performance

Margem abaixo do piso é diagnóstico. Deve cruzar visitas, vendas, conversão, recorrência, faturamento e competitividade, produzindo ao menos:

- `MARGEM_BAIXA_ESTRATEGICAMENTE_FUNCIONAL`;
- `MARGEM_BAIXA_SEM_RETORNO_COMERCIAL`;
- `MARGEM_BAIXA_SEM_EVIDENCIA_COMERCIAL`;
- `PREJUIZO_REAL`;
- `LIQUIDACAO_AUTORIZADA`.

A recuperação prioriza inicialmente o piso, não necessariamente o alvo.

Margem elevada não implica redução. Com vendas ou recorrência, classificar como `MARGEM_PREMIUM_VALIDADA_PELO_MERCADO` e manter. Redução somente por experimento ou regra explicitamente autorizada.

Performance é uma camada separada da economia, com janelas de 30, 90 e 150 dias; 30 dias é a janela primária. Ausência de evidência gera `SEM_AMOSTRA`. Quando viável, usar coortes por categoria, faixa de preço e logística.

Zero tráfego gera `ALERTA_AMARELO_SEM_TRAFEGO`:

- D+7: observação;
- D+15: alerta amarelo;
- D+30: auditoria de exposição e qualidade.

Alterações futuras desses limiares exigem auditoria e homologação.

## 9. Experimentos

Cada experimento deve preservar:

- `experiment_id` e `pricing_group_id`;
- tipo, início e fim;
- `baseline_price`, `baseline_margin`, `experimental_price` e `target_margin`;
- `baseline_visits` e `baseline_sales`;
- status, autor e motivo.

Estados: `planned`, `running`, `completed`, `cancelled`, `safety_stopped`.

O contrato deve preservar baseline, impedir otimizações concorrentes, detectar mudança de custo/taxa/frete, interromper ou alertar prejuízo não autorizado e garantir reversibilidade.

## 10. Rotina autônoma noturna

Criar uma rotina canônica diária, na madrugada e no fuso oficial, com agenda configurada apenas dentro dos limites seguros da área avançada de jobs.

Requisitos:

- execução `scheduled`;
- idempotência, dedupe e lock de domínio;
- checkpoint e retomada segura;
- batching e observabilidade;
- nenhuma sobreposição;
- falha parcial rastreável;
- nenhuma ação destrutiva silenciosa.

Escopo mínimo:

1. atualizar dados necessários;
2. reconstruir pricing groups;
3. validar custo e oferta;
4. recalcular economia;
5. detectar prejuízo;
6. detectar margem abaixo do piso;
7. detectar margem premium;
8. avaliar Buy Box;
9. consolidar visitas, vendas e conversão;
10. detectar zero tráfego;
11. acompanhar experimentos;
12. detectar exceções vencidas;
13. produzir alertas;
14. registrar resumo e saúde.

## 11. Níveis de autonomia

Toda regra declara um nível:

- `AUTO_OBSERVE`: diagnostica e registra;
- `AUTO_SAFE`: executa ação segura, reversível e homologada;
- `REQUIRES_CONFIRMATION`: aguarda decisão no ERP;
- `MANUAL_ONLY`: nunca executa automaticamente.

Matriz inicial:

| Evento | Nível inicial |
|---|---|
| Prejuízo real | `REQUIRES_CONFIRMATION` |
| Conflito Buy Box | `AUTO_OBSERVE` |
| Margem abaixo do piso | `AUTO_OBSERVE` |
| Margem premium | `AUTO_OBSERVE` |
| Zero tráfego | `AUTO_OBSERVE` |
| Checkpoint de experimento | `AUTO_OBSERVE` |
| Remover override | `MANUAL_ONLY` |
| Ativar ou remover liquidação | `MANUAL_ONLY` |
| Mudança automática de preço | `REQUIRES_CONFIRMATION` |
| Identidade ou GTIN | `REQUIRES_CONFIRMATION` |
| Falha crítica de integração | `AUTO_OBSERVE` + alerta crítico |

Uma regra só pode tornar-se `AUTO_SAFE` após auditoria específica e aprovação no gate de autonomia.

## 12. Centro acionável, confirmações e alertas

O Dashboard deve exibir decisões e não logs brutos:

- Crítico — requer decisão;
- Atenção — alerta amarelo;
- Experimentos em andamento;
- Pricing saudável e resumo;
- Falhas de automação;
- Aguardando confirmação.

Cada alerta deve conter SKU/produto, pricing group, motivo, severidade, evidência, impacto financeiro, recomendação, timestamp, regra e ação.

Uma confirmação permite aprovar, rejeitar, adiar e abrir detalhes. Registra usuário, decisão, instante, evidência e ação resultante. Aprovação é idempotente.

Alertas usam chave de dedupe estável e lifecycle capaz de abrir, atualizar, mudar severidade, resolver e reabrir sem perder histórico.

Severidades:

- **P0/CRÍTICO:** prejuízo relevante, venda incorreta, falha operacional crítica ou experimento com prejuízo não autorizado;
- **P1/ALTA:** recomendação econômica relevante, exceção vencida ou divergência de grupo/catálogo;
- **P2/AMARELO:** zero tráfego, abaixo do piso sem risco imediato, evidência insuficiente ou problema de qualidade/exposição;
- **INFORMATIVO:** margem premium, experimento saudável ou job concluído.

## 13. Configurações administrativas

Em `/configuracoes`, na seção Comercial e Precificação, expor com contrato tipado e auditoria:

- faixas por preço final;
- piso, alvo e limite;
- fallback de taxa Mercado Livre;
- fallback de frete;
- nenhuma opção de lucro mínimo nominal, margem global legada, extras por SKU ou desconto por quantidade;
- parâmetros homologados de observação;
- zero tráfego;
- permissões de automação por regra;
- políticas de experimento.

Coleções reais exigem tabelas tipadas. `sync_runtime_config` não pode virar armazenamento key/value administrativo genérico.

## 14. Fila obrigatória

Uma fila operacional; duas identificações na mesma linha representam **a mesma ação**. Reconciliação `BNT-M2M-RECON-01`, aprovada em 06/09/2026: preservar ordem relativa M2M, antecipar grupos antes das proteções, confirmações antes da prova de publicação e performance antes dos diagnósticos comerciais. Não criar entregas intermediárias descartáveis. 00/CANON-01 são documentais; PRC-01/02/02A/03 e QTY-01 estão concluídas nos respectivos escopos. Demais entregas funcionais abaixo estão pendentes; o checklist registra evidências e conclusão, não a mera posição na fila.

| Ordem | Ação | Prioridade | Entrega central |
|---:|---|---|---|
| 0 | `BNT-PRICING-V2-00` | P0 | Dossiê `AS_IS → TO_BE`, contratos, donos, consumidores, migrations e testes; nenhuma implementação funcional |
| 1 | `BNT-PRICING-V2-01` / `M2M-PRC-01` | P0 | Faixas finais e estabilização pura; sem ativação nos consumidores |
| 2 | `BNT-PRICING-V2-02` / `M2M-PRC-02` | P0 | Economia unitária, memória e projeção puras validadas; consumidores ainda não migrados |
| 2.1 | `BNT-PARITY-CANON-01` | P0 | Reconciliação documental concluída: fonte imutável, 18 commits classificados e fila ajustada |
| 2.2 | `M2M-PRC-02A` | P0 | Concluído: tributo calculado para cima ao centavo, campo de extras removido e memória ECON-2; realizados/histórico preservados |
| 3 | `BNT-PRICING-V2-03` / `M2M-PRC-03` | P0 | Retirar custo/lucro mínimo/margem global/piso universal de 10% do caminho decisório |
| 3.1 | `BNT-CANON-QTY-01` | P0 | Aposentar desconto por quantidade em UI/API/config/jobs, preservando compra de múltiplas unidades, estoque/status e histórico |
| 3.2 | `BNT-M2M-RECON-01` | P0 documental | Reconciliar autoridade, dependências e aceites; sem código, banco ou liberação comercial |
| 4 | `M2M-PRC-04` | P0 | Precedência/revalidação ML viva e inconclusivo explícito |
| 5 | `M2M-CFL-01` | P0 | Contrato canônico de conflitos independente do score |
| 6 | `M2M-CFL-02` | P0 | Identidade, embalagem, kit e quantidade com evidência |
| 7 | `BNT-PRICING-V2-07` / `M2M-CFL-03` | P0 | Anúncio existente, reativação, vínculo e grupos sincronizados; sem habilitar escritores |
| 8 | `BNT-PRICING-V2-04` | P0 | Origem e audit trail vinculados ao grupo existente |
| 9 | `BNT-PRICING-V2-05` | P0 | Override explícito por grupo até revogação manual |
| 10 | `BNT-PRICING-V2-06` | P1 | Liquidação interna |
| 10.1 | `BNT-CANON-WARRANTY-01` | P0 | Garantia por evidência, sem prazo universal ou atributo inventado; conflitos exigem validação |
| 11 | `BNT-PRICING-V2-08` / `M2M-CFL-04` | P0 | Viabilidade competitiva e Buy Box econômica |
| 11.1 | `BNT-PRICING-V2-13` | P0 operacional | Alertas, confirmações, lifecycle e dedupe; decisão auditável/idempotente antes da prova externa |
| 11.2 | `BNT-CANON-PUB-GATE` | P0 | Provar sugestão → preparação → confirmação → publicação/read-back em homologação, com economia, identidade, garantia e grupo coerentes |
| 12 | `BNT-PRICING-V2-09` | P1 | Performance 30/90/150 separada da economia |
| 13 | `BNT-PRICING-V2-08A` | P1 | Diagnósticos de margem baixa, prejuízo, liquidação e premium com evidência comercial |
| 14 | `BNT-PRICING-V2-10` | P1 | Experimentos |
| 15 | `BNT-PRICING-V2-11` | P1 | Zero tráfego |
| 16 | `M2M-RAD-01` | P0 | Funil e priorização explicável nas seis dimensões |
| 17 | `BNT-PRICING-V2-12` / `M2M-RAD-02` | P0 operacional | Uma rotina noturna de pricing/Radar com checkpoint, dedupe e cobertura |
| 18 | `BNT-PRICING-V2-14` / `M2M-RAD-03` | P0 | Dashboard, filas acionáveis e sete filas do Radar |
| 19 | `BNT-PRICING-V2-15` | P1 | Configurações administrativas tipadas |
| 20 | `M2M-RAD-04` | P0 | Reprocessar universo existente e candidatos revisados, sem pesquisa pesada |
| 21 | `BNT-CFG-08` | P1 | Integrar Dashboard, TV e metas |
| 22 | `BNT-CFG-09` | P1 | Integrar agenda e saúde operacional |
| 23 | `BNT-PRICING-V2-16` / `M2M-GATE` | P0 release | Regressão, evidências, homologação e gate de autonomia |
| 24 | `BNT-D20` | P1 | Composição visual final de Configurações |

Cada ação terá critério de aceite, teste e evidência próprios. Não agrupar correções independentes. Migrations são novas, ensaiadas e aplicadas somente no `supabase-dev` em `192.168.1.162`; produção em `192.168.1.160` permanece somente leitura.

**Contrato de transição vigente:** PRC-01/02 entregaram o núcleo; PRC-02A adequou a memória ao cânon; PRC-03 migrou consumidores, inclusive CMV unitário e kits, preservando bloqueios; QTY-01 retirou desconto por quantidade. PRC-04 integrará revalidação ML viva, sem liberar criação/preço. Não habilitar escrita substituta antes de trilha, proteções, grupo e decisão estarem validados. A seção 18 do [dossiê](VORTEK_BENTEVI_PRICING_V2_DOSSIE.md) registra os aceites reconciliados; a seção 13 permanece histórica. Cada linha é uma tarefa independente.

**Dependências sem ciclo:** CFL-03/V2-07 entrega identidade e leitura de grupos, não depende de publicação efetiva para ser concluída. V2-04/05/06 consomem esse contrato. V2-13 entrega decisões, aplicação controlada e lifecycle de alertas para os fluxos já existentes, com testes de contrato; não exige job noturno, experimentos ou Dashboard prontos. Essas entregas posteriores conectam seus produtores ao mesmo mecanismo, sem duplicá-lo. PUB-GATE só admite prova externa DEV após V2-13 e demais pré-requisitos, mediante autorização específica. Performance V2-09 antecede diagnósticos V2-08A; uma dependência ausente permanece explícita, nunca simulada como entrega concluída.

O gate de publicação é evidência funcional antecipada, não substitui `M2M-GATE`, o gate de autonomia ou `BNT-PARITY-FINAL`. Não autoriza publicação em massa, continuidade de coorte histórica, alteração de anúncios reais ou produção. A ausência de nova rotina periódica na entrega pontual do cânon de produção não cancela o job noturno já solicitado para a V2: ele permanece na ação própria, inicialmente observacional.

## 15. Gate de autonomia

Antes de qualquer escrita autônoma:

- toda regra possui nível de autonomia;
- toda escrita possui trilha;
- idempotência está comprovada;
- pricing group está consistente;
- override e liquidação são respeitados;
- safety stop foi testado;
- aprovação humana é idempotente;
- alertas estão deduplicados;
- produção não foi tocada durante homologação.

O padrão continua sendo `REQUIRES_CONFIRMATION` para mudança automática de preço.

## 16. Critério global de conclusão

A épica termina somente quando:

1. a política antiga por custo não governa pricing;
2. a política por preço final está centralizada;
3. a economia unitária é única;
4. alterações manuais, automáticas e por sincronização são rastreáveis;
5. override é explícito;
6. liquidação existe como exceção controlada;
7. catálogo sincronizado é uma unidade econômica;
8. Buy Box não pode induzir prejuízo não autorizado;
9. performance está separada da economia;
10. a rotina noturna é idempotente e observável;
11. o Dashboard possui filas acionáveis;
12. nenhuma ação automática existe sem nível de autonomia;
13. testes de regressão e paridade passam;
14. a documentação canônica está atualizada.

## 17. Entregáveis finais

- matriz `AS_IS → TO_BE`;
- migrations novas;
- contratos e tipos;
- testes unitários e de integração;
- evidência de cada ação `BNT-PRICING-V2-N`;
- screenshots ou descrição funcional do Dashboard;
- catálogo final de regras;
- matriz de autonomia;
- mapa de jobs noturnos;
- plano de rollback;
- riscos residuais;
- recomendação de promoção ou bloqueio.

## 18. Evidência atual e contratos externos

Na fotografia de incorporação:

- o motor atual ainda possui faixas por custo em `src/services/pricing.ts`, `src/services/commercial-pricing-configuration.ts` e `src/lib/commercial-pricing.ts`;
- `custom_price` é escrito tanto pela rota manual quanto pela automação, portanto não comprova origem manual;
- `price_to_win` já é armazenado e consumido, mas deve continuar sendo evidência econômica;
- visitas já fazem parte dos fluxos de anúncios e sincronização;
- ainda não existem fontes canônicas para pricing group, override explícito, liquidação e experimentos.

Contratos oficiais que devem ser reconfirmados na ação aplicável:

- Mercado Livre — concorrência de catálogo: `https://developers.mercadolivre.com.br/concorrencia-em-catalogo`;
- Mercado Livre — visitas: `https://developers.mercadolivre.com.br/recurso-visits`;
- Mercado Livre — publicação em catálogo: `https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo`.

As APIs oficiais sustentam o uso de `price_to_win` como informação competitiva, a consulta de visitas em janelas de até 150 dias e a necessidade de identidade exata para catálogo. A decisão econômica e o nível de autonomia pertencem à Bentevi.

## 19. Regressões obrigatórias vindas dos deltas produtivos de pricing

**Adição documental em 05/09/2026:** o intervalo `95941f1..b6e1b17` foi classificado na seção 4.1 de [Paridade de regras](VORTEK_PARIDADE_REGRAS_PRODUCAO_BENTEVI.md). Ela é a fonte dos commits, evidências e classificações `PRC-D01` a `PRC-D16`; não duplicar a coorte ou o executor produtivo neste plano. Estes requisitos estão **pendentes de implementação**, não são resultados de testes da V2.

| Ação responsável | Critérios adicionais de aceite/regressão |
| --- | --- |
| V2-01/03 | Fronteiras comerciais exatas; cruzamento e não convergência; cinco iterações do experimento são evidência histórica, não um limite novo obrigatório. Não restaurar o piso nominal universal. |
| V2-02/08A | Preço, tarifa e frete da mesma avaliação; frete antigo que simula prejuízo não pode causar decisão cega. Ausente/inválido não vira zero. Revalidar origem/oferta e contexto fiscal, não usar imposto fixo da coorte. |
| V2-04/10 | Registrar origem e preservar baseline antes da primeira escrita; crash após efeito remoto e antes do checkpoint; retomada não perde sucessos nem reenvia alteração confirmada. `custom_price` sozinho não identifica autoria nem override. |
| V2-07/10 | Origem e espelhos sem alvos duplicados ou preços concorrentes; falha em um membro; divergência após escrita; falha local após sucesso remoto; compensação não confirmada com bloqueio e evidência. Não confundir compensação com atomicidade distribuída. |
| V2-09/10 | Janelas/baseline coerentes, dados ausentes como SEM_AMOSTRA, venda cancelada não comprova conversão; validar semântica de contagem de visitas/pedidos por grupo antes de agregar. |
| V2-10 | Travar todos os escritores de preço antes de alterar `custom_price` ou enfileirar; leitura de proteção inválida bloqueia automação; respeitar promoção, B2B, automação ML, produto manualmente inativo e oferta válida. Outbox misto preserva operações independentes de estoque/status. Monitor e aplicação não se sobrepõem. |
| V2-11/13 | D7/D15/D30, execução atrasada e checkpoints pendentes; reexecução sem novo alerta idêntico; estado após D30 não remove proteção sem decisão explícita. |
| V2-12 | Batching, retomada e cobertura completa: grupos com falhas persistentes não monopolizam os lotes; custo alterado é priorizado sem abandonar os demais. Reusar scheduler/locks e agenda noturna aprovada, não copiar a cadência de cinco minutos. |
| V2-13/14/16 | Safety stop suspende novas otimizações e gera decisão acionável; pausa/alteração comercial externa continua sob a matriz de autonomia. Confirmar/rejeitar/adiar com trilha e idempotência, sem autorização herdada do experimento D0. Reusar templates Bentevi e dedupe pelo problema, não pela tentativa. |
| V2-00/06/10/15 | Não portar SKUs, alíquota, limiares particulares, estado JSON ou dados reais do experimento como defaults. Reusar políticas tipadas e contrato atual de bulk; não executar o script histórico, nem em --dry-run, pois seu fluxo pode renovar e persistir tokens. |

**Gate de sequência concluído em 05/09/2026:** o responsável aceitou explicitamente o encaminhamento das lacunas à V2, sem declarar equivalência funcional ou liberar produção. O registro está no checklist, seção `BNT-PARITY-GATE`. `BNT-CFG-07` foi posteriormente aprovada e V2-00 concluído. Os critérios funcionais da tabela continuam pendentes; o aceite não altera prioridades, política canônica, matriz de autonomia ou bloqueios de release.

**Complemento V2-00:** os 11 commits adicionais até `cffc64d` e os achados PRC-N01–PRC-N12 estão classificados na seção 4 do [dossiê](VORTEK_BENTEVI_PRICING_V2_DOSSIE.md). Isso atualiza o destino documental dos deltas, não comprova implantação, schema vivo ou homologação comercial da `main`. As três migrations novas daquele intervalo entram na reconciliação futura, sem replay nesta entrega.

**Promoção:** `BNT-PARITY-FINAL` deve reconfirmar o SHA implantado e a existência de experimentos ativos/aguardando decisão, com continuidade ou encerramento autorizados e sem perder baseline, checkpoints ou travas. O relatório D0 não comprova o estado na data do release. Nenhum experimento produtivo será importado ou ativado em DEV para esta classificação.

## 20. Incorporação definitiva M2M — contratos e entregáveis

A transcrição integral está na [ordem histórica da Diretoria](VORTEK_M2M_ORDEM_CANONICA_PRICING_RADAR.md), subordinada ao cânon posterior nos conflitos. Este plano e o dossiê mantêm o encaixe técnico; não são outra política comercial. PRC-01/02/02A/03 e QTY-01 estão concluídas nos respectivos escopos; as adições CFL/RAD/GATE abaixo permanecem **pendentes de implementação** e obedecem à fila reconciliada, não antecipam homologação.

- **CFL-01/02:** filtro independente de score com `SEM_CONFLITO`, `CONFLITO_CONFIRMADO`, `PENDENCIA_VALIDACAO`, `INCONCLUSIVO`. Comparar os atributos disponíveis e registrar motivos; GTIN isolado não supera contradição material. Variação legítima exige evidência. Kit/unidade/quantidade incompatível bloqueia automação, sem inventar dados ausentes.
- **CFL-03:** consultar ativos, pausados, próprios, catálogo, pares e histórico. `JA_ANUNCIADO_ATIVO`, `REATIVACAO_CANDIDATA`, `NOVO_ANUNCIO_CANDIDATO` e `VINCULO_INCONCLUSIVO` são estados distintos; eliminar já anunciado do funil de **novo** anúncio não significa excluir/pausar o anúncio existente.
- **CFL-04:** `VIAVEL_NO_ALVO`, `VIAVEL_ACIMA_DO_PISO`, `ABAIXO_DO_PISO_MAS_POSITIVO`, `PREJUIZO_NO_PRECO_COMPETITIVO` e `CONFLITO_ECONOMICO_DE_BUY_BOX`; abaixo do piso positivo vai à revisão, não a descarte automático. Abaixo de R$200, margem competitiva de 7,3% atende ao alvo da faixa. Confirmar origem viva antes de bloquear por frete/tarifa.
- **RAD-01:** demanda (`SEM_EVIDENCIA_DE_DEMANDA`, `SINAL_INDIRETO`, `RANKING_ML`, `HISTORICO_PROPRIO`) prioriza, não define conflito; 404/ausência não prova falta de vendas. Exibir identidade, economia, demanda, competitividade, estoque e completude/qualidade separadamente. Funil e estados paralelos são os da seção 13 da ordem, sem promover automaticamente por score.
- **RAD-02/03:** reusar scheduler e Dashboard. Sete filas mínimas: `PRONTOS_PARA_ANALISE`, `ALTA_PRIORIDADE`, `REATIVACOES`, `PENDENCIAS_IDENTIDADE`, `CONFLITOS`, `ECONOMICAMENTE_INVIAVEIS`, `EXPLORATORIOS`. Exibir todos os campos da seção 16 da ordem, inclusive origem/validade e recomendação; não duplicar a memória econômica ou o cadastro de alertas para cada consumidor.
- **RAD-04:** localizar e identificar por hash/versão a planilha `oportunidades-ml.xlsx` e o universo revisado; esta entrega não afirma ter recebido o arquivo nem reprocessado 65 candidatos. Após implantação autorizada em DEV, reclassificar a base existente, identificar faltantes, separar reativações e medir impacto. Não executar o reprocessador histórico de produção, não pesquisar um novo universo pesado nem modificar ML.
- **GATE:** testar as fronteiras e todos os casos de identidade/variação, embalagem, quantidade, anúncio existente, vínculo, reativação e catálogo; mesma memória no Radar/anúncio e mesmo preço no simulador; ML vivo desfaz falso prejuízo por dado stale. `AUTO_OBSERVE` para Radar; publicação permanece `REQUIRES_CONFIRMATION`, sem massa autônoma.

### Entregáveis por ação — não gerar evidência fictícia

| Artefato exigido | Ação responsável e fonte reutilizada |
| --- | --- |
| `00_RESUMO_EXECUTIVO.md` | M2M-GATE, consolidando resultados reais de cada ação |
| `01_AS_IS_TO_BE.md` | M2M-GATE, síntese rastreável do dossiê e deltas por SHA |
| `02_POLITICA_PRICING_CANONICA.md` | M2M-GATE, referência à ordem + evidência PRC-01/02/03/04, sem outra regra editável |
| `03_CONTRATO_FILTRO_CONFLITOS.md` | M2M-CFL-01, evoluído com CFL-02/03/04 |
| `04_MATRIZ_CONSUMIDORES_PRICING.md` | M2M-PRC-03, atualizando o inventário do dossiê |
| `05_TESTES_E_EVIDENCIAS.md` | M2M-GATE, consolidando execuções por ação sem antecipar homologação |
| `06_REPROCESSAMENTO_OPORTUNIDADES.xlsx` ou CSVs | M2M-RAD-04, somente após reprocessamento efetivo |
| `07_PENDENCIAS_VALIDACAO.md`, `08_RISCOS_RESIDUAIS.md` | M2M-GATE, com pendências/rollback reais |
| `manifest.json` | M2M-GATE: SHAs, hashes dos insumos/artefatos, cobertura, versões, ambiente e limites da evidência; sem secrets |

Saídas finais serão reunidas em um diretório de relatório da execução M2M em DEV. A documentação canônica continua na base de reestruturação; os relatórios referenciam essas fontes, não criam motores ou políticas concorrentes.
