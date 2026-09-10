---
name: vortek-dev-release
description: Preparar um snapshot validado de dev para uma próxima promoção controlada da branch produtiva independente bentevi-prod, sem misturar a main legada nem executar produção.
---

# Preparação de promoção Vortek

Esta skill prepara um snapshot validado da nova versão para uma próxima promoção. Leia primeiro o `AGENTS.md`, fonte central dos ambientes e das autorizações. `main` é o sistema legado preservado; `dev` é a linha independente de desenvolvimento; `bentevi-prod` é a branch produtiva criada diretamente de um SHA aprovado de `dev`. Esta preparação nunca move a branch produtiva, mistura históricos, aplica migrations ou altera produção.

## Preparação obrigatória

1. Confirme a branch `dev`, o working tree e os testes executados para a mudança; pare se a branch for outra.
2. Confirme que `dev` está limpa antes de considerar a mudança pronta para promoção. Se houver pendências, informe-as sem descartar, incluir ou publicar trabalho alheio.
3. Fixe o SHA candidato de `dev` e revise seu conteúdo como snapshot autônomo. Não trate o diff ou a ancestralidade com `main` como pacote de promoção.
4. Audite `main` e a produção somente por leitura para identificar comportamentos essenciais ainda necessários. Classifique cada um como já atendido, substituído conscientemente, adiado com aceite ou bloqueador a implementar nativamente em `dev`; nunca faça merge, rebase ou cherry-pick em massa.
5. Compare o schema produtivo lido com o schema requerido pelo candidato e prepare migrations novas, mínimas e ordenadas. Não reaplique o diretório de DEV nem fabrique igualdade entre históricos.
6. Identifique novas variáveis de ambiente exigidas, sem revelar valores ou secrets.
7. Confira os gates e aceites no checklist vigente e prepare a movimentação de `bentevi-prod` somente para o SHA candidato aprovado, a troca controlada do serviço, recuperação, condições de interrupção e preservação da `main` legada. Implementação e publicação DEV não equivalem a aceite produtivo.
8. Encerre com a preparação e suas pendências. Qualquer push para a branch produtiva, alteração do serviço ou execução produtiva pertence a tarefa própria e autorizada. Os Supabases remotos permanecem exclusivamente leitura neste projeto; ensaios de escrita seguem o preflight DEV local do `AGENTS.md`.

Não faça commit, push, movimentação de branch produtiva, merge, migrations ou deploy como efeito automático da preparação. Não exponha valores de secrets. Não transforme a identificação de uma correção produtiva em autorização para executá-la. A preservação de `main` não prova rollback: valide separadamente compatibilidade de schema, dados e efeitos externos.
