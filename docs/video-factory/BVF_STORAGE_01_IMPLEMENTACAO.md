# BVF-STORAGE-01 — referências privadas e acesso assinado

Data da ação: 14/09/2026.

Estado deste registro: implementação preparada e validada na branch `dev`.
Migration produtiva, promoção, deploy e read-back não executados por orientação
do usuário.

## A. Auditoria

- O alvo produtivo foi confirmado diretamente em `192.168.1.162`, PostgreSQL
  17.6, com as quatro migrations BVF anteriores registradas.
- O bucket `video-factory` já existia privado, aceitava JPEG, PNG, WebP e MP4 e
  mantinha a policy restritiva contra acesso direto de `anon`/`authenticated`.
- `video_assets` possuía RLS sem policies e zero linhas; o bucket também tinha
  zero objetos. `job_id NOT NULL` impedia referências canônicas sem criar um
  job artificial.
- `service_role` ainda possuía `INSERT/UPDATE` direto em `video_assets`; nenhum
  serviço ou rota BVF de Storage existia.
- `produtos.imagens` é a fonte real de URLs de produto. A aplicação já utiliza
  `authorizeApiRequest`, cliente Supabase server-side e URLs assinadas em
  outros domínios privados.

## B. Divergências e decisões

- Referências de persona e produto não pertencem a um job. `job_id` passou a
  aceitar `NULL`, com constraints diferentes para referências e assets futuros
  de geração.
- Cada versão de persona possui três posições canônicas: `front`, `profile` e
  `full_body`. Nova imagem na mesma posição desativa a anterior e conserva
  linha e objeto.
- Produtos aceitam upload manual ou cópia de uma URL que já conste exatamente
  em `produtos.imagens`. A imagem é copiada para o bucket privado, eliminando a
  dependência operacional da origem.
- MP4 não ganhou rota manual. `jobs/` e `approved/` possuem builders e formato
  de path reservados para Worker/Validation, sem geração ou publicação.
- O navegador não recebe service key nem token de upload. A aplicação recebe o
  arquivo, valida e faz upload server-side; acesso de leitura usa URL assinada
  por dez minutos.

Essa escolha segue o contrato de bucket privado e URL temporária da
[documentação oficial do Supabase](https://supabase.com/docs/guides/storage/buckets/fundamentals).
Arquivos de referência ficam limitados a 6 MiB, faixa recomendada para
[upload padrão](https://supabase.com/docs/guides/storage/uploads/standard-uploads);
vídeos maiores permanecem destinados ao upload resumível do worker.

## C. Implementação

- Migration `20260914210000_bvf_storage_01`: lifecycle, constraints, índices
  parciais, FKs, RPCs atômicas, grants e paths privados.
- Serviço `src/services/video-factory/storage.ts`: inspeção real por Sharp,
  SHA-256, paths únicos, upload sem overwrite, compensação segura, importação
  remota protegida e URL assinada.
- Contratos Zod e cinco APIs em `/api/video-factory/assets` para listar,
  enviar, importar, desativar e obter acesso temporário.
- Tipagem do banco atualizada sem dependência nova e sem alteração mobile.

## D. Banco e segurança

- `video_assets` ganhou `reference_slot`, `active`, autoria e dados auditáveis
  de desativação; `job_id` agora é anulável.
- O índice parcial permite somente uma referência ativa por
  `(persona_id, reference_slot)`. Referências de produto podem ser múltiplas.
- `bvf_register_reference_asset` é idempotente pelo UUID da solicitação,
  substitui posição canônica sob lock curto e valida o RBAC real.
- `bvf_deactivate_reference_asset` registra operador, horário e motivo, usando
  “desativação manual” quando o motivo não é informado.
- `service_role` preserva somente `SELECT` direto em `video_assets`; mutations
  de referência passam pelas RPCs. `anon` e `authenticated` continuam sem
  acesso direto, e não foi criada policy permissiva.
- Os paths persistidos são relativos ao bucket e nunca contêm nome fornecido
  pelo usuário. Não existe `public_url` persistida.

## E. Validação em desenvolvimento

- 41 testes BVF direcionados aprovados, sendo oito cenários novos de Storage.
- Migration e teste SQL executados juntos em transação com `ROLLBACK` antes da
  aplicação; idempotência, substituição, desativação, RBAC, grants e histórico
  foram exercitados sem fixture persistida.
- `npm run validate`, `npm run build`, verificação de secrets e
  `git diff --check` aprovados.
- Um PNG sintético de 95 bytes foi enviado ao bucket produtivo sob path UUID,
  baixado por URL assinada e removido exatamente; o read-back final confirmou
  zero objetos e zero assets, pois nenhuma imagem canônica real foi fornecida.
- O preflight produtivo foi somente leitura. A migration foi ensaiada junto do
  teste SQL no `.162` dentro de transação com `ROLLBACK`; schema e dados
  permaneceram inalterados.
- As contagens do preflight foram `24.903 produtos`, `1.544 pedidos`, `1.441
  compras`, `13 fornecedores` e `7.038 anúncios ML`. Não houve aplicação de
  schema nem escrita persistente nesses domínios.
- A migration não foi registrada, as rotas não foram publicadas e nenhum smoke
  de aplicação foi executado, conforme a instrução de não realizar deploy.

## F. Pendências deliberadas

- Nenhuma imagem foi inventada ou associada à RAFA. As três referências reais
  serão enviadas quando os arquivos canônicos estiverem disponíveis.
- A UI para operar upload, revisão factual e autorização pertence a
  `BVF-UI-01`.
- Upload de MP4, provider, worker, validação, thumbnails, aprovação final,
  custo e associação ML continuam nas ações próprias do checklist.
- Não foi criada rotina periódica para órfãos. Falha ambígua é reportada para
  reconciliação específica, sem apagar objetos de terceiros.

## G. Próximo passo recomendado

Quando houver autorização específica para publicação, concluir somente o
release de `BVF-STORAGE-01`: promover o SHA validado, aplicar a migration no
`.162`, publicar e executar o read-back. `BVF-UI-01` permanece posterior a esse
gate.

## Recuperação

Em incidente, desabilitar as cinco rotas e manter bucket e tabelas privados. As
referências podem ser desativadas, nunca removidas como operação normal. Depois
de existirem referências reais, não restaurar `job_id NOT NULL` nem apagar o
histórico; corrigir progressivamente. O cleanup automático limita-se ao objeto
da própria tentativa quando a gravação no banco falha de forma comprovada.
