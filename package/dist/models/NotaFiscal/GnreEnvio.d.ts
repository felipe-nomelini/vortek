export interface GnreEnvio {
    TipoAmbiente?: number;
    GnreGuia?: GnreGuia[];
}
export interface GnreGuia {
    Favorecido?: Favorecido;
    ChaveDfe?: string;
    Valor?: number;
    DataPagamento?: string;
    DataVencimento?: string;
}
export interface Favorecido {
    CpfCnpj?: string;
    NmFavorecido?: string;
    CodMunicipio?: string;
    Uf?: string;
}
