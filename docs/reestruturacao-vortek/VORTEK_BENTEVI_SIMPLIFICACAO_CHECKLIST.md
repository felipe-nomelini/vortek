# Bentevi — Checklist geral de simplificação

**Início:** 19/09/2026

**Escopo:** aplicação web, web celular e páginas públicas

**Fora do escopo inicial:** aplicativo Expo
**Direção aprovada:** os dois usuários internos são proprietários com acesso total; confirmações permanecem somente diante de risco externo, financeiro, destrutivo ou irreversível.

## Regra de execução

Uma área é analisada e implementada por vez. Cada ação deve mapear o fluxo atual, classificar os impedimentos, propor o menor fluxo correto, preservar proteções técnicas e passar pelos gates de validação e produção do `AGENTS.md`.

Todo bloqueio encontrado recebe uma classificação:

- proteção obrigatória;
- regra de negócio real;
- fricção removível;
- etapa automatizável;
- gate temporário obsoleto;
- defeito ou estado ambíguo.

## Critérios transversais

- [ ] os dois proprietários executam as mesmas ações;
- [ ] ações internas reversíveis não pedem confirmação;
- [ ] ações externas, financeiras, destrutivas ou irreversíveis possuem no máximo uma confirmação clara;
- [ ] o sistema avança etapas seguras automaticamente e chama os proprietários apenas para decisão ou exceção;
- [ ] botão bloqueado informa causa e ação necessária;
- [ ] estado remoto incerto é relido antes de qualquer reenvio;
- [ ] auditoria, idempotência, concorrência, segurança fiscal e proteção contra efeitos duplicados são preservadas;
- [ ] a tarefa principal funciona no desktop e em `390×844`.

## Áreas e ordem

1. **Acesso, navegação e padrões globais** — em andamento; primeira ação `BNT-SIMP-01`.
2. **Dashboard, TV e prioridades diárias** — pendente.
3. **Vendas, pedidos, fulfillment e expedição** — pendente.
4. **Compras, fornecedores, pagamentos e créditos** — pendente.
5. **Estoque, recebimentos e devoluções** — pendente.
6. **Fiscal e documentos** — pendente.
7. **Produtos, ofertas, kits e cadastro comercial** — pendente.
8. **Mercado Livre: anúncios, catálogo e preço** — pendente.
9. **Clientes e atendimento no Mercado Livre** — pendente.
10. **Configurações, integrações e notificações** — pendente.
11. **Jobs, sincronizações, webhooks e saúde operacional** — pendente.
12. **Assistente, Estúdio e páginas públicas** — pendente.

Dependências de outra área são registradas, mas não ampliam a ação atual.

## BNT-SIMP-01 — Contas proprietárias sem gestão de cargos

### Estado confirmado

- [x] produção possui dois usuários interativos;
- [x] ambos já usam o perfil técnico `admin` e possuem acesso completo;
- [x] não existem dados nem schema a migrar;
- [x] o enum histórico continua necessário para compatibilidade do código e do aplicativo móvel, mas não precisa aparecer na gestão web.

### Mudança

- [x] renomear a superfície web de Usuários para Proprietários;
- [x] retirar a escolha e a alteração de cargo dos formulários e contratos web;
- [x] criar novas contas internas sempre com o perfil técnico `admin`;
- [x] preservar edição de nome, e-mail, avatar, senha e ativação;
- [x] preservar autenticação, autorização server-side, auditoria e proteção contra auto-desativação;
- [x] exibir o perfil `admin` como Proprietário no shell;
- [x] concluir testes direcionados, validação, build e verificação de secrets;
- [ ] promover o SHA validado e concluir o smoke produtivo.

### Aceite

- a tela não apresenta cargos nem permite enviá-los pela API;
- contas novas recebem acesso proprietário por fonte server-side;
- as duas contas atuais permanecem inalteradas;
- nenhuma permissão do aplicativo Expo ou de páginas públicas é ampliada;
- nenhuma migration ou escrita de dados é necessária.

### Validação local

- 22/22 testes direcionados de contratos, permissões, segurança e interface aprovados;
- 91/91 testes da suíte de Configurações e integrações aprovados;
- `npm run validate`, `npm run build` com 146 páginas estáticas/dinâmicas, `npm run check:build-secrets` e `git diff --check` aprovados;
- leitura produtiva confirmou dois usuários interativos e ambos com perfil técnico `admin`; nenhum dado foi alterado.

## Entrega obrigatória por área

Cada área deve registrar:

1. fluxo atual e tarefas frequentes;
2. cliques, confirmações, trocas de página, esperas e atualizações manuais;
3. fricções classificadas;
4. fluxo alvo com uma ação primária por etapa;
5. itens mantidos, removidos e automatizados;
6. contratos, compatibilidade e recuperação;
7. testes direcionados, validate, build e smoke aplicáveis;
8. SHA publicado e evidência produtiva quando houver implementação.
