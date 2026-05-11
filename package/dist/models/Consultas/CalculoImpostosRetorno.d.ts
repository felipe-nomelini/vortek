import { Erros } from '../Outros/Erros';
export interface CalculoImpostosRetorno extends Erros {
    Impostos?: Impostos;
    Total?: Total;
}
export interface Impostos {
    BaseCalculoICMS?: number;
    BaseCalculoICMSST?: number;
    ValorICMS?: number;
    ValorICMSST?: number;
    ValorICMSDesoneracao?: number;
    ValorIPI?: number;
    ValorPIS?: number;
    ValorCOFINS?: number;
    ValorFCP?: number;
    ValorFCPST?: number;
    ValorFCPSTRetido?: number;
    ValorImportacao?: number;
}
export interface Total {
    ValorFrete?: number;
    ValorDesconto?: number;
    ValorSeguro?: number;
    ValorDespesasAcessorias?: number;
    ValorTributosAproximados?: number;
    ValorProdutos?: number;
    ValorTotal?: number;
}
