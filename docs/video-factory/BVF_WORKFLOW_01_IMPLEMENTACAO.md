# BVF-WORKFLOW-01 — APIs e workflow autorizado

Data da ação: 14/09/2026.

Estado deste registro: implementação, migration, deploy e read-back produtivos
concluídos.

## A. Auditoria

- A fundação BVF, BRIEF-01 e FAMILY-01 já estavam publicadas; jobs, briefings,
  famílias, sugestões e análises permaneciam vazios no preflight.
- O RBAC vigente mantém `video_factory.read` para os cargos internos e
  `video_factory.manage` somente para `admin` e `gerente`.
- `video_jobs` possuía os estados e campos de aprovação da geração e do master,
  mas ainda permitia `INSERT/UPDATE` direto pelo `service_role` e não possuía
  criação idempotente nem autoria do cancelamento.
- O banco produtivo foi confirmado em `192.168.1.162`, PostgreSQL 17.6. A nova
  versão não existia no histórico e não havia linha incompatível com a mudança.

## B. Divergências e decisões

- O desenho anterior previa três aprovações. Por decisão explícita desta ação,
  ficaram apenas dois gates humanos: conferir briefing e custo para autorizar a
  geração; depois, aprovar o master validado.
- Não foi criado estado novo. `waiting_brief_approval` permanece como contrato
  interno e será apresentado como “Aguardando autorização para gerar”.
- Persona, claims, prompt, escala e análise familiar não recebem aprovações
  isoladas. Alterações antes do primeiro gate geram/reutilizam uma versão de
  briefing; depois dele, os dados aprovados não podem mudar silenciosamente.
- Não foi criada tabela genérica de eventos. As versões imutáveis existentes e
  a autoria registrada no job cobrem o histórico desta etapa.
- A confirmação de uma família continua necessária porque uma composição
  incorreta compromete a segurança factual, mas não é um gate adicional do
  vídeo.

## C. Implementação

- Foram criadas 11 rotas em `/api/video-factory` para consultar/criar jobs,
  preparar briefing, autorizar geração, cancelar, consultar famílias, sugerir e
  revisar composição, atualizar membros e executar análise.
- A criação recebe `requestId`, produto ou família e tipo de vídeo. Ela prepara
  o briefing na mesma operação; para família sem análise vigente, executa a
  análise primeiro. Retry reutiliza o job já criado.
- As rotas usam `authorizeApiRequest`, schemas Zod estritos e respostas
  `no-store`. Consultas exigem `video_factory.read`; comandos exigem
  `video_factory.manage`.
- A autorização compara versão do briefing, provider, modelo, custo e moeda
  exatos. Sem prompt/cotação real, responde conflito e não muda o estado.
- Falhas após a criação preservam o job em `draft` e devolvem seu ID para retry;
  nenhum fluxo usa DELETE.

## D. Banco

- Migration `20260914090000_bvf_workflow_01` adicionou cinco colunas, cinco
  constraints e três índices em `video_jobs`.
- `creation_request_id` é único por operador. A versão de briefing autorizada
  usa FK composta para não apontar para outro job.
- Cancelamento registra data, operador e motivo opcional.
- `bvf_create_video_job`, `bvf_authorize_video_generation` e
  `bvf_cancel_video_job` usam `SECURITY DEFINER`, `search_path` vazio, RBAC
  interno e `FOR UPDATE` nas transições concorrentes.
- `service_role` preserva `SELECT`, mas perdeu `INSERT`, `UPDATE` e `DELETE`
  diretos sobre `video_jobs`; executa somente as RPCs autorizadas. RLS continua
  ativa, sem policy aberta.

## E. Testes e evidências

- 33 testes BVF direcionados aprovados: fundação, BRIEF-01, FAMILY-01 e cinco
  cenários novos do WORKFLOW-01.
- `npm run validate`, `npm run build`, `npm run check:build-secrets` e
  `git diff --check` aprovados. O build Next.js 16.3.3 publicou as 11 rotas.
- Migration e teste SQL foram ensaiados juntos em transação com `ROLLBACK` no
  `.162`. Depois da aplicação, o mesmo teste passou novamente com rollback.
- O histórico contém uma ocorrência da migration e seu conteúdo possui SHA-256
  `1b9d37a8081de850948fd8a12402b58cd074346ed9009b473021e0bd2ff4e692`,
  idêntico ao arquivo versionado.
- Read-back: cinco colunas, cinco constraints, três índices, três RPCs
  protegidas, RLS ativa, zero policy, leitura permitida e escrita direta negada
  ao `service_role`. Nenhuma fixture BVF permaneceu.
- As contagens críticas permaneceram iguais ao preflight: `24.888 produtos`,
  `1.532 pedidos`, `1.429 compras`, `13 fornecedores` e `7.035 anúncios ML`.
- Código funcional no SHA `07b18caae9933f80200c86a2c4282a5ee31c7866`,
  enviado a `dev`, promovido por fast-forward para `bentevi-prod` e confirmado
  em execução no serviço `local/bentevi-prod`.
- A ação Easypanel `cmu0o5szy001y07r8c3si7ggz` terminou em `done`. Health e
  login responderam `200`; ML e fiscal estavam saudáveis; as novas APIs e os
  endpoints críticos responderam `401` sem sessão.

## F. Pendências deliberadas

- A autorização de geração permanece indisponível até Provider-01 fornecer
  prompt, provider, modelo e estimativa reais. Não houve chamada ou gasto.
- Upload e acesso assinado, UI, provider, worker, validação MP4, relatório de
  custos, master e vínculo ML permanecem nas ações próprias do checklist.
- Nenhuma tela ou arquivo em `mobile/` foi alterado.

## G. Próximo passo recomendado

Executar somente `BVF-STORAGE-01`: implementar referências privadas e acesso
assinado nos prefixos homologados, sem URL pública nem geração de vídeo.

## Recuperação

Em incidente, interromper novos comandos BVF e reverter o consumidor web. A
migration é aditiva e pode permanecer inerte; não apagar jobs ou versões. Uma
correção de schema deve ser progressiva, preservando o histórico já criado.
