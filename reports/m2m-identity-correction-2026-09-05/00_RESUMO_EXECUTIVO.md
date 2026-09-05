# Correção de identidade do Radar — 05/09/2026

Correção implementada, testada e implantada em `a31cd43`, após `8c604a1` e `bc57c39`. Reclassificação persistida dos 65 com 65 eventos: **32 SEM_CONFLITO, 32 PENDENCIA_VALIDACAO, 1 CONFLITO_CONFIRMADO**. São 33 identidades coerentes, das quais uma pertence à fila de reativação.

A comparação antiga produzia 11 divergências de marca e 54 identidades inconclusivas. Os 11 conflitos literais de marca foram removidos; relações ainda sem comprovação ficaram pendentes. ROADSTAR BRASIL/Roadstar, MULTILASER/Multi e SOHOPLUS–FURUKAWA/Furukawa compartilham equivalência documentada. NWT/Storm depende da declaração na oferta específica.

Outras causas corrigidas: comparação do modelo inteiro com palavras comerciais; separadores em códigos; composição existente somente na descrição ou título ML; ausência de apresentação tratada como incompatibilidade; um kit vendido como uma unidade confundido com seu conteúdo; estimativas econômicas misturadas com conflitos de identidade.

Não houve renomeação de marcas, alteração de preços, pausa ou publicação no ML. O conflito restante é técnico: Evus FK-12P, fornecedor com cabo de seis pinos versus catálogo ML com quatro. Bravox CX50BK permanece pendente pelo escopo dos 60/120 W RMS. Minipa MTL-24A é reativação candidata.

92 testes passaram, assim como lint, typecheck, build e diff-check. Runtime: build `bbct_OTq9JflW49zcwylT`, regra v2.1 encontrada no bundle; API sem autenticação retorna 401. Repetição da reclassificação retornou `already_applied`, sem duplicar os 65 eventos.

A coorte real segue sem publicações: os 32 candidatos sem conflito têm recotação viva no alvo, mas os termos de garantia ainda não estão completamente comprovados. Prazo de três meses aparece na oferta Kepper VTK005849; é necessário esclarecer quem cobre a garantia. Para os demais 31 faltam prazo e cobertura. O default de 12 meses de fábrica do ERP não foi tratado como evidência comercial.

O pacote D0 está em `../RADAR_LAUNCH_2026_09_COHORT_01/`. Essa pendência não foi gravada como conflito de identidade no Radar.
