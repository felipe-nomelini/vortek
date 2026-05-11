export interface CancelarNotaFiscalEnvio {
    /**
     * Chave da NF-e, NFC-e, MDF-e ou CFe-SAT
     */
    ChaveNF?: string;
    /**
     * Número do protocolo de transmissão do documento (Obrigatório caso a nota foi emitida por outro sistema)
     */
    NumeroProtocolo?: string;
    /**
     * Motivo do cancelamento do documento fiscal
     */
    Justificativa?: string;
    /**
     * Ambiente de emissão da NFS-e (Padrão 1)
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbienteNFSe?: number;
    /**
     * Data do evento de cancelamento do documento (Caso não for enviado é considerada a data e hora atual)
     */
    DataEvento?: string;
    /**
     * Número da NFS-e a ser cancelada
     */
    NumeroNFSe?: string;
    /**
     * Código do motivo de cancelamento da NFS-e (Padrão 1)
     * 1 - Erro na emissão
     * 2 - Serviço não prestado
     * 3 - Duplicidade da nota
     * 9 - Outros
     */
    CodCancelamentoNFSe?: number;
    /**
     * Tipo do documento fiscal (Padrão 0 - NF-e, NFC-e, CT-e, MDF-e, CFe-SAT)
     * 0 - NF-e, NFC-e, CT-e, MDF-e, CFe-SAT
     * 1 - NFS-e
     */
    TipoDocumento?: number;
    /**
     * Número sequencial do evento
     */
    NumeroSequencial?: number;
}
