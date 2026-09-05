# Consumidores AS_IS → TO_BE

| Consumidor | Fonte anterior | Fonte atual | Dependência/risco |
|---|---|---|---|
| Motor TS | Faixas por custo e mínimos nominais | pricing-policy/pricing | Fronteiras e estabilização testadas |
| Produtos lista/detalhe | Fórmula no navegador | Memória projetada e preço observado | Sem avaliação: pendência |
| Produtos resumo/filtros/ordenação | Fórmulas PL/pgSQL 4%+30% | current_pricing_evaluations | Migrations aditivas e substituição apenas de funções atuais |
| Ofertas e PDF produtos | Fórmulas locais | Memória compatível com oferta | Oferta inativa não fornece CMV |
| Anúncios e PDF | Lucro local independente | Memória atual por item/preço | Não mistura preço de outro anúncio |
| Simulador/schema ML | Estimativa/fallback própria | evaluateProductPricing + solveQuotedPrice | Exige contexto logístico e fonte identificada |
| Criação ML | Proteção 50% e correção automática | Alvo canônico, aprovação e recotação | Sem imagem fictícia; trava de identidade e lock |
| Alteração manual | PUT direto e atacado implícito | Aprovação vinculada às entradas | Promoções, atacado e experimentos exigem revisão |
| Worker/outbox | Envio de preço/atacado automático | Proposta com REQUIRES_CONFIRMATION | Estoque/status conservam seus guardas |
| Mudança de custo fornecedor | Alteração custom_price + outbox | Proposta; premium com vendas mantém | Guardas do experimento preservados |
| Sync observado | Repreço por frete configurado | Memória atual, sem correção automática | Fontes indisponíveis ficam pendentes |
| Monitor D0 | Cálculo/taxa congelada próprios | Economia viva canônica | Pausa econômica exige prejuízo confirmado |
| Buy Box | Lucro e corte próprios | Política por faixa e cotação viva | Não recomenda preço destrutivo |
| Resultado de pedido | Tarifa fallback e tributo fixo | Aritmética central, tarifa observada e tributo central | Componentes ausentes deixam lucro pendente; sem backfill executado |
| Radar e reprocessamento | Piso universal 10% | Mesmo motor/filtro | Memória extrapolada identificada como estimativa |
| CLI de lotes/limpeza/SEO/D0 | Regras históricas com escrita | Entrada aposentada, indica fluxo atual | Evidências históricas preservadas |
| Auditorias não versionadas preexistentes | Trabalho local anterior | Preservado fora da implantação | Não são consumidores do build entregue |

Levantamento bruto anterior: baseline-consumers.txt. A classificação de riscos foi registrada antes da implementação em 01_AS_IS_TO_BE.md. Não foram reescritas migrations históricas ou planilhas originais.
