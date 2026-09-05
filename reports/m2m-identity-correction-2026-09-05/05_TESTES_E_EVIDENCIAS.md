# Validação executada

- `npm run test:m2m-pricing-radar`: 92/92 passaram; inclui pricing canônico, precedência viva, conflitos, kits, readback e equivalências.
- `npm run validate`: lint e TypeScript sem erro.
- `npm run build`: concluído.
- `git diff --check`: sem erro.
- Deploy oficial Easypanel: webhook HTTP 200; checkout `a31cd43`, bundle v2.1 e build ID conferidos. `/api/radar` sem autenticação = 401; `/radar` = 307. Não foi alegado teste visual autenticado.
- Banco: 65 registros, versão v2.1, 65 eventos, job completo. Repetição retornou `already_applied` e contagem de eventos permaneceu 65.
- Conta ML: 5.937 itens obtidos de 5.937 esperados. Um vínculo pausado separado para reativação.
- 33 recotações vivas no alvo: 32 novos sem conflito e uma reativação. Taxa/frete vivos; tributo estimado e custos variáveis desconhecidos continuam explícitos.

Logs e provas: `tests.log`, `validate.log`, `build.log`, `apply.log`, `idempotency.log`, `deployment.json`, `db_verification.json`. Publicação real e validação pós-POST não foram executadas nesta coorte.
