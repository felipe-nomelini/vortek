export interface PegarArquivoEnvio {
    Chaves?: string[];
    ChaveNF?: string;
    /**
     * Tipo do documento fiscal (Padrão 1 - XML)
     * 1 - XML
     * 2 - DANFE
     */
    FileType?: number;
    /**
     * Tipo do documento fiscal (Padrão 1 - Saída)
     * 0 - Entrada
     * 1 - Saída
     */
    TipoDocumentoFiscal?: number;
    Base64Logo?: string;
}
