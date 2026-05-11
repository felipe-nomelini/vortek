import { Erros } from '../Outros/Erros';
export interface EmpresaRetorno extends Erros {
    token?: string;
    status?: boolean;
}
