import { Erros } from '../Outros/Erros';
export interface BuscarNotaFiscalRetorno extends Erros {
    Notas?: BuscarNotaFiscalRetornoInfo[];
}
export interface BuscarNotaFiscalRetornoInfo {
    Chave?: string;
    IdentificadorInterno?: string;
    CodLote?: string;
    Numero?: number;
    /**
     * Modelo do documento fiscal
     * 10 - Nota Fiscal de Serviço (NFS-e)
     * 55 - Nota Fiscal Eletrônica (NF-e)
     * 65 - 65 - Nota Fiscal de Consumidor (NFC-e)
     * 57 - Conhecimento de Transporte Eletrônico (CT-e)
     * 58 - Manifesto Eletrônico de Documentos Fiscais (MDF-e)
     * 59 - Cupom Fiscal Eletrônico SAT (CFe SAT)
     */
    ModeloDocumento?: number;
    Valor?: number;
    ValorIcms?: number;
    CnpjEmissor?: string;
    NomeEmissor?: string;
    IeEmissor?: string;
    CnpjDestinatario?: string;
    NomeDestinatario?: string;
    NumeroProtocolo?: string;
    Cfops?: string;
    DigestValue?: string;
    /**
     * Status da nota fiscal:
     * 1 - Autorizado o uso
     * 2 - Documento Cancelado
     * 3 - Uso denegado
     */
    Status?: number;
    DtRecebimento?: string;
    DtEmissao?: string;
}
