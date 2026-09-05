# Causa e regra aplicada

Origem: `supplierIdentityFacts` tentava encontrar a string completa de MODEL, e o filtro exigia atributos de embalagem presentes em ambas as fontes. O catálogo omitindo GTIN/quantidade e a marca com denominação comercial ampliada resultavam em reprovação indevida. O guard de anúncios também mantinha uma comparação independente de marca e aceitava renomeá-la apenas pelo GTIN.

Fonte única: `src/lib/ml/identity-normalization.ts`, usada na extração/comparação do Radar, criação e guard de anúncios/sincronização. Valores originais, fonte e trecho permanecem em evidência. Não existe similaridade percentual ou remoção genérica de “Brasil” de qualquer marca.

Modelos: separadores equivalentes; prefixos comerciais limitados e marca repetida são separados do código. Cor explícita é comparada à parte. Sufixos como PC108-PK e CP-130A não são descartados. “Preta” e “preto” representam a mesma cor.

Apresentação: composição explícita pode vir da descrição, título ou atributos. Falta de informação não prova que o item é unitário. Kits sem composição comprovada continuam pendentes. Ausência comum vira aviso, não conflito nem trava universal de preparação.

Complementos técnicos: evidência existente do Radar guarda origem/data/trecho, vinculados à oferta e ao GTIN. Radar e publicação leem a mesma evidência. Não há nova tabela ou migração. Troca de oferta/GTIN invalida o complemento.

Fontes consultadas: [Roadstar](https://www.roadstarbrasil.com.br/), [Multi](https://www.multilaser.com.br/), [Furukawa/SOHOPLUS](https://content.furukawalatam.com/sohoplus-lp), [publicação e garantia no ML](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos). Os links técnicos dos produtos ficam em `identity_supplements.json` do pacote D0.
