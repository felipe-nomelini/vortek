# M2M-PRC-04 — Fontes ML vivas e cotação sob demanda

Data: 06/09/2026. Worktree/branch: vortek-dev / dev. Base anterior: 9d44997.

## Estado e limite de conclusão

Implementação e validação local concluídas. **Ação ainda aberta**, aguardando homologação econômica completa com oferta elegível e contexto comercial de teste apto. Não avançar para CFL-01 enquanto essa evidência não existir. Deploy e verificação web serão registrados abaixo após execução.

## AS_IS → TO_BE

| Antes | Agora |
| --- | --- |
| Detalhe consultava preço do item, mas avaliava tarifa de fallback e frete local não comprovado | Consulta individual de tarifa e frete do vendedor, vinculada a preço/categoria/tipo/logística/conta |
| Projeção não admitia extrapolar uma cotação vinculada, sem mecanismo de recotação | Usa o solver canônico como semente e recota o candidato até estabilizar; cada objetivo possui memória própria |
| GET de análise também atualizava snapshot de competição | Consulta sem DML comercial; atualização persistente continua com seu fluxo existente |
| Detalhe de Produto não oferecia consulta econômica viva | Botão Consultar preço no ML; contexto explícito para produto sem anúncio; resumo reutilizado em Anúncios e Catálogo |
| Estimativa local podia parecer uma sugestão revalidada | Rótulo de estimativa local; consulta mostra fontes, data, tarifa total, frete estimado, tributo e faixa |

## Contrato implementado

- Mesma seleção de oferta, CMV, kit simples e contexto fiscal de `pricing-context`; nenhuma fórmula de economia duplicada em API/UI/PDF.
- GET `/api/ml/anuncio/preco-detalhe` preserva consulta de anúncio, descontos remotos informativos e indicação de automação ML. POST estrito aceita produto, anúncio opcional, preço em centavos opcional e contexto explícito somente antes de anúncio. Autenticação obrigatória; respostas `no-store`.
- Conta vem do cliente ML autorizado, não do browser. Vínculo produto/anúncio, seller, moeda BRL, categoria e contexto são verificados. Preparação exige categoria folha publicável e interseção logística da conta/categoria. Nesta entrega a preparação comercial admite Clássico/Premium; outros tipos são incompatíveis explícitos.
- Item existente resolve dimensões no ML por item_id. Produto novo exige dimensões/peso bruto locais para ME2, convertendo kg para gramas inteiros. Ausência não inventa medidas.
- `listing_prices`: categoria ou produto catálogo, preço candidato, tipo, moeda, modalidade/logística e peso faturável quando retornado. Um único resultado compatível. `sale_fee_amount` é total autoritativo; fixa já incluída. Percentual declarado/fixa servem apenas à próxima semente, nunca se infere taxa dividindo total pelo preço.
- Frete: endpoint do vendedor `/users/{id}/shipping_options/free`, contexto completo, `coverage.all_country.list_cost`. Não usa `options.cost` do comprador, desconto presumido ou proteção fixa de 50%. Cotação viva continua **estimativa**, não custo realizado de shipment.
- Fallback configurado permanece estimado; frete configurado só para `not_specified`. Falha/ausência não vira zero. Sem fontes vivas suficientes, resposta `INCONCLUSIVO_FONTE_ML_INDISPONIVEL`, sem confirmar prejuízo ou executar pausa.
- Alvo, piso e equilíbrio recotados separadamente, com dedupe efêmero por preço dentro da requisição; máximo de 12 refinamentos por objetivo, ciclo e não convergência explícitos. Nenhum cache persistente, TTL arbitrário, cron ou chamada por linha de tabela/PDF.
- Revalida produto, atividade, oferta/CMV/kit, preferência, vínculo, dimensões, configuração, fiscal e fornecedores operacionais; também conta/contexto/preço/logística ML. Mudança material → `CONTEXTO_ALTERADO`. Refresh sem mudança comercial não invalida automaticamente.
- Consulta não autoriza execução. Guardas `pricing_execution_not_ready` preservados em criação, preço, opt-in, transporte e outbox. Sem novas publicações, pausas, ajustes automáticos ou regras de Buy Box/Radar.
- Amostras visuais protegidas recusadas antes de consultar anúncios reais; botão desabilitado na amostra e durante edição do produto. Mudança de campo/fechamento limpa a consulta no browser.

## Validação local executada

344 testes passaram, zero falhas, incluindo 29 novos testes de cotação, convergência, integração das fontes reais de código e rotas isoladas.

```sh
node --test tests/m2m-*.test.js tests/*pricing*.test.js tests/*products*.test.js tests/*listings*.test.js tests/bentevi-product-detail.test.js tests/seo-reactivation.test.js tests/catalog-cleanup.test.js tests/preferred-offer.test.js tests/product-activity.test.js tests/supplier-deactivation.test.js tests/ml-price-publish-tracking.test.js tests/ml-publish-outbox.test.js tests/ml-order-profit.test.js tests/easypanel-deploy-contract.test.js
npm run validate
npm run build
git diff --check
```

Casos: fronteiras 20000/20001/100000/100001 centavos, tarifa total/fixa, resposta ambígua, moeda/tipo divergente, frete ausente/zero explícito/recebedor, percentual ausente, mudança de preço/frete, ciclo, oferta inativa/ausente/CMV alterado, dimensões/vínculo alterados, atualização não material, consulta repetida sem cache persistente, 401/409/422/503, contexto estrito, produto novo, kg→gramas, proteção de fixture, sinal de preço automático e GET compatível. Integrações dos testes usam dependências simuladas, não são prova de cotação ML comercial real.

## Fotografia real DEV e pendência

Preflight por conexão direta: **192.168.1.162**, hostname **supabase-dev**, transação READ ONLY. Histórico: 111 versões, última 20260906130000. Nenhuma migration necessária ou aplicada nesta ação.

- Cinco produtos operacionais, **zero ofertas**, zero produtos com ml_item_id. Amostra visual protegida não é cadastro operacional.
- `/users/me` HTTP 200, conta MLB com tag `test_user`; busca retorna um anúncio de teste, tipo **free**, modalidade **not_specified**. Não é um cenário comercial Clássico/Premium apto para provar toda a recotação.
- Consulta direta somente leitura de `listing_prices` para esse item respondeu 200 e tarifa total/fixa/percentual explícitos zero. Isso comprova acesso/parsing do tipo gratuito, **não** CMV/tributo/projeção completa nem frete ME2. Ausência de fallback informado nessa prova permaneceu null, não zero fabricado.
- Pendente: preparar uma oferta DEV com custo/estoque e origem conhecidos, associada a produto de teste e contexto comercial habilitado; provar consulta completa alvo/piso/equilíbrio e revalidação autenticada. Não copiar credenciais/anúncios de produção nem inventar custo para encerrar o gate. Nenhum anúncio externo foi criado ou modificado.

## Rollback e riscos residuais

Reversão seletiva do código desta ação em dev, preservando os bloqueios da PRC-03 e a retirada de atacado. Não há migration, cache persistente ou preço remoto a reverter. Não restaurar DML de snapshot dentro de consulta como solução comercial.

Cotação é temporal e aproximada; não constitui autorização futura de escrita. A futura execução deverá recotar e verificar os respectivos gates. Projeções não convergentes exigem análise, não uso do último candidato. Latência depende do ML; refinamentos são limitados e compartilham resultados dentro da consulta. Homologação comercial completa permanece bloqueadora, explicitamente separada dos testes locais aprovados.

## Referências verificadas

- [ML — custos por vender](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender), atualização 03/09/2026: total de tarifa e parâmetros da cotação.
- [ML — custos de envio](https://developers.mercadolivre.com.br/custos-de-envio): cotação do vendedor e contexto obrigatório.
- [ML — custos e cotações](https://developers.mercadolivre.com.br/en_us/choose-service-type/mercado-envios-shipping-costs-and-quotes): cotação aproximada versus custo realizado.
- [ML — preferências de envio](https://developers.mercadolivre.com.br/pt_br/mercado-envios): logística da conta e categoria.
- [Ant Design — Modal](https://ant.design/components/modal/); guia de Route Handlers do Next 16.3.3 instalado.
- [Supabase — generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp) e [signOut local](https://supabase.com/docs/reference/javascript/auth-signout), para homologação com sessão temporária, sem redefinir senha.
- [Easypanel — deployment](https://easypanel.io/docs/services/app#deployments).

Skills DEV/Supabase orientam validação e isolamento; a referência antiga da skill a .160 foi rejeitada conforme AGENTS. Banco de produção não acessado. Cânon e AGENTS preservados.
