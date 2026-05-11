export interface EncerrarManifestoTransporteEnvio {
    /**
     * Ambiente de emissão do evento (Padrão 1)
     * 1 - Produção
     * 2 - Homologação
     */
    tipoAmbiente?: number;
    /**
     * Chave da MDF-e
     */
    chave?: string;
    /**
     * Descrição da correção da NF-e
     */
    protocolo?: string;
    /**
     * Número sequencial do evento
     */
    numeroSequencial?: number;
}
