# Reconciliação da primeira criação

MLB5193194293 foi criado uma única vez. A resposta HTTP da rota ficou incompleta porque a finalização usava cenário `catalog_expansion_readback`, não permitido pelo CHECK da tabela pricing_evaluations. O registro de encerramento inconclusivo também omitia rule_id obrigatório, mascarando a causa inicial.

Correção: utilizar cenário canônico `current`, informar rule_id no encerramento e restringir tipos de cenários e eventos em TypeScript. Nenhuma migration ou flexibilização de constraint.

A conciliação usou GET remoto, simulação canônica com item_id, identidade, garantia, estoque, preço, catálogo e pesquisa remota de duplicidade. Evento PUBLICADO_VALIDADO persistido, sem novo POST. Preço R$169,63; margem 7,769852%; anúncio ativo. Frete pós-criação menor que a cotação prévia.

Bravox não sofreu POST na primeira tentativa. A pendência histórica de RMS foi resolvida com evidência individual: 60 W por unidade, 120 W no par, corroborada no conteúdo do catálogo. O registro anterior permanece no evento de revisão.
