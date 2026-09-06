# Validação

- npm run test:m2m-pricing-radar: 101 testes passaram.
- node --test tests/commercial-canon.test.cjs: 15 testes passaram.
- node --test tests/product-activity.test.js: 1 teste passou; limite operacional de custo preservado.
- 12 entrypoints históricos executados em ambiente mínimo: todos interromperam antes dos efeitos, com POLITICA_REMOVIDA.
- npm run validate: lint e TypeScript aprovados.
- npm run build: build de produção aprovado.
- Migration + tests/sql/commercial-canon.sql no PostgreSQL self-hosted: COMMERCIAL_CANON_SQL_PASS, encerrado com ROLLBACK na validação. Aplicação efetiva, quando executada, fica em migration-apply.log.

Cobertura: fronteiras/estabilização, fonte viva versus stale/fallback, estimado/confirmado, ausência de componente extra, identidade/conflitos, CMV de kit e igualdade com pedido, perda real e premium, recuperação no piso, estratégia explícita e revogação, garantia por precedência/contradição/duração/category sale_terms e equivalência 12 meses/1 ano. Nenhum teste publica anúncio nem faz pedido DSLite ou operação fiscal.

A interface compilou, mas não houve teste visual autenticado em navegador nesta entrega. A aceitação remota de um novo payload de garantia não foi testada com POST real; o contrato foi consultado e a leitura das categorias foi auditada. Isso respeita o escopo sem mutação remota.

Logs de validação em evidencias/. Auditoria: 5.518 anúncios, 0 falhas de consulta, cobertura completa de ativos e pausados. Requests sanitizados registram método, endpoint, status e instante.

Contratos oficiais consultados: [Mercado Livre — publicação e sale_terms](https://developers.mercadolivre.com.br/devcenter/publicacao-de-produtos), [preços por quantidade](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b), [busca de itens](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas), [PostgreSQL 15 — locks](https://www.postgresql.org/docs/15/explicit-locking.html), [Supabase — RPC](https://supabase.com/docs/reference/javascript/rpc), [Easypanel — deployment trigger](https://easypanel.io/docs/services/app#deployments). O acesso integral ao portal ML retornou 403 em parte das consultas; trechos oficiais indexados e respostas vivas das categorias complementaram a evidência.

Produção: health HTTP 200; novo build e regras encontrados no bundle. A tentativa de GET de cadastro sem sessão autenticada retornou 401, como esperado; não conta como validação da interface. A venda de kit 2000018304422954 continua com lucro de R$7,46 na leitura do banco, sem reprocessar o pedido.

A conferência adicional encontrou cinco ofertas com múltiplas menções de garantia. Todos os prazos da oferta são comparados; os dois anúncios vinculados a essas ofertas mantiveram a classificação após a revisão. Não houve nova pesquisa externa.

Regressão adicional: refresh de timestamp sem alteração de oferta/custo/quantidade preserva aprovação; alteração de quantidade invalida. A segunda migration foi testada com rollback: projeções atuais passaram de 3.701 a 3.902 no mesmo snapshot transacional, sem recotar ou modificar preço. Depois foi aplicada e registrada no histórico.
