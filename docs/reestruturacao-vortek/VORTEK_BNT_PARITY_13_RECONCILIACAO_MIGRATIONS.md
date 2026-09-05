# BNT-PARITY-13 — Reconciliação do histórico de migrations

**Data:** 05/09/2026. **Resultado:** reconciliação documental e comparador validados; **não autoriza promoção nem replay**.

## 1. Evidência e escopo

Inventários completos, hashes dos arquivos, fingerprints dos registros, efeitos inspecionados, 91 classificações de revisão e verificação antes/depois:

[`reports/bnt-parity-13/reconciliation-2026-09-05.json`](../../reports/bnt-parity-13/reconciliation-2026-09-05.json).

| Referência | DEV | Produção |
| --- | --- | --- |
| Host consultado | `192.168.1.162` | `192.168.1.160` |
| PostgreSQL | 17.6 | 15.8 |
| SHA Git de referência | `db0c24a495ecf82026d40002dcdb655af0f8c647` | `b6e1b17eba58f0ec80a3d16357ac7ab2409f56de` |
| Arquivos de migrations | 109 | 89 |
| Registros no banco | 109 | 87 |
| Captura UTC | 15:00:49 | 15:00:49 |
| Verificação UTC | 15:03:57 | 15:03:56 |
| Registro e metadados de schema inspecionados inalterados | sim | sim |

O SHA produtivo acima identifica o objeto Git de `origin/main`, reconfirmado com `git ls-remote`; não representa nova certificação do SHA implantado. Não foi usado o worktree `vortek-prod`.

As consultas usaram `default_transaction_read_only=on` e transações `REPEATABLE READ READ ONLY`, encerradas com `ROLLBACK`. Não houve DDL, DML, RPC operacional, acesso a linhas de negócio, migration, mudança de configuração ou escrita no registro de migrations. Configuração autorizada foi usada somente em memória, sem reproduzir credenciais.

## 2. Resultado da comparação

- **DEV local × registro DEV:** igualdade de versões e nomes, não prova de igualdade de SQL.
- **Arquivos DEV × arquivos main:** 85 iguais em bytes, 2 diferentes, 22 exclusivos DEV e 2 exclusivos main.
- **Registro DEV × registro produção:** 46 fingerprints iguais, 9 diferentes, 30 indisponíveis, 24 exclusivos DEV e 2 exclusivos produção.
- **main × registro produção:** faltam no registro `20260729182648` e `20260729213737`; nomes divergem em `00008`, `20260709120000` e `20260709121500`.

`file_sha256` é SHA-256 dos bytes do arquivo. `statements_md5` é MD5 da representação PostgreSQL `statements::text`, apenas quando o array não está vazio. São formatos distintos: **não compará-los entre si**. Nem mesmo fingerprints iguais comprovam o estado atual do schema. Arrays preenchidos podem conter apenas notas históricas, não SQL executável.

O fingerprint `catalog_md5` é calculado sobre as categorias estruturais do coletor DB-03, excluindo server, roles e migration_registry; estes últimos registros são comparados separadamente. Ele não é hash de dados de negócio nem certificação de todo o banco. Os corpos SQL não integram o relatório.

## 3. Mapa de tratamento

As classificações abaixo indicam o **destino da divergência**, não uma autorização para alterar o registro. A evidência JSON liga cada linha que exige revisão a um tratamento explícito; nenhuma linha desconhecida pode ser aceita automaticamente em captura futura.

| Versão / grupo | Evidência e classificação | Tratamento |
| --- | --- | --- |
| `00001` | SQL inicial diferente: DEV inclui `brasilnfe` no enum e índice único de integrações. Ambos os efeitos existem hoje nos dois bancos; `00013` e `20260525144254` também os estabelecem. `EQUIVALENTE` apenas para esses efeitos. | Preservar os bootstraps diferentes; não editar nem reaplicar. |
| `00008` | Registro produtivo trata `ml_buyer_id`; DEV trata tracking. Não é simples renomeação. `ml_buyer_id` não existe hoje em nenhum dos dois bancos, nem possui consumidor em `src` DEV; tracking existe e também está em `00009`. `NÃO COPIAR`. | Não recriar coluna sem consumidor, não renomear o registro e não reaplicar `00008`. A causa histórica da ausência da coluna não foi reconstruída. |
| `20260709120000` / `20260709121500` | Produção tem nomes nulos e nenhum comando registrado. `pedidos.dslite_label_source` existe nos dois bancos. `NÃO COPIAR` o registro/backfill. | Preservar lacuna histórica. Estrutura confirmada não comprova execução nem resultado do backfill; não repeti-lo para alinhar histórico. |
| `20260729182648` / `20260729213737` | Arquivos existem em ambas as branches; versões não constam em produção. Colunas de kit, estorno e índice de saídas ativas estão presentes. `EQUIVALENTE` somente para os objetos verificados. | Não fabricar registros aplicados. View e funções finais devem ser confrontadas no delta de promoção; não reaplicar a view histórica de kits. |
| `20260830143000` | Produção: `internal_purchase_stock_origin`; DEV: `atomic_internal_stock_reservation`. Conteúdos e efeitos distintos. Modelo antigo de compra `SUBSTITUÍDA` pelo BNT-D05. | Preservar ambas as identidades históricas. Reserva, despacho e estorno DEV exigem delta próprio para promoção, descrito abaixo. |
| `20260801223553` / `20260801232600` | Registros diferem em formatação, separação dos comandos e comentário de jobs; arquivos DEV/main iguais. `NÃO COPIAR` a representação do registro. | Não normalizar o histórico. Confrontar os objetos finais na promoção. |
| `20260802000117`, `20260803231103`, `20260804001421`, `20260804164839`, `20260804192052` | Registros produtivos contêm descrições textuais no lugar do SQL; arquivos DEV/main iguais. `NÃO COPIAR`. | Não considerar notas como prova executável e não repetir reparos de dados, enfileiramento ou cron históricos. |
| Comparações com conteúdo indisponível (30 ao todo, incluindo casos acima) | Ausência de comandos em um ou ambos registros não prova divergência funcional. `NÃO COPIAR` histórico incompleto. | Preservar registros; confronto de objetos finais obrigatório no delta. As versões são individualizadas no JSON. |
| `20260903183000` | Reativação produtiva de produtos. `NÃO COPIAR`, conforme BNT-PARITY-01. | Não repetir backfill que altere a atividade manual de produtos DEV. |
| `20260904041000` / `20260905120000` | `concretizada_ml` existe nos dois bancos. DEV incorporou o contrato por migration nova em BNT-PARITY-07. `EQUIVALENTE`. | Manter versões distintas, sem copiar registro produtivo. |
| Demais evoluções exclusivas DEV | Evoluções já existentes na nova versão. `INCORPORAR` refere-se ao destino futuro em produção, não a trabalho funcional pendente no DEV. | Inventariadas; promover objetos finais por delta ensaiado, não por replay da lista de arquivos. |

### Colisão do estoque: dependências bloqueadoras

Em produção existem `origem_entrada`, `custo_unitario` e a assinatura antiga `select_order_fulfillment(uuid,text)`. Não existem `estado_envio_interno`, `despachado_em` nem as RPCs de despacho e estorno da reserva.

DEV possui essas colunas, `select_order_fulfillment(uuid,text,jsonb)`, `dispatch_internal_stock_reservation(uuid)` e `reverse_internal_stock_commitment(uuid,text)`, além das relações de recebimento e idempotência do BNT-D05. A migration de estoque próprio `20260901190000` já depende de `estado_envio_interno`.

Consequência: ignorar a versão colidente porque está registrada em produção deixa pré-requisitos ausentes. Adicionar apenas uma migration corretiva ao final de um replay também não resolve a ordem: migrations anteriores já dependem desses objetos.

**Pendência bloqueadora de release — DELTA_PROMOCAO:**

1. Atualizar a fotografia produtiva e fixar os SHAs da promoção autorizada.
2. Preparar migrations novas para o delta real entre o schema produtivo e o schema final aprovado, sem reutilizar versões aplicadas nem reproduzir estados intermediários obsoletos.
3. Estabelecer os pré-requisitos de reserva antes dos consumidores BNT-D05; portar as definições finais e grants apropriados, não sobrescrever funções novas com corpos antigos.
4. Definir a transição auditável dos movimentos de compra antigos, preservando sua origem, custo e histórico. Não apagar esses dados nem inventar NF-e para encaixá-los no novo modelo.
5. Ensaiar em ambiente isolado no `.162`, sem alterar os dados operacionais do DEV e sem acesso de escrita à produção. Testar dependências, saldos, idempotência e rollback; nunca usar restauração/reset do DEV atual como atalho.
6. Revalidar `BNT-PARITY-FINAL`. Eventual aplicação produtiva exige autorização própria e execução pelo workspace dedicado.

Essa pendência **não foi executada nem homologada nesta ação**. Não há migration artificial para fazer históricos parecerem iguais.

## 4. Comparador e reprodução

O coletor existente `scripts/capture-db-03-snapshot.js` passa a produzir formato 3, mantendo a leitura dos snapshots históricos de formato 2 nos testes:

- inventário local com hash dos arquivos e registro com contagem/fingerprint, sem comandos brutos;
- versões duplicadas rejeitadas antes de construir mapas;
- `migrationComparison`: contrato explícito `version_and_name_only`, com `content_equivalence=not_established`;
- `migrationContentComparison`: compara arquivos entre branches ou registros entre bancos, nunca formatos cruzados;
- estados `matching`, `different`, `unavailable`, `left_only`, `right_only`; `requires_review` também cobre mudança de nome, inclusive nome nulo;
- bloqueio de saída dos campos `statements`, `rollback` e `raw_sql`, além dos campos sensíveis já proibidos.

Para repetir a análise, usar as consultas exportadas por `SNAPSHOT_QUERIES` em sessões somente leitura e os inventários Git de SHAs fixados, sem trocar de branch. Para arquivos main, ler os bytes por `git show <SHA>:<arquivo>`; para DEV, usar `repositoryMigrations`. Comparar com os helpers exportados. Os quatro conjuntos completos e os resultados estão no JSON para reprodução offline pelos testes. Evidências antigas são preservadas; capturas novas não substituem classificações sem revisão.

Uma correspondência de nome/versão ou de fingerprint nunca libera release. O comparador apenas detecta e sinaliza; não escreve no banco nem executa `repair`, `push`, `reset`, `squash` ou migrations.

## 5. Validação, rollback e continuidade

Passaram **21 testes direcionados** em `npm run test:db-schema-snapshot`, cobrindo colisão, nome igual com conteúdo diferente, nome nulo, comandos ausentes, versões duplicadas, exclusivas, determinismo, formatos incompatíveis, sanitização, rollback de coleta e integridade da evidência. `npm run validate` (lint e typecheck) e `git diff --check` também passaram.

Os históricos locais e `AGENTS.md` permanecem inalterados. Capturas antes/depois confirmaram registro e metadados estruturais inspecionados inalterados nos dois bancos. Build, geração de tipos, homologação web e deploy não se aplicam.

Rollback desta ação: reverter somente o commit de script, testes e documentação; nada a desfazer nos bancos. Preservar a evidência histórica da colisão.

`BNT-PARITY-13` conclui o **mapeamento e sua verificação**, não a transição produtiva. Permanecem pendentes a decisão `BNT-PARITY-DEC-01`, o delta de pricing registrado no catálogo e os gates de sequência/release. Não avançar automaticamente para `BNT-CFG-07`.

## 6. Fontes oficiais verificadas

- [Supabase — migration list e repair](https://supabase.com/docs/reference/cli/supabase-migration-list): comparação por timestamp; repair altera o registro, não reconcilia por si só o schema.
- [PostgreSQL 17 — SET TRANSACTION](https://www.postgresql.org/docs/17/sql-set-transaction.html): transações somente leitura e fotografia consistente em repeatable read.
- [PostgreSQL 17 — arrays](https://www.postgresql.org/docs/17/functions-array.html) e [strings](https://www.postgresql.org/docs/17/functions-string.html): contagem com cardinality e fingerprint textual MD5.
