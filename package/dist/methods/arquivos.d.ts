import { BrasilNFeRequest } from '../brasilnferequest';
import { SintegraEnvio, FciEnvio, ArqEnerComEnvio, SpedEnvio, UnificarSpedEnvio, PegarArquivoEnvio, PegarArquivoEventoEnvio, ObterArquivosRangeEnvio, SintegraRetorno, FciRetorno, ArqEnerComRetorno, SpedRetorno, ObterArquivosRangeRetorno } from '../models';
export declare class Arquivos extends BrasilNFeRequest {
    constructor(token: string, url: string);
    obterArquivoSintegra(sintegraEnvio: SintegraEnvio): Promise<SintegraRetorno>;
    obterArquivoFci(fciEnvio: FciEnvio): Promise<FciRetorno>;
    obterArqEnerCom(arqEnerComEnvio: ArqEnerComEnvio): Promise<ArqEnerComRetorno>;
    obterArquivoSped(spedEnvio: SpedEnvio): Promise<SpedRetorno>;
    obterArquivoSpedUnificado(unificarSpedEnvio: UnificarSpedEnvio): Promise<SpedRetorno>;
    recriarArquivoSped(codigo: string): Promise<SpedRetorno>;
    pegarArquivo(pegarArquivoEnvio: PegarArquivoEnvio): Promise<Buffer>;
    pegarArquivoEvento(pegarArquivoEventoEnvio: PegarArquivoEventoEnvio): Promise<Buffer>;
    obterArquivosPorRange(pegarArquivosRangeEnvio: ObterArquivosRangeEnvio): Promise<ObterArquivosRangeRetorno>;
    gerarArquivoSintegra(sintegraEnvio: SintegraEnvio): Promise<SintegraRetorno>;
    gerarArquivoFci(fciEnvio: FciEnvio): Promise<FciRetorno>;
    gerarArquivoSped(spedEnvio: SpedEnvio): Promise<SpedRetorno>;
    unificarArquivoSped(unificarSpedEnvio: UnificarSpedEnvio): Promise<SpedRetorno>;
    obterArquivoNotaFiscal(pegarArquivoEnvio: PegarArquivoEnvio): Promise<Buffer>;
    obterArquivoEvento(pegarArquivoEventoEnvio: PegarArquivoEventoEnvio): Promise<Buffer>;
    obterArquivosPorPeriodo(pegarArquivosRangeEnvio: ObterArquivosRangeEnvio): Promise<ObterArquivosRangeRetorno>;
}
