import { BrasilNFeRequest } from '../brasilnferequest';
import { StatusSefazEnvio, Produto, PreVisualizarNotaFiscalEnvio, BuscarNotaFiscalServicoEnvio, BuscarNotaFiscalEnvio, ConsultarCadastroEnvio, StatusSefazRetorno, CalculoImpostosRetorno, PreVisualizarNotaFiscalRetorno, NotaFiscalServicoRetorno, BuscarNotaFiscalRetorno, ConsultarCadastroRetorno, SpedRetorno } from '../models';
export declare class Consultas extends BrasilNFeRequest {
    constructor(token: string, url: string);
    statusSefaz(envio: StatusSefazEnvio): Promise<StatusSefazRetorno>;
    calcularImpostos(produtos: Produto[]): Promise<CalculoImpostosRetorno>;
    preVisualizarNotaFiscal(envio: PreVisualizarNotaFiscalEnvio): Promise<PreVisualizarNotaFiscalRetorno>;
    buscarNotaFiscalServico(envio: BuscarNotaFiscalServicoEnvio): Promise<NotaFiscalServicoRetorno>;
    buscarNotaFiscal(envio: BuscarNotaFiscalEnvio): Promise<BuscarNotaFiscalRetorno>;
    consultarCadastroSefaz(envio: ConsultarCadastroEnvio): Promise<ConsultarCadastroRetorno>;
    buscarArquivoSped(codigo: string): Promise<SpedRetorno>;
    consultarStatusSefaz(envio: StatusSefazEnvio): Promise<StatusSefazRetorno>;
    obterNotasFiscais(envio: BuscarNotaFiscalEnvio): Promise<BuscarNotaFiscalRetorno>;
    obterArquivoSped(codigo: string): Promise<SpedRetorno>;
}
