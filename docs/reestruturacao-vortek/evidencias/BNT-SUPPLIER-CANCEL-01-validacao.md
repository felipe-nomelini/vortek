# BNT-SUPPLIER-CANCEL-01 — aviso ao fornecedor após cancelamento da venda

Em 24/09/2026, o fluxo existente foi confirmado como restrito a vendas com compra DSLite e NF-e emitida. A leitura somente leitura da produção Bentevi `.162` encontrou uma venda cancelada com compra Evolusom direta ainda em estado `Faturado`, sem etiqueta entregue nem rastreio registrado. Esse caso histórico exige revisão operacional individual; não pertence ao novo envio automático.

## Mudança preparada em `dev`

- Migration aditiva registra apenas transições futuras para `cancelado` em uma fila privada. Não faz backfill de vendas anteriores.
- O executor já agendado envia o aviso antes do tratamento fiscal, confirma vínculo DSLite ou Evolusom e, para a Evolusom, usa o contato principal e o adicional configurado para etiquetas oficiais. Falhas são retomadas por destinatário com o mesmo ID de mensagem.
- O texto não afirma que a compra ou a NF-e foi cancelada. Compras compartilhadas com vendas ativas recebem orientação de conferir os itens, sem bloquear a compra inteira.
- Amostras protegidas de homologação e vínculos ambíguos não geram envio. O código anterior de envio pós-NF é removido; um registro de envio DSLite feito entre migration e deploy impede duplicação na fila nova.

## Validação e limite

Passaram 32 testes direcionados de mensagem, cancelamento, amostra protegida e fluxo de vendas; `npm run validate`, `npm run build`, `npm run check:build-secrets` e `git diff --check`. Nenhuma mensagem real foi enviada por estes testes.

**Produção ainda pendente:** a configuração local autorizada permite leitura da API Supabase `.162`, mas não contém uma conexão PostgreSQL nem chave SSH autenticada. A migration não foi aplicada, e o código não deve ser publicado antes do preflight de schema/histórico, aplicação transacional e read-back. Depois disso, promover o SHA validado de `dev`, publicar pelo webhook de `local/bentevi-prod` e conferir o processo e a fila. Não usar o Supabase legado `.160` nem disparar a venda histórica automaticamente.
