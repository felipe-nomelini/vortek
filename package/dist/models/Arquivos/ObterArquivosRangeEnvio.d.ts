export interface ObterArquivosRangeEnvio {
    DtInicio?: string;
    DtFim?: string;
    /**
     * Tipo do documento fiscal (Padrão 1 - XML)
     * 0 - PDF
     * 1 - XML
     * 2 - EXCEL
     */
    Type?: number;
    /**
     * Tipo de ambiente (Padrão 1 - Produção)
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    /**
     * Tipo de ambiente (Padrão 1 - Saída)
     * 1 - Saídas
     * 2 - Entradas
     * 3 - Saídas e Entradas
     */
    TipoNota?: number;
    /**
     * Chaves pagar pegar notas fiscal especificas
     */
    Chaves?: string[];
    /**
     * CPFs ou CNPJs dos clientes das notas
     */
    cpfCnpjs?: string[];
    /**
     * Anexar todas as notas fiscais retornadas em um unico arquivo PDF
     */
    JuntarArquivosPDF?: boolean;
    /**
     * Incluir carta de correção emitidas no periodo
     */
    incluirCCe?: boolean;
    /**
     * Aplicar plano de ajustes de impostos
     */
    aplicarPlanoAjustes?: boolean;
}
