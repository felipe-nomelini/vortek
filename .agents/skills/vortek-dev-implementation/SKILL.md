---
name: vortek-dev-implementation
description: Implementar tarefas do Item 17 e melhorias da nova versão do Vortek somente em dev e homologação.
---

# Implementação Vortek DEV

Use esta skill somente para uma mudança por vez do Item 17 ou da nova versão no ambiente de desenvolvimento e homologação.

## Fluxo obrigatório

1. Confirme que a branch atual é `dev` e inspecione o working tree. Pare se a branch for outra e preserve mudanças preexistentes.
2. Leia e siga integralmente o `AGENTS.md`.
3. Trate `main` como o sistema legado preservado, `dev` como a linha de desenvolvimento independente e `bentevi-prod` como a branch produtiva. Não faça merge, rebase ou cherry-pick em massa; uma regra essencial observada em `main` deve ser reimplementada nativamente em `dev`, quando fizer parte da ação aprovada.
4. Consulte a ação e os gates aplicáveis no checklist vigente, incluindo o recorte Bentevi em operação. Siga o roteamento do `AGENTS.md` para os documentos pertinentes, sem avançar para outra ação.
5. Investigue apenas os arquivos e fluxos necessários à tarefa.
6. Consulte a documentação oficial atual quando a decisão depender do comportamento de tecnologias ou integrações externas.
7. Identifique e registre, com evidência, a causa ou o estado atual antes de alterar o projeto.
8. Escolha a menor mudança correta, segura, sustentável e reversível.
9. Quando a implementação for pedida, implemente-a diretamente; não pare apenas no diagnóstico.
10. Adicione teste de regressão quando necessário para provar o comportamento corrigido.
11. Valide conforme a área alterada e a matriz do `AGENTS.md`: código web exige testes direcionados e `npm run validate`; mobile tem comandos próprios; documentação sem consumo em runtime exige revisão de referências e diff.
12. Execute build quando aplicável, sem tratá-lo como substituto do typecheck. Identifique falhas preexistentes e regressões, sem ocultá-las.
13. Antes de testes ou scripts com efeitos externos, confira seus efeitos e o escopo autorizado. Não execute fixtures ou reparos como testes automáticos.
14. Para qualquer escrita de banco, cumpra o preflight do `AGENTS.md`: comprove o projeto `bentevi-dev-local` restrito a loopback e dados sintéticos. `.162` é produção Bentevi e `.160` é o legado; ambos são exclusivamente leitura neste repositório. Destino diferente ou incerto interrompe a operação.
15. A homologação web remota anterior está desabilitada. Valide localmente até que um novo serviço e banco DEV independentes sejam ativados em tarefa própria; deploy precisa de solicitação explícita e conferência do destino conforme o `AGENTS.md`.
16. Não altere produção, não troque para `main`, não mova `bentevi-prod` e não use `app.bentevi.shop` nem o redirecionamento `app.vortek.shop` para testes. Implementação não autoriza commit, push ou publicação automaticamente.
17. Relate concisamente a mudança, a validação executada, o resultado e qualquer pendência real.

Não crie arquitetura nova sem necessidade nem replique regras que já possuem fonte no Vortek. Não combine várias etapas do Item 17 em uma única tarefa. Siga o `AGENTS.md` para proteger documentos consumidos em runtime, credenciais e alterações preexistentes; não alimente a homologação com secrets de produção.
