# Bentevi — Oráculo de Fornecedores — Checklist de Implementação

**Função:** fonte de acompanhamento da liquidação consolidada de fornecedores

**Documento de origem:** `Briefing_Oraculo_Bentevi_Fornecedores_V2.pdf`

**Branch de desenvolvimento:** `dev`

**Aplicação produtiva:** `https://app.bentevi.shop`

**Banco produtivo:** `supabase.bentevi.shop` (`192.168.1.162`)

**Criado em:** 16/09/2026

**Última atualização:** 16/09/2026
**SHA-base analisado:** `53407a403a0f3f6ecc161d65632ae941585acf7d`

---

## 1. Como usar este checklist

Este documento é obrigatório durante toda a implementação. Antes de iniciar qualquer ação desta trilha:

1. ler `AGENTS.md` e o recorte **Bentevi em operação** do checklist central do Item 17;
2. confirmar branch `dev`, SHA e estado do Git;
3. executar somente a próxima ação liberada neste documento;
4. atualizar situação, evidências, testes e pendências ao terminar a ação;
5. não avançar enquanto o aceite da ação atual não estiver comprovado.

Regras permanentes:

- Uma ação técnica do Item 17 por tarefa.
- Planejado não significa concluído.
- Separar implementação, validação em DEV, publicação e aceite operacional.
- Não registrar credenciais, tokens, telefones completos, CNPJ completo ou chaves PIX.
- Não usar o banco produtivo para fixtures ou ensaios.
- Não executar backfill financeiro automático das compras existentes.
- Não alterar `main`, o aplicativo `mobile/` ou a TV comercial nesta trilha.
- Atualizar o checklist central somente com evidência real e resumida; os detalhes ficam aqui.
- Registrar `N/A` apenas com justificativa.
- Falha externa depois de um PIX confirmado não autoriza desfazer ou apagar a liquidação.

### Situações

| Situação | Significado |
|---|---|
| Pendente | Ainda não iniciada |
| Em andamento | Ação atual, ainda sem aceite |
| Bloqueado | Existe impedimento explícito registrado |
| Validado em DEV | Código e testes da ação passaram em `dev` |
| Publicado | Mesmo SHA validado foi promovido e publicado |
| Aceito | Comportamento e evidências da ação foram aprovados |

### Controle das ações

| Ordem | Ação | Situação | Dependência | Próximo gate |
|---:|---|---|---|---|
| 0 | ORC-00 — Contrato e checklist permanente | Aceito | Nenhuma | ORC-01 em nova tarefa |
| 1 | ORC-01 — Schema aditivo | Aceito | ORC-00 aceito | SHA executado, schema e smoke confirmados |
| 2 | ORC-02 — Estados e elegibilidade | Aceito | ORC-01 aceito | ORC-03 em nova tarefa |
| 3 | ORC-03 — Núcleo financeiro transacional | Aceito | ORC-02 aceito | ORC-04 em nova tarefa |
| 4 | ORC-04 — Pós-processamento e comunicação | Pendente | ORC-03 aceito | Jobs reprocessáveis sem duplicação |
| 5 | ORC-05 — Interfaces operacionais | Pendente | ORC-04 aceito | Compras, Vendas e Conta Corrente |
| 6 | ORC-06 — Cancelamentos e divergências | Pendente | ORC-05 aceito | Três cenários financeiros comprovados |
| 7 | ORC-07 — Ativação controlada | Pendente | ORC-06 aceito | Primeiro fechamento real acompanhado |
| 8 | ORC-08 — Dashboard resumido | Pendente | ORC-07 estabilizado | Aceite visual específico |

---

## 2. Contrato funcional aprovado

### Objetivo

Substituir dezenas de confirmações individuais por poucos fechamentos consolidados por fornecedor, sem misturar venda, fulfillment, etiqueta, obrigação financeira, pagamento e crédito.

O PIX pertence à liquidação. Cada compra recebe uma alocação auditável dentro dela.

### Decisões fechadas

- A liquidação consolidada será o fluxo padrão.
- A confirmação individual permanecerá como compatibilidade controlada e usará o mesmo núcleo.
- Somente compras comprovadamente prontas poderão entrar em uma liquidação.
- Dúvida, divergência ou dado incompleto exclui a compra; não haverá inferência otimista.
- O agrupamento financeiro será por CNPJ normalizado e chave PIX.
- Na primeira versão, uma conta financeira deverá corresponder a um único fornecedor operacional.
- BKR1 e MKS continuarão com contas, livros e PIX separados, mesmo compartilhando contato.
- A comunicação será agrupada por contato: uma mensagem poderá informar mais de uma liquidação, com separação explícita por CNPJ.
- A mensagem será gerada, revisada por uma pessoa e somente então enviada.
- O gestor escolherá quanto crédito usar, entre zero e o saldo confirmado disponível; o sistema sugerirá o máximo aplicável.
- Crédito pendente não reduz o PIX.
- Admin e gerente poderão preparar, cancelar, confirmar e comunicar.
- Operador e visualizador terão somente leitura.
- O comprovante será opcional e pertencerá à liquidação.
- Liquidação confirmada será imutável; correções financeiras usarão movimentos compensatórios auditáveis.
- A primeira fase alterará Compras, Vendas e Conta Corrente.
- Dashboard será posterior ao núcleo. A TV comercial não será alterada.
- Não haverá integração bancária ou execução automática de PIX nesta versão.
- O Oráculo não altera preço, margem ou outra regra do cânon comercial.

### Elegibilidade mínima

Uma compra somente poderá ser incluída quando todas as condições abaixo forem verdadeiras:

- pagamento `prepaid_pix` pendente;
- valor de pagamento conhecido e positivo;
- venda vinculada e ativa;
- compra não cancelada;
- etiqueta real disponível e entregue pelo fluxo operacional;
- abastecimento confirmado como `ready`;
- fornecedor com cadastro financeiro válido;
- nenhuma divergência financeira ou operacional aberta;
- nenhuma alocação em outra liquidação preparada ou confirmada.

O preview deverá apresentar separadamente as compras excluídas e o motivo objetivo de cada exclusão.

---

## 3. Fotografia do estado atual — ORC-00

### Fluxo implementado

- `compras` é a fonte da compra DSLite e guarda o pagamento individual.
- A rota individual de confirmação exige `purchases.payment.confirm`.
- O fluxo atual atualiza a compra, envia WhatsApp e pode retomar a DSLite no mesmo processamento HTTP.
- O comprovante é exigido pelo fluxo normal atual, salvo caminhos de retomada.
- BKR1 adia o PIX enquanto existe etiqueta provisória.
- Compras permite “Registrar PIX” individualmente.
- Vendas deriva ações como confirmar pagamento, enviar comprovante e retomar DSLite.
- A API usada pelo mobile delega à confirmação individual; o código em `mobile/` permanece fora do escopo.
- `supplier_balance_movements` controla créditos, ajustes e usos de crédito, com estados pendente/confirmado/rejeitado/anulado.
- Créditos de cancelamento são criados para venda cancelada e compra pré-paga já paga, mas o ponto exato do despacho ainda não impede todos os créditos automáticos.
- A infraestrutura persistente de jobs já possui deduplicação e recuperação e deverá ser reutilizada.
- Eventos operacionais de pagamento e WhatsApp já aparecem em `nf_auditoria_eventos`; a nova implementação não deve criar uma segunda trilha sem necessidade.

### Riscos confirmados

- A confirmação individual não é atômica para várias compras.
- Banco, WhatsApp e retomada DSLite estão acoplados e admitem falha parcial.
- Não existe cabeçalho de liquidação nem alocação de compras em um PIX consolidado.
- O modelo atual não distingue formalmente obrigação, liquidação e conta corrente.
- Etiqueta real/provisória e seu canal ainda não possuem contrato único persistido.
- Compras pendentes existentes incluem canceladas, etiquetas futuras, placeholders e casos sem venda ativa; não podem ser migradas em lote por suposição.
- CNPJ/chave PIX e telefone são dimensões diferentes e não podem usar o mesmo agrupamento.
- Existe identificador financeiro em migration histórica; não duplicar o valor e não reescrever o histórico nesta trilha.

### Leitura produtiva inicial, somente leitura

O levantamento de 16/09/2026 confirmou:

- banco alvo em `.162` e ausência das novas tabelas de liquidação;
- 13 fornecedores e 1.452 compras no momento da consulta;
- 22 compras pré-pagas pendentes, misturando casos ativos, cancelados e incompletos;
- BKR1 e MKS com contato compartilhado, mas CNPJ e chave PIX distintos;
- saldo confirmado existente para Vanral e créditos de outros fornecedores ainda dependentes do ledger atual;
- os casos 407678 e 407812 já mudaram desde a redação do briefing e serão cenários conceituais de teste, não fixtures copiadas da produção.

Esses números são fotografia datada, não condição fixa da implementação. ORC-01 deverá repetir o preflight antes de qualquer migration produtiva.

### Consumidores que exigem compatibilidade

- Página e APIs de Compras.
- Página, ações e projeção de leitura de Vendas.
- Fluxo de criação/retomada DSLite.
- Sincronização de pedidos DSLite.
- Conta Corrente/Créditos de fornecedores.
- Geração de PDFs de Compras e Vendas.
- Assistente Bentevi e sua projeção de leitura.
- API compartilhada consumida pelo mobile, sem alterar arquivos do aplicativo.
- Jobs, eventos de auditoria e templates de WhatsApp.

---

## 4. Contrato técnico mínimo

Os nomes abaixo ficam reservados para ORC-01 e seguintes. Qualquer alteração exige atualizar este documento antes de implementar.

### Persistência

`supplier_settlements` será o cabeçalho do fechamento e terá, no mínimo:

- fornecedor e conta financeira;
- fotografia de nome, CNPJ e chave PIX;
- estado `prepared`, `confirmed` ou `cancelled`;
- total bruto, crédito escolhido e PIX líquido;
- referência e comprovante opcionais;
- chave de idempotência e versão;
- ator e datas de preparação, confirmação e cancelamento.

`supplier_settlement_items` registrará:

- liquidação, compra e venda;
- fotografias dos identificadores e valores usados;
- valor bruto, crédito alocado e PIX alocado;
- vínculo ativo único por compra.

Extensões previstas:

- `compras`: vínculo com liquidação e estado de abastecimento;
- `pedidos`: `label_type`, `label_delivery_channel` e `label_delivered_at`;
- índices em todas as chaves estrangeiras e nos filtros operacionais reais;
- índice único parcial impedindo duas alocações ativas da mesma compra;
- checks de estado, valores não negativos e igualdade entre bruto, crédito e PIX.

`supplier_balance_movements` continuará como fonte dos créditos. As novas tabelas serão a fonte das obrigações e pagamentos consolidados; não haverá duplicação das obrigações no ledger.

### APIs previstas

- `GET /api/compras/liquidacoes/preview`
- `POST /api/compras/liquidacoes/preparar`
- `GET /api/compras/liquidacoes/[id]`
- `POST /api/compras/liquidacoes/[id]/confirmar`
- `POST /api/compras/liquidacoes/[id]/cancelar`
- `POST /api/compras/liquidacoes/[id]/comunicar`
- endpoint de gestão do estado de abastecimento

A rota individual existente se tornará um adaptador de liquidação com um item na ativação controlada da ORC-07. Até lá, o novo writer ficará desligado e o fluxo individual atual permanecerá ativo; depois da troca não poderão existir dois writers financeiros ativos.

### Concorrência e efeitos externos

- Preparar, confirmar e cancelar serão operações transacionais no banco.
- Conta, compras e créditos serão travados em ordem determinística.
- Toda elegibilidade será revalidada dentro da transação.
- Se um item mudar, o lote inteiro será rejeitado.
- Crédito será reservado em `prepared`, consumido em `confirmed` e liberado em `cancelled`.
- A distribuição do crédito escolhido será determinística, das compras mais antigas para as mais novas.
- Chamadas DSLite e WhatsApp ficarão fora da transação.
- A confirmação criará atomicamente um job de pós-processamento.
- Serão reutilizados os jobs persistentes existentes, com os tipos `supplier_settlement_postprocess` e `supplier_settlement_communication`.
- Repetição da requisição ou do job não poderá duplicar pagamento, retomada ou mensagem.

---

## 5. Ações e critérios de aceite

### ORC-00 — Contrato e checklist permanente

- [x] Analisar o briefing e separar venda, fulfillment, etiqueta, obrigação, liquidação e crédito.
- [x] Cruzar o briefing com código, migrations, documentação e dados produtivos somente leitura.
- [x] Registrar decisões funcionais aprovadas pelo responsável.
- [x] Registrar riscos, consumidores e limites da primeira versão.
- [x] Definir ordem, gates, testes e recuperação.
- [x] Criar este checklist permanente.
- [x] Validar referências e `git diff --check`.
- [x] Commitar e enviar a ação em `dev`.
- [x] Promover o mesmo SHA para `bentevi-prod`.
- [x] Registrar evidência final e mudar ORC-00 para `Aceito`.

**Não inclui:** migration, código funcional, escrita no banco ou ativação. A publicação documental segue o fluxo normal do Bentevi.

### ORC-01 — Schema aditivo

- [x] Repetir a inspeção do schema atual em `.162`, sem escrita.
- [x] Conferir funções, triggers, RLS, grants, índices e consumidores das tabelas afetadas.
- [x] Criar uma única migration idempotente e aditiva.
- [x] Criar tabelas, colunas, checks, FKs e índices definidos no contrato.
- [x] Aplicar privilégio mínimo: sem escrita direta para `anon`/`authenticated`; acesso pelo servidor autorizado.
- [x] Não classificar ou migrar compras existentes automaticamente.
- [x] Ensaiar em PostgreSQL 17.5 local embarcado com dados sintéticos. Supabase DEV local: **N/A nesta ação**, pois Docker/WSL está indisponível; não equivale a replay integral do projeto.
- [x] Provar compatibilidade do schema com linhas legadas sintéticas e validar lint, tipos e build do código atual.
- [x] Documentar recuperação antes de liquidações confirmadas: manter schema aditivo e reverter somente código se necessário; nenhuma linha financeira é criada nesta etapa.
- [x] Executar preflight, snapshot proporcional de metadados, migration em `.162` e read-back.
- [x] Registrar migration, SHA remoto, alvo e evidências.
- [x] Confirmar o SHA efetivamente executado pelo serviço no Easypanel; webhook e reinício não bastam para este gate.

**Aceite:** schema aditivo publicado sem alterar o fluxo financeiro existente.

### ORC-02 — Estados e elegibilidade

- [x] Criar fonte única da elegibilidade.
- [x] Persistir e projetar etiqueta provisória/real, canal e entrega nos fluxos DSLite e WhatsApp afetados.
- [x] Implementar abastecimento `unknown`, `ready`, `blocked` e `cancelled` com justificativa e controle de concorrência.
- [x] Restringir alteração manual a admin/gerente.
- [x] Implementar preview por conta financeira, sem criar liquidação ou movimentar PIX.
- [x] Exibir cada exclusão com motivo determinístico.
- [x] Revisar individualmente as 22 compras PIX pendentes em produção; manter todas em `unknown` por falta de prova inequívoca de abastecimento.
- [x] Não inferir `ready` de texto livre, ausência de erro ou status DSLite ambíguo.

**Validação e publicação:** testes direcionados, lint, tipos e build aprovados. O mesmo SHA foi promovido e publicado no Bentevi produtivo. Não houve atualização de estado nas 22 compras, migration, liquidação ou escrita financeira nesta ação. A elegibilidade de compras reais permanecerá bloqueada até que os estados operacionais sejam comprovados e classificados manualmente.

**Aceite:** preview inclui somente compras comprovadamente prontas e explica todas as exclusões.

### ORC-03 — Núcleo financeiro transacional

- [x] Implementar preparação, reserva de crédito, confirmação e cancelamento em RPCs transacionais.
- [x] Sugerir crédito máximo, permitindo escolher de zero ao disponível; crédito pendente não entra no saldo.
- [x] Registrar fotografias dos dados financeiros e operacionais.
- [x] Aplicar locks por fornecedor e por compra em ordem estável, com transações curtas.
- [x] Revalidar compra, venda, etiqueta, conta, valores e crédito dentro da transação.
- [x] Implementar idempotência e restrições contra alocação e uso de crédito duplicados.
- [x] Tornar liquidação confirmada imutável e registrar job pendente na confirmação atômica.
- [x] Suportar lote unitário no núcleo; manter a rota individual atual como único writer ativo até a ORC-07.
- [x] Preservar o contrato da API compartilhada usada pelo mobile, sem alterar `mobile/`.
- [x] Preservar as projeções existentes de `supplier_payment_status`; a apresentação das novas liquidações em Vendas, Compras, Conta Corrente e relatórios fica na ORC-05.

**Decisão de lançamento:** a flag privada `ORACULO_SETTLEMENT_WRITES_ENABLED` nasce desligada em produção. ORC-03 publica o núcleo sem preparar ou confirmar pagamentos reais; a mudança da confirmação individual para o mesmo núcleo ocorrerá na ORC-07, após ORC-04/05/06 e canário operacional. Uma liquidação inteiramente coberta por crédito tem PIX líquido zero e não recebe referência bancária fictícia.

**Validação e publicação:** migration aplicada duas vezes em PostgreSQL 17.6 local com dados sintéticos; oito testes de integração cobrem concorrência real, reserva, idempotência, reversão integral, crédito pendente, conta alterada, PIX zero e privilégios. Quatro testes de API cobrem flag, autenticação e contratos; regressões do fluxo individual também passaram. O núcleo foi publicado passivamente em `.162` e `app.bentevi.shop`; o primeiro pagamento real permanece bloqueado pelos gates das ações seguintes.

**Aceite:** concorrência e repetição não duplicam compra, crédito ou PIX; totais fecham no banco.

### ORC-04 — Pós-processamento e comunicação

- [ ] Criar os dois tipos de job usando a infraestrutura existente.
- [ ] Enfileirar pós-processamento na mesma transação da confirmação.
- [ ] Retomar DSLite de forma idempotente.
- [ ] Gerar comunicação consolidada por contato e separada por CNPJ.
- [ ] Exigir revisão humana antes do envio.
- [ ] Registrar envio, falha, tentativa e reprocessamento.
- [ ] Não desfazer o financeiro por falha externa.
- [ ] Impedir mensagens e retomadas duplicadas.

**Aceite:** falhas de DSLite/WhatsApp ficam visíveis e reprocessáveis sem duplicar efeitos.

### ORC-05 — Interfaces operacionais

- [ ] Adicionar “Liquidação de hoje” e “Fechar pagamentos” em Compras.
- [ ] Mostrar grupos, bruto, crédito sugerido/escolhido, PIX e exceções.
- [ ] Permitir comprovante opcional no fechamento.
- [ ] Exigir confirmação humana do PIX.
- [ ] Mostrar liquidação e estado financeiro em Vendas, sem misturar logística.
- [ ] Evoluir Conta Corrente com créditos, reservas, usos, liquidações e ajustes.
- [ ] Exibir saldo contábil e saldo reconciliado.
- [ ] Aplicar permissões também nas APIs.
- [ ] Atualizar PDFs e Assistente quando consumirem os campos afetados.
- [ ] Projetar liquidações e crédito reservado nas leituras e relatórios afetados, mantendo `supplier_payment_status` compatível.

**Aceite:** uma tela responde quanto pagar por CNPJ, itens incluídos/excluídos, créditos, etiquetas e exceções.

### ORC-06 — Cancelamentos e divergências

- [ ] Antes do pagamento: invalidar obrigação e remover elegibilidade.
- [ ] Depois do pagamento e antes do despacho: criar crédito pendente para análise.
- [ ] Depois do despacho: não criar crédito automaticamente.
- [ ] Bloquear divergências até decisão explícita.
- [ ] Usar movimento compensatório com referência à origem.
- [ ] Não apagar ou editar liquidação confirmada.

**Aceite:** os três momentos do cancelamento produzem resultados distintos e auditáveis.

### ORC-07 — Ativação controlada

- [ ] Confirmar que a flag privada criada na ORC-03 segue desligada e ativá-la somente após os gates.
- [ ] Redirecionar a confirmação individual web/API mobile para o mesmo núcleo antes de ligar a flag; eliminar o writer financeiro antigo sem alterar o contrato público.
- [ ] Publicar mantendo o fluxo atual como padrão.
- [ ] Fazer smoke sem pagamentos fictícios.
- [ ] Ativar para um fechamento real pequeno e acompanhado.
- [ ] Conferir banco, compra, venda, crédito, job, DSLite e mensagem.
- [ ] Tornar lote o padrão somente depois do aceite do canário.
- [ ] Manter confirmação individual como exceção identificada.
- [ ] Monitorar os primeiros sete dias e pelo menos um ciclo completo.

**Aceite:** operação diária consolidada sem perda de rastreabilidade ou dupla execução.

### ORC-08 — Dashboard resumido

- [ ] Definir resumo pequeno a partir do núcleo estabilizado.
- [ ] Não duplicar a torre operacional de Compras.
- [ ] Obter aceite visual específico.
- [ ] Manter TV comercial inalterada.

---

## 6. Matriz mínima de testes

### Elegibilidade

- [ ] Compra pronta incluída.
- [ ] Etiqueta provisória excluída.
- [ ] Etiqueta real ainda não entregue excluída.
- [ ] Abastecimento `unknown` ou `blocked` excluído.
- [ ] Venda cancelada excluída.
- [ ] Valor ausente, zero ou divergente excluído.
- [ ] Compra já alocada excluída.

### Financeiro

- [ ] Várias compras do mesmo CNPJ/chave geram um fechamento.
- [ ] BKR1 e MKS geram dois PIX e uma comunicação revisável.
- [ ] Crédito confirmado parcial e integral.
- [ ] Crédito pendente não reduz PIX.
- [ ] Crédito acima do disponível é rejeitado.
- [ ] Cancelar preparação libera compras e reserva.
- [ ] Liquidação confirmada não aceita edição ou cancelamento.
- [ ] Comprovante ausente não bloqueia a confirmação.
- [ ] Totais usam `numeric`, sem ponto flutuante.

### Concorrência e integração

- [ ] Dois gestores preparando as mesmas compras.
- [ ] Repetição da preparação e confirmação.
- [ ] Compra alterada entre preview e preparação.
- [ ] Falha DSLite depois do PIX.
- [ ] Falha WhatsApp e reprocessamento.
- [ ] Job repetido não duplica efeito.
- [ ] Rota individual mantém compatibilidade usando o novo núcleo.

### Cancelamento e acesso

- [ ] Cancelamento antes do pagamento.
- [ ] Cancelamento depois do pagamento e antes do despacho.
- [ ] Cancelamento depois do despacho.
- [ ] Admin e gerente escrevem.
- [ ] Operador e visualizador somente leem.
- [ ] Chamador sem permissão é rejeitado no servidor e no banco.

### Validação por ação

- [ ] Testes direcionados primeiro.
- [ ] `npm run validate` para código web.
- [ ] `npm run build` para runtime/configuração sensível.
- [ ] `git diff --check` em todas as ações.
- [ ] Migrations e testes de banco somente no DEV local com dados sintéticos antes da publicação.
- [ ] Smoke e read-back produtivos proporcionais à mudança.

---

## 7. Publicação, monitoramento e recuperação

### Publicação obrigatória

Para cada ação técnica:

1. validar na branch `dev`;
2. commit e push somente dos arquivos da ação;
3. confirmar SHA remoto de `dev`;
4. promover esse SHA por fast-forward para `bentevi-prod`;
5. comprovar o alvo `.162` antes de qualquer escrita;
6. aplicar apenas a migration da ação, quando houver;
7. publicar em `local/bentevi-prod` quando houver mudança de runtime;
8. conferir SHA executado, health, comportamento e read-back;
9. registrar evidências neste documento.

### Monitoramento

- Liquidações `prepared` antigas.
- Reservas de crédito sem liquidação ativa.
- Jobs falhos, `on_hold` ou repetidos.
- Liquidações confirmadas com pós-processamento pendente.
- Compras com elegibilidade desconhecida.
- Divergências de totais ou tentativas idempotentes rejeitadas.

### Recuperação

- Antes de existir liquidação confirmada: desligar a flag, cancelar preparações e reverter código; manter schema aditivo.
- Depois de existir liquidação confirmada: bloquear novos fechamentos e corrigir progressivamente.
- Nunca restaurar backup cegamente, apagar pagamento ou voltar para `main`.
- Reprocessar efeitos externos pelos jobs sem alterar a confirmação financeira.

---

## 8. Registro de evidências

| Data | Ação | SHA/migration | Validação | Resultado e pendência |
|---|---|---|---|---|
| 16/09/2026 | ORC-00 | `199e02bbd67f5ff98c8b1625059c10643c8977a8` | Referências, `git diff --check` e 34 testes de `tests/assistant-chat.test.js` | Enviado a `dev`, promovido por fast-forward e aceito pelo webhook oficial |
| 16/09/2026 | ORC-00 | Sem migration | Processo produtivo reiniciado; health e login `200`, Compras `307` sem sessão e API de Compras `401` | Publicação documental confirmada, sem escrita financeira ou alteração de banco |
| 16/09/2026 | ORC-01 | Base `63ec772c` | Preflight somente leitura: PostgreSQL 17.6 no `.162`, migration mais recente `20260916120000`, novas tabelas ausentes, 1.452 compras e 22 PIX pendentes | Migration ainda não criada; DEV Docker indisponível nesta máquina, ensaio sintético alternativo em avaliação |
| 16/09/2026 | ORC-01 | `20260916180000_oraculo_supplier_settlements_schema.sql` | Ensaio sintético PostgreSQL 17.5: migration aplicada duas vezes; defaults legados, FKs, unicidade, totais, RLS e grants conferidos. 37 testes direcionados e 21 testes DB-03 passaram; `npm run validate`, `npm run build`, varredura de segredos e `git diff --check` passaram | Nenhuma escrita produtiva ainda; teste inicial com asserção de tipo incorreta foi corrigido e repetido com sucesso. Supabase DEV local indisponível por ausência do Docker |
| 16/09/2026 | ORC-01 | SHA funcional `3b37eade2c1b1dd01800b6ffebfad03040741cd1` | `dev` e `bentevi-prod` remotas no mesmo SHA por fast-forward; snapshot pré-migration de metadados/contagens em `/tmp/oraculo-schema-preflight-fVQsaT/baseline.json`, hash SHA-256 `7b21ebc3dbf2fb704081954acea95c770af6baaebc964382f224e815a1f71390` | Snapshot não contém linhas de clientes nem substitui backup integral de dados; migration é apenas aditiva e não altera valores existentes |
| 16/09/2026 | ORC-01 | Migration `20260916180000`, hash SHA-256 `dea210454308915dea79b2733371ee84c92eeb336fe930050b5de58ce4e02096` | Aplicada em transação curta diretamente em `192.168.1.162/postgres`, PostgreSQL 17.6; registry confirmou a versão. Read-back: duas tabelas vazias, RLS ativo, zero grants de cliente, zero DELETE ao `service_role`, constraints válidas, 1.452 compras `unknown`, zero compras vinculadas, zero pedidos classificados, 995 movimentos de crédito e 22 PIX pendentes | Sem backfill, PIX, crédito ou mensagem criados |
| 16/09/2026 | ORC-01 | SHA remoto `3b37eade` | Webhook oficial HTTP `200`; processo reiniciado, health/login `200`, Compras e Vendas `307` sem sessão, APIs protegidas `401`; ML Auth e configuração fiscal `ok` | **Aceite pendente:** o endpoint de health não expõe SHA e o SHA do processo Easypanel não pôde ser comprovado por leitura |
| 16/09/2026 | ORC-01 | SHA `6667ddf0ebf7a3e3db972d6713f34e91ab742ea9` | Easypanel `local/bentevi-prod`: fonte `bentevi-prod`, ação `cmu3sjfv8001d07k34pdn7msv` concluída; digest da imagem da ação `162d8351…` igual ao contêiner ativo, task `we4iffdb7oexb2ekijl4idi29`. Read-back HTTP em `.162`: zero liquidações, itens, compras vinculadas/classificadas e pedidos etiquetados. Health/login `200`, Compras `307`, API de Compras `401` sem sessão | **Aceito:** schema passivo em produção, sem ativação de pagamento em lote ou alteração do fluxo financeiro existente |
| 16/09/2026 | ORC-02 | SHA funcional `66bf23a299782ed9ed6b3fbad3366cd904bcd7fa`; sem migration | 75 testes direcionados, 34 testes do Assistente, `npm run validate`, `npm run build`, varredura de secrets e `git diff --check` aprovados. Revisão somente leitura das 22 compras PIX pendentes em `.162` | Todas seguem `unknown`; nove vendas canceladas, uma sem venda e uma entregue. Nenhuma foi classificada como pronta sem evidência |
| 16/09/2026 | ORC-02 | SHA remoto `66bf23a299782ed9ed6b3fbad3366cd904bcd7fa`; ação Easypanel `cmu3uadrl002307k39nrd0lqh` | `dev` e `bentevi-prod` remotas no mesmo SHA por fast-forward. Serviço `local/bentevi-prod` lê `bentevi-prod`; ação concluída e digest da imagem `4fe4d34fc7654e88f058398ec0617a8ead2ba1ca109131222c0747c2e17043ad` igual ao contêiner ativo. Health/login `200`, Compras `307` sem sessão, API de Compras, preview e PATCH de abastecimento `401` sem sessão | **Aceito tecnicamente:** estado e preview publicados, sem habilitar fechamento. Read-back `.162`: 22 PIX pendentes, 22 abastecimentos `unknown`, zero liquidações e zero itens. Preview autenticado com dados reais ainda não foi exercitado; primeira classificação e fechamento exigem acompanhamento operacional nas ações seguintes |
| 16/09/2026 | ORC-03 | Migration `20260916193000_oraculo_supplier_settlement_core.sql`; SHA funcional `64d576bc527d3e35dc29fd971655376e1de8a140` | PostgreSQL 17.6 local sintético: migration aplicada duas vezes; oito testes transacionais e concorrentes passaram. Quatro testes de API e 35 regressões direcionadas passaram; `npm run validate`, `npm run build`, varredura de secrets, 34 testes do Assistente e `git diff --check` passaram | Núcleo validado em DEV. A rota individual e o mobile continuam no contrato anterior. Sem liquidação ou PIX real |
| 16/09/2026 | ORC-03 | Preflight `.162`; backup de metadados e DDL em `/tmp/oraculo-orc03-preflight-20260916.json`, SHA-256 `856b5850370b29e73ea2924e6939b8d77af2a669d79b8638f6bc4d3edc851bf1` | Conexão autenticada via pooler da `.162` confirmou PostgreSQL 17.6, migration anterior `20260916180000`, RLS nas duas tabelas, trigger de saldo existente, zero liquidações/itens, 995 movimentos, 22 PIX pendentes `unknown`. Serviço `local/bentevi-prod` usa `bentevi-prod` e não possui a flag privada de escrita | Backup proporcional ao delta de função/schema; não é backup integral de dados. Não fazer reversão cega após novas gravações |
| 16/09/2026 | ORC-03 | SHA funcional remoto `64d576bc527d3e35dc29fd971655376e1de8a140`; migration `20260916193000`, SHA-256 `607eb7d12d31af85f3f826b3222f693a5abcb05dbc1df167e7348e679e808787` | `dev` e `bentevi-prod` no mesmo SHA por fast-forward. Migration aplicada em transação curta à `.162`; registry, quatro RPCs restritas a `service_role`, três guards, dois índices e bloqueio de INSERT direto nas liquidações conferidos. Read-back: zero liquidações, itens, usos de crédito do Oráculo, jobs e compras vinculadas; 995 movimentos, 22 PIX pendentes, 22 abastecimentos `unknown` | Nenhum pagamento, crédito ou job real criado. Flag privada de escrita ausente/desligada |
| 16/09/2026 | ORC-03 | Easypanel ação `cmu3w060e000207ov7lb1h8df`; digest `7bfd10c5643c7cb8379574fbec11f2df92b9ab7cfc5b99438f998fd0dde79948` | Primeira tentativa `cmu3vz45i002p07k3djdc68km` falhou por DNS do GitHub antes do build; segundo deploy concluiu e digest da ação coincide com a imagem do contêiner ativo. Health/login `200`, Compras `307` sem sessão, API de Compras, preview, detalhe e preparo/confirmação `401` sem sessão | **Aceito tecnicamente:** publicação passiva. Não houve canário autenticado nem liquidação real; ORC-04 e gates posteriores seguem obrigatórios antes da ativação |

## 9. Próxima ação permitida

**ORC-03 aceita tecnicamente em 16/09/2026.** A próxima ação técnica permitida é ORC-04 — Pós-processamento e comunicação, em tarefa própria. Não iniciar liquidação real antes dos gates financeiros e da classificação operacional das compras.
