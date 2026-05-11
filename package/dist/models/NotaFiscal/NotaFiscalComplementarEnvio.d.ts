import { Cliente, Transporte, Cobranca, Produto } from './NotaFiscalEnvio';
export interface ImpostoComplementar {
    /**
     * Código da Situação Tributária (CST)
     */
    CodSituacaoTributaria?: string;
    /**
     * Alíquota ICMS
     */
    AliquotaICMS?: number;
    /**
     * Alíquota ICMSST
     */
    AliquotaICMSST?: number;
    /**
     * Base de cálculo do ICMS complementar
     */
    BaseCalculoICMS?: number;
    /**
     * Valor do complemento do ICMS
     */
    ValorICMS?: number;
    /**
     * Base de cálculo do ICMSST complementar
     */
    BaseCalculoICMSST?: number;
    /**
     * Valor do complemento do ICMSST
     */
    ValorICMSST?: number;
    /**
     * Base de cálculo do IPI
     */
    BaseCalculoIPI?: number;
    /**
     * Valor do complemento do IPI
     */
    ValorIPI?: number;
}
export interface NotaFiscalComplementarEnvio {
    /**
     * Tipo de complemento
     * 0 - Complementar quantidade ou valor
     * 1 - Complementar impostos
     */
    TipoComplemento?: number;
    /**
     * CFOP
     */
    CFOP?: number;
    /**
     * Série da nota Fiscal
     */
    Serie?: number;
    /**
     * Número da nota fiscal
     */
    Numero?: number;
    /**
     * Lote da Nota Fiscal
     */
    Lote?: number;
    /**
     * Código numérico que compõe a Chave de Acesso. Número aleatório gerado pelo emitente para cada NF-e.
     */
    Codigo?: string;
    /**
     * Notas fiscal de Referência
     */
    NFReferencia?: string;
    /**
     * Descrição da Natureza da Operação
     */
    NaturezaOperacao?: string;
    /**
     * Identificação do Ambiente
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    ObservacaoFisco?: string;
    Observacao?: string;
    Cliente?: Cliente;
    Transporte?: Transporte;
    Cobranca?: Cobranca;
    ImpostoComplementar?: ImpostoComplementar;
    Produtos?: Produto[];
}
