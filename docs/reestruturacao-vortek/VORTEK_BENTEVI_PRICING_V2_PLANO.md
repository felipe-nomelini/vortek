# Bentevi V2 — Política Canônica de Pricing

**Função:** contrato técnico e fila controlada de implementação
**Ambiente:** desenvolvimento/homologação
**Produção:** somente leitura até gate formal
**Data de incorporação:** 04/09/2026
**Situação:** planejada e bloqueada
**Condição de início:** `BNT-PARITY-GATE` concluído e `BNT-CFG-07` aprovado

---

## 1. Missão e princípio

Adequar a Bentevi V2 à política comercial homologada, substituindo o motor baseado em faixas de custo e margens fixas por uma política baseada em preço final, economia unitária, piso, alvo, limite de busca, governança, catálogo, performance e experimentos.

A Bentevi deve operar como motor de decisão auditável:

`MEDIR → DIAGNOSTICAR → ALERTAR → CONFIRMAR QUANDO NECESSÁRIO → EXECUTAR COM TRILHA → AUDITAR`

A rotina noturna observa, calcula, diagnostica, consolida e alerta. Decisões comerciais relevantes ou com risco material permanecem sob confirmação humana até o gate de autonomia.

## 2. Encaixe obrigatório no Item 17

Esta épica não começa imediatamente. A ordem bloqueante é:

1. concluir `BNT-PARITY-01` a `BNT-PARITY-13`;
2. resolver a decisão registrada e concluir `BNT-PARITY-GATE`;
3. executar e aprovar `BNT-CFG-07`;
4. executar `BNT-PRICING-V2-00`;
5. executar uma única ação `BNT-PRICING-V2-N` por tarefa, de `01` a `15`, incluindo `08A`;
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
- **Alvo:** referência para preço novo, recomposição e experimento autorizado.
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

Os pisos nominais de R$ 20, R$ 60 e R$ 150 deixam de governar o motor. A capacidade pode permanecer apenas como política opcional, tipada, auditável e desativada por padrão até nova homologação.

## 5. Economia unitária única

A fórmula canônica é:

`resultado_unitario = receita - CMV - taxa_ml - frete_vortek - custos_variaveis - tributo`

`margem_operacional = resultado_unitario / receita`

Todo cálculo deve registrar a origem do custo, taxa, frete, tributo e preço. Fórmulas paralelas divergentes são proibidas.

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

`custom_price` não comprova ação manual e não pode ser usado como trilha de origem. `manual_pricing_override` deve ser explícito, separado, auditável e possuir lifecycle próprio.

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

`internal_stock_clearance` deve registrar autor, início, motivo, validade opcional e estado. Pode autorizar margem abaixo do piso, zero ou prejuízo controlado. O impacto continua visível, mas não é corrigido automaticamente enquanto a exceção estiver válida.

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
- lucro mínimo opcional;
- parâmetros homologados de observação;
- zero tráfego;
- permissões de automação por regra;
- políticas de experimento.

Coleções reais exigem tabelas tipadas. `sync_runtime_config` não pode virar armazenamento key/value administrativo genérico.

## 14. Fila obrigatória

| Ordem | Ação | Prioridade | Entrega central |
|---:|---|---|---|
| 0 | `BNT-PRICING-V2-00` | P0 | Dossiê `AS_IS → TO_BE`, contratos, donos, consumidores, migrations e testes; nenhuma implementação funcional |
| 1 | `BNT-PRICING-V2-01` | P0 | Faixas por preço final e convergência determinística |
| 2 | `BNT-PRICING-V2-02` | P0 | Economia unitária única |
| 3 | `BNT-PRICING-V2-03` | P0 | Retirar política antiga de custo/lucro mínimo do papel de motor |
| 4 | `BNT-PRICING-V2-04` | P0 | Origem e audit trail do pricing |
| 5 | `BNT-PRICING-V2-05` | P0 | Override manual explícito e lifecycle |
| 6 | `BNT-PRICING-V2-06` | P1 | Liquidação interna |
| 7 | `BNT-PRICING-V2-07` | P0 | Pricing groups e pares de catálogo |
| 8 | `BNT-PRICING-V2-08` | P1 | Buy Box econômica |
| 8A | `BNT-PRICING-V2-08A` | P1 | Diagnósticos de margem baixa, prejuízo, liquidação e margem premium |
| 9 | `BNT-PRICING-V2-09` | P1 | Performance 30/90/150 separada da economia |
| 10 | `BNT-PRICING-V2-10` | P1 | Experimentos |
| 11 | `BNT-PRICING-V2-11` | P1 | Zero tráfego |
| 12 | `BNT-PRICING-V2-12` | P0 operacional | Job noturno idempotente e observável |
| 13 | `BNT-PRICING-V2-13` | P0 operacional | Alertas, confirmações, lifecycle e dedupe |
| 14 | `BNT-PRICING-V2-14` | P1 | Centro acionável no Dashboard |
| 15 | `BNT-PRICING-V2-15` | P1 | Configurações administrativas |
| 16 | `BNT-PRICING-V2-16` | P0 release | Gate de autonomia |

Cada ação terá critério de aceite, teste e evidência próprios. Não agrupar correções independentes. Migrations são novas, ensaiadas e aplicadas somente no `supabase-dev` em `192.168.1.162`; produção em `192.168.1.160` permanece somente leitura.

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
