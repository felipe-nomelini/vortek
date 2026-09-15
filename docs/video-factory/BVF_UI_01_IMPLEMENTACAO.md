# BVF-UI-01 — interface operacional, revisão factual e gates humanos

Data da ação: 15/09/2026.

Estado deste registro: implementação e validação de código concluídas na branch
`dev`; migration, publicação e aceite operacional deliberadamente não
executados.

## A. Auditoria

- A aplicação web real usa Next.js App Router 16.3.3, React 19, TypeScript,
  Ant Design, autenticação same-origin por `authorizeApiRequest`, RBAC central e
  serviços Supabase exclusivamente server-side.
- O domínio BVF existente já possuía APIs para jobs, famílias e cinco operações
  de Storage. O bucket `video-factory` permanece privado, e as referências são
  acessadas por URL assinada de dez minutos sem persistência de URL pública.
- O read-back somente leitura do `.162` confirmou `VTK000115` ativo, seis
  imagens, dois anúncios ML pausados e dimensões estruturadas: largura 5,2 cm,
  altura 5,9 cm, profundidade 9,8 cm e peso líquido 0,593 kg.
- A persona `RAFA/v1` está ativa, mas ainda não possui nenhuma das três
  referências canônicas. Não foi criado asset substituto.
- No início da ação, famílias, jobs, tentativas e assets BVF permaneciam vazios.
  A migration de UI não estava aplicada no banco produtivo.

## B. Divergências e decisões

- O WORKFLOW-01 já definiu um único Gate #1 para briefing e cotação real.
  Portanto, a UI registra a revisão humana em versão imutável, mas não promove
  o job a `approved_for_generation` sem provider, modelo, prompt e custo reais.
- Salvar a revisão factual foi separado de autorizar a geração. Produto sem
  referência e RAFA sem biblioteca podem ter a revisão registrada, porém o
  Gate #1 continua bloqueado.
- Os slots homologados pelo STORAGE-01 são `front`, `profile` e `full_body`.
  A interface apresenta Frontal, Perfil e Corpo inteiro, sem criar uma segunda
  taxonomia para “três quartos” ou “bancada”.
- As colunas estruturadas `produtos.largura`, `altura` e `profundidade` passaram
  a preceder qualquer medida extraída da descrição. A âncora nomeia cada eixo,
  evitando trocar a orientação física do produto.
- O Supabase DEV local não pôde ser iniciado porque o runtime Docker não está
  disponível para o usuário atual. O teste SQL transacional foi criado, mas não
  foi declarado como executado.
- A `dev` contém commits posteriores de catálogo ainda ausentes em
  `bentevi-prod`. Conforme o limite definido para esta ação, não houve promoção
  conjunta, aplicação no `.162` nem deploy.

## C. Implementação

- Rota nativa `/video-factory`, item `Estúdio` no shell Bentevi e componente
  responsivo `VideoFactoryStudio`.
- Read models server-side para produto real por SKU, anúncios relacionados,
  personas e referências privadas.
- Nova API autenticada de revisão em
  `PUT /api/video-factory/jobs/[id]/brief-review`, além das consultas de persona
  e produto do estúdio.
- Contrato Zod de revisão, mapa explícito dos 16 estados e serviço que cria uma
  nova versão imutável com fingerprint SHA-256.
- Histórico de briefings, Gate #1, tentativas e aprovação/rejeição do master,
  exibindo somente eventos realmente persistidos.
- Commit funcional: `246bc6cc44f5f31748ab57210fe834fcd939fc39`.

## D. Banco e Storage

- A migration preparada é `20260915100000_bvf_ui_01.sql`, SHA-256
  `f2a62335bccf1515f69b25b6eb22f2d06521239ca204ff4f7a3bbf638419fb6c`.
- Ela não cria tabela nem policy. Cria uma RPC de persistência da revisão e
  endurece a RPC existente de autorização para exigir revisão UI, referências
  ativas e coerentes com SKU/família/persona e a cotação exata.
- Mudança material após autorização cria nova versão, volta o job para
  `waiting_brief_approval` e limpa prompt, provider, modelo, cotação e autoria
  do Gate #1 anteriores.
- O acesso direto continua sem mutation para `anon`/`authenticated`; a nova RPC
  é executável somente por `service_role` e valida `admin`/`gerente` dentro da
  transação.
- A migration **não foi aplicada** no `.162`. Nenhum dado, objeto de Storage,
  referência RAFA ou fixture foi criado ou alterado nesta ação.

## E. UX entregue no código

- Busca explícita por SKU, mensagens de inexistência, produto inativo e ausência
  de imagens, sem alterar o cadastro mestre.
- Produto, estoque cadastrado, anúncios, preço, vendidos, visitas, qualidade,
  dica ML, descrição, imagens, dimensões e peso.
- Biblioteca RAFA com upload, preview assinado, substituição e desativação pelos
  contratos já existentes; slots ausentes permanecem visivelmente bloqueantes.
- Configuração dos três tipos de vídeo, escopo SKU/família e seleção exclusiva
  de famílias existentes.
- Revisão de claims com origem, claims proibidos, scale anchor, atributos
  seguros/inseguros e briefing editável nos oito blocos previstos.
- Revisão auditável separada do Gate #1. Geração paga permanece indisponível sem
  cotação real. Gate #2 mostra apenas “Aguardando geração”, sem player ou asset
  fictício.

## F. Testes

- 54 testes direcionados BVF/shell foram aprovados durante o fechamento.
- A suíte completa terminou com 1.534 testes aprovados, zero falhas e um teste
  ignorado por condição já existente no projeto.
- `npm run validate`, `npm run build`, `npm run check:build-secrets` e
  `git diff --check` foram aprovados. O build listou `/video-factory` e as novas
  APIs.
- `tests/bvf-ui-01.sql` cobre revisão sem imagens, revisão com referência,
  autorização exata, invalidação material e grants, sempre dentro de
  `ROLLBACK`; sua execução ficou pendente pela indisponibilidade do Docker.
- O aceite operacional completo com `VTK000115` não foi executado, pois a
  migration e a aplicação não foram publicadas.

## G. Segurança

- Sessão e permissões `video_factory.read`/`video_factory.manage` são exigidas
  nas novas rotas.
- Nenhuma chave privilegiada, secret, URL pública permanente ou upload assinado
  foi adicionado ao cliente.
- A UI reutiliza as APIs server-side do STORAGE-01 e solicita previews
  temporários; referências inativas não passam no Gate #1.
- O SQL não contém `DELETE`, nova policy permissiva ou escrita em produto,
  anúncio, pricing, estoque, pedido, compra, fornecedor ou fiscal.

## H. Deploy

- Não houve aplicação de migration, promoção de `bentevi-prod`, deploy, smoke
  remoto ou alteração do serviço produtivo.
- O único destino Git desta entrega é `origin/dev`, conforme a limitação
  expressa desta missão.

## I. Pendências deliberadas

- Executar a migration e o teste SQL em ambiente autorizado, com preflight e
  read-back, antes de liberar a rota operacionalmente.
- Disponibilizar e enviar as três imagens canônicas reais da RAFA; HUMAN_DEMO
  continuará bloqueado até isso ocorrer.
- Executar o aceite com `VTK000115` e comprovar que os domínios lidos não foram
  alterados.
- Provider, cotação, worker, MP4, validação, thumbnail, master e associação ML
  permanecem fora de escopo e não foram simulados.

## J. Próximo passo recomendado

Primeiro concluir a liberação controlada de `BVF-UI-01` sem promover junto os
commits de catálogo ainda não aprovados: aplicar a migration, publicar o mesmo
SHA e executar o aceite com assets reais. Depois, planejar `BVF-PROVIDER-01`
sobre a porta `VideoProvider`; a Briefing/Factual Engine já está implementada e
agora possui seu consumidor de revisão humana.

## Recuperação

Antes de qualquer uso, a recuperação é simplesmente não publicar a rota nem
aplicar a migration. Depois da aplicação, um rollback de código deixa a nova
RPC inerte; versões de briefing já criadas devem ser preservadas. Não remover
histórico nem restaurar aprovação antiga: correções devem ser progressivas.
