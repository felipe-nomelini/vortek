import { Erros } from '../Outros/Erros';
export interface EventoNotaFiscalRetorno extends Erros {
    DsMotivo?: string;
    DsEvento?: string;
    DsAmbiente?: string;
    NuProtocolo?: string;
    NumeroSequencial?: number;
    CodStatusRespostaSefaz?: number;
    /**
     * 1 - Evento Processado
     * 2 - Aguardando processamento do evento
     * 3 - Ocorreu um erro ao processar o evento
     */
    Status?: number;
}
