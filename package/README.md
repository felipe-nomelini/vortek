# Brasil NFe Node.js SDK

[![npm version](https://img.shields.io/npm/v/brasilnfe.svg?style=flat-square)](https://www.npmjs.com/package/brasilnfe)
[![License: ISC](https://img.shields.io/badge/license-ISC-yellow.svg?style=flat-square)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg?style=flat-square)](https://www.typescriptlang.org/)

SDK oficial em **Node.js / TypeScript** para integração com a API da **[Brasil NFe](https://www.brasilnfe.com.br)**. Permite emitir, consultar, cancelar e gerenciar documentos fiscais eletrônicos (NF-e, NFC-e, CT-e, MDF-e, NFS-e, DC-e, NF3-e) e arquivos fiscais (SPED, Sintegra, FCI), de forma orientada a objetos com tipagem forte e serialização automática.

> Equivalente em Node.js ao pacote [`brasilnfe/brasilnfe-php-sdk`](https://packagist.org/packages/brasilnfe/brasilnfe-php-sdk) (PHP).

## Índice

- [Sobre a Brasil NFe](#sobre-a-brasil-nfe)
- [Recursos](#recursos)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração Inicial](#configuração-inicial)
- [Arquitetura do SDK](#arquitetura-do-sdk)
- [Guia Rápido](#guia-rápido)
- [Exemplos](#exemplos)
  - [1. Emitir NF-e (modelo 55)](#1-emitir-nf-e-modelo-55)
  - [2. Emitir NFC-e (modelo 65)](#2-emitir-nfc-e-modelo-65)
  - [3. Emitir NF-e em lote](#3-emitir-nf-e-em-lote)
  - [4. Emitir NFS-e](#4-emitir-nfs-e)
  - [5. Emitir CT-e](#5-emitir-ct-e)
  - [6. Emitir DC-e (Declaração de Conteúdo)](#6-emitir-dc-e-declaração-de-conteúdo)
  - [7. Cancelar NF-e](#7-cancelar-nf-e)
  - [8. Carta de Correção (CC-e)](#8-carta-de-correção-cc-e)
  - [9. Inutilizar numeração](#9-inutilizar-numeração)
  - [10. Manifestar NF-e de entrada](#10-manifestar-nf-e-de-entrada)
  - [11. Consultar status da SEFAZ](#11-consultar-status-da-sefaz)
  - [12. Buscar notas por período](#12-buscar-notas-por-período)
  - [13. Baixar XML / DANFE](#13-baixar-xml--danfe)
  - [14. Gerar SPED e Sintegra](#14-gerar-sped-e-sintegra)
  - [15. Gestão de empresas e certificados](#15-gestão-de-empresas-e-certificados)
- [Referência de Métodos](#referência-de-métodos)
- [Compatibilidade retroativa](#compatibilidade-retroativa)
- [Tratamento de Erros](#tratamento-de-erros)
- [Tabelas de Referência](#tabelas-de-referência)
- [Ambientes](#ambientes)
- [Como o SDK serializa o payload](#como-o-sdk-serializa-o-payload)
- [Utilitário BrasilNFeHelper](#utilitário-brasilnfehelper)
- [Licença](#licença)
- [Suporte](#suporte)

## Sobre a Brasil NFe

A **Brasil NFe** oferece uma API REST para emissão de notas fiscais e documentos eletrônicos, com foco em estabilidade, performance e conformidade com a legislação brasileira.

- **Site oficial:** https://www.brasilnfe.com.br
- **Documentação da API:** https://www.brasilnfe.com.br/docs

## Recursos

O SDK cobre todos os módulos da API REST da Brasil NFe:

- **Emissão de documentos fiscais**
  - NF-e (modelo 55)
  - NFC-e (modelo 65)
  - NFS-e (nota fiscal de serviço)
  - CT-e (modelo 57)
  - MDF-e (modelo 58)
  - DC-e (Declaração de Conteúdo)
  - NF3-e / NF-e de Energia (`NFEnerCom`)
  - Nota Fiscal Complementar
  - Envio em lote

- **Eventos**
  - Cancelamento
  - Carta de Correção (CC-e)
  - Inutilização de numeração
  - Manifestação do Destinatário
  - Encerramento de MDF-e

- **Consultas**
  - Status SEFAZ
  - Consulta de Cadastro (IE/CNPJ)
  - Busca de notas por período
  - Pré-visualização de DANFE
  - Cálculo de impostos

- **Arquivos fiscais**
  - Download de XML e DANFE (`Buffer`)
  - SPED Fiscal e Contribuições (individual e unificado)
  - Sintegra
  - FCI (Ficha de Conteúdo de Importação)
  - Arquivos por range de chaves

- **Gestão**
  - Cadastro e edição de empresas
  - Envio e verificação de certificados digitais A1

## Requisitos

- Node.js **>= 16** (recomendado 18+)
- TypeScript **>= 4.7** (opcional, mas recomendado — o SDK é escrito em TS)
- Token de acesso válido do painel Brasil NFe

## Instalação

```bash
npm install brasilnfe
# ou
yarn add brasilnfe
# ou
pnpm add brasilnfe
```

## Configuração Inicial

A classe principal é `BrasilNFe`. Com um **Token** você já tem acesso a todos os módulos fiscais. O **UserToken** é opcional e só é necessário para o módulo de gestão de empresas/certificados.

```ts
import { BrasilNFe } from 'brasilnfe';

const token     = 'SEU_TOKEN_AQUI';   // Token da empresa (obrigatório)
const userToken = 'SEU_USER_TOKEN';   // Token do usuário (opcional, p/ Empresa)

const bnfe = new BrasilNFe(token, userToken);

// Por padrão o SDK aponta para https://api.brasilnfe.com.br/services/
// Para sobrescrever (ex.: ambiente interno / sandbox específico):
const bnfeCustom = new BrasilNFe(token, userToken, 'https://api.brasilnfe.com.br/services/');
```

> A definição de **produção** x **homologação** não é feita pela URL: é controlada pelo campo `TipoAmbiente` (`1 = Produção`, `2 = Homologação`) de cada requisição.

## Arquitetura do SDK

A instância `BrasilNFe` agrega cinco módulos públicos:

| Módulo      | Propriedade         | Classe      | Responsabilidade |
|-------------|---------------------|-------------|------------------|
| Nota Fiscal | `bnfe.notaFiscal`   | `NotaFiscal`| Emissão de NF-e, NFC-e, NFS-e, CT-e, MDF-e, DC-e, NF3-e, lote e complementar |
| Eventos     | `bnfe.eventos`      | `Eventos`   | Cancelamento, CC-e, inutilização, manifestação, encerramento de MDF-e |
| Consultas   | `bnfe.consultas`    | `Consultas` | Status SEFAZ, busca, cadastro, cálculo de impostos |
| Arquivos    | `bnfe.arquivos`     | `Arquivos`  | XML, DANFE, SPED, Sintegra, FCI |
| Empresa     | `bnfe.empresa`      | `Empresa`   | Cadastro de empresas e certificados (requer `userToken`) |

Estrutura de diretórios:

```
src/
├── brasilnfe.ts           # Classe agregadora
├── brasilnferequest.ts    # Camada HTTP (axios) + headers
├── helper.ts              # BrasilNFeHelper (rateio)
├── methods/               # Módulos de alto nível
│   ├── notafiscal.ts
│   ├── eventos.ts
│   ├── consultas.ts
│   ├── arquivos.ts
│   └── empresa.ts
└── models/                # Interfaces TS (payloads e retornos)
    ├── NotaFiscal/
    ├── Eventos/
    ├── Consultas/
    ├── Empresa/
    ├── Arquivos/
    └── Outros/
```

## Guia Rápido

```ts
import { BrasilNFe, StatusSefazEnvio } from 'brasilnfe';

const bnfe = new BrasilNFe('SEU_TOKEN');

const req: StatusSefazEnvio = {
    ModeloDocumento: 55,
    TipoAmbiente: 2, // homologação
};

const resp = await bnfe.consultas.statusSefaz(req);
console.log(resp.StatusSefaz?.DsStatusRespostaSefaz ?? 'indisponível');
```

## Exemplos

### 1. Emitir NF-e (modelo 55)

```ts
import { BrasilNFe, NotaFiscalEnvio } from 'brasilnfe';

const bnfe = new BrasilNFe('SEU_TOKEN');

const nf: NotaFiscalEnvio = {
    TipoAmbiente: 2,       // 1 = Produção, 2 = Homologação
    ModeloDocumento: 55,   // NF-e
    Finalidade: 1,         // Normal
    NaturezaOperacao: 'VENDA DE MERCADORIA',
    IndicadorPresenca: 1,
    ConsumidorFinal: false,
    EnviarEmail: true,

    Cliente: {
        CpfCnpj: '00000000000191',
        NmCliente: 'EMPRESA EXEMPLO LTDA',
        IndicadorIe: 1, // Contribuinte ICMS
        Ie: '123456789',
        Contato: { Email: 'financeiro@cliente.com.br' },
        Endereco: {
            Logradouro: 'Av. Industrial',
            Numero: '500',
            Bairro: 'Distrito Industrial',
            CodMunicipio: '3550308',
            Municipio: 'São Paulo',
            Uf: 'SP',
            Cep: '01000000',
        },
    },

    Produtos: [
        {
            CodProdutoServico: 'COD-100',
            NmProduto: 'PARAFUSADEIRA ELETRICA 220V',
            NCM: '84672100',
            CFOP: 5102,
            UnidadeComercial: 'UN',
            Quantidade: 2,
            ValorUnitario: 150.00,
            ValorTotal: 300.00,
            OrigemProduto: 0,
            Imposto: {
                ICMS:   { CodSituacaoTributaria: '102', AliquotaICMS: 0 },
                PIS:    { CodSituacaoTributaria: '99',  Aliquota: 0 },
                COFINS: { CodSituacaoTributaria: '99',  Aliquota: 0 },
            },
        },
    ],

    Pagamentos: [
        { IndicadorPagamento: 0, FormaPagamento: '15', VlPago: 300.00 },
    ],

    Transporte: {
        ModalidadeFrete: 0, // CIF
        Volume: {
            QuantidadeVolume: 2,
            Especie: 'CAIXA',
            PesoBruto: 5.500,
            PesoLiquido: 5.000,
        },
    },
};

try {
    const resp = await bnfe.notaFiscal.enviarNotaFiscal(nf);

    if (resp.ReturnNF?.Ok) {
        console.log('✅ NF-e autorizada!');
        console.log('Chave:     ', resp.ReturnNF.ChaveNF);
        console.log('Protocolo: ', resp.ReturnNF.Numero);
        console.log('PDF:       ', resp.Base64File ? 'recebido' : 'não gerado');
    } else {
        console.log('⚠️  Rejeitada:', resp.ReturnNF?.DsStatusRespostaSefaz);
        resp.erros?.forEach(e => console.log(` - [${e.codigo}] ${e.descricao}`));
    }
} catch (err: any) {
    console.error('❌ Erro de comunicação:', err.message);
}
```

### 2. Emitir NFC-e (modelo 65)

```ts
import { NotaFiscalEnvio } from 'brasilnfe';

const nfce: NotaFiscalEnvio = {
    TipoAmbiente: 2,
    ModeloDocumento: 65,       // NFC-e
    Finalidade: 1,
    NaturezaOperacao: 'VENDA AO CONSUMIDOR',
    IndicadorPresenca: 1,
    ConsumidorFinal: true,     // obrigatório em NFC-e

    Cliente: {
        CpfCnpj: '12345678909', // opcional em valores baixos
    },

    Produtos: [
        {
            CodProdutoServico: 'REFRI-LATA',
            NmProduto: 'REFRIGERANTE LATA 350ML',
            NCM: '22021000',
            CFOP: 5102,
            UnidadeComercial: 'UN',
            Quantidade: 1,
            ValorUnitario: 5.00,
            ValorTotal: 5.00,
            OrigemProduto: 0,
            Imposto: {
                ICMS:   { CodSituacaoTributaria: '102', AliquotaICMS: 0 },
                PIS:    { CodSituacaoTributaria: '99',  Aliquota: 0 },
                COFINS: { CodSituacaoTributaria: '99',  Aliquota: 0 },
            },
        },
    ],

    Pagamentos: [
        {
            IndicadorPagamento: 0,
            FormaPagamento: '03',      // Cartão de crédito
            VlPago: 5.00,
            BandeiraOperadora: '01',   // Visa
        },
    ],
};

const resp = await bnfe.notaFiscal.enviarNotaFiscal(nfce);
```

### 3. Emitir NF-e em lote

```ts
import { NotaFiscalLoteEnvio } from 'brasilnfe';

const lote: NotaFiscalLoteEnvio = {
    TipoAmbiente: 2,
    ModeloDocumento: 55,
    nFInfos: pedidos.map((pedido) => ({
        TipoAmbiente: 2,
        ModeloDocumento: 55,
        Finalidade: 1,
        NaturezaOperacao: 'VENDA DE MERCADORIA',
        Cliente: { /* … */ },
        Produtos: [ /* … */ ],
        Pagamentos: [ /* … */ ],
    })),
};

const resp = await bnfe.notaFiscal.enviarNotaFiscalLote(lote);
console.log('Chave da 1ª nota:', resp.ReturnNF?.ChaveNF);
```

### 4. Emitir NFS-e

```ts
import { NotaFiscalServicoEnvio } from 'brasilnfe';

const nfse: NotaFiscalServicoEnvio = {
    TipoAmbiente: 2,
    // … preencha tomador, serviço, valores conforme sua prefeitura
};

const resp = await bnfe.notaFiscal.enviarNotaFiscalServico(nfse);
```

### 5. Emitir CT-e

```ts
import { CTeEnvio } from 'brasilnfe';

const cte: CTeEnvio = {
    TipoAmbiente: 2,
    ModeloDocumento: 57,
    TipoCte: 0,                 // 0 = Normal
    NaturezaOperacao: 'PRESTAÇÃO DE SERVIÇO DE TRANSPORTE',
    // preencha Remetente, Destinatário, Tomador, Serviço, Carga, Modal, Imposto…
};

const resp = await bnfe.notaFiscal.enviarConhecimentoTransporte(cte);
console.log('Chave CT-e:', resp.chave);
```

### 6. Emitir DC-e (Declaração de Conteúdo)

```ts
import { DCeEnvio } from 'brasilnfe';

const dce: DCeEnvio = {
    TipoAmbiente: 2,
    TipoEmitente: 3,            // 3 = Transportadora
    ModalidadeTransporte: 2,
    Remetente: {
        CpfCnpj: '00000000000191',
        Nome: 'EMPRESA EXEMPLO LTDA',
        Endereco: { Cep: '01000000', Uf: 'SP', Municipio: 'São Paulo' },
    },
    Destinatario: {
        CpfCnpj: '12345678909',
        Nome: 'JOÃO DA SILVA',
        Endereco: { Cep: '30130000', Uf: 'MG', Municipio: 'Belo Horizonte' },
    },
    Itens: [
        {
            Descricao: 'Livros didáticos',
            NCM: '4901',
            Quantidade: 3,
            ValorUnitario: 80.00,
            ValorTotal: 240.00,
        },
    ],
    ValorTotal: 240.00,
};

const resp = await bnfe.notaFiscal.enviarDeclaracaoConteudo(dce);
```

### 7. Cancelar NF-e

```ts
import { CancelarNotaFiscalEnvio } from 'brasilnfe';

const cancel: CancelarNotaFiscalEnvio = {
    ChaveNF: '35230100000000000000550010000000011000000000',
    NumeroProtocolo: '135230000000000',
    Justificativa: 'Erro de digitação no valor do produto',
    TipoAmbienteNFSe: 2,
};

const resp = await bnfe.eventos.cancelarNotaFiscal(cancel);
console.log('Status:', resp.Status);
```

### 8. Carta de Correção (CC-e)

```ts
import { CartaCorrecaoEnvio } from 'brasilnfe';

const cce: CartaCorrecaoEnvio = {
    TipoAmbiente: 1,
    ChaveNF: '35230100000000000000550010000000011000000000',
    Correcao: 'Correção na descrição do produto item 1',
    NumeroSequencial: 1,
};

await bnfe.eventos.enviarCartaCorrecao(cce);
```

### 9. Inutilizar numeração

```ts
import { InutilizarNumeracaoEnvio } from 'brasilnfe';

const inut: InutilizarNumeracaoEnvio = {
    TipoAmbiente: 1,
    ModeloDocumento: 55,
    Serie: 1,
    NumeracaoInicial: 101,
    NumeracaoFinal: 105,
    Justificativa: 'Falha no sistema durante emissão sequencial',
};

await bnfe.eventos.inutilizarNumeracao(inut);
```

### 10. Manifestar NF-e de entrada

```ts
import { ManifestarNotaFiscalEnvio } from 'brasilnfe';

const evt: ManifestarNotaFiscalEnvio = {
    Chave: '35230100000000000000550010000000011000000000',
    TipoAmbiente: 1,
    TipoManifestacao: 1, // 1=Confirmação, 2=Ciência, 3=Desconhecimento, 4=Não realizada
};

await bnfe.eventos.manifestarNotaFiscal(evt);
```

### 11. Consultar status da SEFAZ

```ts
import { StatusSefazEnvio } from 'brasilnfe';

const req: StatusSefazEnvio = { TipoAmbiente: 2, ModeloDocumento: 55 };
const resp = await bnfe.consultas.statusSefaz(req);
console.log(resp.StatusSefaz?.DsStatusRespostaSefaz);
```

### 12. Buscar notas por período

```ts
import { BuscarNotaFiscalEnvio } from 'brasilnfe';

const busca: BuscarNotaFiscalEnvio = {
    TipoDocumentoFiscal: 1,                   // 0 = Entradas, 1 = Saídas
    DtInicio: '2026-04-01T00:00:00',
    DtFim:    '2026-04-18T23:59:59',
};

const resp = await bnfe.consultas.buscarNotaFiscal(busca);
```

### 13. Baixar XML / DANFE

```ts
import { PegarArquivoEnvio } from 'brasilnfe';
import { writeFileSync } from 'node:fs';

const req: PegarArquivoEnvio = {
    ChaveNF: '35230100000000000000550010000000011000000000',
    FileType: 2,                 // 1 = XML, 2 = DANFE/Cupom
    TipoDocumentoFiscal: 1,      // 0 = Entrada, 1 = Saída
};

const buffer = await bnfe.arquivos.pegarArquivo(req); // já vem decodificado de base64
writeFileSync('danfe.pdf', buffer);
```

### 14. Gerar SPED e Sintegra

```ts
import { SpedEnvio, SintegraEnvio } from 'brasilnfe';

const sped: SpedEnvio = { /* período, tipo, finalidade… */ };
const respSped = await bnfe.arquivos.obterArquivoSped(sped);

const sintegra: SintegraEnvio = { /* … */ };
const respSintegra = await bnfe.arquivos.obterArquivoSintegra(sintegra);
```

### 15. Gestão de empresas e certificados

> Requer `userToken` no construtor de `BrasilNFe`.

```ts
import { BrasilNFe, EmpresaEnvio, CertificadoEnvio } from 'brasilnfe';
import { readFileSync } from 'node:fs';

const bnfe = new BrasilNFe('TOKEN', 'USER_TOKEN');

// Cadastro
const empresa: EmpresaEnvio = {
    Cnpj: '00000000000191',
    RzSocial: 'EMPRESA EXEMPLO LTDA',
    Crt: 1,                         // 1=Simples, 3=Regime Normal
};
await bnfe.empresa.adicionarEmpresa(empresa);

// Certificado A1
const cert: CertificadoEnvio = {
    Base64Certificado: readFileSync('certificado.pfx').toString('base64'),
    Senha: 'senha-do-pfx',
};
await bnfe.empresa.alterarCertificado(cert);

// Listagem
const empresas = await bnfe.empresa.buscarTodasEmpresas();
```

## Referência de Métodos

### `notaFiscal`

| Método | Endpoint | Payload | Retorno |
|--------|----------|---------|---------|
| `enviarNotaFiscal` | `EnviarNotaFiscal` | `NotaFiscalEnvio` | `NotaFiscalRetorno` |
| `enviarNotaFiscalLote` | `EnviarNotaFiscalLote` | `NotaFiscalLoteEnvio` | `NotaFiscalRetorno` |
| `enviarNotaFiscalServico` | `EnviarNotaFiscalServico` | `NotaFiscalServicoEnvio` | `NotaFiscalServicoRetorno` |
| `enviarManifestoTransporte` | `EnviarManifestoTransporte` | `ManifestoTransporteEnvio` | `ManifestoTransporteRetorno` |
| `enviarNFEnerCom` | `EnviarNFEnerCom` | `NFEnerComEnvio` | `NFEnerComRetorno` |
| `enviarNotaFiscalComplementar` | `EnviarNotaFiscalComplementar` | `NotaFiscalComplementarEnvio` | `NotaFiscalRetorno` |
| `enviarConhecimentoTransporte` | `EnviarConhecimentoTransporte` | `CTeEnvio` | `CTeRetorno` |
| `enviarDeclaracaoConteudo` | `EnviarDeclaracaoConteudo` | `DCeEnvio` | `DCeRetorno` |

### `eventos`

| Método | Endpoint | Payload | Retorno |
|--------|----------|---------|---------|
| `cancelarNotaFiscal` | `CancelarNotaFiscal` | `CancelarNotaFiscalEnvio` | `EventoNotaFiscalRetorno` |
| `cancelarNF` | `CancelNF` | `CancelarNotaFiscalEnvio` | `EventoNotaFiscalRetorno` |
| `enviarCartaCorrecao` | `EnviarCartaCorrecao` | `CartaCorrecaoEnvio` | `EventoNotaFiscalRetorno` |
| `inutilizarNumeracao` | `InutilizarNumeracao` | `InutilizarNumeracaoEnvio` | `EventoNotaFiscalRetorno` |
| `manifestarNotaFiscal` | `ManifestarNotaFiscal` | `ManifestarNotaFiscalEnvio` | `EventoNotaFiscalRetorno` |
| `encerrarManifestoTransporte` | `EncerrarManifestoTransporte` | `EncerrarManifestoTransporteEnvio` | `EventoNotaFiscalRetorno` |

### `consultas`

| Método | Endpoint | Payload | Retorno |
|--------|----------|---------|---------|
| `statusSefaz` | `StatusSefaz` | `StatusSefazEnvio` | `StatusSefazRetorno` |
| `calcularImpostos` | `CalcularImpostos` | `Produto[]` | `CalculoImpostosRetorno` |
| `preVisualizarNotaFiscal` | `PreVisualizarNotaFiscal` | `PreVisualizarNotaFiscalEnvio` | `PreVisualizarNotaFiscalRetorno` |
| `buscarNotaFiscal` | `BuscarNotaFiscal` | `BuscarNotaFiscalEnvio` | `BuscarNotaFiscalRetorno` |
| `buscarNotaFiscalServico` | `BuscarNotaFiscalServico` | `BuscarNotaFiscalServicoEnvio` | `NotaFiscalServicoRetorno` |
| `consultarCadastroSefaz` | `ConsultarCadastroSefaz` | `ConsultarCadastroEnvio` | `ConsultarCadastroRetorno` |
| `buscarArquivoSped` | `BuscarArquivoSped/?codigo=` | `string` (código) | `SpedRetorno` |

### `arquivos`

| Método | Endpoint | Payload | Retorno |
|--------|----------|---------|---------|
| `obterArquivoSintegra` | `ObterArquivoSintegra` | `SintegraEnvio` | `SintegraRetorno` |
| `obterArquivoFci` | `ObterArquivoFci` | `FciEnvio` | `FciRetorno` |
| `obterArqEnerCom` | `ObterArquivoNFEnerCom` | `ArqEnerComEnvio` | `ArqEnerComRetorno` |
| `obterArquivoSped` | `ObterArquivoSped` | `SpedEnvio` | `SpedRetorno` |
| `obterArquivoSpedUnificado` | `ObterArquivoSpedUnificado` | `UnificarSpedEnvio` | `SpedRetorno` |
| `recriarArquivoSped` | `RecriarArquivoSped/?codigo=` | `string` (código) | `SpedRetorno` |
| `pegarArquivo` | `GetFile` | `PegarArquivoEnvio` | `Buffer` |
| `pegarArquivoEvento` | `GetFileFromEvent` | `PegarArquivoEventoEnvio` | `Buffer` |
| `obterArquivosPorRange` | `ObterArquivosPorRange` | `ObterArquivosRangeEnvio` | `ObterArquivosRangeRetorno` |

### `empresa`

| Método | Endpoint | Payload | Retorno |
|--------|----------|---------|---------|
| `alterarCertificado` | `AlterarCertificado` | `CertificadoEnvio` | `CertificadoRetorno` |
| `verificarCertificado` | `VerifyCertificate` | `CertificadoEnvio` | `CertificadoRetorno` |
| `adicionarEmpresa` | `AdicionarEmpresa` | `EmpresaEnvio` | `EmpresaRetorno` |
| `editarEmpresa` | `EditarEmpresa` | `EmpresaEnvio` | `EmpresaRetorno` |
| `buscarEmpresa` | `BuscarEmpresa` | — | `EmpresaEnvio` |
| `buscarTodasEmpresas` | `BuscarTodasEmpresas` | — | `EmpresaEnvio[]` |

## Compatibilidade retroativa

Versões anteriores do SDK Node usavam nomes de métodos e endpoints ligeiramente diferentes do SDK principal (C#/PHP). Esses nomes **continuam funcionando** como aliases, para não quebrar código existente:

| Método legado | Endpoint legado | Método recomendado |
|---------------|-----------------|--------------------|
| `consultas.consultarStatusSefaz` | `ConsultarStatusSefaz` | `consultas.statusSefaz` |
| `consultas.obterNotasFiscais` | `ObterNotasFiscais` | `consultas.buscarNotaFiscal` |
| `consultas.obterArquivoSped` | `ObterArquivoSped/?codigo=` | `consultas.buscarArquivoSped` |
| `arquivos.gerarArquivoSintegra` | `GerarArquivoSintegra` | `arquivos.obterArquivoSintegra` |
| `arquivos.gerarArquivoFci` | `GerarArquivoFci` | `arquivos.obterArquivoFci` |
| `arquivos.gerarArquivoSped` | `GerarArquivoSped` | `arquivos.obterArquivoSped` |
| `arquivos.unificarArquivoSped` | `UnificarArquivoSped` | `arquivos.obterArquivoSpedUnificado` |
| `arquivos.obterArquivoNotaFiscal` | `ObterArquivoNotaFiscal` | `arquivos.pegarArquivo` |
| `arquivos.obterArquivoEvento` | `ObterArquivoEvento` | `arquivos.pegarArquivoEvento` |
| `arquivos.obterArquivosPorPeriodo` | `ObterArquivosPorPeriodo` | `arquivos.obterArquivosPorRange` |

Para novos projetos, prefira sempre os métodos da tabela de [Referência de Métodos](#referência-de-métodos).

## Tratamento de Erros

O SDK rejeita a `Promise` com `Error` em dois casos:

1. **Falha de comunicação** (timeout, DNS, TLS).
2. **Resposta HTTP fora de 2xx**.

Rejeições da SEFAZ **não** lançam exceção — elas vêm dentro do objeto de retorno. Sempre verifique `ReturnNF?.Ok` (e os campos `Error` / `Avisos` / `erros` nos retornos que herdam de `Erros` / `NewError`).

```ts
try {
    const resp = await bnfe.notaFiscal.enviarNotaFiscal(nf);

    if (!resp.ReturnNF?.Ok) {
        console.log(`Rejeitada [${resp.ReturnNF?.CodStatusRespostaSefaz}] `
                  + `${resp.ReturnNF?.DsStatusRespostaSefaz}`);

        if (resp.Error) console.log('Erro:', resp.Error);
        resp.Avisos?.forEach(a => console.log('Aviso:', a));
        return;
    }

    console.log('Autorizada: chave', resp.ReturnNF.ChaveNF);
} catch (err: any) {
    console.error('Falha na integração Brasil NFe:', err.message);
}
```

## Tabelas de Referência

### Modelos de documento

| Código | Documento |
|--------|-----------|
| 55 | NF-e |
| 57 | CT-e |
| 58 | MDF-e |
| 65 | NFC-e |

### `TipoAmbiente`

| Código | Ambiente |
|--------|----------|
| 1 | Produção |
| 2 | Homologação |

### `Finalidade` (NF-e)

| Código | Finalidade |
|--------|-----------|
| 1 | Normal |
| 2 | Complementar |
| 3 | Ajuste |
| 4 | Devolução / Retorno |

### `IndicadorPresenca`

| Código | Descrição |
|--------|-----------|
| 0 | Não se aplica |
| 1 | Operação presencial |
| 2 | Operação não presencial, Internet |
| 3 | Operação não presencial, teleatendimento |
| 4 | NFC-e com entrega em domicílio |
| 5 | Presencial fora do estabelecimento |
| 9 | Operação não presencial, outros |

### `IndicadorIe` (destinatário)

| Código | Situação |
|--------|----------|
| 1 | Contribuinte ICMS (IE obrigatória) |
| 2 | Contribuinte isento |
| 9 | Não contribuinte |

### `ModalidadeFrete`

| Código | Descrição |
|--------|-----------|
| 0 | Por conta do Remetente (CIF) |
| 1 | Por conta do Destinatário (FOB) |
| 2 | Por conta de Terceiros |
| 3 | Transporte próprio, conta do Remetente |
| 4 | Transporte próprio, conta do Destinatário |
| 9 | Sem ocorrência de transporte |

### `FormaPagamento`

| Código | Forma |
|--------|-------|
| 01 | Dinheiro |
| 02 | Cheque |
| 03 | Cartão de Crédito |
| 04 | Cartão de Débito |
| 05 | Crediário / Private Label |
| 10–13 | Vales (Alimentação, Refeição, Presente, Combustível) |
| 14 | Duplicata Mercantil |
| 15 | Boleto Bancário |
| 16 | Depósito Bancário |
| 17 | PIX Dinâmico |
| 18 | Transferência / Carteira Digital |
| 19 | Programa de fidelidade / cashback |
| 20 | PIX Estático |
| 90 | Sem pagamento |
| 99 | Outros |

### `TipoManifestacao`

| Código | Evento |
|--------|--------|
| 1 | Confirmação da Operação |
| 2 | Ciência da Operação |
| 3 | Desconhecimento da Operação |
| 4 | Operação não Realizada |

### `Crt` (Empresa)

| Código | Regime |
|--------|--------|
| 1 | Simples Nacional |
| 2 | Simples Nacional — Excesso de sublimite |
| 3 | Regime Normal |

## Ambientes

- **Homologação**: envie `TipoAmbiente: 2` em cada requisição. Ideal para testes; nenhuma nota tem validade fiscal.
- **Produção**: `TipoAmbiente: 1`. A partir daqui a nota é real — o usuário e CNPJ precisam estar devidamente autorizados no painel Brasil NFe e com certificado digital A1 válido.

A URL base padrão é `https://api.brasilnfe.com.br/services/` — a mesma para homologação e produção. O ambiente é sempre determinado pelo campo do payload.

## Como o SDK serializa o payload

O SDK usa `axios` configurado em `BrasilNFeRequest`:

- Payloads são enviados como JSON (`application/json`).
- As propriedades respeitam o casing esperado pela API (geralmente `PascalCase` nos módulos NF-e/Eventos, `camelCase` nos módulos novos).
- Todas as chamadas são `POST` para a URL base + nome do método.
- Toda requisição envia os headers:

  ```
  Content-Type:    application/json
  Accept:          application/json
  Token:           <seu token>
  UserToken:       <user token, se houver>
  Package-Version: 1.22.3
  Package-Type:    node.js
  ```

- Timeout padrão: **300s** (5 minutos).
- Arquivos binários (XML/DANFE) são devolvidos em `Buffer` — o SDK decodifica o base64 automaticamente.

## Utilitário BrasilNFeHelper

A classe `BrasilNFeHelper` expõe um método estático para **ratear valores proporcionalmente** entre itens (útil para distribuir frete, desconto ou seguro entre produtos da nota):

```ts
import { BrasilNFeHelper, TipoRateio } from 'brasilnfe';

BrasilNFeHelper.ratear(
    nf.Produtos!,
    50.00,                                    // valor total a distribuir (ex.: frete)
    (p) => p.ValorFrete ?? 0,                 // seletor do campo atual
    (p) => p.ValorTotal ?? 0,                 // seletor da proporção (base)
    TipoRateio.Somar,                         // Substituir | Somar | Subtrair
    (p, novoValor) => { p.ValorFrete = novoValor; }, // atualizador
);
```

## Licença

Distribuído sob a licença **ISC**.

## Suporte

- **Site:** https://www.brasilnfe.com.br
- **E-mail:** contato@brasilnfe.com.br
- **WhatsApp:** [+55 (31) 9 7168-5947](https://wa.me/5531971685947)

Desenvolvido por **BRASIL NFE LTDA** — CNPJ 39.658.743/0001-99.
