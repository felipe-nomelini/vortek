# Revisão dos preços ativos — 07/09/2026

Foram auditados 3854 anúncios encontrados ativos nas varreduras, incluindo os ativados durante a execução. A última varredura de inclusão terminou às 12:38:58 (Brasília); a confirmação financeira final terminou às 12:43:25.

- **2200 anúncios tiveram o preço aumentado e confirmado no ML.**
- **3832 anúncios atingem o alvo do sistema**, incluindo 1.632 que já estavam adequados e tiveram o preço preservado.
- Nenhum anúncio com cálculo completo permanece abaixo do alvo.
- Os **27 anúncios inicialmente com prejuízo** tiveram o preço corrigido e o resultado passou a atingir o alvo.
- **22 anúncios permanecem sem cálculo completo**, detalhados abaixo. Não é possível afirmar que esses 22 estão dentro da margem.

## Critério aplicado

Alvo de 7% até R$ 200, 10% de R$ 200,01 a R$ 1.000 e 15% acima de R$ 1.000, considerando a faixa do preço final. Custo elegível do fornecedor e tarifas/frete consultados pelo motor canônico. Imposto central estimado de 8,279935%, com estimativa reconhecida na aprovação. Preços superiores ao alvo foram preservados.

As alterações passaram pelas rotas existentes de simulação, aprovação e aplicação, com leitura posterior do ML. Foram encerradas as observações comerciais impeditivas apenas dos anúncios abaixo do alvo e removidas duas automações de preço incompatíveis com o ajuste autorizado.

## Correções por fornecedor

| Fornecedor | Anúncios corrigidos |
|---|---:|
| VANRAL | 154 |
| BKR1 | 1.430 |
| EVOLUSOM-PR | 616 |
| Total | 2.200 |

## Produtos que motivaram a revisão

| Produto | Antes | Depois | Lucro calculado depois |
|---|---:|---:|---:|
| VTK012279 — Alto-falante ATK | R$ 231,00 | R$ 259,98 | R$ 26,00 / 10,00% |
| VTK012181 — Palheta SG | R$ 31,45 | R$ 33,54 | R$ 2,35 / 7,01% |

Os dois anúncios de cada produto tiveram os valores confirmados. Vendas anteriores não foram alteradas.

## Pendências que impedem o cálculo

- **16 anúncios sem Mercado Envios aplicável na resposta atual do ML:** oito com restrição da ficha de catálogo, seis baterias com restrição de transporte e dois controles remotos em categoria que não habilita ME2. O usuário determinou Mercado Envios sempre. Foram enviadas 14 solicitações compatíveis com as categorias, mas o ML manteve a modalidade anterior; nenhuma conversão foi confirmada. Detalhes em [sem-cotacao-frete.md](sem-cotacao-frete.md).
- **4 anúncios sem oferta ativa:** VTK000980 (MLB6564925370, MLB7381240556) e VTK000234 (MLB4836306667, MLB5198836111). As únicas ofertas estão inativas, sem estoque; seus custos históricos não foram tratados como custo elegível atual.
- **2 anúncios sem produto/custo local identificado:** MLB5007910637 e MLB7349903698, kit de três jogos de cordas D'Addario XTAPB1047.

## Cadastro, sincronização e rastreabilidade

Há 23 registros com avisos de divergência de atributos; todos os 23 atingem o alvo financeiro. Esses avisos não foram apresentados como preços incorretos.

Uma alteração local de marca feita durante a revisão acionou a proteção de identidade e pausou pares de quatro produtos. As quatro marcas foram restauradas ao cadastro anterior e os oito anúncios voltaram a ficar ativos, preservando os preços corrigidos. A restauração foi confirmada pela fila existente e por leitura no ML; ver `status-restoration.json`. Nenhuma marca de catálogo foi alterada no ML.

Oito pares antigos estão `under_review/forbidden` no ML e não receberam o preço do anúncio ativo. Os anúncios ativos correspondentes foram confirmados e reconciliados; os pares bloqueados estão fora do escopo de anúncios ativos. As tentativas registram essa distinção. Não restam tentativas de aplicação com resultado desconhecido.

## Correções no sistema e validação

- `1234085`: o encerramento autorizado de uma observação passa a ser respeitado pelos monitores e pela proteção de preço.
- `ed8f221`: o cálculo iterativo do preço-alvo considera o arredondamento do imposto; corrigida a oscilação que impedia atingir a margem por centavos.

Ambas as mudanças foram enviadas ao GitHub e implantadas pelo fluxo normal do Easypanel, com conclusão de implantação confirmada. Validação executada: 109 testes de precificação/radar, `npm run validate`, dois testes do executor e verificação de sintaxe do executor.

[Planilha detalhada dos anúncios](anuncios.csv). `summary.json` contém as contagens; os arquivos locais em `items/` preservam as simulações, aprovações, respostas e leituras de confirmação.
