# Corte produtivo inicial do Bentevi

Este runbook executa a decisão de entrada antecipada do Bentevi. O primeiro
release opera o núcleo existente enquanto Assistente, criação de anúncios e
alteração de preços no Mercado Livre permanecem bloqueados. Ele não autoriza
ações produtivas a partir do repositório DEV: o corte ocorre em tarefa e
workspace produtivos, com a `.160` somente para leitura e exportação.

## Snapshot e configuração

- Candidato inicial: branch `bentevi-prod` criada diretamente do SHA aprovado de
  `dev`, sem merge, rebase ou cherry-pick com a `main` legada.
- Serviço: `local/bentevi-prod`, atualmente reservado e desabilitado no
  Easypanel.
- Aplicação: `https://app.bentevi.shop`.
- Banco Bentevi: stack self-hosted em `192.168.1.162`, reclassificada como
  produção somente durante o corte.
- Origem dos dados reais: stack legada em `192.168.1.160`, sempre somente
  leitura neste processo.

O arquivo privado de variáveis produtivas deve permanecer fora do Git. Antes de
configurar o Easypanel, validá-lo sem exibir valores:

```bash
npm run release:check-prod-env -- --env-file=/caminho/privado/bentevi-prod.env
```

O preflight exige runtime `production`, domínio canônico, serviço Supabase na
`.162`, Brasil NFe em ambiente `1`, Assistente bloqueado e
`ML_PRICING_EXECUTION_MODE=disabled`.

## Ensaio obrigatório

1. Capturar snapshots estruturais atuais dos dois bancos em transações somente
   leitura e comparar tabelas, colunas, constraints, RLS, grants, funções e
   registro de migrations.
2. Fazer backups verificados e separados da `.160` e da `.162`, incluindo
   PostgreSQL, Auth e objetos do Storage. Guardar hashes e manifestos fora do
   repositório.
3. Preservar o schema Bentevi já validado na `.162`. Não restaurar o schema
   legado sobre ele e não reproduzir todo o diretório de migrations.
4. Preparar carga de dados por tabela, em ordem de dependências, usando `COPY`
   em lotes e apenas colunas compatíveis explicitamente mapeadas. Ausência de
   coluna obrigatória, conflito de chave ou tipo divergente interrompe o ensaio.
5. Migrar Auth/identidades e Storage/objetos como conjuntos próprios. Login e
   arquivos precisam ser comprovados; contagem de linhas em `public` não os
   substitui.
6. Excluir da carga fixtures de homologação, jobs em execução, locks, filas
   transitórias e segredos sintéticos. Preservar pedidos, eventos fiscais,
   auditorias, vínculos, tokens operacionais e histórico financeiro reais.
7. Validar contagens, chaves estrangeiras, unicidade, sequências, objetos de
   Storage e login. Rodar `ANALYZE` depois da carga, fora da transação de cópia.

O ensaio acontece enquanto a `.162` ainda é DEV e somente após o preflight do
`AGENTS.md`. Se a origem atual da `.160` não puder ser acessada em modo somente
leitura, a migração não começa.

## Janela de corte

1. Confirmar backups e resultado do ensaio; registrar os SHAs de `main`, `dev` e
   do candidato `bentevi-prod`.
2. Pausar jobs e writers legados. A interface antiga pode permanecer disponível
   como consulta, mas não pode disputar webhooks, filas ou efeitos externos.
3. Exportar o delta final da `.160` em modo somente leitura e repetir a carga
   ensaiada na `.162`.
4. Reconciliar contagens e vínculos críticos antes de aceitar tráfego.
5. Reclassificar formalmente a `.162` como produção Bentevi e atualizar o mapa
   de ambientes; a partir desse ponto ela não recebe mais escritas do workspace
   DEV.
6. Configurar source, branch, build, porta, variáveis e domínio no serviço
   `local/bentevi-prod`; executar o deploy pelo webhook oficial do próprio
   serviço.
7. Confirmar build, rollout, logs, `/login`, `/api/ops/health` e autenticação.
8. Trocar callbacks/webhooks necessários somente depois do smoke seguro.
9. Validar dashboard, pedidos, produtos, clientes, compras, estoque e fiscal. A
   primeira operação real passa por acompanhamento e read-back.

## Interrupção e recuperação

- Antes da troca de webhooks, falha de schema, carga, login, build ou smoke
  mantém o legado como executor e o serviço novo sem tráfego.
- Depois de receber eventos reais, não restaurar cegamente um backup anterior:
  preservar os novos pedidos/eventos, interromper somente o fluxo afetado e
  reconciliar ou corrigir para frente.
- Criação de anúncio, alteração de preço e Assistente continuam indisponíveis no
  primeiro release. Habilitá-los exige ação posterior, validação própria e novo
  snapshot promovido de `dev`.
- Desenvolvimento continua em `dev`; produção recebe snapshots explícitos em
  `bentevi-prod`, sem desenvolvimento direto no container ou na branch legada.
