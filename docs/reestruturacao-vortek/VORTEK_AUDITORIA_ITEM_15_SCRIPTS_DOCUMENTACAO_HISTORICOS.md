# Vortek — Auditoria de Limpeza e Organização

## Item 15 — Scripts + Documentação + Arquivos Históricos

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Observação:** o P0 de autorização do Item 9 continua aceito temporariamente como risco conhecido até o futuro plano de execução.  
**Objetivo:** classificar scripts, documentação, relatórios, arquivos de campanha e configurações de ferramentas como operacionais, manutenção, uso único encerrado ou históricos; identificar candidatos reais à remoção sem apagar mecanismos ainda necessários.

---

## 1. Conclusão executiva

O maior volume de “lixo” do Vortek **não está no núcleo `src/`**.

Ele está principalmente em:

```text
scripts/
reports/
testes de campanhas
comandos npm de campanhas
documentação antiga
artefatos de fornecedores
configurações de ferramentas antigas
tabelas criadas para auditorias pontuais
```

A pasta `scripts/` contém quase uma centena de utilitários, misturando:

```text
operações atuais
manutenção/recovery
backfills
reparos pontuais
importações de fornecedor
campanhas Mercado Livre
auditorias encerráveis
experimentos
```

A limpeza futura deve ser feita **por conjunto funcional**, e não apagando arquivos isoladamente.

O maior bloco candidato a remoção é o ecossistema:

```text
ml-p0-*
```

que hoje atravessa:

- scripts;
- libs de scripts;
- comandos `package.json`;
- 19 testes;
- diretórios em `reports/`;
- tabelas no banco;
- jobs históricos.

Na consulta operacional realizada, foi encontrado apenas um job `ml_p0_*`, concluído em **15/08/2026**, sem novas execuções na amostra consultada.

Isso indica forte caráter de campanha/auditoria, mas a remoção só deve ocorrer depois de confirmar que a campanha está encerrada e que nenhum dado precisa permanecer para auditoria.

Também foi encontrado um problema de segurança prioritário:

**`GUIDE.md` contém uma credencial administrativa literal versionada no repositório público.**

O valor não é reproduzido neste documento.

A validade atual da credencial não foi testada.

Ela deve ser tratada como potencialmente comprometida:

```text
remover do arquivo atual
+
rotacionar se ainda puder ser válida
+
revisar histórico Git
```

A documentação oficial do GitHub orienta que a primeira ação para um secret exposto seja revogar/rotacionar. Reescrever histórico pode ser necessário em alguns casos, mas possui efeitos colaterais e não deve ser feito automaticamente.

---

# 2. Classificação geral dos scripts

## Operacional atual — manter

Scripts diretamente ligados à operação atual, deploy, backup, segurança ou diagnóstico:

```text
backup-supabase-db-resilient.sh
backup-supabase-storage.mjs
restore-supabase-db.sh
restore-supabase-storage.mjs
check-build-secrets.sh
deploy-easypanel-vortek.sh
diagnose-runtime.sh
sync-local-main.sh
sync-codex-mcp.sh
codex-engineering.sh
waha-gows-smoke-test.js
audit-syncs-production.js
```

### Avaliação

**Manter.**

Eles resolvem necessidades atuais:

- backup/restore;
- deploy;
- diagnóstico;
- proteção contra secrets em build;
- sincronização de ambiente de desenvolvimento;
- smoke de integração.

Não devem ser misturados à limpeza de scripts históricos.

---

# 3. Scripts de manutenção/recovery — manter até confirmar substituição

Há scripts que não fazem parte do runtime normal, mas ainda podem ser úteis para recuperação controlada:

```text
backfill-ml-pack-id.js
backfill-nfe-status.js
backfill-shipping-labels.js
reconcile-nf-status.js
repair-dslite-fiscal-links.js
dedupe-produtos.js
dedupe-anuncios-ml.js
cleanup-ml-listings.js
audit-sku-duplicates.js
analyze-supplier-listing-conflicts.js
```

### Avaliação

**Manutenção / recovery.**

Não remover apenas porque não rodam diariamente.

Antes de excluir qualquer um, confirmar:

```text
a função foi absorvida pelo produto?
há endpoint/job equivalente?
o script ainda é citado em runbook?
há situação real de recuperação em que ele é necessário?
```

---

# 4. Scripts de uso único / campanha

Há muitos scripts claramente associados a:

- datas específicas;
- fornecedores específicos;
- correções pontuais;
- batches aprovados;
- campanhas SEO;
- reativação;
- saneamento de anúncios;
- preenchimento de marca/GTIN;
- shelf/profitability;
- P0 de Mercado Livre.

Exemplos de padrão:

```text
*-2026-08-03.js
*-2026-08-10.js
*-2026-08-12.js
*-2026-08-13.js
reconcile-hayamax-balance-2026-06-16.mjs
prepare-*
create-*batch*
run-*approved-batches*
```

e scripts específicos de fornecedores como:

```text
Hayamax
BKR1
Evolusom
Vanral
Floratta
Panasonic
```

### Avaliação

**Forte candidato a uso único encerrado.**

Não apagar individualmente durante a auditoria.

O Item 16 deve agrupá-los por campanha/finalidade, e o futuro checklist de execução deve remover cada cluster depois de confirmar que:

```text
resultado final já está persistido
+
não há operação recorrente dependente
+
não há script de rollback/recovery ainda necessário
```

---

# 5. Ecossistema `ml-p0-*`

Esse é o maior conjunto claramente especializado do repositório.

Ele aparece em:

```text
scripts/run-ml-p0-*
scripts/finalize-ml-p0-*
scripts/lib/ml-p0-*
tests/ml-p0-*
reports/ml-p0-*
package.json → ml:p0:*
package.json → test:ml-p0-*
tabelas ml_p0_*
```

O Item 14 contabilizou:

```text
19 testes ml-p0-*
```

O Item 10 identificou tabelas como:

```text
ml_p0_population_snapshots
ml_p0_publication_audits
ml_p0_sanitize_runs
ml_p0_sanitize_results
ml_p0_phase3_runs
ml_p0_phase3_results
ml_p0_phase3_remote_items
```

### Estado operacional observado

Foi encontrado um job:

```text
ml_p0_premium_audit
```

concluído em:

```text
15/08/2026
```

com:

```text
501 / 501
```

Não foram encontrados jobs `ml_p0_*` posteriores na consulta realizada.

### Avaliação

**P2 — forte candidato a cluster histórico.**

A remoção futura deve ser coordenada:

```text
1. confirmar encerramento da campanha
2. arquivar evidências necessárias
3. remover scripts
4. remover libs de campanha
5. remover comandos npm
6. remover testes específicos
7. remover reports ativos
8. criar migration nova para remover tabelas atuais, se confirmado
```

### Importante

**Não apagar migrations antigas que criaram essas tabelas.**

Se a estrutura deixar de existir, deve ser removida por uma **nova migration**, preservando o histórico do banco.

---

# 6. `reports/`

A pasta `reports/` contém grande volume de evidências geradas por:

- campanhas Mercado Livre;
- correções de fornecedor;
- auditorias;
- batches;
- before/after;
- CSVs;
- JSONs;
- sincronizações antigas.

A maior parte não participa do runtime.

### Porém

Alguns comandos atuais do `package.json` ainda apontam diretamente para arquivos dentro de `reports/`.

Portanto:

```text
reports/
```

não pode ser apagada inteira sem antes remover/encerrar os comandos que ainda a utilizam.

### Avaliação

**P2 — principal fonte de clutter no repositório.**

Direção futura:

```text
evidência ainda necessária
→ arquivar fora da árvore operacional do código

artefato de campanha encerrada
→ remover do repo ativo

arquivo ainda referenciado por comando atual
→ manter até retirar o consumidor
```

---

# 7. `GUIDE.md`

O arquivo é um guia/roadmap antigo do Vortek.

Ele descreve fases e estado do sistema que já não correspondem integralmente ao repositório atual.

### Problema crítico

O arquivo contém uma **credencial administrativa literal** versionada.

O valor não será reproduzido.

### Avaliação

**P0/P1 de segurança + P2 de documentação desatualizada.**

Ações futuras:

```text
1. remover a credencial do estado atual do repositório
2. rotacionar a credencial se ainda puder ser válida
3. revisar histórico Git
4. decidir se GUIDE.md ainda possui valor
5. se não possui:
   remover
6. se alguma informação ainda é útil:
   migrar somente o conteúdo atual e seguro para documentação correta
```

### Git history

Excluir `GUIDE.md` no commit atual **não elimina o conteúdo dos commits antigos**.

A decisão de reescrever histórico deve considerar:

- validade/criticidade do secret;
- forks/clones;
- pull requests;
- impacto operacional.

A rotação do secret é prioritária.

---

# 8. `CLAUDE.md`

O arquivo é pequeno e apenas direciona o agente para:

```text
AGENTS.md
```

como referência principal.

### Avaliação

**Manter.**

É um adapter simples de ferramenta e não duplica instruções extensas.

---

# 9. `RTK.md`

`RTK.md` afirma, em essência, que os comandos shell devem sempre usar RTK.

O `AGENTS.md` atual diz algo mais flexível:

```text
usar RTK quando disponível e quando houver equivalente correto
sem bloquear ou complicar a tarefa
```

### Problema

A documentação de menor prioridade contradiz a orientação operacional atual.

### Avaliação

**P2 — atualizar/reduzir/remover.**

Se a ferramenta ainda usa `RTK.md`, ele deve apenas refletir `AGENTS.md`.

Se não há consumidor real, remover o arquivo.

Não manter duas políticas diferentes sobre a mesma ferramenta.

---

# 10. `opencode.json`

O arquivo aponta para um servidor local em:

```text
.agents/tools/vortek-dataset/server.mjs
```

No estado atual do repositório, a árvore:

```text
.agents/
```

contém `skills`, mas o caminho:

```text
.agents/tools/vortek-dataset
```

não existe.

### Avaliação

**P2 — configuração quebrada ou obsoleta.**

Futuro:

```text
OpenCode ainda é usado?
→ corrigir referência

não é mais usado?
→ remover opencode.json
```

Não criar novamente o servidor apenas para preservar um arquivo de configuração antigo.

---

# 11. `skills-lock.json` + `.agents/skills`

O lockfile de skills corresponde à estrutura de skills presente no repositório.

### Avaliação

**Manter.**

É ferramenta de desenvolvimento atual, não lixo histórico.

---

# 12. `scripts/build_dataset/`

Existe um conjunto separado para gerar dataset de treinamento/fine-tuning.

Ele:

- usa dataset externo;
- adiciona exemplos Vortek;
- prepara upload;
- carrega pressupostos antigos de arquitetura;
- não está ligado aos scripts npm principais da aplicação.

Também não corresponde ao caminho ausente apontado em `opencode.json`.

### Avaliação

**P2 — forte candidato a experimento/histórico.**

Se não existe iniciativa atual de fine-tuning do Vortek:

```text
remover do repositório operacional
ou
mover para projeto separado
```

Não manter experimento de IA junto do código principal sem consumidor.

---

# 13. `Panasonic.xls`

Existe um arquivo:

```text
Panasonic.xls
```

na raiz do repositório.

Há script específico:

```text
scripts/import-panasonic-kits.js
```

que utiliza esse arquivo para importar kits.

### Avaliação

**Uso único / fornecedor específico.**

Se a importação Panasonic já foi concluída e não existe alimentação recorrente por esse arquivo:

```text
Panasonic.xls
+
import-panasonic-kits.js
```

devem ser removidos/arquivados juntos.

Não manter planilha de fornecedor na raiz permanentemente.

---

# 14. Importadores de planilha por fornecedor

Também existem scripts como:

```text
import-bkr1-client-kit-sheet.js
```

que processam planilhas externas.

### Avaliação

**Manutenção especializada ou uso único, dependendo da operação atual.**

Só manter se o processo real de onboarding/atualização do fornecedor ainda depender de planilha.

Se todo o fluxo atual já vem por API/XML:

```text
classificar como histórico
```

---

# 15. Dependência `xlsx`

O projeto possui dependência para leitura de planilhas.

Parte do uso está associada a scripts de importação.

### Avaliação

**Não remover a dependência agora.**

Depois de classificar e remover todos os consumidores de planilha, fazer uma busca final.

Somente se:

```text
nenhum código operacional usa xlsx
```

a dependência deve ser removida.

---

# 16. Documentação de deploy

`docs/easypanel-deploys.md` descreve o fluxo de deploy atual.

O `package.json` e `AGENTS.md` continuam apontando para Easypanel.

### Avaliação

**Manter como documentação operacional.**

---

# 17. Documentação Mercado Livre operacional

`docs/mercado-livre-publicacao-operacional.md` é explicitamente exigido pelas instruções do agente para operações de publicação.

### Avaliação

**Manter.**

É documentação operacional de alto valor e deve continuar sendo atualizada junto das mudanças de publicação.

---

# 18. Documentação Codex / runtime

Existem documentos como:

```text
docs/policyagent-unblock-checklist.md
docs/runtime-unblock-playbook.md
```

Eles descrevem ferramentas de engenharia e diagnóstico.

O `package.json` ainda possui comandos relacionados:

```text
sync:codex-mcp
diagnose:runtime
codex:engineering
```

### Avaliação

**Manutenção de desenvolvimento.**

Não são documentação de runtime do produto.

Devem permanecer apenas enquanto esse fluxo de engenharia for utilizado.

### Ponto a revisar

O playbook cita uma configuração `.mcp.json` que não aparece na árvore pública atual.

Isso pode ser:

- arquivo local não versionado;
- documentação desatualizada.

### Direção

Atualizar o documento para refletir o estado real do ambiente.

---

# 19. `docs/waha-gows-migration.md`

É um playbook de migração do engine WAHA.

O projeto ainda possui:

```text
waha:gows:smoke
```

e scripts relacionados.

### Avaliação

**Manutenção/migração ainda potencialmente válida.**

Não classificar como histórico sem confirmar que:

```text
migração GOWS foi concluída
+
não há rollback/fallback necessário
```

Depois de estabilizada, o documento pode virar um runbook curto do estado atual e deixar de ser “migration guide”.

---

# 20. `ops_whatsapp_events`

O Item 8 encontrou a tabela de eventos de comandos operacionais WhatsApp.

Consulta atual:

- os registros mais recentes continuam sendo de **22/06/2026**;
- não foi encontrado endpoint WAHA inbound atual no projeto web.

Os eventos antigos mostram um fluxo de comandos/ações operacionais que hoje não aparece no código web atual.

### Avaliação

**P2 — forte candidato a fluxo histórico.**

Item 15 confirma a classificação, mas não autoriza remoção ainda.

No futuro checklist:

```text
buscar script/serviço externo
+
buscar documentação
+
se nenhum consumidor:
    arquivar dados necessários
    criar migration de remoção
```

---

# 21. `whatsapp_alert_events`

A tabela permanece:

```text
vazia
```

O fluxo atual de alertas grava auditoria em outra estrutura.

### Avaliação

**P2 — forte candidata a tabela não adotada.**

Pode ser removida futuramente depois de confirmar ausência completa de readers/writers.

---

# 22. Aliases e compatibilidades antigas

Os itens anteriores encontraram aliases antigos em:

- jobs/sync taxonomy;
- tópicos Mercado Livre;
- rotas de dispatch;
- status.

### Avaliação

**P3/P2 — remover somente junto do consumidor.**

A sequência correta é:

```text
buscar referência
→ migrar consumidor atual
→ teste
→ remover alias
```

Não apagar compatibilidade cegamente.

---

# 23. Migrations

Migrations antigas documentam como o schema evoluiu.

Mesmo quando uma tabela ou campo deixa de existir, a migration que o criou continua sendo parte do histórico de implantação.

### Avaliação

**Não apagar nem reescrever migrations aplicadas apenas por limpeza.**

Quando remover objeto atual:

```text
nova migration de DROP/ALTER
```

preserva a evolução do banco.

---

# 24. Dados pessoais/configuração versionados

O Item 9 já encontrou dados operacionais pessoais em migrations históricas.

Os valores não serão reproduzidos.

### Avaliação

**P2 de privacidade/configuração.**

Para dados pessoais não-secret:

- remover de configurações atuais;
- evitar novos valores fixos em migrations/código;
- decidir revisão de histórico proporcionalmente ao risco.

Isso é diferente de secret de autenticação, que exige rotação.

---

# 25. `.gitignore`

O Item 9 observou que o `.gitignore` protege vários arquivos específicos de ambiente, mas não possui regra genérica ampla para todo `.env*`.

### Avaliação

**P3 preventivo.**

No futuro, endurecer o ignore sem bloquear `.env.example`.

Isso não substitui scanning de secrets nem rotação quando ocorre exposição.

---

# 26. Estruturas que devem permanecer no repositório

## Runtime/aplicação

```text
src/
supabase/migrations/
mobile/
public/
```

## Testes operacionais

Testes das regras permanentes.

## Scripts operacionais/manutenção atual

Backup, restore, deploy, diagnóstico e recovery ainda usados.

## Documentação operacional

```text
AGENTS.md
CLAUDE.md
docs/easypanel-deploys.md
docs/mercado-livre-publicacao-operacional.md
```

e playbooks de engenharia comprovadamente atuais.

---

# 27. Estruturas candidatas a sair do repositório ativo

Após confirmação no plano de execução:

```text
GUIDE.md antigo/inseguro
RTK.md conflitante, se não consumido
opencode.json quebrado, se OpenCode não usado
scripts/build_dataset/
Panasonic.xls
importadores one-off concluídos
scripts datados de campanha
ml-p0 scripts/libs/tests/reports
reports encerrados
configs/scripts antigos de fornecedores
aliases sem consumidores
```

No banco, por migrations novas:

```text
ml_p0_* se campanha encerrada
whatsapp_alert_events se sem uso
ops_whatsapp_events se fluxo encerrado
```

---

# 28. Prioridades do Item 15

## P0/P1 — segurança

### Credencial em `GUIDE.md`

Validade atual não foi testada.

Tratar como comprometida:

```text
remover
rotacionar se aplicável
revisar histórico
```

---

## P2 — grande volume de clutter

### Cluster `ml-p0-*`

Remover como conjunto depois de confirmar encerramento.

### `reports/`

Arquivar/remover campanhas encerradas e manter apenas consumidores reais.

### `scripts/`

Reduzir scripts datados e fornecedor-specific depois de confirmar que já cumpriram finalidade.

---

## P2 — documentação/configuração obsoleta

```text
GUIDE.md
RTK.md
opencode.json
scripts/build_dataset/
Panasonic.xls
```

---

## P2 — estruturas históricas de WhatsApp

```text
ops_whatsapp_events
whatsapp_alert_events
```

---

## P3

Aliases antigos e pequenos arquivos de compatibilidade sem impacto operacional.

---

# 29. Estratégia de remoção futura

Não fazer um único commit “delete old stuff”.

A ordem segura é:

```text
1. escolher um cluster
2. identificar todos os consumidores
3. confirmar que a função acabou
4. arquivar evidência necessária
5. remover comandos/referências
6. remover scripts/tests/reports
7. se houver objeto de banco:
   criar migration nova
8. rodar testes/validate
9. confirmar que nenhum fluxo operacional perdeu função
```

Exemplo:

```text
cluster ml-p0
```

deve ser tratado como uma única ação de limpeza coordenada.

---

# 30. O que NÃO fazer

Não devemos:

- apagar `scripts/` inteiro;
- apagar `reports/` inteiro;
- apagar migrations antigas;
- apagar testes antes do código que protegem;
- remover recovery scripts ainda úteis;
- remover documentação operacional atual;
- fazer rewrite de Git history automaticamente;
- manter secret exposto apenas porque pode estar antigo;
- mover tudo para um diretório `archive/` dentro do mesmo repo e chamar isso de limpeza;
- criar outro repositório sem necessidade apenas para esconder clutter;
- apagar dados de auditoria necessários.

---

# 31. Resultado do checklist — Item 15

- [x] Classificar scripts operacionais atuais.
- [x] Classificar scripts de manutenção/recovery.
- [x] Identificar scripts de uso único/campanha.
- [x] Revisar documentação antiga.
- [x] Revisar configurações de ferramentas potencialmente obsoletas.
- [x] Identificar o cluster `ml-p0-*` em scripts, testes, reports, comandos npm e banco.
- [x] Confirmar ausência de jobs `ml_p0_*` recentes além da execução concluída em 15/08/2026.
- [x] Identificar `reports/` como grande fonte de clutter não-runtime.
- [x] Identificar `GUIDE.md` como documentação antiga e com credencial administrativa versionada.
- [x] Confirmar `CLAUDE.md` como adapter atual simples.
- [x] Identificar conflito entre `RTK.md` e `AGENTS.md`.
- [x] Identificar `opencode.json` apontando para caminho inexistente.
- [x] Identificar `scripts/build_dataset/` como provável experimento histórico.
- [x] Identificar `Panasonic.xls` + importer como artefato de fornecedor/uso único.
- [x] Revisar importadores de planilha.
- [x] Confirmar docs de deploy e publicação ML como operacionais.
- [x] Classificar docs Codex/runtime como manutenção de engenharia.
- [x] Classificar guia WAHA GOWS como migração/manutenção até confirmar encerramento.
- [x] Confirmar `ops_whatsapp_events` sem atividade recente.
- [x] Confirmar `whatsapp_alert_events` vazia.
- [x] Definir que migrations aplicadas não devem ser apagadas para limpeza.
- [x] Definir remoção futura por clusters, somente após confirmar ausência de função operacional.

---

# 32. Restrições desta etapa

Nesta etapa:

- nenhum script foi removido;
- nenhum report foi removido;
- nenhuma documentação foi alterada;
- nenhuma credencial foi rotacionada;
- nenhuma migration foi criada/executada;
- nenhuma tabela foi removida;
- nenhum teste foi removido;
- nenhum comando npm foi alterado;
- nenhum histórico Git foi reescrito;
- nenhum arquivo foi arquivado;
- nenhum deploy foi realizado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise de `scripts/`, `reports/`, `docs/` e arquivos raiz;
- análise das referências em `package.json`;
- comparação com os Itens 7, 8, 9, 10 e 14;
- consultas somente leitura de jobs/eventos operacionais;
- consulta à documentação oficial do GitHub para remoção de dados sensíveis.

Nenhuma credencial ou dado sensível encontrado foi reproduzido neste documento.

---

# 33. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Repositório Vortek — branch `dev`

Analisados:

- `scripts/`
- `reports/`
- `docs/`
- `tests/`
- `package.json`
- `GUIDE.md`
- `CLAUDE.md`
- `RTK.md`
- `opencode.json`
- `skills-lock.json`
- `.agents/skills`
- `Panasonic.xls`
- `scripts/build_dataset/`

Documentos específicos:

- `docs/easypanel-deploys.md`
- `docs/mercado-livre-publicacao-operacional.md`
- `docs/policyagent-unblock-checklist.md`
- `docs/runtime-unblock-playbook.md`
- `docs/waha-gows-migration.md`

## Banco operacional — somente leitura

Consultados:

- jobs `ml_p0_*`;
- `ops_whatsapp_events`;
- `whatsapp_alert_events`.

## GitHub — documentação oficial

Removing sensitive data from a repository:

`https://docs.github.com/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository`

Delete files:

`https://docs.github.com/repositories/working-with-files/managing-files/deleting-files-in-a-repository`

---

# 34. Conclusão final do Item 15

O Item 15 confirma que o Vortek possui **bastante material removível nas bordas do repositório**, mas pouco desse material pertence ao núcleo operacional.

A maior oportunidade de limpeza é:

```text
campanhas encerradas
+
scripts one-off
+
reports gerados
+
testes específicos de campanha
+
configs de ferramentas antigas
```

A limpeza deve preservar:

```text
runtime
backups
deploy
diagnóstico
recovery
documentação operacional
testes das regras permanentes
```

O maior bloco candidato é:

```text
ml-p0-*
```

e deve ser removido como um cluster somente depois de confirmação final de encerramento.

Antes disso, existe uma ação de segurança independente e prioritária:

```text
credencial versionada em GUIDE.md
→ remover
→ rotacionar se ainda válida
→ revisar histórico
```

O **Item 15 está concluído**.

O próximo passo do checklist é o **Item 16 — Consolidar a auditoria**, onde todos os achados dos Itens 1–15 serão transformados em:

```text
manter
corrigir
simplificar
consolidar
remover
investigar mais
```

com prioridade P0–P3 e dependências.
