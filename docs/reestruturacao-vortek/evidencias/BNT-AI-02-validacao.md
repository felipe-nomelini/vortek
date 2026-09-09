# BNT-AI-02 — Interface e histórico

**Data:** 08/09/2026. **Branch:** `dev`. **Estado:** implementação e validação local concluídas; ativação/publicação DEV e homologação do chat com modelo real pendentes.

## Mudança e evidência

AI-01 entregara consultas tipadas, mas não havia chat, histórico ou transporte do Assistente. Agora `/assistente` reutiliza shell/Ant Design Bentevi, com histórico privado lateral, nova conversa, busca, renomeação, exclusão, fases de progresso, cancelamento e fontes em Drawer. O menu aparece após Dashboard somente para o piloto autorizado.

O backend usa exclusivamente consultas AI-01 e o modelo escolhido `gpt-6-astra/low` por assinatura ChatGPT. Planejador limitado a três consultas, até duas inferências por pergunta, contexto de oito pares/24 mil caracteres e deadline de 120 segundos. Valores numéricos e referências são validados/resolvidos no servidor. Nenhuma operação comercial foi criada; regras de pricing, estoque, fiscal e publicação não foram modificadas.

O protocolo Codex foi extraído do piloto de garantia para transporte compartilhado, mantendo perfis/contextos e validação de domínio separados. Regressões do extrator passaram. Os consumidores OpenRouter existentes não foram alterados.

Persistência em duas tabelas, RLS de propriedade/admin, escrita somente pelo servidor e claim atômico com lease por usuário. Reenvio idêntico não repete inferência; cancelamento/timeout impedem persistência tardia. Exclusão ativa é recusada até interrupção/encerramento. Histórico mantido até exclusão pelo usuário, sem job de expurgo e sem promessa de exclusão do provedor/backups.

## Validações executadas

| Prova | Resultado |
|---|---|
| `node --test tests/assistant-chat.test.js tests/assistant-knowledge.test.js tests/warranty-codex.test.js tests/product-warranty.test.js` | 138 aprovados, zero falhas, 2 LIVE de garantia ignorados explicitamente |
| `npm run validate` | Lint e typecheck aprovados |
| `npm run build` | Aprovado; 127 páginas estáticas, rotas do Assistente incluídas; não é deploy |
| `tests/assistant-history.sql` no DEV | Ensaio com rollback e reconferência após aplicação aprovados |
| Smoke HTTP com build local e Auth/Supabase DEV reais | Status, criar, renomear, listar/buscar, abrir e excluir aprovados; anônimo 401; ausência do login Codex recusa inferência sem gravar mensagem |
| Chromium local 1440×1000, respostas de chat sintéticas/interceptadas | Bloqueio sem login, sugestão, envio NDJSON, fontes, renomear, reabrir, recolher histórico e excluir aprovados; zero `pageerror` |

A suíte cobre entrada estrita, fontes/valores inventados, metadados, documentos vigentes no limite de payload, conteúdo privado identificável, destino `.160` recusado, piloto/admin atuais, acesso cruzado, contexto limitado, duas abas, cancelamento, revogação, timeout com provedor não cooperativo, dedupe e erros/cotas do transporte. Interceptações de modelo/rede são sintéticas: não comprovam a qualidade semântica de respostas reais.

Durante o smoke local, o primeiro POST evidenciou divergência entre Origin público e URL interna reconstruída pelo Next. A checagem foi corrigida para aceitar a origem canônica DEV e loopback local com Host correspondente; origem externa e produção continuam recusadas. Regressão incluída. O empacotamento documental passou a manter caminho-raiz estático e verificação de `realpath`, eliminando os avisos de tracing amplo no build final.

## Banco e configuração

- Preflight confirmou destino TCP **192.168.1.162**, hostname **supabase-dev**, PostgreSQL 17.6 e histórico/schema da mesma conexão antes das escritas.
- Migration nova `20260908190000_assistant_history.sql` ensaiada com rollback, aplicada e registrada em `supabase_migrations.schema_migrations`. Migration histórica não foi reescrita.
- SQL testou RLS do dono, outro administrador, papel revogado, anon, escrita/RPC diretas recusadas, reenvio, concorrência, cancelamento, timeout, exclusão em cascata e resultado tardio após exclusão. Fixtures sintéticas ficaram em transação desfeita.
- Tipos das duas tabelas atualizados pelas colunas efetivas consultadas no DEV, preservando os demais tipos; assinaturas das três RPCs alinhadas à migration. Não foi executada regeneração completa do schema.
- Smoke usou sessão Auth DEV por OTP oficial, sem alterar senha ou enviar e-mail. Sessão local encerrada e conversa sintética criada pelo teste removida via API. Nenhum histórico real removido.
- `.env.local` permanece ignorado. Guard individual configurado localmente. Perfil `/home/felipe/.config/vortek-dev/assistant-codex` criado com diretórios `700` e `config.toml` `600`, workspace vazio, sem copiar credenciais. Não há login ChatGPT neste novo perfil.
- `BENTEVI_ASSISTANT_DATA_APPROVED=0` preservado. Nenhum dado operacional foi enviado à OpenAI nesta tarefa. Codex local reconfirmado como `0.153.4`; instalação versionada preparada no Nixpacks, não executada no Easypanel.
- **Produção `.160` não foi acessada.** Nenhum endpoint ML, fiscal, fornecedor ou serviço de operação foi executado.

## Evidência visual local

As capturas abaixo usam conteúdo claramente sintético, não respostas de um modelo real e não dados financeiros da empresa. Comprovam renderização/interações locais, não publicação ou aceite do usuário.

- [Conversa e histórico](BNT-AI-02-conversa.png).
- [Fontes, cobertura e período](BNT-AI-02-fontes.png).

<a id="pendencias-para-o-teste-de-felipe"></a>

## Pendências para o teste de Felipe

1. Conectar o titular pelo login oficial no **perfil exclusivo do Assistente**, sem copiar a sessão de engenharia ou assumir a autenticação do perfil de garantia. Em publicação DEV autorizada, provisionar diretório persistente privado no serviço `vortek-erp-dev`; nunca no Supabase de produção.
2. Confirmar os controles de dados aplicáveis à conta descritos na [seção 3 do contrato](../VORTEK_BENTEVI_ASSISTENTE_CONTRATO.md#3-provedor-e-limites) antes de habilitar `BENTEVI_ASSISTANT_DATA_APPROVED`. A existência da assinatura não comprova esses controles. Primeiro executar uma pergunta sintética com o perfil real, validando conta/modelo/cota.
3. Fazer commit/push/deploy **quando autorizados**, conferir Codex/documentos/perfil persistente e executar smoke autenticado em `https://dev.bentevi.shop/assistente`, incluindo consulta canônica real sem mutações. Só então fornecer roteiro de teste visual e avançar ao AI-GATE.

Não foi executado LIVE de inferência do chat. A prova anterior de `gpt-6-astra` no extrator de garantia permanece histórica; não equivale à validação deste perfil/hospedagem. Precisão semântica, uso efetivo de cota, reconexão/renovação e comportamento multi-instância em hospedagem ainda exigem homologação. A UI classifica limite atingido, mas ainda não apresenta uma data específica de renovação da cota. A retenção pessoal é limitada pelo contrato do provedor; exclusão no ERP não a redefine.

## Referências e decisões

Foram usados o guia local do Next 16.3.3 para Route Handlers/NextRequest e a implementação instalada para confirmar URL interna; componentes de [Ant Design 5](https://5x.ant.design/components/drawer/) e [Typography](https://5x.ant.design/components/typography/); [App Server](https://learn.chatgpt.com/docs/app-server) e [autenticação Codex](https://learn.chatgpt.com/docs/auth); [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [locks transacionais PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS); [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) e [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp) para o smoke Auth; [Playwright — network](https://playwright.dev/docs/network) para a separação explícita da prova sintética; e [Nixpacks — configuração](https://nixpacks.com/docs/configuration/file) para preparar o runtime.

As skills de implementação DEV, Supabase/Postgres e documentação OpenAI orientaram o isolamento, os testes de propriedade e o reaproveitamento do transporte oficial. O mapa vigente do AGENTS prevaleceu sobre o endereço antigo da skill Supabase: somente `.162` recebeu escritas.

## Git e rollback

HEAD preservado em `5c7f28a1a6132618c724078b040e6b1b6877ebf9`. Sem commit, push, deploy ou alteração de `AGENTS.md`. Mudanças preexistentes AI-00/AI-01 e de outras tarefas preservadas, sem staging.

Rollback inicial: desabilitar `BENTEVI_ASSISTANT_ENABLED` e manter inferência bloqueada; reverter apenas alterações desta ação, preservando AI-01 e extrator de garantia. Não apagar tabelas com histórico real automaticamente. Se for necessário desfazer schema, usar nova migration autorizada somente no `.162`, após exportar/avaliar o histórico e ensaiar rollback. Credencial do perfil exclusivo deve ser desconectada pelo fluxo oficial; nunca removida junto à sessão de engenharia. Produção permanece fora do escopo.
