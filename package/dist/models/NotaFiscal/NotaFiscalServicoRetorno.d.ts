import { Erros } from '../Outros/Erros';
export interface NotaFiscalServicoRetorno extends Erros {
    /**
     * Data de recebimento do lote;
     */
    DataRecebimento?: string;
    /**
     * Número do lote enviado;
     */
    Lote?: number;
    /**
     * Código atrelado ao lote;
     * - Usado para busca de lotes
     */
    CodLote?: string;
    /**
     * Número de protocolo do lote
     */
    Protocolo?: string;
    /**
     * Código do ambiente de envio
     */
    CodTipoAmbiente?: number;
    /**
     * Descrição do ambiente de envio
     */
    DsTipoAmbiente?: string;
    /**
     * Municipio onde foi enviado
     */
    MunicipioEnvio?: string;
    /**
     * 1 - Lote processado
     * 2 - Aguardando processamento
     * 3 - Ocorreu um erro ao processar o lote
     * 4 - Ocorreu um erro ao analisar as informações do lote
     */
    StatusLote?: number;
    Notas?: NotaFiscalServicoRetornoInfo[];
    /**
     * Dados xml do lote, bytes em base64
     */
    Base64XmlLote?: string;
    /**
     * Tempo total da transmissão para prefeitura em milisegundos
     */
    TempoRequisicaoPrefeitura?: number;
}
export interface NotaFiscalServicoRetornoInfo {
    /**
     * Valores da NFS-e
     */
    Valores?: RetornoValores;
    /**
     * Informa se a NFS-e encontra-se cancelada
     */
    Cancelada?: boolean;
    /**
     * Número do RPS
     */
    NumeroRPS?: number;
    /**
     * Data da emissao da NFSe
     */
    DtEmissao?: string;
    /**
     * Cpf ou Cnpj do Prestador
     */
    CpfCnpjPrestador?: string;
    /**
     * Cpf ou Cnpj do Tomador
     */
    CpfCnpjTomador?: string;
    /**
     * Número da NFS-e
     */
    NumeroNFSe?: string;
    /**
     * Chave da NFS-e
     */
    Chave?: string;
    /**
     * Código de verificação da NFS-e
     */
    CodVerificacao?: string;
    /**
     * Identificador interno da nfs (enviado pela API)
     */
    IdentificadorInterno?: string;
    /**
     * 1 - NFSe Emitida
     * 3 - Erro ao emitir
     */
    Status?: number;
    /**
     * Descrição do erro caso a nota não for emitida
     */
    Erro?: string;
    /**
     * Dados xml da nfs, bytes em base64
     */
    Base64Xml?: string;
    /**
     * Documento pdf da nfs, bytes em base64
     */
    Base64Doc?: string;
}
export interface RetornoValores {
    /**
     * Base de cálculo
     */
    BaseCalculo?: number;
    /**
     * Valor Líquido
     */
    ValorLiquido?: number;
    /**
     * Valor ISS
     */
    ValorISS?: number;
    /**
     * Valor ISS Retido
     */
    ValorISSRetido?: number;
    /**
     * Valor PIS
     */
    ValorPIS?: number;
    /**
     * Valor COFINS
     */
    ValorCOFINS?: number;
    /**
     * Valor CSLL
     */
    ValorCSLL?: number;
    /**
     * Valor IR
     */
    ValorIR?: number;
    /**
     * Alíquota em %
     */
    Aliquota?: number;
}
