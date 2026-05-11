export interface ManifestarNotaFiscalEnvio {
    Chave?: string;
    /**
     * Ambiente de emissão da NF-e (Padrão 1)
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    /**
     * Tipo da manifestação
     * 1 - Confirmacao da Operacao
     * 2 - Ciência da Operacao
     * 3 - Desconhecimento da Operacao
     * 4 - Operacao não Realizada
     */
    TipoManifestacao?: number;
    NumeroSequencial?: number;
}
