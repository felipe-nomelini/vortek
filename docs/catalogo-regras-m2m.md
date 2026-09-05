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
