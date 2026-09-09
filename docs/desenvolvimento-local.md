# Bentevi — desenvolvimento local

O ambiente local substitui a dependência permanente do Supabase DEV remoto depois
do corte produtivo. Até esse corte, `192.168.1.162` continua classificado como DEV;
este procedimento não o altera, não lê produção e não copia dados reais.

## Pré-requisitos

- Node.js `>=22 <23`;
- runtime compatível com a API Docker;
- dependências instaladas com `npm ci`.

No `PCBAO`, que executa Ubuntu em WSL2, usar o Docker Desktop com engine WSL2 e
habilitar a integração para esta distribuição. Não instalar um segundo daemon
Docker dentro do WSL em paralelo ao Docker Desktop.

A stack local é exclusiva de desenvolvimento e só pode permanecer ativa quando
as portas publicadas forem comprovadamente ligadas à interface de loopback. Ela
não deve ser publicada por domínio, proxy ou túnel público.

## Iniciar

```bash
npm run dev:db:start
npm run dev:db:status
```

Use a saída local do Supabase para preencher um `.env.local` ignorado pelo Git:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
VORTEK_RUNTIME_ENVIRONMENT=local_dev
ML_PRICING_EXECUTION_MODE=disabled
```

As chaves locais são geradas pelo Supabase CLI. Não copie para o DEV local
credenciais, tokens, dumps ou objetos de produção. Depois, inicie a aplicação:

```bash
npm run dev
```

## Reset e parada

O reset apaga somente os volumes do projeto local e exige confirmação explícita:

```bash
npm run dev:db:reset -- --confirm-local-reset
npm run dev:db:stop
```

O wrapper recusa qualquer ambiente diferente de `local_dev`, solicita uma rede
Docker com bind padrão em `127.0.0.1` e confere os binds efetivos de cada container.
Se o runtime ignorar essa opção e publicar em `0.0.0.0`/`::`, o stack é desligado
automaticamente. A inicialização redige valores sensíveis da saída do CLI, e o
comando de status exibe somente URLs locais.

No Docker Desktop 4.90 validado em 09/09/2026, foi selecionado **Settings →
Resources → Network → Port binding behavior → Localhost by default**. Um container
descartável confirmou `127.0.0.1` e `::1`, e o stack `bentevi-dev-local` confirmou
os mesmos binds nas portas 54321–54324, inclusive depois de reiniciar o Docker
Desktop. Essa preferência é global para publicações Docker sem IP explícito; uma
declaração explícita ainda pode sobrescrevê-la. Por isso, a verificação e o
desligamento automático do wrapper continuam obrigatórios.

O Supabase CLI pode emitir o aviso genérico de que os serviços usam `0.0.0.0`.
Neste ambiente, o critério efetivo é a inspeção das publicações Docker realizada
pelo wrapper. Se `npm run dev:db:status` recusar a stack, não contorne a proteção.

## Critério de prontidão

Antes de converter a VM `.162` em produção Bentevi, comprovar neste ambiente:

1. inicialização saudável de todos os serviços necessários;
2. aplicação integral das migrations em banco vazio;
3. execução do seed sintético sem dados externos;
4. autenticação local e fluxos web direcionados;
5. `npm run validate`, testes pertinentes e build aprovados.

Referências oficiais:

- [Supabase Local Development](https://supabase.com/docs/guides/local-development)
- [Supabase CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Docker Desktop com WSL2](https://docs.docker.com/desktop/features/wsl/)
- [Networking no Docker Desktop](https://docs.docker.com/desktop/features/networking/)
- [Publicação de portas Docker](https://docs.docker.com/engine/network/port-publishing/)
