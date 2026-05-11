import { Erros } from '../Outros/Erros';
export interface SpedRetorno extends Erros {
    Status?: number;
    Codigo?: string;
    Registros?: string;
    Url?: string;
    Detalhamento?: Detalhamento;
}
export interface Detalhamento {
    SaldoCredorTransportarIcmsIpi?: number;
    DFes?: DetalhamentoDFe[];
}
export interface InfoAjuste {
    CodigoAjuste?: string;
    CodigoProduto?: string;
    Icms?: number;
    BcIcms?: number;
    Outros?: number;
}
export interface DetalhamentoDFe {
    TipoMovimentacao?: number;
    CpfCnpj?: string;
    Chave?: string;
    CfopCte?: number;
    DataMovimentacao?: string;
    Itens?: DetalhamentoDFeItem[];
    InfoAjustes?: InfoAjuste[];
}
export interface DetalhamentoDFeItem {
    NumeroItem?: number;
    CodigoProduto?: string;
    Cfop?: number;
    Ncm?: string;
    CstIcmsCsosn?: string;
    CstPis?: string;
    CstCofins?: string;
    CstIpi?: string;
    Quantidade?: number;
    ValorUnitario?: number;
    ValorTotal?: number;
    Desconto?: number;
    Outros?: number;
    Frete?: number;
    Icms?: number;
    AliquotaIcms?: number;
    Pis?: number;
    Cofins?: number;
    Ipi?: number;
}
