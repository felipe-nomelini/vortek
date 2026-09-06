# Consumidores e fontes

| Consumidor | Fonte canônica / alteração |
|---|---|
| Anúncio novo, schema e simulador | pricing-context → resolvePricingProduct → quoteMlEconomics → pricing; novo no alvo |
| Radar | Mesmo resolvedor, costBasis e solveQuotedPrice; fingerprint inclui componentes |
| Pedidos | resolvePricingProduct e unitResult; kit multiplica CMV e quantidade sem duplicar tarifa |
| Sugestão por alteração de custo | automatic-pricing → economia viva → piso; registra proposta por grupo |
| Aprovação | economicSignature sem custos extras, com componentes e versão; nova recotação antes do ato |
| Listas, produtos, PDFs | current_pricing_evaluations → pricing-projection; nenhuma fórmula paralela adicionada |
| Garantia | product-warranty → ml-sale-terms; registro explícito no pricing_events |
| Proteção/liquidação | pricing/strategy + pricing-strategy, evento persistente por grupo e revogação |
| Configurações | pricing-policy com tabela exata; update_canonical_pricing_config auditável |
| Atacado | Aplicação retorna 410; worker ignora flag legada; leitura de prices e price_per_quantity preservada |
| Preparadores antigos e publicador D0 | Entry points aposentados; histórico não reescrito |
| Auditoria pontual | audit-commercial-canon.cjs: somente SELECT e GET |
| Reprocessamento econômico pontual | reprocess-commercial-canon.cjs: motor existente, GET ML e novas memórias; sem job periódico |

Novas memórias registram custo, componentes/ofertas/fornecedores/quantidades, tarifa/frete e origens, tributo estimated/confirmed, resultado, margem, faixa e timestamps. O valor 7,46 é exclusivamente fixture de uma venda de kit.

Timestamp de fonte permanece na trilha, mas sozinho não invalida aprovação. A assinatura usa identidade da oferta/componentes, quantidade, custo, taxas, tributo e versão; a view verifica estado material atual e validade.
