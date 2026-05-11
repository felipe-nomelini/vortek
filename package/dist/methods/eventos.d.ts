import { BrasilNFeRequest } from '../brasilnferequest';
import { CancelarNotaFiscalEnvio, CartaCorrecaoEnvio, InutilizarNumeracaoEnvio, ManifestarNotaFiscalEnvio, EncerrarManifestoTransporteEnvio, EventoNotaFiscalRetorno } from '../models';
export declare class Eventos extends BrasilNFeRequest {
    constructor(token: string, url: string);
    cancelarNotaFiscal(envio: CancelarNotaFiscalEnvio): Promise<EventoNotaFiscalRetorno>;
    cancelarNF(envio: CancelarNotaFiscalEnvio): Promise<EventoNotaFiscalRetorno>;
    enviarCartaCorrecao(envio: CartaCorrecaoEnvio): Promise<EventoNotaFiscalRetorno>;
    inutilizarNumeracao(envio: InutilizarNumeracaoEnvio): Promise<EventoNotaFiscalRetorno>;
    manifestarNotaFiscal(envio: ManifestarNotaFiscalEnvio): Promise<EventoNotaFiscalRetorno>;
    encerrarManifestoTransporte(envio: EncerrarManifestoTransporteEnvio): Promise<EventoNotaFiscalRetorno>;
}
