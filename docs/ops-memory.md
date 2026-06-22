# Memoria Operacional Vortek

Este arquivo e contexto persistente para o workflow `ops-autofix`.
Atualize quando uma regra, incidente ou decisao operacional importante mudar.

## Regras de Engenharia

- Investigar antes de corrigir: localizar fluxo, entidades, estados, jobs, webhooks e logs.
- Nao inventar regra de negocio. Se faltar dado, pedir acao humana.
- Preferir menor correcao localizada e reversivel.
- Nao criar patch se nao houver evidencia suficiente no codigo/contexto.
- Rodar `npm run typecheck` antes de criar PR.
- Se a correcao depender de credenciais, acesso externo, dados de producao ou decisao de negocio, comentar `needs_human`.

## Stack

- Next.js App Router, TypeScript strict, Ant Design.
- Supabase self-hosted. Nao usamos Supabase Cloud.
- Mercado Livre para pedidos, anuncios, envios e etiquetas.
- DSLite para pedidos de compra, fornecedores, estoque e custos.
- Brasil NFe para notas fiscais.
- WAHA para WhatsApp via QR Code.
- GitHub Issues para registro operacional.
- OpenRouter para IA.

## WhatsApp Ops

- Webhook: `/api/webhooks/waha/ops`.
- Envs criticas em producao:
  - `WAHA_OPS_WEBHOOK_SECRET`
  - `OPS_WHATSAPP_AUTHORIZED_PHONES`
  - `OPENROUTER_OPS_WHATSAPP_MODEL`
  - `GITHUB_OPS_TOKEN`
  - `GITHUB_OWNER`
  - `GITHUB_REPO`
  - `GITHUB_OPS_ERROR_LABELS`
  - `GITHUB_OPS_WORKFLOW`
  - `GITHUB_OPS_WORKFLOW_REF`
- WAHA pode enviar remetente como `@lid`, nao apenas telefone. O ID `57462518468760` corresponde ao Felipe no fluxo atual.
- O bot deve conversar naturalmente. So listar comandos se o usuario pedir ajuda/menu/comandos.
- O bot pode criar issue a partir de alerta critico ou comentar em issue existente.
- O bot precisa usar historico recente por chat para entender continuacoes como "sim", "pode" e "aprovar essa".
- Perguntas como "preciso aprovar alguma correcao?" devem consultar issues abertas reais, nao responder com orientacao generica.

## Workflow Ops Autofix

- Workflow: `.github/workflows/ops-autofix.yml`.
- Script: `scripts/ops-autofix.mjs`.
- Modelo esperado: `openai/gpt-5.5`.
- Reasoning esperado: medio (`reasoning.effort=medium`, `exclude=true`).
- O workflow deve sugerir atualizacoes de memoria quando identificar aprendizado operacional novo.
- Atualizacao de memoria deve entrar por PR em `docs/ops-memory.md`, nao direto na `main`.
- O workflow deve notificar WhatsApp quando:
  - criar PR;
  - criar PR de memoria;
  - nao criar PR e precisar de acao humana;
  - falhar;
  - solicitar mais detalhes.
- O workflow nao deve aplicar patch se a issue nao tiver informacao suficiente.

## Fluxo DSLite

- Funcao principal: criar pedido DSLite a partir de pedido de venda ML.
- Hayamax:
  - usa saldo na conta, nao PIX por pedido;
  - pode usar etiqueta generica quando etiqueta real ML ainda nao liberou;
  - depois, quando etiqueta real liberar, subir XML no ML, baixar etiqueta real e enviar por WhatsApp para Hayamax.
- Fornecedores pre-pagos:
  - precisam PIX do custo do produto;
  - modal deve mostrar valor PIX e chave PIX;
  - comprovante deve ser anexado no proprio fluxo quando possivel;
  - WhatsApp para fornecedor deve incluir dados do pedido, comprovante e data prevista/liberacao de etiqueta;
  - nao usar etiqueta generica para fornecedor que nao seja Hayamax.
- Se etiqueta ML nao estiver pronta, pedido pode seguir sem etiqueta real quando regra do fornecedor permitir; depois deve haver retomada para completar etiqueta.

## Mercado Livre

- Nunca aceitar token de conta diferente da Vortek.
- Se aparecer usuario Rodrigo Vitorio ou outro vendedor, tratar como incidente de autenticacao.
- Tokens ML devem ser validados pelo seller correto antes de operar.
- Erros esperados de etiqueta:
  - shipment pending / not printable significa etiqueta ainda nao liberada.
  - nao tratar como erro critico quando for estado operacional esperado.

## Etiquetas, NF e Arquivos

- Etiquetas devem ser salvas em storage self-hosted.
- Links publicos usados no WhatsApp devem apontar para `https://app.vortek.shop`, nao diretamente para storage/supabase.
- DANFE e XML precisam ter links publicos quando enviados a fornecedor.
- Mensagens WhatsApp devem ser limpas, agrupadas por tipo e com links importantes em destaque.

## Catalogo e Anuncios

- Nunca preencher atributos no chute.
- Primeiro buscar dados na DSLite. Se nao existir e for necessario, pesquisar marca/modelo exatos na internet.
- Nao criar anuncios sem estoque.
- Se Mercado Livre publicar anuncio como "combinar com vendedor", pausar se nao for operacionalmente aceito.
- Nova Center pode ficar com estoque zerado na DSLite; confirmar antes de criar anuncios.

## Incidentes Recentes e Aprendizados

- Reanalise de preco deu URI too long por query grande; corrigido com chunking.
- WAHA webhook quebrou depois de deploy porque envs nao estavam persistidas no registro real do Easypanel/LMDB.
- Env do Easypanel nao basta estar no Docker service; precisa estar no registro persistente do Easypanel.
- GitHub Ops precisa de `GITHUB_OPS_WORKFLOW=ops-autofix.yml` para aprovacoes dispararem workflow.
- OpenRouter no WhatsApp deve usar modelo barato/rapido; autofix deve usar modelo forte.

## Fontes Oficiais a Consultar

- GitHub Actions/REST: https://docs.github.com/actions e https://docs.github.com/rest
- OpenRouter: https://openrouter.ai/docs
- Mercado Livre: https://developers.mercadolivre.com.br
- DSLite: https://documenter.getpostman.com/view/5316990/RWaRNkaA
- Supabase: https://supabase.com/docs
