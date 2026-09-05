# Contrato do filtro canônico

Filtro independente do score. Estado final: SEM_CONFLITO, CONFLITO_CONFIRMADO, PENDENCIA_VALIDACAO ou INCONCLUSIVO. Somente SEM_CONFLITO seria elegível a autonomia futura; esta entrega mantém confirmação individual.

Identidade compara GTIN, marca, modelo, part number, embalagem, quantidade, variação e atributos técnicos disponíveis. Ausência permanece inconclusiva; contradição material supera GTIN coincidente. Variação de GTIN exige evidência explícita. Quantidade multiplica UNITS_PER_PACK por PACKS_NUMBER e reaproveita o parser de apresentação existente. Não completa apresentação como “unidade” por padrão.

Vínculos distinguem JA_ANUNCIADO_ATIVO, REATIVACAO_CANDIDATA, NOVO_ANUNCIO_CANDIDATO e VINCULO_INCONCLUSIVO. A busca usa produtos, SKUs, snapshots de catálogo, itens próprios e histórico disponível. Vínculos ausentes na cobertura de conta impedem conclusão positiva. Relações sem prova de SYNC não unem preços nem autorizam escrita do par.

Economia: VIAVEL_NO_ALVO, VIAVEL_ACIMA_DO_PISO, ABAIXO_DO_PISO_MAS_POSITIVO, PREJUIZO_NO_PRECO_COMPETITIVO, CONFLITO_ECONOMICO_DE_BUY_BOX ou INCONCLUSIVO. Prejuízo baseado em fonte ML não viva fica inconclusivo para decisão. Estimativas positivas podem priorizar revisão; não equivalem a aprovação.

Demanda: SEM_EVIDENCIA_DE_DEMANDA, SINAL_INDIRETO, RANKING_ML e HISTORICO_PROPRIO. Ausência/404 não acrescenta conflito. A prioridade informa seis dimensões, sem nota opaca.

Filas: PRONTOS_PARA_ANALISE, ALTA_PRIORIDADE, REATIVACOES, PENDENCIAS_IDENTIDADE, CONFLITOS, ECONOMICAMENTE_INVIAVEIS, EXPLORATORIOS; estados adicionais explícitos INCONCLUSIVOS, REVISAR e JA_ANUNCIADOS.

Funil: DESCOBERTO → IDENTIDADE_VALIDADA → ECONOMIA_VALIDADA → SEM_CONFLITOS → PRONTO_PARA_PREPARACAO → AGUARDANDO_APROVACAO → PUBLICADO_EXPERIMENTO → VALIDADO/REJEITADO/REVISAR. A classificação deriva a etapa alcançada; revisão humana registra razão e usa comparação da etapa anterior para impedir sobrescrita concorrente. Publicação individual aprovada registra a etapa publicada. Revisão de fila não modifica o ML.
