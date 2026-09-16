# BNT-ML-BUYBOX-ECONOMICS-01 — validação produtiva

Data: 16/09/2026  
Ator: Rodrigo (`3e56ce48-f461-4784-848b-097d1e482a43`)  
Run: `de254c62-9a47-43af-be56-d3f536080cbd`

## Resultado

Os 15 SKUs do manifesto foram reavaliados com dados vivos. O lote terminou
`completed`:

- 3 `UPDATED_OK`;
- 6 `CONFLITO_ECONOMICO_DE_BUY_BOX`;
- 6 `BLOQUEADO_DADO_ECONOMICO`;
- 0 falhas de escrita ou readback.

Preços alterados e confirmados pelo Mercado Livre:

| SKU | MLB | Antes | Depois |
|---|---|---:|---:|
| VTK017907 | MLB4986120825 | R$ 133,33 | R$ 128,00 |
| VTK018644 | MLB5196984191 | R$ 69,35 | R$ 61,22 |
| VTK017359 | MLB7598790232 | R$ 41,00 | R$ 32,83 |

Os três anúncios continuaram `competing` no readback inicial. Cada operação
ficou `confirmed`, com o preço persistido exatamente igual ao aprovado.

## Bloqueios preservados

Seis SKUs ficaram abaixo do piso econômico no `price_to_win` vivo. Outros seis
foram bloqueados por tarifa/frete não confirmados, ausência de oferta ativa com
estoque ou grupo de pricing inconclusivo. Nenhum deles recebeu escrita.

## Segurança

O readback final dos 15 itens confirmou zero mudança em:

- estoque;
- `produtos.ativo`;
- `custom_price`;
- oferta preferencial;
- status do anúncio;
- vínculo de catálogo.

Não houve relink, mudança de conteúdo ou Batch 02. A identidade do universo
permaneceu em `1.526 SEM_CONFLITO`, `22 CONFLITO_CONFIRMADO` e
`2 PENDENCIA_VALIDACAO`.

Três experimentos foram abertos e nove checkpoints somente leitura foram
agendados: D+1 em 17/09, D+3 em 19/09 e D+7 em 23/09/2026.

## Produção e validações

- SHA funcional executado e promovido em `dev` e `bentevi-prod`:
  `86cf3b9e7a3818ac72fd0c66c18a351c344a479e`;
- migration: `20260916120000_bnt_ml_buybox_economics_01`;
- backup de schema anterior à migration: SHA-256
  `17529eb845b2c23ec6724597b4fa63d87a85b2b3f7a2336b92cbb3631e421f2f`;
- `npm run validate`: aprovado;
- testes direcionados: aprovados;
- `npm run build`: aprovado;
- verificação de secrets do build: aprovada;
- deploy produtivo aceito pelo Easypanel e processo reiniciado com health OK;
- nenhum teste específico da Video Factory foi executado.

Os dez artefatos da ordem estão em
`reports/buybox-economics/BNT-ML-BUYBOX-ECONOMICS-01-2026-09-16/`.
