# Vortek Mobile

Aplicativo Android interno da Vortek. Projeto isolado do ERP web existente.

## Estado atual

- Planejamento e arquitetura definidos.
- Scaffold Expo criado com login, sessão segura e navegação principal.
- Backend possui contratos versionados de sessão e TV em `/api/mobile/v1`.
- TV ao vivo implementada com atualização automática em primeiro plano.
- Vendas possui resumo, abas operacionais, busca com debounce e lista paginada.
- Detalhe da venda mostra múltiplos produtos, entrega, fornecedor, fiscal e histórico operacional.
- Vendas possui filtros por status, período e faixa de valor, além de rastreio ML detalhado.
- Vendas possui filtros por fornecedor, etiqueta DSLite e WhatsApp real.
- Vendas possui ordenação remota equivalente ao ERP.
- Detalhe da venda cobre criação/retomada DSLite, PIX, frete pago, envio interno, etiquetas, DANFE/XML, WhatsApp e desvínculo corretivo.
- Comprovantes e documentos usam seleção/download nativos do Android.
- Compras possui resumo, busca, filtros, ordenação, paginação, detalhe, vínculo com venda, rastreio e confirmação/reenvio de PIX.
- Ações exigem confirmação, permissão de cargo, idempotência e acompanhamento do job.
- Próximo passo: validar Vendas e Compras em uso controlado, sem duplicar ações.
- Build Android possui perfil `preview` para APK interno e `production` para futuro AAB da Play Store.

## Limites do projeto

- Site permanece na raiz do repositório.
- Aplicativo terá `package.json`, dependências, variáveis e builds próprios dentro de `mobile/`.
- Build do Next.js ignora esta pasta pelo `tsconfig.json` da raiz.
- Regras de negócio continuam no backend Vortek. Aplicativo será cliente da API.
- Aplicativo não acessará Mercado Livre, DSLite ou Brasil NFe diretamente.
- Chaves `service_role`, credenciais de fornecedores e tokens de marketplace nunca entram no APK.

## Stack planejada

- React Native com Expo
- TypeScript estrito
- Expo Router
- Supabase Auth
- TanStack Query
- Zod
- Expo SecureStore
- Expo Notifications
- EAS Build para builds internos

## Documentação

- [Roadmap completo](ROADMAP.md)
- [Arquitetura técnica](docs/ARCHITECTURE.md)

## Desenvolvimento local

1. Copie `.env.example` para `.env` e preencha somente valores públicos.
2. Execute `npm install` dentro de `mobile/`.
3. Execute `npm run start`.

## APK interno

1. Entre na conta Expo com `npx eas-cli login`.
2. Configure as variáveis públicas do ambiente `preview` no EAS.
3. Execute `npx eas-cli build --platform android --profile preview`.
4. Abra o link fornecido pelo EAS no celular e instale o APK.

Nunca coloque `service_role`, credenciais do Mercado Livre, DSLite ou Brasil NFe no `.env` móvel.

## Fontes oficiais

- [React Native — início de projeto](https://reactnative.dev/docs/environment-setup)
- [Expo Router](https://docs.expo.dev/router/introduction/)
- [Expo — distribuição interna](https://docs.expo.dev/build/internal-distribution/)
- [Supabase Auth com React Native](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [Supabase `getUser(jwt)`](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Next.js como Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Mercado Livre — OAuth e segurança](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/gestao-de-identidades-e-acessos-oauth-e-tokens)
- [DSLite — API oficial](https://documenter.getpostman.com/view/5316990/RWaRNkaA)
- [Brasil NFe — documentação](https://www.brasilnfe.com.br/docs)
