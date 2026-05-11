export interface BuscarNotaFiscalEnvio {
    /**
     * Tipo do documento fiscal (Padrão 0 - Entrada)
     * 0 - Entradas
     * 1 - Saídas
     */
    TipoDocumentoFiscal?: number;
    /**
     * Data inicial da busca
     */
    DtInicio?: string;
    /**
     * Data final da busca
     */
    DtFim?: string;
    /**
     * Busca notas que possui o código interno informado (somente saídas)
     */
    IndentificadorInterno?: string;
}
