# Testes e evidências

## Executado

| Validação | Resultado | Evidência |
|---|---|---|
| `npm run test:m2m-pricing-radar` | 71 passaram, zero falhas | 05_testes.log |
| `npm run validate` | Lint e TypeScript aprovados | 05_validate.log |
| `npm run build` | Next.js compilado, rotas Radar presentes | 05_build.log |
| SQL em produção, transação com ROLLBACK | M2M_SQL_PASS | 05_sql_rollback.log |
| Aplicação das três migrations | Registradas e verificadas | 05_migrations.log; 05_migration_audit.log; 05_estado_banco.log |
| GET ML vivo via serviço canônico | Oferta elegível, tarifa e frete vivos | 05_live_smoke.json |
| Job Radar em produção | HTTP 200, 50 processados e checkpoint | 05_radar_canary.log |
| Importação | 1.977 candidatos; repetição sem duplicar | 06_importacao.log; 06_idempotencia.log |
| Sintaxe dos comandos legados encerrados/reprocessador | `node --check` aprovado | Comandos executados antes do commit final de testes |

## Cobertura

Os testes de domínio exercitam R$ 200,00/200,01/1.000,00/1.000,01, estabilização e não convergência, margem piso/alvo/premium/prejuízo, tributo estimado/confirmado, tarifa/frete vivos versus fallback e invalidação de evidências. Integração verifica equivalência econômica dos consumidores e impede falso prejuízo por dado stale quando a cotação viva o resolve.

Conflitos cobrem GTIN, divergência material, variação legítima, embalagem/quantidade, anúncio ativo, reativação, vínculo inconclusivo, pares sincronizados e separação de demanda. Regressões existentes cobrem oferta preferencial, resultado de pedido, experimento de margem premium, propostas de preço, estratégia nominal explícita, ativação, quantidade de catálogo e competição.

A aprovação é testada contra mudança de custo/preço anterior, reutilização, ausência, grupo divergente e fonte inconclusiva. SQL verifica lock concorrente/expirado, idempotência, checkpoint, trilha de revisão e comparação de etapa, além dos privilégios que impedem mutação da memória/eventos.

## Verificação operacional

A primeira tentativa limitada do Radar falhou em uma consulta a `pedido_itens.produto_id`, coluna inexistente no schema real. A consulta foi corrigida para `seller_sku`, com o vínculo real `pedido_id → pedidos(id)` e filtro de situações. O novo teste, job `5c0184e5-48e5-4d92-8375-d7dac394d5cb`, processou 50 produtos. A cobertura incompleta de vínculo continuou explícita, sem autorizar publicação. Ambos os jobs de teste foram cancelados após a verificação.

A leitura ML viva do SKU VTK000004 / MLB6955942282 obteve preço R$ 116,68, CMV R$ 70,48, tarifa total R$ 13,42 e frete R$ 14,95. Com tributo estimado pelo RBT12 auditado, a contribuição estimada foi R$ 8,16; a memória registra custo variável ausente e tributo estimado. O procedimento faz somente GET no ML.

Após importação e teste operacional: 2.024 candidatos únicos, 1.258 avaliações, 2.027 eventos de classificação, zero referências econômicas quebradas. Estes são números da fotografia final, não totais imutáveis do sistema em operação.

## Limites da validação

Não foi executada escrita de preço/publicação em anúncio real, homologação comercial dos candidatos, ciclo noturno completo nem navegação automatizada do dashboard em navegador. Rotas e página foram compiladas e identificadas no contêiner implantado; o serviço real do Radar e os contratos de domínio/persistência foram exercitados separadamente. As estimativas da planilha não substituem recotação no momento da aprovação.

A validação SQL foi revertida integralmente; as migrations foram aplicadas em operações separadas. Nenhuma ferramenta enviou mensagens a terceiros durante esta execução.

## Rastreabilidade dos critérios de aceite

| Critério | Implementação / prova |
|---|---|
| 1. Faixas por custo aposentadas | Motor por preço final; matriz de consumidores; comandos históricos encerrados |
| 2. Sem piso universal de 10% | Teste de margem 7,3%; 14 reclassificações na planilha |
| 3. Economia única | Motor compartilhado e teste de equivalência; projeções SQL sem fórmula própria |
| 4. ML vivo vence stale | Testes de fontes e leitura real documentada |
| 5. Identidade/economia/demanda separadas | Contrato e classificação de domínio |
| 6. Kit/quantidade impede automação | Testes de embalagem e bloqueio de identidade |
| 7. Demanda ausente não vira conflito | Teste específico e fila inconclusiva sem reprovação por ranking |
| 8. Reativação separada | Teste de vínculo e 25 itens na aba/fila de reativações |
| 9. Par sincronizado não duplica economia | Grupo com evidência SYNC; verificação dos membros antes de aplicar preço |
| 10. Buy Box não induz prejuízo | Teste econômico e proposta condicionada à fonte viva |
| 11. Dashboard explica filas | Página/rota compiladas; critérios, dimensões e recomendação expostos; revisão visual humana pendente |
| 12. Regressões passam | 71 testes, validate, build e SQL com rollback |
| 13. Sem publicação automática em massa | Modo AUTO_OBSERVE; escritas de preço/publicação exigem aprovação individual |

Implantação final: commit `c94f864`, build `aIiL-_eggee9mHMTxMbA9`. O contêiner contém o registro do teste de aprovação adicionado nesse commit. As rotas `/api/radar` e `/api/pricing/simulate` responderam HTTP 401 sem autenticação, preservando o controle de acesso. Evidência: 05_implantacao_final.log. A tentativa inicial por loopback não alcançou o servidor; a verificação usou o hostname do próprio contêiner, correspondente ao endereço de escuta.
