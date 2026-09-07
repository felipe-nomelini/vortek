# M2M-CFL-03 / BNT-PRICING-V2-07 — Vínculos e grupos de anúncios

Data: 07/09/2026. Base: `972cd0b`, branch `dev` inicialmente limpa.

**Resultado:** implementação e validação local/SQL DEV concluídas. Sem push, deploy, consulta autenticada ML ou homologação externa nesta tarefa. Produção não acessada. Próxima ação: **BNT-PRICING-V2-04 — Origem e audit trail**.

## AS_IS → TO_BE

| Área | Estado anterior | Entrega |
| --- | --- | --- |
| Busca por SKU | Helper retornava primeiro resultado | Busca paginada pelos campos `sku` e `seller_sku`, incluindo SKUs mestre/ofertas, IDs locais e fechamento das relações |
| Vínculo | SKU podia vincular produto sem avaliação canônica | Vendedor, ownership nas fontes locais e identidade/apresentação CFL-02 obrigatórios; ambiguidade é inconclusiva |
| Relação padrão/catálogo | Relação/ponteiros sem identidade econômica persistida | Par exige prova bilateral SYNC e relações/variações coerentes; independentes permanecem separados |
| Persistência | Sem grupos/revisões/membros canônicos | Três estruturas tipadas e uma RPC transacional observacional |
| Consumidores | Criação e teste fiscal escolhiam por ponteiro/primeiro SKU | Resolvedor único; múltiplos candidatos exigem seleção, sem escolha arbitrária |
| Vinculação auxiliar | Writer próprio por SKU | Reexporta o job autenticado de sync já existente |
| DTO produto/oferta | Dados por anúncio, sem grupo | Campo aditivo `pricingGroup`, nullable, com versão, estado, data, sincronismo comprovado e membros |

## Contratos entregues

- Classificações: `JA_ANUNCIADO_ATIVO`, `REATIVACAO_CANDIDATA`, `NOVO_ANUNCIO_CANDIDATO`, `VINCULO_INCONCLUSIVO`.
- Estar anunciado não é conflito para manutenção. Consumidor de nova publicação deve considerar a classificação, não apenas `listing_link=SEM_CONFLITO`.
- Busca falha, truncada, sem total, identidade insuficiente, outro vendedor/produto, variação ambígua e histórico encerrado/desconhecido não autorizam recriação.
- ID do grupo é UUID persistido ancorado no anúncio padrão e sua variação, dentro do vendedor. `produtos.ml_item_id` não vira identidade do grupo.
- Relação, SKU, UPID ou catálogo isolados não comprovam sincronismo. `GET /public/buybox/sync/{id}` precisa retornar prova consistente nos dois lados. Não foi criado POST de reparo/sincronização.
- União mantém o ID da âncora e registra predecessores; separação preserva os IDs existentes por âncora. Revisão terminal `retired` registra sucessores em `predecessor_ids`, como referência histórica de transição.
- Repetição sem mudança de composição/estado não cria revisão. Observação estritamente anterior é rejeitada. Lock transacional por vendedor serializa a reconciliação e protege composição entre produtos.
- Falha de revalidação conserva membros anteriores e marca `unverified`, sem dissolver o par por ausência de prova. Falha na própria persistência é reportada e não autoriza ações derivadas.
- Membro `(seller_id, ml_item_id, variation_id)` é exclusivo na composição vigente. Histórico permanece imutável pelo acesso operacional concedido.
- O DTO consulta apenas revisões vigentes. Item que corresponder a múltiplos grupos/variações não é reduzido a um grupo arbitrário: `pricingGroup=null`.
- Agregação futura: não somar estoque dos espelhos; deduplicar vendas/resultados pelo evento econômico; visitas por anúncio não são visitantes únicos do grupo. Nenhuma nova métrica ou fórmula foi implementada aqui.

## Consumidores e limites da alteração

`src/services/ml-listing-links.ts` resolve candidatos; `src/lib/ml/listing-link.ts` classifica sem I/O. O sync de anúncios persiste uma resolução por produto/lote, reutilizando o fluxo observado. Itens indisponíveis invalidam a prova vigente quando identificáveis nos membros locais.

`POST /api/sync/vincular-produtos` passa a devolver o contrato de criação/reuso do job de `/api/sync/anuncios/job`, não o antigo contador síncrono. Não foi encontrado consumidor de interface dependente do contador antigo. Não foi criado novo scheduler.

Criação devolve 409 para vínculo inconclusivo ou múltiplos candidatos; o guard `pricing_execution_not_ready` continua intacto. Teste fiscal aceita `mlItemId` explícito apenas entre os candidatos validados. Essa ação fiscal existente não foi executada nesta tarefa.

Não foi alterado layout, preço, oferta preferencial, atividade manual do produto, tributo ou regra de autonomia. A entrega não executa publicação, reativação, pausa, reprecificação ou reparo de sincronismo ML.

## Banco e validação executada

- Destino conferido: `192.168.1.162`, hostname `supabase-dev`; PostgreSQL 17.6. Credenciais lidas somente em memória, sem reprodução.
- Migration nova `20260907150000_m2m_cfl_03_listing_groups.sql`: ensaiada em transação com rollback e aplicada/registrada somente nesse destino. Nenhuma migration histórica reescrita.
- Tabelas `ml_pricing_groups`, `ml_pricing_group_revisions`, `ml_pricing_group_members`; RPC `reconcile_ml_pricing_groups`.
- RLS habilitada; sem acesso anon/authenticated; service_role tem leitura das tabelas e execução da RPC, não DML direto. SECURITY DEFINER usa search_path vazio e nomes qualificados.
- Tipos dessas três tabelas e da RPC extraídos do metadata generator do mesmo Supabase DEV e incorporados a `src/types/database.ts`, sem substituir tipos não relacionados.
- `tests/m2m-cfl-03-groups.sql`: idempotência, união, separação, predecessor, falha preservando membros, observação antiga, erro atômico, grants e RLS aprovados em transação revertida.
- Concorrência real: duas conexões chamando a mesma reconciliação; a segunda comprovadamente aguardou advisory lock em `pg_locks`. Após rollback da primeira, a segunda concluiu com um grupo; rollback da segunda. Zero fixtures persistidas.
- `node --test tests/m2m-*.test.js tests/ml-identity-block-lifecycle.test.js tests/ml-critical-attributes.test.js`: **285 testes, 285 aprovados**. Inclui regressões de pricing/CFL anteriores, resolução com I/O simulado, estados HTTP inválidos, variações, pares, consumidores e DTO.
- Regressões de `bentevi-product-detail`, `bentevi-supplier-offer-detail` e `bentevi-products`: **25 testes adicionais aprovados**; total direcionado desta validação: **310 testes**.
- `npm run validate`: ESLint e TypeScript aprovados.
- `npm run build`: aprovado; 120 páginas geradas. O build do projeto pula typecheck, por isso `validate` foi executado separadamente.
- `git diff --check`: aprovado.

## Referências oficiais consultadas

- [ML — Catalog listing](https://developers.mercadolivre.com.br/en_us/catalog-listing): relações e GET SYNC/UNSYNC. Conteúdo relevante acessado pelo índice de pesquisa; abertura direta retornou 403, sem alegar consulta autenticada do endpoint.
- [ML — Itens e buscas](https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/itens-e-buscas): `sku`, `seller_sku`, paginação e bulk.
- [ML — Variations](https://developers.mercadolivre.com.br/en_us/variations): `include_attributes=all` na consulta individual de item; não presumido no bulk.
- [PostgreSQL 17 — Explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): locks transacionais/advisory.
- [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): exposição e privilégios.
- [Supabase Studio — geração self-hosted](https://github.com/supabase/supabase/blob/master/apps/studio/lib/api/self-hosted/generate-types.ts): metadata generator e `included_schemas`.
- Guia de Route Handlers instalado em `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, Next.js 16.3.3.

## Riscos residuais, pendências e rollback

1. Sem deploy, execução de job real, screenshots ou homologação autenticada de par SYNC/UNSYNC; validar em homologação antes dos gates comerciais. Nenhum grupo real foi fabricado para apresentar prova inexistente.
2. Busca por SKU que alcance limite de 1.000 resultados sem concluir fica inconclusiva, sem fallback de varredura pesada. Variações sem associação única e histórico encerrado exigem revisão. Resultados incompletos não autorizam ações.
3. Estado do DTO é observação datada, não autorização permanente. Escritores futuros devem revalidar fontes e versão; não consumir `verified` antigo como permissão comercial.
4. Igualdade de timestamp não é critério de desempate de conteúdo divergente; produtor observado usa lock existente, resolução por produto/lote e timestamps de início. Não liberar escritores independentes sem definir seu controle de versão.
5. Frete ME2 continua reservado à conexão autorizada da conta real e bloqueia aceite comercial PUB-GATE/M2M-GATE/produção, conforme decisão vigente; não bloqueia o próximo desenvolvimento.
6. Rollback de aplicação: reverter seletivamente o commit desta ação em DEV, com validação. As estruturas aditivas podem permanecer sem uso, preservando histórico. Não apagar tabelas nem remover registro de migration para desfazer código; eventual mudança de schema exige nova migration e preflight `.162`.

As skills locais orientaram uma única ação, validação direcionada, preflight de destino, transações curtas e privilégios restritos. A indicação antiga de `.160` em material de skill foi desconsiderada conforme AGENTS: produção não foi acessada.
