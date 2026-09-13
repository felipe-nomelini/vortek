# BVF-BRIEF-01 — Briefing/Factual Engine

Data da ação: 13/09/2026.

Estado deste registro: implementação e gates locais concluídos; aplicação e
read-back produtivos serão registrados somente depois de executados.

## A. Auditoria

- A fundação BVF V1 já existe no Supabase Bentevi e mantém oito tabelas
  `video_*`, RLS sem policies abertas e acesso operacional pelo backend com
  `service_role`.
- O RBAC vigente possui `video_factory.read` e `video_factory.manage`; o segundo
  está atribuído somente a `admin` e `gerente`.
- A PK de `produtos` e as identidades de `profiles`, `video_jobs` e
  `video_personas` são UUID. A identidade operacional do produto é o SKU.
- As fontes locais disponíveis para o briefing são `produtos`, a oferta DSLite
  preferencial (ou a ativa mais recente) e o anúncio ML vinculado. Elas são
  consultadas somente para leitura.
- `produtos.altura`, `largura`, `profundidade` e `peso_bruto` representam dados
  logísticos. Não são evidência de dimensão física do produto. Somente
  `peso_liq` positivo pode alimentar o peso físico automaticamente.
- O projeto já utiliza Firecrawl server-side. Não há OpenRouter configurado nem
  necessidade de introduzi-lo neste recorte.
- O Supabase DEV local não pôde ser usado porque o runtime Docker está
  indisponível ao usuário atual. Isso não substitui nem antecipa o teste
  transacional previsto no Supabase produtivo autorizado.

## B. Divergências e decisões

- O histórico não permanece apenas na projeção mutável de `video_jobs`: cada
  briefing é persistido como versão imutável em `video_brief_versions`.
- O fingerprint SHA-256 elimina duplicação material. Horários de coleta não
  criam nova versão; alteração de fatos, fontes ou direção cria.
- Claims locais são preservados literalmente após somente remoção de markup e
  normalização de espaços. A pesquisa web só preenche campos ausentes e uma
  evidência só é aceita quando a citação aparece no conteúdo coletado.
- A âncora de escala é automática e determinística quando largura, altura e
  profundidade físicas estão verificadas. Ela integra a aprovação humana do
  briefing completo; não existe aprovação isolada da âncora.
- Ausência de medida não é preenchida por inferência: permanece `null` e aparece
  em `missingFacts`.
- `FAMILY_VIDEO`, detecção de variações, APIs/UI de aprovação, geração paga,
  provider concreto, worker, Storage e publicação ML não pertencem a esta ação.

## C. Implementação

- `supabase/migrations/20260913160000_bvf_brief_01.sql`: tabela append-only,
  ponteiro da versão corrente e RPC transacional.
- `src/lib/video-factory/contracts.ts`: schemas Zod do input, fatos, claims,
  medidas, fontes, pesquisa e briefing.
- `src/lib/video-factory/factual-engine.ts`: engine pura, determinística e sem
  dependência de provider de vídeo.
- `src/services/video-factory/factual-research.ts`: adapter Firecrawl com busca
  somente para lacunas, exclusão de marketplaces, limite de fontes, timeout e
  validação de citação.
- `src/services/video-factory/briefing.ts`: orquestração server-side; consulta
  fontes locais, aplica o RBAC real e persiste exclusivamente pela RPC BVF.
- `src/types/database.ts`: contrato tipado do novo schema e da RPC.
- `tests/bvf-brief-01.test.js` e `tests/bvf-brief-01.sql`: regressão unitária,
  estrutural e transacional.

## D. Banco

- `video_brief_versions` possui chave UUID, versão positiva única por job,
  fingerprint, snapshots JSON validados como objetos, autor e timestamp.
- A tabela bloqueia `UPDATE` e `DELETE` por trigger e referencia `video_jobs` e
  `profiles` com `ON DELETE RESTRICT`.
- `video_jobs.current_brief_version_id` usa FK composta para impedir que um job
  aponte para versão pertencente a outro job.
- `bvf_persist_brief_version` serializa o job com `FOR UPDATE`, verifica
  `admin`/`gerente`, aceita apenas escopo SKU e tipos `HUMAN_DEMO` ou
  `CINEMATIC_PRODUCT`, preserva idempotência e move o job para
  `waiting_brief_approval`.
- RLS permanece habilitada. `anon` e `authenticated` não recebem acesso direto;
  `service_role` tem somente `SELECT` na tabela e `EXECUTE` na RPC.

## E. Testes locais

- 16 testes BVF direcionados aprovados, cobrindo a fundação e o BRIEF-01.
- `npm run validate` aprovado (`eslint` e `tsc --noEmit`).
- `npm run build` aprovado com Next.js 16.3.3.
- `npm run check:build-secrets` aprovado.
- `git diff --check` aprovado.

## F. Pendências deliberadas

- Aplicar a migration e executar `tests/bvf-brief-01.sql` em transação com
  rollback no Supabase Bentevi `.162`.
- Fazer read-back de tabela, colunas, FKs, índices, trigger, RLS, grants, função
  e ausência de registros de teste.
- Consumir `prepareBvfBrief` por APIs/state machine somente em
  `BVF-WORKFLOW-01`.
- Tratar famílias e `variation_safe`/`variation_unsafe` em `BVF-FAMILY-01`.

## G. Próximo passo recomendado

Depois da publicação e do read-back desta ação, executar somente
`BVF-FAMILY-01`, reutilizando os contratos de proveniência e versionamento sem
ampliar o BRIEF-01 para geração ou publicação de vídeo.
