import { BrasilNFeRequest } from '../brasilnferequest';
import { CertificadoEnvio, EmpresaEnvio, CertificadoRetorno, EmpresaRetorno } from '../models';
export declare class Empresa extends BrasilNFeRequest {
    constructor(token: string, url: string, userToken: string);
    alterarCertificado(certificado: CertificadoEnvio): Promise<CertificadoRetorno>;
    verificarCertificado(certificado: CertificadoEnvio): Promise<CertificadoRetorno>;
    adicionarEmpresa(empresa: EmpresaEnvio): Promise<EmpresaRetorno>;
    editarEmpresa(empresa: EmpresaEnvio): Promise<EmpresaRetorno>;
    buscarEmpresa(): Promise<EmpresaEnvio>;
    buscarTodasEmpresas(): Promise<EmpresaEnvio[]>;
}
