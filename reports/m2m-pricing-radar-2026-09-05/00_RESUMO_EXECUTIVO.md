# Entrega M2M — pricing canônico e Radar

Política, economia unitária, conflitos e consumidores foram consolidados e implantados no Vortek. O Radar opera em `AUTO_OBSERVE`; publicação e alteração de preço exigem confirmação vinculada à simulação, seguida de recotação viva. Nenhum anúncio foi publicado nem preço alterado por esta execução.

| Preço final | Piso | Alvo | Limite de busca |
|---|---:|---:|---:|
| Até R$ 200,00 | 5% | 7% | 10% |
| R$ 200,01 a R$ 1.000,00 | 7% | 10% | 15% |
| Acima de R$ 1.000,00 | 10% | 15% | 20% |

Margem premium com vendas é preservada. Piso e limite geram diagnósticos; não são comandos de pausa ou redução. Fontes ML inconclusivas impedem confirmar prejuízo por tarifa/frete. Identidade, economia e demanda têm avaliações separadas.

## Resultado do reprocessamento

Foram reprocessados os 1.977 candidatos existentes e os 65 revisados, sem novas consultas ML nessa etapa. Os 14 antes excluídos pelo piso universal de 10% atendem ao piso da faixa no cenário competitivo registrado. Isso não elimina as pendências de identidade, tributação estimada e custos variáveis.

A fila da planilha contém 25 reativações, 3 já anunciados, 54 pendências de identidade, 295 conflitos e 1.600 inconclusivos. Não houve promoção artificial de candidatos por dados ausentes. Os 65 revisados têm 54 identidades estruturadas incompletas e 11 divergências de marca.

O universo foi importado para o Radar com deduplicação; repetir a importação retornou `already_imported`. Depois do teste operacional de 50 produtos, o banco tinha 2.024 candidatos únicos: 47 adicionais ao universo importado e 3 reavaliados. Os números da planilha permanecem vinculados ao universo original.

## Evidência técnica e homologação

- 71 testes automatizados passaram; lint, typecheck e build passaram.
- Três migrations aplicadas no Supabase self-hosted, com backup integral anterior e validação SQL transacional revertida.
- Leitura ML viva confirmou tarifa/frete e memória de um anúncio com oferta elegível.
- Teste do job em produção processou 50 produtos, gravou checkpoint e respondeu HTTP 200. O job de teste foi cancelado após o lote; o ciclo noturno completo ainda não foi exercitado.
- Dashboard entregue em `/radar`, com filas, motivos, seis dimensões e revisão auditável.

A implementação está entregue. A homologação comercial/fiscal dos candidatos permanece pendente conforme 07_PENDENCIAS_VALIDACAO.md; não há autorização para publicação em massa. Detalhes de validação, limites e rollback estão nos documentos 05 e 08. O manifest registra commits, implantação e hashes dos artefatos.
