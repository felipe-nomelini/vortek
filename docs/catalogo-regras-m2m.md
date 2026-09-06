# Catálogo de regras M2M

| ID | Fonte canônica | Evidência / consumidor |
|---|---|---|
| M2M-PRC-01 | services/pricing-policy.ts | Configuração versionada por preço final |
| M2M-PRC-02 | services/pricing.ts; pricing-tax.ts | Memória econômica e tributo estimado/confirmado |
| M2M-PRC-03 | pricing-projection.ts; current_pricing_evaluations | Produtos, anúncios, PDFs e resumo SQL |
| M2M-PRC-04 | pricing-context.ts; pricing-approval.ts | Recotação viva e aplicação individual |
| M2M-CFL-01/02 | lib/ml/opportunity-conflicts.ts; opportunity-identity.ts | Identidade, apresentação e quantidade |
| M2M-CFL-03 | services/ml-pricing-group.ts | Anúncio existente e sincronização comprovada |
| M2M-CFL-04 | classifyCompetitiveEconomy | Piso da faixa, contribuição e Buy Box |
| M2M-RAD-01 | radarClassification; radarPriority | Funil e decomposição da prioridade |
| M2M-RAD-02 | services/opportunity-radar.ts; save_radar_batch | Lote, lock, checkpoint, idempotência |
| M2M-RAD-03 | /radar; /api/radar | Filas explicáveis e memória com validade |
| M2M-RAD-04 | scripts/reprocess-m2m-opportunities.cjs | Universo existente, sem pesquisa pesada |
| M2M-GATE | tests/m2m-*; tests/sql/m2m-pricing-radar.sql | Fronteiras, regressão D0, fontes, locks e trilha |

Scripts históricos de criação/limpeza, SEO reativador e D0 não são caminhos operacionais de pricing. Seus comandos de entrada foram aposentados quando escreviam usando políticas antigas. Evidências e migrations históricas permanecem preservadas.

M2M-IDENTITY-v2.1: comparadores de equivalência compartilhados por Radar, criação e leitura posterior; fonte por atributo, composição comercial separada de unidade vendida e avisos separados de conflitos. Mudanças da versão/descrição/marca/GTIN da oferta invalidam o fingerprint de classificação.

M2M-RAD-LAUNCH-01: `scripts/run-radar-launch-cohort.cjs` executa somente a coorte expressamente autorizada, com limite agregado de dez criações, lock do publicador, recotação viva, registro prévio e reconciliação sem segundo POST. Descrição de catálogo é somente leitura; atributos multivalorados são comparados por IDs. Safety stops preservam pausa, diagnóstico e resolução auditável.

M2M-RAD-MONITOR-01: `services/radar-launch-monitor.ts` usa o monitor agendado existente para D+7/D+15/D+30; `getProtectedPricingExperimentSkus` inclui a coorte validada nos 30 dias de proteção contra reprecificação por performance. Evidências D0 em `reports/RADAR_LAUNCH_2026_09_COHORT_01/`.

## Adequação ao Cânon Comercial 1.0

Autoridade: [Cânon integral e complementos](canon-comercial-vortek-bentevi-1.0.md). Modelo `VORTEK-CANON-1.0-ECON-2` substitui a autoridade decisória das memórias anteriores, preservadas no histórico.

| Regra | Consumidores / fonte | Ausência / autonomia |
|---|---|---|
| CANON-ECON-02 | pricing, pricing-context, orders, Radar, simulador e publicação; CMV único com componentes reais | Fonte material ausente: inconclusivo; nenhuma decisão usa custo variável ou lucro mínimo nominal |
| CANON-WARRANTY-01 | ml-sale-terms, product-warranty, schema/criar e evidência no cadastro | Fabricante → fornecedor → legal 30/90 documentado; classificação ausente: pendência específica |
| CANON-QUANTITY-REMOVED | Endpoint tombstone; UI sem sugestões; outbox descarta só desconto legado | Nenhuma escrita por quantidade; leitura para auditoria |
| CANON-OVERRIDE-01 | strategy / pricing_events, registro serializado por grupo | Desligada sem registro explícito; até revogação; admin + motivo |
| CANON-CLEARANCE-01 | strategy / pricing-approval | Prazo autorizado ou até revogação; sem teto técnico ou nova rotina |
| CANON-COST-RECOVERY-01 | automatic-pricing existente gera proposta no piso | Sem alteração automática; proteção/liquidação/experimento preservados |
| CANON-AUDIT-01 | audit-commercial-canon.cjs | Auditoria pontual GET/SELECT; políticas órfãs seguem para Diretoria |

O runner da coorte anterior foi aposentado para novas execuções; seus registros, baseline e monitor existente permanecem preservados. Não reutilizar a autorização histórica de garantia/publicação.
