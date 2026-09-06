# Validação e impacto

- `npm run validate`: lint sem avisos/erros e TypeScript aprovado. Evidência: validate.log.
- Regressão dirigida: 58 testes, 58 aprovados, zero falhas. Evidência: regression.log.
- `npm run build`: concluído. Evidência: build.log.
- Sintaxe do executor e gerador de D0: `node --check scripts/catalog-expansion-batch-01.cjs` aprovado.
- Produção: correção ec51185 implantada e bundle conferido; deployment.json contém build e container.
- Integração real: dois anúncios criados, dois eventos PUBLICADO_VALIDADO, leitura final de ambos ativa e sem divergência de preço, estoque, catálogo ou status. Os dois anúncios anteriores permaneceram ativos com os valores anteriores. Evidência: final-readback.json.

Os testes dirigidos cobriram catalog-expansion, commercial-canon, m2m-pricing-approval, m2m-pricing-integration, m2m-pricing-conflicts e ml-virtual-kit-orders. A validação real do Bravox concluiu a persistência do cenário current pelo backend corrigido; a medusa teve reconciliação explícita sem repetir criação.

## Alterações

Fallback de garantia comercial homologado aplicado ao resolvedor e interface existentes. Publicação do lote reutiliza a rota canônica, oferta, custo, tributação, pricing, aprovação e auditoria existentes. Acrescentados apenas gates e executor pontual necessários ao lote: identidade/catalogo vivo, imagem pública, fornecedor, dimensões, garantia, cotação, validação ML, idempotência e leitura posterior.

Nenhuma migration necessária. Nenhuma nova rotina periódica. Nenhum próximo lote iniciado. Nenhuma correção remota nos dois anúncios anteriormente ativos. Os seis candidatos pendentes não foram publicados.

Os preços permanecem os aprovados antes do POST. O frete por item alterou a contribuição após criação; os dois resultados permanecem acima do piso, conforme a memória registrada. A tributação é estimada, não confirmação fiscal.

## Limitações explícitas

IPI das duas bandejas requer esclarecimento sobre o preço de aquisição; não se somou nem se ignorou o percentual por inferência. A antena precisa de logística compatível. RCA, fans e Sparflex precisam de correção/validação individual do conteúdo de catálogo ou imagem. Visitas iniciais não coletadas permanecem ausentes. O incidente de auditoria da primeira criação e sua resolução constam de incident-reconciliation.md.
