import { NewError } from '../Outros/Erros';
import { NewPessoa } from '../Outros/Pessoa';
export interface ArqEnerComEnvio {
    /**
     * Tipo de geração de arquivo
     * 1 - Gera o arquivo a partir das notas enviadas no período informado.
     * 2 - Gera o arquivo a partir da lista de notas.
     */
    tipoGeracao?: number;
    /**
     * Mês de emissão da notas
     */
    mes?: number;
    /**
     * Ano de emissão da notas
     */
    ano?: number;
    /**
     * Tipo de ambiente
     * 1 - Produção
     * 2 - Homologação
     */
    tipoAmbiente?: number;
    /**
     * Notas Fiscais de Energia, Comunicação e Telecomunicações
     */
    notas?: NFEnerComEnvio[];
}
export interface NFEnerComEnvio {
    /**
     * Modelo do Documento
     * 6 - Energia elétrica
     * 21 - Comunicação
     * 22 - Telecomunicação
     */
    modeloDocumento?: number;
    /**
     * Tipo de ambiente
     * 1 - Produção
     * 2 - Homologação
     */
    tipoAmbiente?: number;
    /**
     * Código de controle interno unico da venda. Evita duplicidades, caso configurado.
     */
    identificadorInterno?: string;
    /**
     * Série da nota fiscal. Quando não informado é controlado pelo Painel
     */
    serie?: string;
    /**
     * Número da nota fiscal. Quando não informado é controlado pelo Painel
     */
    numero?: number;
    /**
     * Situação do documento (Padrão 4)
     * 1 - documento fiscal cancelado dentro do mesmo período de apuração;
     * 2 - documento fiscal emitido em substituição a um documento fiscal cancelado dentro do mesmo período de apuração
     * 3 - documento fiscal complementar
     * 4 - demais casos
     */
    situacao?: number;
    /**
     * Valor total da fatura comercial
     */
    valorTotalFatura?: number;
    /**
     * Data de emissão do documento
     */
    dataEmissao?: string;
    /**
     * Informações referente a nota de comunicação e Telecomunicação
     */
    comunicao?: Comunicao;
    /**
     * Informações referente a nota de Energia
     */
    energia?: Energia;
    /**
     * Informações do Destinatário
     */
    destinatario?: Destinatario;
    /**
     * Produtos para gerar os registros do arquivo
     */
    produtos?: EnerComProduto[];
}
export interface Comunicao {
    /**
     * Tipo de Utilização
     * 1 - Telefonia
     * 2 - Comunicação de dados
     * 3 - TV por assinatura
     * 4 - Provimento de acesso à internet
     * 5 - Multimídia
     * 6 - Outros
     */
    tipoUtilizacao?: number;
    /**
     * Tipo de Assinate
     * 1 - Comercial/Industrial
     * 2 - Poder público
     * 3 - Residencial/Pessoa física
     * 4 - Público
     * 5 - Semi-público
     * 6 - Outros
     */
    tipoAssinante?: number;
}
export interface Energia {
    /**
     * Código Classe de Consumo
     * 1 - Comercial
     * 2 - Consumo próprio
     * 3 - Iluminação pública
     * 4 - Industrial
     * 5 - Poder público
     * 6 - Residencial
     * 7 - Rural
     * 8 - Serviço Público
     */
    classeConsumo?: number;
    /**
     * Código da subclasse de consumo de energia elétrica.
     * 1 - Residencial
     * 2 - Residencial baixa renda
     * 3 - Residencial baixa renda indígena
     * 4 - Residencial baixa renda quilombola
     * 5 - Residencial baixa renda benefício de prestação continuada da assistência social
     * 6 - Residencial baixa renda multifamiliar
     * 7 - Comercial
     * 8 - Serviços de transporte, exceto tração elétrica
     * 9 - Serviços de comunicação e telecomunicação
     * 10 - Associação e entidades filantrópicas
     * 11 - Templos religiosos
     * 12 - Administração condominial: iluminação e instalações de uso comum de prédio ou conjunto de edificações
     * 13 - Iluminação em rodovias: solicitada por quem detenha concessão ou autorização para administração em rodovias
     * 14 - Semáforos, radares e câmeras de monitoramento de trânsito, solicitados por quem detenha concessão ou autorização para controle de trânsito
     * 15 - Outros serviços e outras atividades da classe comercial
     * 16 - Agropecuária rural
     * 17 - Agropecuária urbana
     * 18 - Residencial rural
     * 19 - Cooperativa de eletrificação rural
     * 20 - Agroindustrial
     * 21 - Serviço público de irrigação rural
     * 22 - Escola agrotécnica
     * 23 - Aquicultura
     * 24 - Poder público Federal
     * 25 - Poder Público Estadual ou Distrital
     * 26 - Poder público Municipal
     * 27 - Tração Elétrica
     * 28 - Água esgoto ou saneamento
     * 99 - Outros
     */
    subClasseConsumo?: number;
    /**
     * Código do grupo de tensão
     * 1 - A1 - Alta tensão (230kV ou mais)
     * 2 - A2 - Alta tensão (88 a 138kV)
     * 3 - A3 - Alta tensão (69kV)
     * 4 - A3a - Alta tensão (30kV a 44kV)
     * 5 - A4 - Alta tensão (2,3kV a 25kV)
     * 6 - AS - Alta tensão subterrâneo
     * 7 - B1 - Residencial
     * 8 - B1 - Residencial baixa renda
     * 9 - B2 - Rural
     * 10 - B2 - Cooperativa de eletrificação rural
     * 11 - B2 - Serviço público de irrigação
     * 12 - B3 - Demais classes
     * 13 - B4a - Iluminação pública - rede de distribuição
     * 14 - B4b - Iluminação pública - bulbo de lâmpada
     */
    grupoTensao?: number;
    tarifaAplicada?: number;
    dataLeituraAnterior?: string;
    dataLeituraAtual?: string;
}
export interface Destinatario extends NewPessoa {
    /**
     * Código interno que identifica o destinatário
     */
    codigo?: string;
    /**
     * CFP ou CNPJ
     */
    cpfCnpj?: string;
    /**
     * Inscrição Estadual
     */
    ie?: string;
    /**
     * Razão Social
     */
    razaoSocial?: string;
}
export interface EnerComProduto {
    /**
     * Código interno que identifica item
     */
    codigo?: string;
    /**
     * Descrição do item
     */
    descricao?: string;
    /**
     * Código de classificação do serviço
     */
    codClassificacao?: string;
    /**
     * Código CFOP
     */
    cfop?: number;
    /**
     * Unidade de Medida
     */
    unidadeMedida?: string;
    /**
     * Quantidade de itens
     */
    quantidade?: number;
    /**
     * Valor unitário do item
     */
    valor?: number;
    /**
     * Desconto total aplicado no item
     */
    desconto?: number;
    /**
     * Acréscimos e Despesas Acessórias
     */
    outrasDespesas?: number;
    /**
     * Alíquota de Icms
     */
    aliqIcms?: number;
    /**
     * Alíquota de PIS
     */
    aliqPis?: number;
    /**
     * Alíquota de Cofins
     */
    aliqCofins?: number;
    /**
     * Código do grupo tributário cadastrado no Painel, para automação de impostos
     */
    codTributacao?: string;
}
export interface ArqEnerComRetorno extends NewError {
    /**
     * Base64 contendo o arquivo em zip
     */
    base64Zip?: string;
}
export interface NFEnerComRetorno extends NewError {
}
