# BNT-AI-01 — Conhecimento e consultas

**Data:** 08/09/2026. **Ambiente:** local, branch `dev`. **Estado:** concluída no escopo aprovado de backend/consultas; sem chat ou inferência.

## Estado e mudança

- Resumo do Dashboard e enriquecimento de Pedidos estavam presos às rotas. Foram extraídos para serviços compartilhados, preservando fórmulas e regras; comparação textual confirmou que os corpos das funções de enriquecimento movidas não mudaram.
- Pedidos e Fiscal possuem caminhos de leitura com persistência. O Assistente usa apenas reconciliação/projeção em memória e um transporte que bloqueia escrita, endpoints externos e RPCs fora da lista de leitura.
- Introduzidos catálogo tipado, autenticação individual/admin por requisição, cobertura, fontes verificadas, metadados de atualização e seleção documental por seção. O índice aponta aos documentos existentes: não duplica políticas comerciais.
- Os serviços de garantia/modelo preexistentes não foram alterados. A leitura de liquidação aceita a projeção já calculada na requisição, evitando recalcular contexto/preço em outro instante; consumidores anteriores mantêm o comportamento padrão.

## Provas executadas

| Verificação | Resultado |
|---|---|
| `node --test tests/assistant-knowledge.test.js` | 49 aprovados, zero falhas |
| Regressões de pricing, economia, contexto, override/liquidação, fulfillment, fiscal, Pedidos, Estoque e Dashboard | 175 aprovados, zero falhas |
| Regressão do piloto de garantia | 28 aprovados, 2 LIVE explicitamente ignorados |
| `npm run validate` | Aprovado: lint + typecheck |
| `npm run build` | Aprovado, 122 páginas estáticas geradas; não é deploy |
| `git diff --check` | Aprovado |

A suíte nova executa serviços canônicos com armazenamento/auth sintéticos, não respostas numéricas inventadas. Inclui períodos vazios, cancelamento, lucro pendente, paginação acima de mil vendas, Pack múltiplo, ID componente, PIX pendente, estoque reservado/amostra estornada, oferta preferencial inativa, falta de frete, override/liquidação, XML reconciliado sem persistência, alíquota estimada/confirmada, fontes históricas, permissões, revogação, cancelamento/deadline e resposta tardia.

Também usa o SDK Supabase real com transporte de rede simulado: truncamento e falhas não viram zero/sucesso; writes, RPCs mutantes, tabela de integrações e destino `.160` são bloqueados antes do envio. O bloqueio aborta a operação para evitar retries internos do PostgREST. Conteúdo malicioso permanece dado sem acesso a ferramentas.

Os testes existentes que localizavam fórmulas no texto das rotas passaram a verificar os serviços extraídos e seus imports. Um teste estático do Dashboard ainda esperava a assinatura antiga de duas posições de `matchesOrdersOperationalView`; foi alinhado ao terceiro argumento já existente, sem alterar a regra.

## Contrato e rastreabilidade

Entrada, saída, limites e configuração futura estão na [seção AI-01 do contrato](../VORTEK_BENTEVI_ASSISTENTE_CONTRATO.md#8-ai-01--conhecimento-e-consultas-implementados). Próxima ação: planejar AI-02, sem aprovação visual de tela inexistente.

As skills de implementação DEV/Supabase orientaram a restrição ao `.162`, minimização e validação sem mutação operacional. A indicação antiga `.160` na skill foi rejeitada em favor do AGENTS vigente.

Referências técnicas consultadas: documentação Next.js instalada em `node_modules/next/dist/docs/` sobre fronteira server/client e `server-only`; [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser) para identidade validada no servidor; [Supabase AbortSignal](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal) para cancelamento. Contratos de paginação inclusiva, contagem, retries e Zod 3 confirmados também nas fontes oficiais dos SDKs instalados. As três RPCs permitidas foram inspecionadas nas migrations locais; não executadas em banco.

## Limites e riscos residuais

- Não foi consultado banco real, alterada configuração, aplicada migration ou chamada API operacional externa. Homologação com runtime/dados reais permanece na AI-02/GATE.
- Não houve execução de modelo ou envio de dados à OpenAI; os controles da conta continuam obrigatórios antes desse envio.
- Não existe endpoint `/assistente`, chat, histórico ou instalação do Codex no runtime nesta entrega. O guard individual precisa ser configurado na AI-02.
- Fonte sem atualização comprovada é declarada como tal. Falha/truncamento não permite concluir sobre totais. Frete ausente continua tornando projeções inconclusivas; não foi inventado fallback.
- As posições meramente visuais da tela de Estoque não são saldo operacional; a resposta identifica essa diferença.
- SHA documental identifica a versão lida, não comprova que uma fotografia histórica descreve o estado atual. A recuperação mantém autoridade e situação explícitas.

## Git e rollback

HEAD permaneceu `5c7f28a1a6132618c724078b040e6b1b6877ebf9`, branch `dev`. Nenhum commit, push, deploy ou operação em `main` foi realizado. Mudanças anteriores preservadas.

`AGENTS.md`, `src/services/warranty-codex.ts` e `tests/warranty-codex.test.js` conservaram os hashes observados antes da execução. Sem histórico de migrations, credenciais ou configuração alterados.

Rollback desta ação: retirar os módulos do Assistente, devolver os trechos extraídos às rotas e restaurar apenas as mudanças de teste/documentação desta ação. A extração não mudou as fórmulas; não há dados ou migration para reverter. Preservar todas as alterações locais anteriores, especialmente o modelo e a AI-00.
