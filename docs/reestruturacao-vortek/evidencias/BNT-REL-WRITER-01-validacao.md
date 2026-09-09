# BNT-REL-WRITER-01 — Writers produtivos controlados

Data: 09/09/2026
Branch: `dev`
Situação: recorte técnico concluído; capacidade não ativada

## Resultado

O executor comercial canônico aceita o novo modo `production_controlled` sem ampliar os writers legados. `disabled` permanece o padrão e `test_only` conserva a separação da conta de teste.

O modo produtivo somente fica disponível quando todas as condições abaixo são verdadeiras:

- `VORTEK_RUNTIME_ENVIRONMENT=production`;
- origem exata `https://app.bentevi.shop`;
- Supabase resolvido exclusivamente para `192.168.1.162`;
- seller presente em `ML_ALLOWED_USER_IDS`;
- identidade `/users/me` igual ao seller, site `MLB`, tags disponíveis e ausência de `test_user`.

A checagem da conta é repetida com o token exato imediatamente antes do claim SQL e da única tentativa mutante. Respostas incertas continuam sem retry: a operação passa a ser reconciliada somente por leitura. Aprovação e aplicação permanecem ações distintas da mesma pessoa autorizada, e o modo produtivo acrescenta confirmação final explícita na interface.

## Contratos preservados

- um único executor canônico para criação e preço;
- writers e rotas comerciais legadas incondicionalmente bloqueados;
- validade econômica e fingerprint reavaliados antes do claim;
- claim atômico e idempotência do comando/operação;
- captura durável do ID remoto antes de pós-processamento;
- confirmação somente depois de read-back de seller, moeda, preço, grupo ou anúncio completo;
- conta real recusada no modo de teste e conta `test_user` recusada no modo produtivo;
- título de teste usado somente em `test_only`; produção usa o nome comprovado do produto;
- descritor público limitado a modo, habilitação e destino, sem seller, IP ou secret.

Não foi necessária migration: as RPCs e constraints atuais já implementam aprovação, consumo, claim, auditoria e recuperação.

## Validações executadas

- `node --test tests/pub-gate-dispatch.test.js tests/pub-gate-preparation.test.js tests/pricing-decisions.test.js tests/m2m-prc-03-execution.test.js`: 46 aprovados, zero falhas.
- `node --test tests/*.test.js`: 1.311 casos; 1.308 aprovados, zero falhas e três LIVE ignorados por dependerem de declaração/ambiente real.
- `npm run validate`: lint e typecheck aprovados.
- `npm run build`: build Next.js 16.3.3 aprovado; a checagem de tipos separada também passou em `validate`.
- `npm run check:build-secrets`: aprovado.
- `git diff --check`: aprovado.

Os testes usam mocks e dados sintéticos. Nenhuma chamada externa de escrita, banco remoto, conta real ou ambiente produtivo participou da validação.

## Fontes oficiais conferidas

- [Publicação de produtos](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos)
- [Consulta de usuários e `/users/me`](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/consulta-de-usuarios)
- [Realização de testes](https://developers.mercadolivre.com.br/devcenter/realizacao-de-testes)
- [Validador de publicações](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/validador-de-publicacoes)

## Limites e próxima etapa

Esta ação não reclassifica a `.162`, não configura `local/bentevi-prod`, não cria a branch `bentevi-prod`, não publica o código e não executa uma operação real. O primeiro anúncio e a primeira alteração de preço reais permanecem no marco 6, em tarefa produtiva autorizada e depois do fechamento dos demais gates do marco 5.

Rollback técnico antes da ativação: manter `ML_PRICING_EXECUTION_MODE=disabled` e reverter o lote. Depois de qualquer efeito real futuro, rollback de código não substitui reconciliação do Mercado Livre nem desfaz efeitos externos.
