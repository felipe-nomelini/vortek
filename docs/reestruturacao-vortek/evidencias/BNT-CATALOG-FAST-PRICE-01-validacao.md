# BNT-CATALOG-FAST-PRICE-01 — Alteração rápida de preço no catálogo

Data: 23/09/2026. Branch de edição: `dev`. Destino: `app.bentevi.shop`, serviço `local/bentevi-prod`.

## Causa e mudança

`Revisar preço` carregava a avaliação completa antes de liberar o painel. O primeiro clique em `Alterar preço` repetia a avaliação para o novo valor, abria outra confirmação e, após o segundo clique, um modal de três etapas bloqueava a próxima revisão. A confirmação e o worker também recotavam alvo, piso e equilíbrio, embora a decisão manual recaia sobre um único preço.

O painel agora abre com os dados já disponíveis na lista. A prévia somente leitura consulta automaticamente tarifa e frete do preço digitado, usa o cálculo econômico canônico e mostra lucro, margem e avisos no mesmo painel. Respostas de preços anteriores são descartadas. O botão único confirma a alteração; o resultado da fila é acompanhado por anúncio na lista, permitindo revisar outro anúncio. Durante a revisão, os cálculos da página visível são adiados. A rota nova exige `pricing.decisions.manage`, valida vínculo produto/anúncio e seller do ML e não grava avaliação, configuração, operação ou preço.

A confirmação preserva operação auditada, idempotência, autorização, verificação de item/seller, concorrência, revalidação do anúncio, claim único e read-back. Apenas o caminho manual do catálogo deixa de cotar preços-alvo adicionais; as demais avaliações continuam com as projeções anteriores. Um preço economicamente inconclusivo permanece aviso, sem criar bloqueio comercial. O worker identifica a forma da decisão persistida para revalidar operações novas sem alterar a revalidação das operações antigas.

## Validação e publicação

- Testes direcionados de catálogo, cotação, decisão, auditoria e acompanhamento: 11 arquivos aprovados; cobrem valor inválido, vínculo ou seller divergente, anúncio fora do catálogo, prejuízo, margem abaixo do piso, tarifa inconclusiva, preço já aplicado, automação ativa e cotação única do preço manual.
- `npm run validate`, `npm run build` com Next.js 16.3.3 e 146 páginas estáticas, `npm run check:build-secrets` e `git diff --check` aprovados.
- Código funcional `18c89dc54b32826ca5296df15e1942cc58e2a85a` enviado a `origin/dev` e promovido por fast-forward a `origin/bentevi-prod`. O único commit anterior ainda não promovido era documental e foi revisado. `main` não foi alterada.
- O webhook oficial do Easypanel aceitou o deploy com HTTP `200`. Após reinício do processo, o chunk da nova interface respondeu `200` e continha o texto do painel novo. `GET /api/ops/health` e `/login` responderam `200`; `/catalogo/no-catalogo` sem sessão respondeu `307`; `POST /api/catalogo/preco/preview` e `/api/catalogo/preco/confirmar` sem sessão responderam `401`.
- A ação do Easypanel e o SHA da imagem ativa não puderam ser lidos diretamente. O arquivo novo servido pelo domínio produtivo comprova o código da interface publicado, mas não substitui a leitura direta do SHA no painel. Nenhum preço real foi alterado no smoke, pois esta tarefa não indicou anúncio e valor para um canário. Nenhuma migration ou mudança de dados foi necessária.

## Recuperação

Se houver regressão, corrigir ou reverter o commit funcional em `dev`, validar, promover o novo SHA por fast-forward e reimplantar `local/bentevi-prod`. Operações já enfileiradas devem continuar pelo worker canônico; não repetir alterações de preço de resultado incerto. Não há rollback de schema ou dados desta mudança.
