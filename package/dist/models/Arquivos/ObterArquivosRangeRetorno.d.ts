import { Erros } from '../Outros/Erros';
export interface ObterArquivosRangeRetorno extends Erros {
    Quantidade?: number;
    Base64FilesCompacted?: string;
}
