# BNT-PRICING-V2-04 — Origem e audit trail de preços

Data: 07/09/2026. Base: `5e28343`, branch `dev` inicialmente limpa.

**Resultado:** implementação e validação local/SQL DEV concluídas. Migrations aplicadas exclusivamente em `192.168.1.162`. Sem push, deploy, consulta autenticada ML ou acesso à produção. Push e deploy ficam para o final das etapas por decisão do usuário. Próxima ação: **BNT-PRICING-V2-05 — Override explícito**.

## AS_IS → TO_BE

| Área | Estado anterior | Entrega |
| --- | --- | --- |
| Memória econômica | Resposta transitória do cálculo canônico | Avaliação imutável com ID, autor autenticado e assinatura material, sem nova fórmula |
| Preço observado | Writes em anúncio e snapshot sem trilha canônica | RPC transacional única com projeção + evento, locks por item e dedupe entre projeções |
| Origem legada | `custom_price` não comprova autoria | Captura passiva registra `unknown`; nenhuma reconstrução fictícia do passado |
| Atualizações repetidas/atrasadas | Sem watermark próprio de pricing | Refresh sem evento econômico; dado anterior não sobrescreve preço; timestamp conflitante fica inconclusivo |
| Futuro comando comercial | Sem operação auditável vinculada ao grupo | Preparação idempotente com avaliação, versão do grupo, baseline e estados explícitos |
| Resultado remoto | HTTP bem-sucedido não comprova preço | Confirmação exige contrato de read-back para origem e todos os membros; sem transporte ML nesta etapa |
| Consulta | Sem endpoint de histórico por produto | GET autenticado, paginação por cursor e campos explícitos sem payload remoto |

## Modelo e contratos

`pricing_evaluations` guarda a memória econômica canônica sanitizada, sem fórmulas paralelas. `pricing_operations` guarda intenção/estado idempotente. `pricing_events` guarda eventos imutáveis, preços em centavos, origem, autor, motivo, regra/job, avaliação e grupo/versionamento quando comprovados. `pricing_observed_at` nas duas projeções é watermark temporal, não segunda fonte de preço.

Fontes aceitas: `manual`, `pricing_engine`, `scheduled_job`, `catalog_sync`, `mercado_livre`, `supplier_sync`, `migration`, `unknown`. Suportar uma fonte no contrato não significa que seu executor foi habilitado. Autor manual é obrigatório; ator de requisição vem da sessão, não de um campo livre enviado pelo browser.

- Avaliação não altera preço. `evaluationId` foi acrescentado à resposta de preço detalhado; listagens e simuladores puros não persistem avaliações indiscriminadamente.
- Primeira observação comprovada é `baseline`, com preço anterior desconhecido. Não atribui autoria retroativa nem transforma `custom_price` em override.
- Captura sem contexto registra apenas `projection_changed/unknown`, inclusive no runtime anterior enquanto o deploy aguarda. Não afirma confirmação no ML.
- Mesmo item/preço observado nas duas tabelas não duplica o evento econômico. Refresh atualiza watermark sem criar evento. Mudança econômica material preserva anterior/novo.
- Observação antiga mantém o preço vigente. Divergência com o mesmo timestamp registra `inconclusive`. O serviço compara o preço persistido e devolve erro explícito ao produtor quando o valor solicitado foi rejeitado.
- Auditoria e projeção pertencem à mesma transação. Erro no lote não deixa preço gravado sem seu evento. Lotes limitados a 200 registros e locks ordenados por item.
- Preparação exige avaliação do produto, grupo vigente `verified`, item membro e baseline observado coerente em todos os membros. ID repetido com mesmo comando não duplica; conteúdo diferente com mesmo ID falha.
- Estados: `prepared → requested → confirmed/failed/inconclusive`; pode desistir antes do pedido. `inconclusive` não volta a `requested`. Confirmação exige read-back; falha após pedido/resultado incerto exige prova de ausência de efeito para todos os membros. Operação incerta mantém exclusividade do grupo.
- Versão do grupo e baseline são reconferidos ao registrar o pedido. Confirmação exige grupo vigente, preço esperado e leitura posterior ao pedido. Propagação `catalog_sync` só é registrada com operação correlacionada e revisão que comprove par sincronizado.
- Provas são fornecidas pelo backend confiável ao contrato interno. Não foi conectado executor HTTP, endpoint de aprovação ou job comercial. Essa estrutura, sozinha, não autoriza execução nem comprova uma operação real no ML.
- RLS e grants impedem acesso direto de `anon`/`authenticated`; funções de escrita são restritas a `service_role`. Avaliações/eventos não podem ser alterados/apagados pelo acesso operacional. Histórico HTTP segue a autenticação existente de produtos e não expõe JSON bruto de evidências.

## Consumidores migrados

- `src/services/pricing-audit.ts`: contratos, assinatura material, persistência observacional e operações internas.
- `src/lib/ml/reconcile-anuncio.ts`: reconciliação comum, incluindo observações recebidas pelo fluxo de webhook; preço ausente/inválido não vira zero.
- `src/lib/ml/persist-single-anuncio.ts`: persistência existente por SKU/ID com guards de identidade preservados.
- `src/app/api/sync/anuncios/route.ts`: snapshot e reconciliação compartilham versão temporal remota quando disponível.
- `src/app/api/catalogo/no-catalogo/refresh/route.ts`: lotes observacionais usam a mesma RPC.
- `src/app/api/catalogo/optin/route.ts` e `src/app/api/ml/anuncio/criar/route.ts`: pontos de persistência preparados; guards comerciais permanecem bloqueando execução.
- `src/app/api/ml/anuncio/preco-detalhe/route.ts`: avaliação explícita persistida e ID aditivo.
- `src/app/api/produtos/[id]/pricing-history/route.ts`: consulta por produto, filtros opcionais de item/grupo, cursor e limite de 100.

Não foi criada interface nova. Não foram alterados motor econômico, tributação, preços sugeridos, autonomia, estoque, status ou atividade manual de produtos. Os escritores comerciais continuam bloqueados por `pricing_execution_not_ready`.

## Banco e validação executada

Destino real verificado: `192.168.1.162`, hostname `supabase-dev`, PostgreSQL 17.6. Histórico e schema conferidos nesse destino antes das escritas; ensaios com rollback antes da aplicação.

1. `20260907180000_bnt_pricing_v2_04_audit.sql`: estruturas, captura e RPCs.
2. `20260907183000_bnt_pricing_v2_04_operation_evidence.sql`: exigência de baseline de todos os membros e prova de ausência de efeito antes de liberar operação incerta. Migration adicional preserva a primeira já aplicada, sem reescrever histórico.

As duas foram registradas em `supabase_migrations.schema_migrations`. Tipos de tabelas/RPCs gerados pelo metadata do mesmo DEV; a segunda migration preserva assinaturas.

- `tests/pricing-audit.sql`: baseline, dedupe entre projeções, refresh/watermark, alteração, stale, conflito temporal, lote atômico, captura passiva, imutabilidade, idempotência, falha sem prova, resultado incerto, confirmação e privilégios. Executado em transação revertida; fixtures não persistidas.
- Concorrência real com duas conexões: segunda operação aguardou advisory lock, confirmado em `pg_locks`; após rollback da primeira, segunda concluiu; também revertida.
- Suíte Node direcionada: **325 testes, 325 aprovados**, incluindo M2M anteriores, auditoria, reconciliação, persistência por SKU, identidade e DTOs de produto/oferta.
- `npm run validate`: ESLint e TypeScript aprovados.
- `npm run build`: aprovado, incluindo a nova rota de histórico. Typecheck foi executado separadamente pelo validate.

Comando Node reproduzível:

```bash
node --test tests/m2m-*.test.js tests/pricing-audit*.test.js tests/persist-single-anuncio.test.js tests/ml-identity-block-lifecycle.test.js tests/ml-critical-attributes.test.js tests/bentevi-product-detail.test.js tests/bentevi-supplier-offer-detail.test.js tests/bentevi-products.test.js
```

## Fontes consultadas

- [PostgreSQL 17 — Triggers](https://www.postgresql.org/docs/17/trigger-definition.html): execução transacional e distinção INSERT/UPDATE em conflito.
- [PostgreSQL 17 — INSERT](https://www.postgresql.org/docs/17/sql-insert.html): atomicidade de `ON CONFLICT`.
- [Supabase — Database functions](https://supabase.com/docs/guides/database/functions): `security definer`, `search_path` e execução restrita.
- [ML — API de preços](https://developers.mercadolivre.com.br/devcenter/api-de-precos): confirmação HTTP não substitui leitura de preço efetivo. Conteúdo indexado consultado; abertura direta falhou.
- [ML — Catalog listing](https://developers.mercadolivre.com.br/en_us/catalog-listing): sincronismo de catálogo; conteúdo indexado consultado, sem chamada autenticada.
- Guia instalado de Route Handlers em `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, Next.js 16.3.3.

## Pendências, limites e rollback

1. Homologação web/ML externa após o push/deploy conjunto ainda não foi executada. Validar a captura em jobs/webhooks reais e leitura do histórico; não apresentar os testes sintéticos como read-back real.
2. Origem histórica continua desconhecida. Não há backfill que atribua autoria. Observação externa identifica a fonte ML, não a pessoa ou sistema que mudou o preço no marketplace.
3. Preparação não é aprovação comercial: override, liquidação, confirmação humana, validade econômica, executor e gate de autonomia pertencem às próximas ações. Nenhum contrato interno pode ser exposto como executor sem esses gates.
4. Grupos/variações sem associação unívoca ficam sem atribuição de grupo no evento observado; a preparação exige comprovação. Não agregar resultados somando espelhos.
5. Fonte remota fornece a versão temporal quando disponível; sem ela, usa-se instante de coleta. Leitura sem versão remota não prova ordenação dos eventos internos do ML.
6. Frete vivo ME2 permanece para a conexão autorizada da conta real, bloqueando gates comerciais, não o planejamento seguinte.
7. Rollback de aplicação: reversão seletiva desta ação com validação. Preservar tabelas, eventos e migrations aplicadas. Runtime anterior continuará com captura passiva `unknown`; qualquer ajuste posterior de schema exige nova migration e preflight `.162`, nunca exclusão de histórico.

As skills locais orientaram o preflight exclusivo `.162`, transações curtas, privilégios restritos e validação de uma ação por vez. A indicação antiga de `.160` em material auxiliar foi desconsiderada conforme AGENTS; produção não foi acessada.
