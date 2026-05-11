import { Pessoa } from '../Outros/Pessoa';
export interface NotaFiscalServicoEnvio {
    TipoAmbiente?: number;
    Lote?: number;
    nFSInfo?: NFSInfo[];
}
export interface NFSInfo {
    EnviarEmail?: boolean;
    SerieRps?: string;
    NumeroRps?: number;
    IdentificadorInterno?: string;
    /**
     * Data da competência
     * Caso não informado será a data de emissão
     */
    DataCompetencia?: string;
    DataEmissao?: string;
    Tomador?: Tomador;
    Intermediario?: IntermediarioServico;
    ConstrucaoCivil?: ConstrucaoCivil;
    Servico?: Servico;
}
export interface Valores {
    ValorServico?: number;
    ValorInss?: number;
    Aliquota?: number;
    DescontoCondicionado?: number;
    DescontoIncondicionado?: number;
    OutrasRetencoes?: number;
    ValorDeducoes?: number;
    TotalTributos?: number;
    AliquotaIr?: number;
}
export interface ConfiguracaoImposto {
    /**
     * Indide 0,65% de PIS caso o valor for maior que R$215,05
     */
    IncidePis?: boolean;
    /**
     * Indide 3,00% de COFINS caso o valor for maior que R$215,05
     */
    IncideCofins?: boolean;
    /**
     * Indide 1,00% de CSLL caso o valor for maior que R$215,05
     */
    IncideCsll?: boolean;
    /**
     * Indide 1,50% (ou a alíquota informada em (Valores -> AliquotaIr)) de IR caso o valor for maior que R$666,66
     */
    IncideIr?: boolean;
    /**
     * Indide 0,65% de PIS independente do valor
     */
    ForcarIncidenciaPis?: boolean;
    /**
     * Indide 3,00% de COFINS independente do valor
     */
    ForcarIncidenciaCofins?: boolean;
    /**
     * Indide 1,00% de CSLL independente do valor
     */
    ForcarIncidenciaCsll?: boolean;
    /**
     * Indide 1,50% (ou a alíquota informada em (Valores -> AliquotaIr)) de IR independente do valor
     */
    ForcarIncidenciaIr?: boolean;
}
export interface Servico {
    Descricao?: string;
    /**
     * Código do Serviço ou Tributação Nacional para o ambiente Nacional
     */
    ItemListaServico?: string;
    /**
     * 0 - Sem Regime Especial
     * 1 - Microempresa municipal
     * 2 - Estimativa
     * 3 - Sociedade de profissionais
     * 4 - Cooperativa
     * 5 - MEI - Simples Nacional
     * 6 - ME EPP - Simples Nacional
     */
    RegimeEspecialTributacao?: number;
    /**
     * Natureza da Operação
     * Alguns municípios possui códigos específicos, para mais informações, veja a documentação: Municípios com códigos específicos
     * 1 - Tributação no município
     * 2 - Tributação fora do município
     * 3 - Isenção
     * 4 - Imune
     * 5 - Exigibilidade suspensa por decisão judicial
     * 6 - Exigibilidade suspensa por procedimento administrativo
     * 7 - Não tributada (Governador Valadares)
     */
    NaturezaOperacao?: number;
    /**
     * Incentio Cultural?
     * Sim - É incentivador cultural
     * Não - Não é incentivador cultiral
     */
    IncentivadorCultural?: boolean;
    /**
     * Incentivo Fiscal?
     * Sim - É incentivador fiscal
     * Não - Não é incentivador fiscal
     */
    IncentivoFiscal?: boolean;
    /**
     * Iss Retido?
     * Sim - Valor retido
     * Não - Valor não será retido
     */
    IssRetido?: boolean;
    /**
     * Código de tributação do município
     */
    CodTributacaoMunicipio?: string;
    /**
     * Código NBS (Nomenclatura Brasileira de Serviços).
     */
    CodNBS?: string;
    /**
     * Exigibilidade ISS (Padrão 1)
     * 1 - Exigível
     * 2 - Não incidência
     * 3 - Isenção
     * 4 - Exportação
     * 5 - Imunidade
     * 6 - Exigibilidade Suspensa por Decisão Judicia
     * 7 - Exigibilidade Suspensa por Processo Administrativo
     */
    ExigibilidadeISS?: number;
    /**
     * Código do municipio da incedência do serviço (Padrão - Município do Prestador)
     */
    CodMunicipioIncidencia?: string;
    /**
     * Código do municipio da prestação do serviço (Padrão - Município do Prestador)
     */
    CodMunicipioPrestacao?: string;
    Valores?: Valores;
    ConfiguracaoImposto?: ConfiguracaoImposto;
}
export interface IntermediarioServico {
    RzSocial?: string;
    CPFCNPJ?: string;
    InscricaoMunicipal?: string;
}
export interface ConstrucaoCivil {
    CodObra?: string;
    Art?: string;
}
export interface Tomador extends Pessoa {
    CpfCnpj?: string;
    NmTomador?: string;
    Im?: string;
    /**
     * NIF (Número de Identificação Fiscal) da pessoa.
     */
    Nif?: string;
}
