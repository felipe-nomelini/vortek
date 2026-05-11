import { Pessoa } from '../Outros/Pessoa';
export interface ConsultarCadastroRetorno extends Pessoa {
    cpfCnpj?: string;
    ie?: string;
    ieUnica?: string;
    ieAtual?: string;
    razaoSocial?: string;
    nomeFantasia?: string;
    regimeApuracao?: string;
    cnaePrincipal?: string;
    dataInicioAtividade?: string;
    dataUltimaAlteracaoCadastral?: string;
    dataOcorrenciaBaixa?: string;
    ufConsultada?: string;
    /**
     * Situação do contribuinte: 0 - não habilitado; 1 - habilitado.
     */
    situacao?: number;
    /**
     * Indicador de contribuinte credenciado a emitir NF-e.
     * 0 - Não credenciado para emissão da NF-e;
     * 1 - Credenciado;
     * 2 - Credenciado com obrigatoriedade para todas operações;
     * 3 - Credenciado com obrigatoriedade parcial;
     * 4 – a SEFAZ não fornece a informação. Este indicador significa apenas que o contribuinte é credenciado para emitir NF-e na SEFAZ consultada.
     */
    indicadorCredenciamentoNFe?: number;
    /**
     * Indicador de contribuinte credenciado a emitir CT-e.
     * 0 - Não credenciado para emissão da CT-e;
     * 1 - Credenciado;
     * 2 - Credenciado com obrigatoriedade para todas operações;
     * 3 - Credenciado com obrigatoriedade parcial;
     * 4 – a SEFAZ não fornece a informação. Este indicador significa apenas que o contribuinte é credenciado para emitir CT-e na SEFAZ consultada.
     */
    indicadorCredenciamentoCTe?: number;
    /**
     * Status Consulta
     * 0 - Não Encontrada;
     * 1 - Encontrada;
     */
    status?: number;
}
