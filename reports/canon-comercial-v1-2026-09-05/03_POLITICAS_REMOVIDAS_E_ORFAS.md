# Políticas removidas e pendências de autoridade

Removidas do caminho operacional: variableCosts/custo_variavel; lucro mínimo nominal; margem global; seleção de margem por custo; sugestões/escritas de descontos por quantidade; garantia universal de 12 meses; limite técnico de 30 dias para liquidação; custom_price como prova de proteção.

Dados históricos, migrations aplicadas e o campo físico margem_lucro foram preservados sem autoridade. A propriedade de mesmo nome recebida no contrato DSLite está marcada como depreciada, não consumida pelo pricing.

Preparadores/publicadores históricos que ainda carregavam regras antigas têm entrada interrompida antes de qualquer efeito. Não são uma segunda opção operacional. Os três scripts locais preexistentes ajustados somente no entrypoint estão identificados com hash em preexisting-script-adjustments.json; seus conteúdos não foram incorporados à entrega.

| Estado | Evidência | Tratamento |
|---|---|---|
| POLITICA_ORFA_DETECTADA — aposentada | Preparadores de agosto com 20/60/150 e faixas por custo; create-profitable-shelf-listings com economia própria | Entrada desativada; novas ações pelo motor canônico |
| POLITICA_ORFA_DETECTADA — aposentada | Auditorias locais não versionadas com otherVariableCost, margem paralela e fronteira de R$200 divergente | Entrada desativada; histórico preservado; não migrar números produzidos por elas como política |
| POLITICA_ORFA_DETECTADA — origem não comprovada | Preços remotos anteriores sem evento de autoria suficiente | Não inferir a regra pela margem atual ou por custom_price; fila individual de pricing |
| PENDENCIA_VALIDACAO | Garantias sem evidência vinculada/classificação de durabilidade | Fila documental; nenhum prazo fabricado e nenhuma redução remota |

Nenhuma nova política foi atribuída a uma lacuna. Regras existentes de experimento e suas cadências foram preservadas, sem ampliação. O limite operacional de custo de R$2.000 tem correspondência expressa na política preservada; não foi removido nem usado como faixa de margem.
