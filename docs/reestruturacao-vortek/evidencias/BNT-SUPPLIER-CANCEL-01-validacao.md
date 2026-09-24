# BNT-SUPPLIER-CANCEL-01 — aviso ao fornecedor após cancelamento da venda

Em 24/09/2026, o fluxo existente foi confirmado como restrito a vendas com compra DSLite e NF-e emitida. A leitura somente leitura da produção Bentevi `.162` encontrou uma venda cancelada com compra Evolusom direta ainda em estado `Faturado`, sem etiqueta entregue nem rastreio registrado. Esse caso histórico exige revisão operacional individual; não pertence ao novo envio automático.

## Mudança publicada

- Migration aditiva registra apenas transições futuras para `cancelado` em uma fila privada. Não faz backfill de vendas anteriores.
- O executor já agendado envia o aviso antes do tratamento fiscal, confirma vínculo DSLite ou Evolusom e, para a Evolusom, usa o contato principal e o adicional configurado para etiquetas oficiais. Falhas são retomadas por destinatário com o mesmo ID de mensagem.
- O texto não afirma que a compra ou a NF-e foi cancelada. Compras compartilhadas com vendas ativas recebem orientação de conferir os itens, sem bloquear a compra inteira.
- Amostras protegidas de homologação e vínculos ambíguos não geram envio. O código anterior de envio pós-NF é removido; um registro de envio DSLite feito entre migration e deploy impede duplicação na fila nova.

## Validação e limite

Passaram 32 testes direcionados de mensagem, cancelamento, amostra protegida e fluxo de vendas; `npm run validate`, `npm run build`, `npm run check:build-secrets` e `git diff --check`. Nenhuma mensagem real foi enviada por estes testes.

O SHA funcional `b1e517bc34aeda638e0267f8527f214f432b8f6a` foi enviado a `origin/dev` e promovido por fast-forward a `origin/bentevi-prod`. O banco foi acessado pela API administrativa protegida do Supabase em `192.168.1.162`, com a chave de serviço privada local. O preflight confirmou PostgreSQL 17.6, banco `postgres`, a migration anterior `20260924120000`, a ausência dos objetos novos e o enum `cancelado`. A migration `20260924180000` (SHA-256 `e084524cffc1fa526dd22be822ab07889e44a98fab419c9574be3ed37ce11c1a`) foi aplicada em uma transação curta com limites de lock e tempo, e registrada no ledger. O read-back confirmou tabela vazia, RLS ativa, grant de serviço, ausência de leitura anônima, função com privilégio restrito e gatilho ativo em `pedidos`.

O webhook do serviço `local/bentevi-prod` aceitou o deploy com HTTP 200. O processo produtivo reiniciou e a primeira execução posterior de `sync_ml_cancelamentos_pos_nfe`, às `2026-09-24 19:32:47 UTC`, terminou `completo` e `success=true`. Seu resultado contém o campo novo `supplier_notices` com `seen=0`, `sent=0`, `failed=0`, `blocked=0` e `skipped=0`, comprovando que o código novo executou sem disparar envio histórico. Health e login responderam HTTP 200 e a rota de cancelamento recusou chamada anônima com 401, pelo proxy privado da `.160` com o host da aplicação. O DNS público de `app.bentevi.shop` não resolveu neste ambiente durante o smoke, e o painel Easypanel não estava acessível para ler diretamente o SHA da imagem ativa; a branch remota e a execução do campo novo foram confirmadas separadamente.

A venda Evolusom cancelada antes da migration permanece para revisão operacional manual. Nenhuma mensagem retroativa foi enviada. A recuperação técnica, se necessária, começa por desabilitar o executor de avisos; o gatilho pode ser retirado por migration corretiva sem apagar os registros de auditoria.
