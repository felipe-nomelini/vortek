# Adequação ao Cânon — AS IS → TO BE

Baseline: `e54f16ae9f76b021d4288eff970df830bba37951`. Estado inicial preservado em baseline.json. Mudanças preexistentes do package.json e arquivos locais não foram incorporadas aos commits desta entrega.

| Domínio | AS IS observado | TO BE implementado | Dependência / risco |
|---|---|---|---|
| Economia | variableCosts em tipos, memória, assinatura e ordens | Receita − CMV − tarifa − frete − tributo; propriedades explícitas | Nova versão invalida autoridade de memória antiga, sem apagar histórico |
| CMV | Pedidos tinham resolução de kit separada; simulação só oferta direta | resolvePricingProduct e costBasis por componentes, mesma oferta elegível | Kits compostos além do suporte operacional atual ficam explicitamente pendentes; nenhuma oferta fictícia |
| Margem | Motor por preço final já existia; preparadores conservavam mínimo nominal | Exclusivamente 5/7/10, 7/10/15, 10/15/20; preparadores antigos aposentados | Fixtures monetárias continuam apenas resultados de teste |
| Recuperação | Alteração de custo propunha alvo | Proposta inicial no piso, com ML vivo e confirmação | Premium, estratégias válidas e experimentos preservados |
| Garantia | 12 meses / primeiro valor da categoria em preparação e sugestão | Fabricante → fornecedor → legal conforme classificação comprovada | Sem prazo comprovado/classificação, pendência; origem separada do tipo ML |
| Atacado | Interface/comandos/configuração de execução legada | Sem sugestão ou escrita; endpoint antigo 410; worker descarta só a operação retirada | Preços remotos por quantidade continuam visíveis para auditoria |
| Proteção | Estratégias com validade e proteção não explícita na interface | Override por grupo até revogação; edição manual independente | RPC serializa decisões do grupo; não altera preço |
| Liquidação | Teto técnico de 30 dias | Data autorizada ou até revogação, sem novo teto | Sem novas cadências de acompanhamento |
| Publicação | Garantia não vinculada à evidência; readback podia usar POST | Garantia registrada antes do POST, GET real obrigatório, MLB registrado antes de validar | Aprovação consumida; claim único impede POST concorrente da mesma aprovação |
| Configurações | Campo econômico removido persistia no JSON | JSON limpo, faixas homologadas visíveis, fallbacks preservados | Sem reprecificação implícita |
| Existentes | Legado remoto e autoria incompleta | Auditoria individual e filas sem mutação remota | Correção exige autorização posterior e nova leitura |

O limite operacional de custo de R$ 2.000 permanece em product-activity.ts e nos fluxos de elegibilidade de ofertas. Não escolhe faixa nem altera produtos.ativo. Nenhuma dessas rotinas foi executada nesta entrega.
