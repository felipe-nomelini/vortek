import { BrasilNFeRequest } from '../brasilnferequest';
import { NotaFiscalEnvio, NotaFiscalLoteEnvio, NotaFiscalServicoEnvio, ManifestoTransporteEnvio, NFEnerComEnvio, NotaFiscalComplementarEnvio, CTeEnvio, DCeEnvio, NotaFiscalRetorno, NotaFiscalServicoRetorno, ManifestoTransporteRetorno, NFEnerComRetorno, CTeRetorno, DCeRetorno } from '../models';
export declare class NotaFiscal extends BrasilNFeRequest {
    constructor(token: string, url: string);
    enviarNotaFiscal(notaFiscal: NotaFiscalEnvio, crt?: number): Promise<NotaFiscalRetorno>;
    enviarNotaFiscalLote(notaFiscalLote: NotaFiscalLoteEnvio, crt?: number): Promise<NotaFiscalRetorno>;
    enviarNotaFiscalServico(notaFiscal: NotaFiscalServicoEnvio): Promise<NotaFiscalServicoRetorno>;
    enviarManifestoTransporte(manifestoTransporte: ManifestoTransporteEnvio): Promise<ManifestoTransporteRetorno>;
    enviarNFEnerCom(nFEnerComEnvio: NFEnerComEnvio): Promise<NFEnerComRetorno>;
    enviarNotaFiscalComplementar(notaFiscal: NotaFiscalComplementarEnvio): Promise<NotaFiscalRetorno>;
    enviarConhecimentoTransporte(cteEnvio: CTeEnvio): Promise<CTeRetorno>;
    enviarDeclaracaoConteudo(dceEnvio: DCeEnvio): Promise<DCeRetorno>;
}
