---
name: vortek-dev-release
description: Promover um snapshot validado de dev para a branch produtiva independente bentevi-prod, aplicar o delta necessário e verificar a produção Bentevi quando a implementação ou release foi solicitada.
---

# Promoção controlada do Bentevi

Leia primeiro o `AGENTS.md`, fonte central dos ambientes e autorizações. `main` é o legado preservado; `dev` é a branch de edição e validação; `bentevi-prod` é a branch efetivamente publicada a partir de um SHA aprovado de `dev`. Pedidos somente de preparação terminam antes das mutações; pedidos de implementação ou release concluem o ciclo produtivo definido no `AGENTS.md`.

## Fluxo obrigatório

1. Confirme a branch `dev`, o working tree e os testes executados para a mudança; pare se a branch for outra.
2. Confirme que `dev` está limpa antes de considerar a mudança pronta para promoção. Se houver pendências, informe-as sem descartar, incluir ou publicar trabalho alheio.
3. Fixe o SHA candidato de `dev` e revise seu conteúdo como snapshot autônomo. Não trate o diff ou a ancestralidade com `main` como pacote de promoção.
4. Audite `main` somente por leitura quando for necessário identificar comportamento legado essencial; nunca faça merge, rebase ou cherry-pick em massa.
5. Compare o schema produtivo lido com o schema requerido pelo candidato e prepare migrations novas, mínimas e ordenadas. Não reaplique o diretório de DEV nem fabrique igualdade entre históricos.
6. Identifique novas variáveis de ambiente exigidas, sem revelar valores ou secrets.
7. Confira gates, backup, recuperação e condições de interrupção. Se a tarefa for somente preparação, encerre com o SHA candidato e as pendências, sem mutações externas.
8. Em implementação/release solicitados, envie `dev`, atualize `bentevi-prod` por fast-forward para o SHA exato, aplique em `.162` apenas o delta necessário na ordem segura e publique `local/bentevi-prod`.
9. Confirme SHA remoto e executado, health, autenticação, logs e o comportamento afetado em `app.bentevi.shop`; registre banco, migrations, smoke e pendências sem expor secrets.

Não misture `main`, não faça force push, não exponha secrets nem use produção para fixtures. Uma implementação solicitada autoriza a promoção e o deploy normais; uma análise, revisão ou preparação não. A preservação de `main` não prova rollback: valide separadamente compatibilidade de schema, dados e efeitos externos.
