# BNT-REL-EARLY-01 — preparação do corte inicial restrito

Data: 09/09/2026  
Branch: `dev`  
Base verificada antes da mudança: `14f0c6616884f0533f539b2e934c99437e5936b8`, igual a `origin/dev`

## Decisão aplicada

O responsável determinou entrada imediata do núcleo Bentevi e continuidade das
validações com o sistema publicado. Assistente, criação de anúncios e alteração
de preços no Mercado Livre não integram o primeiro corte. Essas capacidades
permanecem bloqueadas por configuração e voltam à fila depois da entrada em
produção.

Continuam obrigatórios para o corte: dados reais da `.160` migrados para a
`.162`, preservação de Auth/Storage, backup, ambiente fiscal produtivo,
autenticação, um único executor por fluxo, smoke e recuperação.

## Implementação DEV

- `scripts/check-bentevi-prod-env.js` valida um arquivo privado sem imprimir
  seus valores. Ele exige `https://app.bentevi.shop`,
  `https://supabase.bentevi.shop`, runtime `production`, serviço Supabase na
  `.162`, Brasil NFe em ambiente `1`, Assistente bloqueado e
  `ML_PRICING_EXECUTION_MODE=disabled`.
- `npm run release:check-prod-env -- --env-file=<arquivo-privado>` expõe somente
  um resumo sanitizado e encerra com erro diante de destino legado, loopback,
  placeholder, flag divergente ou variável obrigatória ausente.
- `docs/bentevi-prod-cutover.md` fixa backup, ensaio, carga por dependências,
  Auth/Storage, exclusão de fixtures, pausa de writers legados, smoke e
  condições de interrupção.
- O checklist e a matriz de paridade deixaram de classificar Assistente e as
  quatro lacunas de criação de anúncios como bloqueadores do núcleo restrito.
  Elas continuam bloqueadoras antes de habilitar seus respectivos writers.

## Estado observado

- A `.162` foi consultada somente em leitura pela API já configurada. A amostra
  atual possui 6 produtos, 100 pedidos, 92 clientes, 5 fornecedores, 85 compras,
  1 perfil e zero anúncios; portanto não substitui a carga dos dados reais.
- Não há credencial PostgreSQL produtiva nem sessão administrativa válida do
  Easypanel neste workspace. Tentativas SSH não autenticaram. Nenhuma credencial
  foi improvisada ou solicitada ao ambiente DEV.
- O serviço `local/bentevi-prod` continua apenas reservado/desabilitado e a
  configuração privada local de deploy continua destinada exclusivamente a
  `dev`/`vortek-erp-dev`.

## Validação

- `node --test tests/bentevi-prod-env.test.js`: 4/4 aprovados;
- `node --test tests/assistant-chat.test.js`: 34/34 aprovados;
- suíte integral `node --test tests/*.test.js`: 1.315 coletados, 1.312 aprovados,
  zero falhas e três casos LIVE explicitamente ignorados;
- `npm run validate`: aprovado;
- `npm run build`: aprovado com Next.js 16.3.3 e 127 páginas/rotas;
- `npm run check:build-secrets`: aprovado;
- `git diff --check`: aprovado antes do fechamento documental.

Nenhum teste LIVE, migração, carga, exclusão, conexão mutante, branch produtiva,
push, deploy, domínio, webhook, job ou writer externo foi executado.

## Próxima ação produtiva

Em tarefa/workspace produtivos, obter acesso somente leitura atual à `.160`,
capturar os dois schemas, fazer os backups e executar o ensaio repetível de
migração para a `.162`. Somente depois do ensaio aprovado: fixar o SHA final de
`dev`, criar `bentevi-prod`, configurar o serviço reservado e executar a janela
de corte descrita no runbook.
