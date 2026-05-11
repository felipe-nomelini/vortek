import { Erros } from '../Outros/Erros';
export interface StatusSefazRetorno extends Erros {
    StatusSefaz?: StatusSefaz;
}
export interface StatusSefaz {
    Versao?: string;
    CodTipoAmbiente?: number;
    DsTipoAmbiente?: string;
    CodStatusRespostaSefaz?: number;
    DsStatusRespostaSefaz?: string;
    CodEstadoEmitente?: number;
    DsEstadoEmitente?: string;
}
