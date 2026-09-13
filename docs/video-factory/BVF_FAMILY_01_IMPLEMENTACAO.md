# BVF-FAMILY-01 — Famílias e segurança de variações

Data da ação: 13/09/2026.

Estado deste registro: engine, migration e validação produtiva concluídas. A
capacidade permanece interna ao backend, sem API, tela, geração paga ou escrita
no Mercado Livre.

## A. Auditoria

- A fundação BVF V1 e o `BVF-BRIEF-01` estavam registrados no Supabase Bentevi
  `.162`; `video_families`, `video_family_products`, `video_jobs` e
  `video_brief_versions` estavam vazias antes desta ação.
- `produtos.id`, `profiles.id` e as FKs BVF usam UUID. O vínculo familiar
  existente já era temporal por `created_at`/`removed_at` e não admitia
  `DELETE` operacional.
- `video_families` e `video_family_products` estavam com RLS ativa, sem policy
  aberta. O `service_role` possuía `SELECT`, `INSERT` e `UPDATE`; a FAMILY-01
  removeu a escrita direta necessária ao fluxo familiar e a concentrou em RPCs
  com RBAC.
- O RBAC real autoriza gestão de vídeo somente a `admin` e `gerente`. Dois
  perfis com esses cargos existiam no preflight.
- As fontes locais reutilizáveis são `produtos`, oferta DSLite ativa/preferida,
  anúncio ML persistido e estrutura de kits. Todas são somente leitura para a
  engine.
- A infraestrutura Firecrawl server-side já existia. Foram reutilizados os
  endpoints V2 de [busca](https://docs.firecrawl.dev/api-reference/endpoint/search)
  e [extração](https://docs.firecrawl.dev/api-reference/endpoint/scrape), sem
  OpenRouter, provider de vídeo ou credencial no cliente.
- O DEV local não pôde executar PostgreSQL porque Docker/CLI não estavam
  disponíveis nesta sessão. A própria migration foi então ensaiada no destino
  autorizado dentro de transação com `ROLLBACK`, antes da aplicação definitiva.

## B. Divergências e decisões

- Família não nasce automaticamente: a engine parte de um SKU, sugere somente
  produtos ativos da mesma marca e categoria folha e exige confirmação humana.
- Uma sugestão aceita/rejeitada permanece auditável. Aceitar cria uma família;
  rejeitar não cria nem altera família.
- A composição admite de 2 a 20 SKUs. Inclusão e encerramento de vínculo
  registram o operador; remoção usa `removed_at`/`removed_by`, nunca `DELETE`.
- Análises familiares são versões append-only. Alterar membros invalida a
  projeção corrente e obriga nova análise antes de outro briefing familiar.
- Um atributo só entra em `variation_safe` quando há um único valor explícito e
  igual para todos os SKUs. Valor ausente, ambíguo, diferente ou identificador
  específico entra em `variation_unsafe`.
- SKU, GTIN e ID ML são sempre específicos da variação. Conteúdo inseguro fica
  bloqueado em fala, texto na tela, fechamento e claims.
- Claim familiar só é verificado quando o mesmo texto literal tem fonte em
  todos os membros. A engine não cria claim por inferência.
- Pesquisa web preenche apenas lacunas, exclui marketplaces, exige citação
  literal no conteúdo coletado e confirma a identidade exata do produto por
  GTIN/SKU de fornecedor ou, quando eles não existem, por marca e termos do
  nome. Falha ou dúvida preserva o campo como inseguro.
- Não foi criada família real nem seed operacional. Isso evita classificar
  produtos automaticamente durante o rollout técnico.

## C. Implementação

- `supabase/migrations/20260913200000_bvf_family_01.sql`: sugestões auditáveis,
  versões imutáveis de análise, autoria de vínculos, FKs, índices, RLS, ACLs e
  cinco RPCs transacionais.
- `src/lib/video-factory/contracts.ts`: schemas Zod de fatos familiares,
  variações, pesquisa, análise, guard de conteúdo e briefing.
- `src/lib/video-factory/family-engine.ts`: sugestão determinística, extração e
  comparação por SKU, claims comuns, escala e bloqueio narrativo.
- `src/services/video-factory/family-research.ts`: pesquisa Firecrawl limitada,
  com exclusão de marketplace, confirmação de identidade, citação e cache curto.
- `src/services/video-factory/families.ts`: orquestração server-side para
  sugerir, revisar, compor, analisar e preparar briefing familiar.
- `src/types/database.ts`: contrato tipado do schema e das RPCs.
- `tests/bvf-family-01.test.js` e `tests/bvf-family-01.sql`: regressão unitária,
  estrutural e transacional.

## D. Banco

- `video_family_suggestions` guarda seed, algoritmo, fingerprint, candidatos,
  decisão, nota, revisor, snapshot da revisão e família confirmada.
- `video_family_analysis_versions` guarda composição e análise imutáveis, com
  versão e fingerprint únicos por família.
- `video_families.current_analysis_version_id` usa FK composta para impedir que
  uma família aponte para análise de outra.
- `video_brief_versions.family_analysis_version_id` preserva qual análise
  familiar originou cada briefing histórico.
- `video_family_products.created_by` e `removed_by` identificam os operadores
  das transições temporais.
- As cinco RPCs serializam as entidades mutáveis com `FOR UPDATE`, validam
  `admin`/`gerente`, composição, alvo, estado e idempotência e escrevem apenas
  em tabelas `video_*`.
- RLS permanece habilitada sem policies abertas. `anon` e `authenticated` não
  têm acesso; `service_role` lê as tabelas históricas e executa as RPCs, mas não
  grava diretamente sugestões, análises, famílias ou membros.

## E. Testes e evidências

- 28 testes BVF direcionados aprovados após o fechamento, sendo 12 da
  FAMILY-01 e 16 regressões da fundação/BRIEF-01.
- `npm run validate` aprovado (`eslint` e `tsc --noEmit`).
- `npm run build` aprovado com Next.js 16.3.3.
- `npm run check:build-secrets` e `git diff --check` aprovados.
- A migration foi primeiro executada com `ROLLBACK`; o read-back confirmou que
  nenhuma tabela, coluna ou versão residual permaneceu.
- `tests/bvf-family-01.sql` passou em transação com rollback, cobrindo sugestão,
  aceitação, rejeição, idempotência, imutabilidade, autoria, mudança de membros,
  análise obsoleta e briefing familiar.
- A migration `20260913200000_bvf_family_01` foi aplicada e registrada no
  `.162`, com SHA-256
  `ac877099532889ee5d34c78ece74228a5f858d0df9b968163561a43cd840ea69`
  idêntico ao arquivo versionado.
- O read-back confirmou 14 colunas em `video_family_suggestions`, nove em
  `video_family_analysis_versions`, 10 FKs, 11 índices válidos, cinco RPCs
  protegidas, trigger de imutabilidade, RLS ativa e zero policy aberta.
- Nenhuma família, sugestão, análise, job ou briefing foi deixado como fixture.
  As contagens do preflight e do read-back permaneceram em `24.888 produtos`,
  `1.530 pedidos`, `1.425 compras`, `13 fornecedores` e `7.051 anúncios ML`.
- Código funcional: `a5ee05d3bdaef53d1fb8950e931c51b24d962156`, enviado a
  `dev` e promovido por fast-forward para `bentevi-prod`.

## F. Pendências deliberadas

- Expor as operações por APIs autenticadas e state machine em
  `BVF-WORKFLOW-01`.
- Construir UI de sugestão, confirmação e revisão em `BVF-UI-01`.
- Manter geração paga, provider, worker, validação de MP4, relatório de custos,
  Storage e associação ML nas ações próprias do checklist.
- A confirmação humana futura ainda deverá escolher nome, chave e membros; a
  engine não deve aceitar sugestões automaticamente.

## G. Próximo passo recomendado

Executar somente `BVF-WORKFLOW-01`: criar as APIs backend e a state machine que
consomem BRIEF-01/FAMILY-01, aplicam o RBAC existente e separam aprovação de
briefing, autorização da geração paga e aprovação do master final. Geração e
publicação continuam desabilitadas.

## Recuperação

Em incidente, interromper os novos writes BVF e reverter o consumidor de código.
A migration é aditiva e pode permanecer inerte, preservando o histórico. Não
apagar sugestões, vínculos, análises ou briefings; qualquer correção deve ser
progressiva e versionada.
