# Validação pós-publicação

8 confirmados em `02_PUBLICADOS_CONFIRMADOS.csv`. Cada `*-confirmed.json` contém leitura remota, preço, quantidade inicial, catálogo, identidade, garantia, memória econômica e simulação persistida. `final-live-audit.json` registra a releitura de encerramento e vínculos no ERP.

A leitura usa atributos internos, IDs de valores múltiplos e o catálogo vivo. Espaços entre vírgulas não são divergência técnica. A descrição de catálogo não é editável pelo vendedor; 404 na descrição do item não invalida a descrição/ficha do produto de catálogo já confirmada. [Contrato de catálogo ML](https://developers.mercadolivre.com.br/buscador-de-produtos).

Safety stops são mantidos em `audit-events.json`, com resolução/containment por ID. O EV-430 permanece pausado e fora dos validados. Descrição, frete e atributo multivalorado foram diagnosticados antes de retomar a coorte; não houve segundo POST para SKU já criado.

Validações de código: 92 testes M2M; sete testes específicos da coorte; `npm run validate` e `npm run build` executados para o runtime implantado. O ajuste posterior do executor foi validado pelos sete testes e pelo fluxo real. Monitor compilado confirmado no container, com jobs completos: `monitor-runtime-evidence.json`.

Limite econômico: tributo estimado pelo serviço central RBT12; custo variável não informado permanece explícito. Margens não são apresentadas como lucro contábil confirmado.
