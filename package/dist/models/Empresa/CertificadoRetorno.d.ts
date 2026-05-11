import { Erros } from '../Outros/Erros';
export interface CertificadoRetorno extends Erros {
    Expirado?: boolean;
    DtExpiracao?: string;
    status?: boolean;
}
