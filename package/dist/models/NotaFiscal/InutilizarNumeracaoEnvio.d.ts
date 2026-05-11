export interface InutilizarNumeracaoEnvio {
    /**
     * Identificação do Ambiente
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    /**
     * Código do modelo do Documento Fiscal
     * 55 - NF-e
     * 65 - NFC-e
     * 57 - CT-e
     */
    ModeloDocumento?: number;
    /**
     * Série referente ao modelo do documento
     */
    Serie?: number;
    /**
     * Justificativa da inulização
     */
    Justificativa?: string;
    /**
     * Inicio da range numérico de inutilização
     */
    NumeracaoInicial?: number;
    /**
     * Final da range numérico de inutilização
     */
    NumeracaoFinal?: number;
}
