# BNT-PRICING-V2-05 — Override explícito

Data: 07/09/2026. Base: `c70844e`, branch `dev` inicialmente limpa.

**Entrega:** proteção explícita por grupo, persistência/auditoria, propagação e controle no detalhe do produto. Validação local e SQL DEV; sem push, deploy, chamadas autenticadas ML ou acesso à produção. A homologação visual no domínio fica para o deploy conjunto, conforme instrução do usuário.

## AS_IS → TO_BE e decisões

| Área | Antes | Agora |
| --- | --- | --- |
| Proteção | Nenhum lifecycle próprio; `custom_price` não comprova override | Registro tipado por grupo, ativo/revogado, até revogação humana |
| Gestão | Sem permissão específica | `pricing.override.manage`: admin e gerente; demais perfis somente consulta |
| Composição | Grupos observados não transportavam proteção | Reconciliação transacional propaga a proteção conforme decisão expressa do usuário |
| Operações | Auditoria V2-04 sem proteção explícita | Checagem na preparação e antes de registrar `requested`; manual autorizado não cria/remove override |
| Interface | Custo/publicação sem gestão de proteção | Bloco compacto com membros, motivo, autor, data, ação contextual e histórico |

O usuário escolheu expressamente **admin e gerente** e **proteger automaticamente os grupos resultantes**. O cânon recebeu o complemento; não há expiração automática ou backfill por `custom_price`. Uma alteração manual continua distinta de override. Nenhuma fórmula econômica foi alterada.

## Contratos e integração

- `manual_pricing_overrides`: grupo/versão de referência, origem manual/propagada, estado, data, autor e motivo; revogação com responsável/data/motivo. Não contém preço duplicado. Índice único garante uma proteção ativa por grupo.
- `pricing_events`: acrescenta `override_id`, `command_id` e eventos `override_activated`, `override_revoked`, `override_propagated`. O comando sanitizado suporta idempotência; a propagação registra IDs de origem sem fingir autoria humana.
- RPC `manage_manual_pricing_override`: valida perfil admin/gerente no banco, produto/grupo, versão esperada e estado. Repetição do mesmo comando retorna a mesma referência; conteúdo divergente com mesmo ID falha. Mudança de proteção e evento são atômicos.
- `reconcile_ml_pricing_groups`: captura a composição protegida imediatamente anterior, incluindo anúncio e variação. União/ampliação protege todo o grupo resultante; separação protege os sucessores que contenham membros protegidos. SKU ou histórico arbitrário não geram propagação. Refresh sem mudança de membros e leitura incompleta não inventam proteções/eventos.
- Proteção de grupo arquivado permanece histórica e disponível para revogação; não afeta grupos independentes. Se o mesmo ID de grupo voltar, sua proteção não revogada continua válida. Revogar um grupo não revoga seus irmãos nem registros de outros grupos arquivados. Refresh idêntico não reativa registro revogado; nova mudança de composição com outra origem ainda protegida pode propagar proteção novamente, conforme a política aprovada.
- Preparação, transições e gerenciamento compartilham o lock por vendedor da reconciliação. Checagem de override não é separada da transação que registra intenção. Não há HTTP dentro do lock.
- `prepare_pricing_operation` e transição para `requested` recusam fonte não manual sob proteção. Fonte manual exige autor com cargo de gestão. Operação já solicitada/inconclusiva não é cancelada, reenviada ou classificada como falha pela proteção; o resultado continua exigindo reconciliação V2-04.
- `GET /api/produtos/[id]/pricing-overrides`: grupos, membros, proteção, operação em andamento e capacidade de gerenciamento. Leitura autenticada sem cache.
- `POST` na mesma rota: comando estrito com identificador, ação, grupo/versão, motivo e referência da proteção ao revogar. Autor vem da autenticação cookie/Bearer pelo mecanismo existente. Amostras protegidas são recusadas. Retry de grupo arquivado ainda chega à RPC idempotente após a revogação.
- Preço detalhado recebe `protection` separado da memória econômica; falha de leitura produz `status=unavailable`, não falso “sem proteção”. O histórico existente inclui referência de override e somente os IDs de origem da propagação, sem expor o comando/JSON bruto.

## Interface e comportamento preservado

Bloco **Proteção de preço** na seção **Custo e publicação** do detalhe do produto. Cada grupo aparece com seus membros, proteção e ações permitidas. Modal exige motivo e mostra o alcance. Após resultado desconhecido, eventual reenvio conserva o identificador; não há retry automático. Histórico paginado é consultado no endpoint existente.

Grupos não comprovados não podem receber ativação; proteção já existente é preservada e pode ser revogada por gestão. Amostras de homologação e edição de cadastro em andamento desabilitam os controles. Erro de leitura não mostra o produto como desprotegido.

Ativar/revogar não altera preço, estoque, atividade manual ou status; não dispara cálculo em massa, job ou outbox. Observações e diagnósticos econômicos continuam funcionando. **`pricing_execution_not_ready` permanece incondicional**; esta entrega não habilita o executor comercial, não implementa liquidação nem antecipa aprovação/autonomia.

## Banco e evidências executadas

Destino confirmado por rede/hostname: **192.168.1.162 / supabase-dev**. Histórico e schema conferidos nesse destino. Migration nova `20260907193000_bnt_pricing_v2_05_overrides.sql` ensaiada com rollback, aplicada e registrada; migrations anteriores intactas. Tipos das estruturas/RPCs afetadas gerados pelo metadata do mesmo DEV.

- `tests/pricing-audit.sql` e `tests/pricing-overrides.sql`: aprovados no ensaio e novamente no schema aplicado, sob rollback. Cobrem idempotência, conflitos, permissão, versão, preparação automática, edição manual, operação em andamento, observação, união/separação, propagação, revogação independente, refresh, leitura incompleta, auditoria atômica e grants.
- Duas conexões reais: reconciliação concorrente aguardou o advisory lock mantido pela transação que ativou override; espera confirmada em `pg_locks`. Ambas revertidas. Zero grupos de teste ou overrides persistidos.
- Testes Node: **347 testes, 347 aprovados**; contratos, reader com falhas por fonte, autenticação/autorização, fixture, API, idempotência, estado indeterminado e regressões M2M/V2-04. Componentes renderizados em SSR com Ant Design real e estado injetado para perfis de gestão/consulta e proteção propagada; não equivale a teste visual no navegador.
- `npm run validate` e `npm run build`: aprovados na rodada final, sem warnings de lint. `git diff --check` aprovado.
- Registro da migration reconferido contra o arquivo aplicado: conteúdo idêntico. SELECT REST do histórico com extração sanitizada dos IDs de origem retornou HTTP 200 no `.162`, sem imprimir registros ou credenciais.

Comando direcionado:

```bash
node --test tests/m2m-*.test.js tests/pricing-audit*.test.js tests/pricing-overrides.test.js tests/permissions.test.js tests/persist-single-anuncio.test.js tests/ml-identity-block-lifecycle.test.js tests/ml-critical-attributes.test.js tests/bentevi-product-detail.test.js tests/bentevi-supplier-offer-detail.test.js tests/bentevi-products.test.js
```

## Limites, rollout e rollback

1. Sem deploy, a nova interface ainda não está no domínio. Registrar aceite visual e integração web no deploy conjunto; nenhuma conta real foi conectada.
2. Não existem grupos `verified` reais no DEV na inspeção final desta tarefa. Não fabricar grupos para contornar a comprovação; os testes usaram fixtures transacionais revertidas.
3. Override protege automação do ERP, não impede que o usuário/ML altere preço fora dele. Observação continua registrando o valor real; não restaura preço automaticamente.
4. Operações remotas já iniciadas permanecem pendentes de reconciliação quando aplicável. As garantias desta etapa não substituem os gates futuros do executor.
5. Rollback de aplicação seletivo, preservando tabela, eventos e migration aplicada. As funções do banco mantêm proteção mesmo com runtime anterior. Remover controles de tela não revoga proteções; não apagar histórico. Ajustes de schema exigem nova migration e preflight `.162`.
6. Frete ME2 e homologação comercial seguem nos gates já registrados. Próxima ação: **BNT-PRICING-V2-06 — Liquidação interna**.

## Referências e skills

- [PostgreSQL 17 — locks](https://www.postgresql.org/docs/17/explicit-locking.html), [índices parciais](https://www.postgresql.org/docs/17/indexes-partial.html).
- [Supabase — funções e privilégios](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Ant Design 5 — Modal](https://5x.ant.design/components/modal/), [Form](https://5x.ant.design/components/form/); instalado 5.29.3. Next.js: guia instalado de Route Handlers lido, sem nova arquitetura.
- [ML — publicação no catálogo](https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo): documentação consultada no planejamento sobre pares/sincronização; nenhuma alteração do contrato externo nesta entrega.

Skills Vortek e Supabase orientaram uma ação por vez, preflight exclusivo `.162`, transações curtas, grants restritos e validação antes do avanço. A referência antiga a `.160` em material auxiliar foi desconsiderada segundo AGENTS; produção não foi acessada.
