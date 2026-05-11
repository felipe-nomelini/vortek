export interface DesacordoCTeEnvio {
    /**
     * Tipo do Documento Fiscal:
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    Chave?: string;
    Observacao?: string;
    /**
     * Número sequencial do evento
     */
    NumeroSequencial?: number;
}
