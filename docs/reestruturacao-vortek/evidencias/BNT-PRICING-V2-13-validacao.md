# BNT-PRICING-V2-13 — Alertas e confirmações

Data: 08/09/2026. Implementação e validação local/SQL DEV. **Sem push, deploy, escrita ML ou acesso à produção nesta entrega.**

## AS_IS → TO_BE

| Antes | Entrega |
| --- | --- |
| Avaliações e trilha de pricing sem central de decisão | Drawer compartilhado **Alertas e decisões** em Anúncios e Catálogo |
| Editor com aplicação bloqueada, sem proposta persistida | Reavaliar → registrar proposta com motivo → aprovar, rejeitar ou adiar |
| Problemas sem lifecycle próprio | Alerta por conta, grupo (ou item sem grupo) e regra; atualização, resolução, reabertura e consolidação com histórico |
| Consentimento sem vínculo persistente à operação | Decisão ligada à avaliação econômica, grupo/versão, proteções, autor, validade e assinatura material |

## Contratos e limites

- `pricing-decisions.ts` não contém fórmula econômica: consome memória canônica, grupo, override e cenário explícito de liquidação. A assinatura material ignora relógios de coleta, mas inclui economia, preço anterior/proposto, grupo/membros, proteção e contexto da liquidação. Prazo máximo de 15 minutos, limitado à expiração das fontes.
- `pricing-detail.ts` passa a possuir a consulta já existente de `preco-detalhe`; GET/POST delegam ao mesmo fluxo. Preservados autenticação, fixtures protegidas, leitura ML, recotação e confrontação de mudanças durante a consulta. Aprovar reutiliza esse fluxo, sem uma segunda fórmula ou cotação paralela.
- Produtores desta etapa: vínculo não confirmado, economia inconclusiva, conflito competitivo comprovado, proposta manual e falha/inconclusivo de operação. Buy Box projetada negativa **não** é denominada prejuízo realizado. Fonte competitiva inconclusiva não resolve um conflito anterior por ausência de evidência.
- `pricing_alerts` e `pricing_decisions` têm RLS e nenhuma escrita direta concedida ao browser. Funções mutantes são exclusivas do backend. API exige `pricing.read` para consulta e `pricing.decisions.manage` para comandos; administrador/gerente decidem, operador/visualizador consultam. Autor é obtido da sessão, nunca do corpo enviado.
- `pricing_events` permanece imutável e recebe os vínculos de alerta/decisão. Comandos têm chave idempotente e colisão de conteúdo é recusada. Rejeição não reaparece como nova proposta ao repetir o mesmo cenário; a mudança econômica permite nova proposta. Resolver proposta não resolve problemas econômicos de outra regra.
- Adiar define quando rever, **não renova validade econômica**. Expiração é derivada também na leitura/filtro sem modificar o registro histórico da aprovação; ao decidir/substituir, a transição pertinente fica auditada.
- Aprovação é revalidada no servidor. Mudança material invalida; evidência vencida expira; falha de consulta não executa nem aprova silenciosamente. Mesmo comando repetido retorna seu resultado anterior, sem segunda consulta ou efeito.
- `consumePricingDecision` verifica `pricing_execution_not_ready` antes de consultar ou consumir. Nenhuma rota desta entrega chama consumo. O contrato SQL de consumo liga decisão → `pricing_operations` → `anuncios_ml_outbox` atomicamente, com identificadores únicos e validações existentes de governança. Só foi exercitado dentro de rollback.
- Confirmação de aplicação requer read-back na operação existente; resultado inconclusivo mantém a operação em aberto e gera alerta. Aprovação sozinha não cria outbox, não altera `custom_price` e não marca preço como aplicado. Rejeição ou confirmação da operação da proposta atual encerra seu alerta.
- A listagem usa a **última decisão** do alerta, não qualquer decisão histórica que combine com o filtro. Paginação de 30, prioridade P0/P1/P2/INFO e desempates estáveis. Ordenação de prioridade é gerada a partir da gravidade, sem fonte editável adicional.
- Não foram criados Dashboard, menu novo, scheduler, rotina noturna, experimentos, diagnóstico comercial sem performance ou automação de preço. Esses produtores continuam em suas etapas.

## Banco DEV

Destino reconfirmado antes de cada escrita: **192.168.1.162 / supabase-dev**, PostgreSQL 17.6. Preflight leu schema e histórico nesse destino; as alterações foram ensaiadas com `ROLLBACK`, aplicadas e registradas:

- `20260908110000_bnt_pricing_v2_13_decisions.sql`: contratos, tabelas, RLS, eventos, funções e vínculo com outbox existente;
- `20260908113000_bnt_pricing_v2_13_priority.sql`: prioridade ordenável derivada;
- `20260908120000_bnt_pricing_v2_13_resolution.sql`: encerramento da proposta atual e dedupe antes de reabrir proposta rejeitada.

São migrations novas; nenhuma migration aplicada foi reescrita. Tipos das tabelas/RPCs afetadas foram regenerados usando metadata do mesmo DEV. A CLI não concluiu a geração; usou-se introspecção somente leitura de `information_schema`/`pg_catalog`, preservando os demais tipos. A última migration mantém assinaturas e colunas.

## Validações executadas

- **441 testes passaram; 1 skip**: `m2m-*`, `pricing-*`, `catalog-*`, garantia, Anúncios e Catálogo/PDF. O skip é o teste LIVE opcional de extração de garantia via ChatGPT, não um teste de aprovação de pricing.
- 12 testes específicos em `tests/pricing-decisions.test.js`: contrato, assinatura, TTL, inconclusivo, guard global, permissão, autor, replay, falha ML, sanitização de erros, interface e filtro/expiração.
- `tests/pricing-decisions.sql`, exclusivamente em transação com rollback: dedupe, observação atrasada, resolver/reabrir, consolidação item→grupo preservando história, preparar/repetir, colisão de comando, autorização, adiar, rejeitar, invalidar, expirar, consumir uma vez, outbox única, exclusão de operação concorrente e confirmação por leitura. Não equivale a ensaio de concorrência em múltiplos workers reais.
- Última conferência SQL encontrou **zero alertas sintéticos persistidos** da conta de ensaio. Projeção de preço permaneceu inalterada no teste; nenhum anúncio externo foi escrito.
- Consultas REST reais em `.162`: relação alerta↔última decisão e filtros de pendentes/expirados responderam 200. Não usaram fixtures comerciais externas.
- `tests/pricing-decisions.browser.cjs`: componente real React/Ant Design em Chromium, transporte sintético e rede externa bloqueada. Leitura, detalhe, motivo obrigatório, aprovação com aplicação bloqueada, comando único e perfil somente leitura passaram. Screenshots locais `/tmp/bnt-v2-13-decision.png` e `/tmp/bnt-v2-13-approved.png`; não substituem aceite autenticado em homologação.
- `npm run validate`: lint e typecheck aprovados.
- `npm run build`: aprovado, 121 páginas geradas.
- Smoke do bundle local: GET e POST em `/api/pricing/decisions` sem sessão responderam 401; servidor temporário encerrado após a conferência.

## Pendências e rollback

1. Publicar em DEV quando solicitado e conferir Anúncios/Catálogo autenticados. Aceite visual do usuário ainda não registrado, inclusive a pendência anterior de V2-08.
2. PUB-GATE permanece etapa separada. Frete ME2, conta autorizada, prova externa com read-back e gate comercial continuam necessários. Nenhuma autorização anterior é reaproveitada automaticamente quando o gate for liberado.
3. Transporte real, crash após efeito remoto e recuperação em workers reais serão provados no PUB-GATE; aqui foram validados os contratos SQL, revalidação e bloqueio do consumo em runtime. Não declarar execução ML homologada.

Rollback operacional: reverter somente o código desta entrega, mantendo as estruturas aditivas e a trilha histórica; versão anterior continua utilizável. Não apagar decisões/eventos, não reescrever histórico de migrations e não reenfileirar propostas. Eventual remoção de schema exige tarefa própria após verificar referências e preservar auditoria. Não há preço remoto a desfazer nesta entrega.

## Referências oficiais

- [PostgreSQL — locks transacionais](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS), [constraints](https://www.postgresql.org/docs/17/ddl-constraints.html) e [colunas geradas](https://www.postgresql.org/docs/17/ddl-generated-columns.html).
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [PostgREST — relacionamentos e filtros associados](https://docs.postgrest.org/en/v14/references/api/resource_embedding.html#embedded-filters).
- [Ant Design 5 — Drawer](https://5x.ant.design/components/drawer/) e [Modal](https://5x.ant.design/components/modal/).
- Guia de Route Handlers do Next instalado; procedimento ML, cânon comercial e dossiê de pricing do repositório.
