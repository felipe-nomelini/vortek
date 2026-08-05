# Arquitetura técnica — Vortek Mobile

## 1. Separação física

```text
vortek/
├── src/                 # ERP web e API Next.js atuais
├── supabase/            # migrations e configuração do banco
├── mobile/              # aplicativo Android isolado
│   ├── app/             # rotas Expo Router, após scaffold
│   ├── src/             # componentes, serviços e domínio móvel
│   ├── assets/          # ícones, fontes e imagens do app
│   ├── docs/            # documentação móvel
│   ├── package.json     # dependências próprias
│   └── eas.json         # perfis de build próprios
└── package.json         # site Next.js; não controla app móvel
```

Não será criado monorepo nem movido código existente. Site e aplicativo terão instalações e builds independentes.

## 2. Fluxo principal

```text
Vortek Mobile
  │ HTTPS + Supabase access token
  ▼
Next.js /api/mobile/v1
  ├── autenticação e cargo
  ├── validação Zod
  ├── regras e serviços Vortek
  ├── idempotência e jobs
  └── logs com requestId
       ├── Supabase self-hosted
       ├── Mercado Livre
       ├── DSLite
       ├── Brasil NFe
       └── WhatsApp
```

## 3. Autenticação

1. App autentica e-mail e senha no Supabase Auth público da Vortek.
2. App guarda sessão em armazenamento seguro do Android.
3. App envia `Authorization: Bearer <access_token>`.
4. Backend valida token com `supabase.auth.getUser(jwt)`.
5. Backend consulta perfil/cargo em fonte controlada.
6. Endpoint verifica permissão específica.
7. Backend executa operação com credenciais privadas.

Regras:

- `service_role` nunca entra no app;
- `user_metadata` não autoriza operações;
- cargo vindo da tela nunca é confiável;
- cada endpoint valida permissão novamente;
- token expirado retorna `401` padronizado;
- falta de permissão retorna `403` padronizado;
- usuário removido ou desativado perde acesso.

## 4. API e domínio

Rotas atuais foram construídas para navegador e autenticação por cookie. Aplicativo não simulará cookies.

Estratégia:

- criar adaptador de autenticação móvel;
- extrair consultas e regras necessárias das rotas para funções de domínio reutilizáveis;
- manter rotas web funcionando sem alteração de contrato;
- criar contratos móveis versionados;
- evitar endpoint genérico que repasse qualquer chamada;
- retornar somente campos necessários para tela.

## 5. Estado e atualização

TanStack Query controlará:

- cache de leitura;
- invalidação após ação;
- retry limitado para GET;
- ausência de retry automático para POST sensível;
- atualização ao retornar para foreground;
- paginação;
- estados de erro e dado desatualizado.

TV ao vivo no MVP:

- `/tv/live`: 5 segundos em foreground;
- `/tv/metrics`: 30 segundos em foreground;
- polling desligado em background;
- atualização manual disponível;
- Supabase Realtime poderá ser avaliado depois do piloto, sem ser dependência inicial.

## 6. Ações assíncronas

Fluxos DSLite, NF-e, etiqueta e WhatsApp podem levar tempo. Contrato móvel:

```json
{
  "data": {
    "jobId": "uuid",
    "status": "queued"
  },
  "error": null,
  "meta": {
    "requestId": "uuid"
  }
}
```

Estados aceitos:

```text
queued -> running -> succeeded
                  -> retry_wait
                  -> failed
                  -> cancelled
```

Aplicativo acompanha job existente. Nunca dispara novo job apenas porque resposta demorou.

## 7. Segurança de dados

- HTTPS obrigatório;
- nenhum segredo em variável `EXPO_PUBLIC_*`, exceto URL pública e chave publicável do Supabase;
- respostas sem tokens, documentos completos desnecessários ou stack traces;
- armazenamento local mínimo;
- cache limpo no logout;
- comprovantes e PDFs não ficam permanentes sem necessidade;
- logs móveis sem CPF, endereço completo, token ou comprovante;
- ações sensíveis exigem confirmação e cargo;
- biometria serve como bloqueio local, não substitui autorização do servidor.

## 8. Ambientes

### Desenvolvimento

- app development build;
- API de desenvolvimento controlada;
- dados e ações de teste quando disponíveis.

### Homologação

- APK preview assinado;
- API de homologação ou rotas protegidas de teste;
- usuários piloto.

### Produção

- domínio `app.vortek.shop` para API;
- Supabase self-hosted público por HTTPS;
- build assinado;
- distribuição interna;
- rastreabilidade por versão.

Nunca apontar development build automaticamente para produção.

## 9. Distribuição

### Piloto

- EAS profile `preview` com `distribution: internal`;
- APK compartilhado somente com equipe;
- acesso não autenticado ao link de build deve ser desativado.

### Estável

- AAB assinado;
- Google Play Internal Testing;
- atualização obrigatória quando contrato mínimo de API mudar;
- chave de assinatura armazenada com backup seguro.

## 10. Compatibilidade de API

Aplicativo enviará:

```text
X-App-Version: 1.0.0
X-Platform: android
X-Request-Id: uuid
```

Servidor poderá retornar:

```text
426 Upgrade Required
```

Somente quando versão antiga não puder operar com segurança. Mudanças compatíveis não forçam atualização.

## 11. Impacto no ERP web

- nenhuma tela web será movida;
- nenhuma dependência móvel será instalada no `package.json` da raiz;
- Nixpacks continuará executando `npm ci` e `npm run build` somente na raiz;
- `tsconfig.json` da raiz exclui `mobile/`;
- deploy do site não gera APK;
- build móvel terá processo separado quando a fundação for criada.

## 12. Pontos obrigatórios antes do primeiro build

- confirmar endpoint público do Supabase Auth self-hosted;
- revisar mudança recente de `API_EXTERNAL_URL` e gateway Envoy no Supabase self-hosted;
- confirmar certificado HTTPS acessível por Android;
- confirmar matriz de cargos;
- definir package name Android definitivo;
- definir política de aparelhos perdidos;
- definir responsáveis pela chave de assinatura;
- garantir que API móvel não exponha contratos internos desnecessários.
