import { Erros } from '../Outros/Erros';
export interface NotaFiscalRetorno extends Erros {
    ReturnNF?: RetornoInfo;
    Base64Xml?: string;
    Base64File?: string;
}
export interface RetornoInfo {
    Numero?: number;
    Serie?: number;
    ChaveNF?: string;
    CodTipoAmbiente?: number;
    DsTipoAmbiente?: string;
    CodStatusRespostaSefaz?: number;
    DsStatusRespostaSefaz?: string;
    Ok?: boolean;
    Detalhes?: DetalhesNF;
}
export interface DetalhesNF {
    valorNf?: number;
    valorIcms?: number;
    valorIpi?: number;
    valorPis?: number;
    valorCofins?: number;
}
export interface NotaFiscalLoteListRetorno {
    ReturnNF?: RetornoInfo;
    Base64Xml?: string;
    Base64File?: string;
    IdentificadorInterno?: string;
}
export interface NotaFiscalLoteRetorno extends Erros {
    Notas?: NotaFiscalLoteListRetorno[];
}
