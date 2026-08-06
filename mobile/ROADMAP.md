# Roadmap — Vortek Mobile Android

## Progresso

- [x] Pasta e builds separados do ERP web.
- [x] Arquitetura e contratos iniciais documentados.
- [x] Validação Bearer no backend.
- [x] Endpoint `/api/mobile/v1/session`.
- [x] Scaffold Expo com login, sessão segura e abas principais.
- [x] Matriz final de permissões por cargo.
- [x] Implementar API e tela da TV ao vivo.
- [ ] Implementar Vendas.
- [ ] Implementar Compras.
- [ ] Configurar notificações e distribuição interna.

## 1. Objetivo

Entregar aplicativo Android interno para acompanhar e operar os fluxos principais da Vortek:

1. TV ao vivo;
2. vendas;
3. compras;
4. alertas operacionais;
5. perfil e controle de acesso.

Aplicativo deve reutilizar backend, integrações e regras já existentes. Nenhuma regra de Mercado Livre, DSLite, Brasil NFe ou WhatsApp será duplicada no celular.

## 2. Resultado esperado da versão 1

Funcionário autorizado consegue:

- entrar com conta Vortek;
- ver métricas e vendas novas na TV;
- localizar venda por número, cliente, SKU ou produto;
- identificar urgências e pendências;
- abrir detalhes completos da venda;
- acompanhar compra, fornecedor, DSLite, NF-e, etiqueta e WhatsApp;
- executar ações operacionais permitidas pelo cargo;
- receber alertas de venda nova e falha importante;
- usar aplicativo em celular e tablet Android.

## 3. Escopo funcional

### 3.1 TV ao vivo

- faturamento, lucro, pedidos e ticket médio;
- metas diária, semanal e mensal;
- vendas recentes;
- evolução por hora;
- perguntas recentes;
- ações pendentes;
- alerta visual e sonoro para venda nova;
- modo tela cheia para tablet;
- atualização resumida a cada 5 segundos;
- atualização completa a cada 30 segundos;
- pausa automática quando aplicativo estiver em segundo plano.

### 3.2 Vendas

- abas alinhadas ao ERP: Urgentes, Preparação, Em transporte, Entregues e Todos;
- busca por pedido ML, pack, cliente, SKU e produto;
- filtros por fornecedor, status, etiqueta, WhatsApp e período;
- paginação no servidor;
- resumo por aba;
- detalhes de cliente, produtos, entrega, logística, fiscal e fluxo do fornecedor;
- histórico das etapas;
- links para Mercado Livre e rastreio;
- consulta de NF-e, DSLite e etiqueta;
- ações controladas: reenviar WhatsApp e retomar fluxo DSLite;
- ações financeiras ou fiscais exigem confirmação explícita e permissão de cargo.

### 3.3 Compras

- resumo de compras e pendências;
- busca e filtros por fornecedor, pedido DSLite, venda, produto e status;
- detalhes dos itens e vínculo com venda;
- situação de pagamento, etiqueta e transporte;
- comprovante de PIX somente por acesso autorizado;
- confirmação de pagamento fica para segunda etapa operacional, após auditoria e idempotência.

### 3.4 Perfil e segurança

- nome, e-mail e cargo;
- versão do aplicativo;
- encerramento de sessão;
- bloqueio local por biometria opcional;
- lista de aparelhos autorizados em fase posterior;
- tela de sessão expirada e recuperação segura.

## 4. Fora da versão 1

- criação e edição de anúncios;
- cadastro completo de produtos;
- operações em massa;
- auditorias extensas;
- página de créditos de fornecedores;
- administração de usuários;
- configurações fiscais;
- mutações offline;
- acesso direto do aplicativo ao banco ou às APIs externas.

Esses itens entram somente após uso real do MVP.

## 5. Decisões técnicas

| Tema | Decisão |
|---|---|
| Aplicativo | React Native com Expo |
| Navegação | Expo Router |
| Linguagem | TypeScript estrito |
| Dados remotos | TanStack Query |
| Validação | Zod |
| Login | Supabase Auth |
| Sessão local | Expo SecureStore |
| Backend | API do Next.js existente |
| Autorização | Token Bearer validado no servidor + cargo do perfil |
| Integrações externas | Exclusivamente no backend |
| Atualização da TV | Polling consciente de foreground no MVP |
| Notificações | Expo Notifications |
| Build piloto | EAS Internal Distribution |
| Distribuição estável | Google Play Internal Testing |

## 6. Arquitetura de API móvel

Prefixo inicial:

```text
/api/mobile/v1
```

Endpoints previstos:

```text
GET  /session
GET  /tv/live
GET  /tv/metrics
GET  /sales
GET  /sales/summary
GET  /sales/:id
GET  /sales/:id/tracking
POST /sales/:id/whatsapp-label
POST /sales/:id/resume-dslite
GET  /purchases
GET  /purchases/summary
GET  /purchases/:id
POST /devices/push-token
DELETE /devices/push-token
```

Contrato de resposta:

```json
{
  "data": {},
  "error": null,
  "meta": {
    "requestId": "uuid",
    "page": 1,
    "pageSize": 25,
    "total": 0
  }
}
```

Regras:

- toda entrada validada com Zod;
- toda rota protegida valida token e cargo;
- erros externos são normalizados, sem expor segredo;
- ações POST usam chave de idempotência;
- ações assíncronas retornam `jobId` e status consultável;
- logs usam `requestId` para rastrear ponta a ponta;
- serviços existentes são reutilizados, não copiados.

## 7. Fases de desenvolvimento

### Fase 0 — Preparação e contratos

Estimativa: 2–3 dias.

Tarefas:

- confirmar responsáveis e usuários piloto;
- fechar matriz de permissões por cargo;
- definir nome, ícone e identificador Android;
- registrar contratos atuais de TV, vendas e compras;
- definir formato padrão de erro e paginação;
- definir ambientes: desenvolvimento, homologação e produção;
- criar checklist de segurança e publicação.

Entrega:

- contratos aprovados;
- matriz de cargos aprovada;
- backlog priorizado;
- critérios de aceite definidos.

Gate: nenhuma tela começa antes de autenticação, cargos e contratos estarem fechados.

### Fase 1 — Backend preparado para aplicativo

Estimativa: 4–6 dias.

Tarefas:

- criar validador de `Authorization: Bearer`;
- validar usuário com Supabase Auth no servidor;
- carregar perfil e cargo em fonte confiável;
- negar acesso por padrão;
- criar rotas `/api/mobile/v1`;
- extrair apenas lógica necessária das rotas web para serviços compartilhados;
- padronizar erros, paginação e `requestId`;
- implementar idempotência nas ações escolhidas;
- limitar chamadas por usuário/aparelho;
- testar token válido, expirado, revogado e cargo sem permissão.

Entrega:

- API móvel autenticada;
- documentação dos contratos;
- testes de integração básicos.

Gate: nenhum segredo externo aparece em resposta, log ou bundle móvel.

### Fase 2 — Fundação do aplicativo

Estimativa: 3–5 dias.

Tarefas:

- criar projeto Expo dentro de `mobile/`;
- configurar Expo Router;
- configurar TypeScript, lint e testes próprios;
- criar tema escuro Vortek;
- implementar login;
- persistir sessão com armazenamento seguro;
- controlar refresh somente em foreground;
- criar cliente HTTP com Bearer, timeout e `requestId`;
- configurar TanStack Query e Zod;
- criar navegação TV, Vendas, Compras e Perfil;
- criar estados de carregamento, vazio, erro e offline;
- configurar builds development, preview e production.

Entrega:

- APK de desenvolvimento instalável;
- login e navegação funcionais;
- logout e expiração de sessão testados.

Gate: usuário sem autorização não acessa nenhuma rota protegida.

### Fase 3 — TV ao vivo

Estimativa: 3–5 dias.

Tarefas:

- adaptar métricas existentes;
- criar cartões de faturamento, lucro, pedidos e ticket;
- criar metas e tendência;
- listar vendas e perguntas recentes;
- implementar polling por visibilidade do app;
- criar modo tablet/tela cheia;
- adicionar alerta sonoro configurável;
- mostrar idade do último dado recebido;
- tratar perda e retorno de conexão.

Entrega:

- TV funcional em celular e tablet;
- consumo de rede controlado;
- sem atualização em background.

Gate: dados conferem com painel web no mesmo instante de referência.

### Fase 4 — Vendas

Estimativa: 6–9 dias.

Tarefas:

- [x] implementar resumo e abas;
- [x] implementar busca principal;
- [x] implementar filtros por status, período e faixa de valor;
- [ ] implementar filtros por fornecedor, etiqueta e WhatsApp;
- [x] criar lista em cartões adaptativos e paginação;
- [x] criar detalhe com múltiplos produtos;
- [x] mostrar estados fiscal, fornecedor, DSLite, etiqueta e WhatsApp;
- [x] mostrar linha do tempo operacional;
- [x] adicionar rastreio e link Mercado Livre;
- implementar reenvio de WhatsApp;
- implementar retomada do fluxo DSLite;
- adicionar confirmações, permissões e idempotência;
- atualizar resultado de jobs sem duplicar execução;
- testar venda unitária, kit e pack com múltiplos itens.

Entrega:

- acompanhamento completo de vendas;
- duas ações operacionais seguras;
- estado igual ao ERP web.

Gate: repetição de toque ou falha de rede não duplica ação.

### Fase 5 — Compras

Estimativa: 4–6 dias.

Tarefas:

- implementar resumo e lista;
- implementar busca e filtros;
- criar detalhe de compra;
- mostrar vínculo com venda e itens;
- mostrar PIX, DSLite, etiqueta e transporte;
- abrir comprovante com autorização;
- validar compras com múltiplos itens;
- preparar confirmação de pagamento sem habilitá-la por padrão.

Entrega:

- acompanhamento completo das compras;
- identificação rápida das pendências.

Gate: valores e vínculos conferem com ERP e fornecedor.

### Fase 6 — Notificações e observabilidade

Estimativa: 4–6 dias.

Tarefas:

- registrar token push por usuário e aparelho;
- criar alertas para venda nova, urgência e falha real;
- abrir tela correta por deep link;
- impedir falso positivo e notificação duplicada;
- registrar versão do app, usuário, rota, job e `requestId`;
- configurar relatório de falhas sem dados sensíveis;
- criar painel mínimo de saúde do app.

Entrega:

- notificações acionáveis;
- rastreabilidade entre app, API e job.

Gate: um evento gera no máximo uma notificação por destinatário elegível.

### Fase 7 — Segurança, qualidade e distribuição

Estimativa: 4–6 dias.

Tarefas:

- revisar permissões e vazamento de segredos;
- testar aparelhos pequenos, grandes e tablet;
- testar Android suportado mínimo e atual;
- testar internet lenta, queda, retorno e timeout;
- testar sessão expirada e usuário desativado;
- validar acessibilidade básica;
- validar consumo de bateria e rede da TV;
- gerar APK preview pelo EAS;
- configurar assinatura e backup seguro da chave;
- preparar Google Play Internal Testing;
- produzir manual curto para funcionários.

Entrega:

- release candidate;
- checklist de segurança aprovado;
- canal interno de distribuição pronto.

Gate: zero falha crítica aberta e nenhuma credencial sensível dentro do APK.

### Fase 8 — Piloto e liberação

Estimativa: 5 dias úteis de uso acompanhado.

Tarefas:

- instalar em 2–5 aparelhos;
- acompanhar uso real de TV, vendas e compras;
- registrar dúvidas e fricções;
- corrigir bloqueadores;
- medir falhas, latência e consumo;
- aprovar versão 1;
- ampliar distribuição interna.

Entrega:

- aplicativo liberado para equipe;
- backlog da versão 1.1 baseado em uso real.

## 8. Cronograma esperado

- Desenvolvimento do MVP: 4–6 semanas.
- Piloto controlado: 1 semana.
- Total até liberação interna estável: 5–7 semanas.

Estimativa considera um desenvolvedor focado e escopo sem expansão durante o MVP.

## 9. Ordem das primeiras duas semanas

### Semana 1

1. Contratos e matriz de permissões.
2. Autenticação Bearer no backend.
3. Rotas móveis de sessão e TV.
4. Testes de autorização.
5. Criação do projeto Expo isolado.

### Semana 2

1. Login e sessão móvel.
2. Navegação e tema.
3. Cliente HTTP e validação Zod.
4. TV ao vivo para celular.
5. Build Android de desenvolvimento.

## 10. Matriz inicial de permissões

| Ação | Consulta | Operação | Administrador |
|---|---:|---:|---:|
| Ver TV | Sim | Sim | Sim |
| Ver vendas | Sim | Sim | Sim |
| Ver compras | Conforme cargo | Sim | Sim |
| Rastrear pedido | Sim | Sim | Sim |
| Reenviar WhatsApp | Não | Sim | Sim |
| Retomar DSLite | Não | Sim | Sim |
| Ver comprovante | Não | Conforme cargo | Sim |
| Confirmar pagamento | Não | Conforme cargo | Sim |

Matriz precisa ser confirmada na Fase 0. Autorização sempre aplicada no servidor.

## 11. Estratégia de dados e conexão

- listas paginadas no servidor;
- cache somente para leitura;
- indicador de horário da última atualização;
- consulta automática ao retornar para foreground;
- backoff em falhas repetidas;
- nenhuma fila local para pagamento, emissão fiscal ou ação logística;
- ações iniciadas online recebem resultado ou `jobId` persistido no backend;
- app nunca presume sucesso por timeout.

## 12. Testes obrigatórios

### Backend

- autenticação e autorização;
- validação Zod;
- paginação e filtros;
- idempotência;
- isolamento entre cargos;
- normalização de erros externos.

### Aplicativo

- componentes e estados de tela;
- login, expiração e logout;
- foreground e background;
- reconexão;
- listas extensas;
- múltiplos itens e kits;
- deep links de notificações.

### Ponta a ponta

- venda nova aparece na TV;
- venda aparece na aba correta;
- busca encontra pedido, SKU e cliente;
- reenvio de WhatsApp executa uma vez;
- retomada DSLite acompanha job correto;
- compra exibe venda e fornecedor corretos;
- usuário sem cargo recebe acesso negado.

## 13. Critérios de aceite da versão 1

- login e renovação de sessão estáveis;
- dados de TV, vendas e compras iguais ao ERP;
- busca e filtros funcionam com volume real;
- aplicativo não executa ações duplicadas;
- nenhuma credencial privilegiada está no bundle;
- todas as ações sensíveis têm autorização no servidor;
- TV não consome rede em segundo plano;
- falhas exibem mensagem útil e `requestId`;
- build instala e atualiza pelo canal interno;
- piloto aprovado pela equipe operacional.

## 14. Indicadores do piloto

- tempo para encontrar uma venda;
- quantidade de ações concluídas sem abrir site;
- latência das telas principais;
- taxa de erro por endpoint;
- notificações duplicadas ou falsas;
- consumo de bateria durante TV;
- sessões expiradas inesperadamente;
- falhas operacionais causadas pelo aplicativo: meta zero.

## 15. Riscos e controles

| Risco | Controle |
|---|---|
| Duplicar regra do ERP | Toda regra fica no backend compartilhado |
| Expor token externo | Somente backend acessa integrações |
| Ação duplicada | Idempotência + bloqueio visual + job persistido |
| API atual depender de cookie | Rotas móveis usam Bearer validado pelo Supabase |
| Divergência entre app e site | Mesmos serviços e contratos testados |
| Polling gastar bateria | Intervalos maiores e pausa em background |
| Supabase self-hosted mudar gateway | Validar endpoint público e stack antes do primeiro build |
| Escopo crescer | Versão 1 limitada a TV, Vendas, Compras e Perfil |
| APK desatualizado | Canal interno com versionamento obrigatório |

## 16. Definition of Done por funcionalidade

Funcionalidade termina somente quando:

- contrato validado;
- autorização implementada no servidor;
- tela contempla loading, vazio, erro e sucesso;
- teste automatizado principal existe;
- teste em aparelho Android real passou;
- logs não contêm dados sensíveis;
- documentação curta atualizada;
- aceite operacional concluído.

## 17. Próximo passo autorizado

Concluir a Fase 4: detalhe da venda, histórico e depois ações operacionais com confirmação e idempotência.
