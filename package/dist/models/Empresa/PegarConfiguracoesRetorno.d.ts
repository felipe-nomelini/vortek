import { Erros } from '../Outros/Erros';
export interface PegarConfiguracoesRetorno extends Erros {
    CodEstado?: number;
    NmEstado?: string;
    TipoEmpresa?: string;
    NmEmpresa?: string;
    NmFantazia?: string;
    CodIdCSC?: string;
    CSC?: string;
    CNPJ?: string;
    CNAE?: string;
    IE?: string;
    IEST?: string;
    IM?: string;
    CEP?: string;
    CodMunicipio?: number;
    Numero?: string;
    NmBairro?: string;
    Complemento?: string;
    Logradouro?: string;
    NmMunicipio?: string;
    Site?: string;
    ApenasSAT?: boolean;
    ModeloSAT?: number;
    NuAtivacao?: string;
    NuSAT?: string;
}
