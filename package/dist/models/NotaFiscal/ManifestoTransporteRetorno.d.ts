import { Erros } from '../Outros/Erros';
export interface ManifestoTransporteRetorno extends Erros {
    numero?: number;
    chave?: string;
    tipoAmbiente?: string;
    codRespostaSefaz?: number;
    /**
     * 1 - Lote processado
     * 2 - Aguardando processamento
     * 3 - Ocorreu um erro ao processar o lote
     */
    status?: number;
    base64Xml?: string;
    base64DAMDFe?: string;
}
