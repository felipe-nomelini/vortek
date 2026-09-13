# BVF V1 — auditoria e implementação da base técnica

Data: 2026-09-13

Migration: `20260913120000_bvf_v1_initial.sql`

Escopo: banco, Storage, contratos modulares, RBAC e abstração de provider. Sem geração por API, worker, UI ou publicação no Mercado Livre.

## A. Auditoria do sistema real

O preflight foi executado na branch `dev`, inicialmente limpa, confrontando repositório e Supabase Bentevi produtivo antes de qualquer escrita.

- O runtime web é Next.js App Router, React, TypeScript, Ant Design, Supabase e Zod; o Node exigido na raiz é `>=22 <23`.
- O Supabase é self-hosted. O destino produtivo confirmado é `supabase.bentevi.shop`/`192.168.1.162`; o `.160` continua legado e somente leitura.
- `produtos.id` e `profiles.id` são `uuid`, compatíveis com as referências inicialmente propostas.
- Os cargos reais são `admin`, `gerente`, `operador` e `visualizador`. A autorização de negócio ocorre no backend por `src/lib/permissions.ts`; o cliente não recebe acesso direto às tabelas operacionais.
- O hardening vigente habilita RLS, revoga `anon`/`authenticated` e usa o cliente server-side com `service_role` após autenticação e autorização da API.
- A função canônica para timestamps é `public.set_updated_at()`; uma função BVF duplicada não é necessária.
- As oito relações `video_*` e o bucket `video-factory` não existiam no preflight.
- Os buckets existentes misturam conteúdo privado e público conforme o domínio. Não havia convenção BVF nem justificativa para exposição pública.
- Há infraestrutura genérica de jobs, mas seu contrato e estados pertencem a outros fluxos. Reutilizá-la acoplaria a BVF aos executores atuais.
- As dimensões atualmente disponíveis em `produtos` alimentam logística/pacote do vendedor. Elas não comprovam, por si, dimensões físicas do produto para escala visual.
- Não existe worker BVF nem provider de vídeo implementado. A V1 não cria processo assíncrono ou chamada paga prematuramente.

## B. Divergências corrigidas em relação ao SQL inicial

| Tema | SQL inicial | Decisão implementada |
|---|---|---|
| Extensão e timestamp | Criava `pgcrypto` e `bvf_touch_updated_at()` | Usa `gen_random_uuid()` já disponível e reutiliza `public.set_updated_at()` |
| RLS | `authenticated` podia selecionar/inserir/atualizar tudo | Sem policies nas tabelas BVF; privilégios diretos revogados e somente `service_role` recebe `SELECT/INSERT/UPDATE` |
| RBAC | Não integrava os cargos reais | `video_factory.read` para todos os cargos internos e `video_factory.manage` somente para `admin`/`gerente`; aplicação futura será via APIs backend |
| Histórico | Vários `ON DELETE CASCADE` | Nenhum cascade operacional; vínculos BVF usam `RESTRICT`, vínculos externos usam `SET NULL` quando existe snapshot |
| Personas | `code` globalmente único e mutável por upsert | Identidade versionada por `(code, version)`, uma versão ativa por código e definição publicada imutável |
| Assets da persona | Três colunas fixas e URLs vazias futuras | Referências normalizadas em `video_assets`; nenhum URL ou placeholder inventado |
| Templates | Seeds presos a Gemini/Veo e versão reutilizável | Seeds ativos, provider/model `NULL`, chave `(code, version)` e definição imutável |
| Custos | Valor sem moeda e total real duplicado no job | Valores com moeda ISO 4217; custo real fica no ledger de tentativas, que inclui falhas |
| Aprovações | Somente aprovação/rejeição final | Aprovação humana paga (`generation_approved_*`) separada da aprovação do master final |
| Família | Claims `safe/unsafe` ambíguos | `verified_claims`, `forbidden_claims`, `variation_safe` e `variation_unsafe` explícitos |
| Produto e escala | Sem proteção contra dimensões logísticas | Comentário de contrato proíbe inferência a partir do pacote; `scale_anchor` exige fonte física explícita/revisão |
| Storage | `public_url` persistida | Bucket privado e somente `storage_path`; acesso futuro deve ser assinado no backend |
| Associação ML | Linha sem ciclo de desvínculo/auditor | `linked_by`, `unlinked_at`, `unlinked_by` e motivo; nenhuma chamada de publicação implementada |
| DDL defensivo | `IF NOT EXISTS` poderia esconder drift | Migration determinística e falha se o estado divergir do preflight |

## C. Implementação

- `supabase/migrations/20260913120000_bvf_v1_initial.sql`: schema, constraints, índices, triggers, ACL/RLS, bucket e seeds.
- `src/lib/video-factory/contracts.ts`: tipos de vídeo, escopos, estados, assets, idiomas e dinheiro com moeda.
- `src/services/video-factory/provider.ts`: porta server-side `VideoProvider`, sem SDK ou provider concreto.
- `src/lib/permissions.ts`: permissões internas de leitura e gestão da BVF.
- `src/types/database.ts`: tipagem das oito relações novas.
- `tests/bvf-v1.test.js` e `tests/permissions.test.js`: regressões estruturais, segurança, histórico, seeds, provider e RBAC.

## D. Contrato do banco

As relações são:

1. `video_personas`: identidade canônica e versionada.
2. `video_families`: fatos invariantes e atributos seguros/inseguros da família.
3. `video_family_products`: associação temporal de SKU/produto à família, encerrada por `removed_at`.
4. `video_prompt_templates`: template imutável por código/versão.
5. `video_jobs`: agregado do workflow, snapshots factuais, aprovações e resultado.
6. `video_generation_attempts`: ledger de toda tentativa, payload, erro, duração e custo.
7. `video_assets`: referências, vídeos e derivados técnicos no Storage privado.
8. `video_asset_links`: vínculo auditável de master aprovado ao anúncio, sem publicação automática.

O bucket privado é `video-factory`, com MIME types `image/jpeg`, `image/png`, `image/webp` e `video/mp4`. Os prefixos reservados para consumidores futuros são:

```text
video-factory/
  personas/
  products/
  jobs/
  approved/
```

O caminho persistido em `video_assets.storage_path` é relativo ao bucket. Não há URL pública persistida.

Seeds:

- `RAFA/v1`, ativa, apenas com a identidade e o território editorial fornecidos; listas proibidas vazias e sem referências canônicas falsas.
- `BENTEVI_HUMAN_DEMO/v1`, `BENTEVI_FAMILY_VIDEO/v1` e `BENTEVI_CINEMATIC_PRODUCT/v1`, ativos e independentes de provider/modelo.

## E. Validação

Evidências locais executadas:

- testes direcionados de BVF, permissões, snapshot de schema e contrato do Supabase local;
- `npm run validate` (`eslint` e `tsc --noEmit`);
- `git diff --check`.

O read-back produtivo deve comprovar, depois da aplicação:

- oito tabelas presentes, RLS habilitada e FKs/índices válidos;
- `anon`/`authenticated` sem grants e `service_role` sem `DELETE`;
- RAFA exatamente uma vez e os três templates V1 exatamente uma vez;
- bucket privado e policy restritiva;
- contagens/hash dos domínios críticos inalterados pela migration.

## F. Pendências deliberadas

- APIs e telas de gestão/aprovação.
- State machine/transições autorizadas no serviço da BVF.
- Factual Engine, origem por claim e contrato estruturado das dimensões físicas.
- Detecção de variações entre SKUs e produção do `scale_anchor`.
- Worker assíncrono, concorrência, retry e recuperação.
- Implementações concretas Gemini/Veo e credenciais.
- Upload/download assinado, validação técnica real de MP4 e thumbnails.
- Estimativa/agregação de custo entre moedas; nenhuma soma multimoeda é permitida.
- Associação manual e publicação de vídeo no Mercado Livre.
- Performance/experimentos e análise posterior.

## G. Próximo passo recomendado

Implementar a **BVF Briefing/Factual Engine** como serviço server-side: carregar snapshots somente por leitura, exigir origem para cada fato/claim, separar ausência de dado de dado verificado, calcular segurança de variação por família e produzir um briefing versionado sujeito à aprovação humana. A engine não deve gerar vídeo nem escrever em anúncios.

## Recuperação

A migration é aditiva e não introduz consumidor automático. Em incidente de aplicação, interromper novos writes BVF e corrigir progressivamente; não apagar tentativas, jobs ou assets históricos. Reverter somente o código deixa as tabelas inertes e preserva o histórico. Remoção estrutural exigiria migration própria, backup e decisão explícita.
