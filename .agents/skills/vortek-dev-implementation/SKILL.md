---
name: vortek-dev-implementation
description: Implementar correções e melhorias do Bentevi desde a branch dev até a produção ativa, incluindo banco, promoção, deploy e verificação quando o pedido autorizar implementação.
---

# Implementação Bentevi em produção

Use esta skill para uma mudança por vez do Item 17 ou do Bentevi. O `AGENTS.md` é a fonte central e define quando a solicitação inclui o ciclo produtivo completo.

## Fluxo obrigatório

1. Confirme que a branch atual é `dev` e inspecione o working tree. Pare se a branch for outra e preserve mudanças preexistentes.
2. Leia e siga integralmente o `AGENTS.md`.
3. Trate `main` como o sistema legado preservado, `dev` como a branch de edição/validação e `bentevi-prod` como o SHA publicado. Não misture históricos; implemente nativamente em `dev` qualquer regra essencial ainda necessária.
4. Consulte a ação e os gates aplicáveis no checklist vigente, incluindo o recorte Bentevi em operação. Siga o roteamento do `AGENTS.md` para os documentos pertinentes, sem avançar para outra ação.
5. Investigue apenas os arquivos e fluxos necessários à tarefa.
6. Consulte a documentação oficial atual quando a decisão depender do comportamento de tecnologias ou integrações externas.
7. Identifique e registre, com evidência, a causa ou o estado atual antes de alterar o projeto.
8. Escolha a menor mudança correta, segura, sustentável e reversível.
9. Quando a implementação for pedida, implemente-a diretamente; não pare apenas no diagnóstico.
10. Adicione teste de regressão quando necessário para provar o comportamento corrigido.
11. Valide conforme a área alterada e a matriz do `AGENTS.md`: código web exige testes direcionados e `npm run validate`; mobile tem comandos próprios; documentação sem consumo em runtime exige revisão de referências e diff. Acrescente build para mudanças de runtime/configuração.
12. Execute build quando aplicável, sem tratá-lo como substituto do typecheck. Identifique falhas preexistentes e regressões, sem ocultá-las.
13. Antes de testes ou scripts com efeitos externos, confira seus efeitos e o escopo autorizado. Não execute fixtures ou reparos como testes automáticos.
14. Para escrita no banco, cumpra o preflight produtivo do `AGENTS.md`: `.162` é o único Supabase remoto gravável para o Bentevi; `.160` é legado somente leitura. Use o DEV local apenas para ensaios sintéticos.
15. Quando implementação foi solicitada, conclua o ciclo normal: commit/push de `dev`, fast-forward do SHA validado para `bentevi-prod`, mudanças necessárias em `.162`, deploy em `local/bentevi-prod` e smoke/read-back em `app.bentevi.shop`. Não peça autorizações repetidas já abrangidas pelo pedido.
16. Interrompa antes da produção somente se o usuário tiver limitado o escopo, se o alvo/recuperação não puder ser comprovado, se houver divergência da branch produtiva ou se surgir efeito destrutivo material não coberto pela tarefa.
17. Preserve `main`, não use `app.vortek.shop` como aplicação independente e não habilite writers comerciais adiados sem autorização específica.
18. Relate concisamente código, banco, SHA promovido, deploy, validação produtiva e qualquer pendência real. Nunca declare uma etapa não executada.

Não crie arquitetura nova sem necessidade nem replique regras que já possuem fonte no Bentevi. Não combine várias etapas do Item 17 em uma única tarefa. Siga o `AGENTS.md` para proteger documentos consumidos em runtime, credenciais, dados reais e alterações preexistentes; nunca versione ou exponha secrets produtivos.
