import { Erros } from '../Outros/Erros';
export interface SintegraRetorno extends Erros {
    Codigo?: string;
    Status?: boolean;
    Registros?: string;
    Detalhes?: Detalhes;
}
export interface Detalhes {
    ValorSaidasNFCe?: number;
    ValorSaidasNFe?: number;
    ValorSaidasCTe?: number;
    ValorEntradasNFe?: number;
    ValorEntradasCTe?: number;
    ValorInventario?: number;
}
