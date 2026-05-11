import { Erros } from '../Outros/Erros';
export interface FciEnvio {
    /**
     * Produtos para gerar os registros do arquivo FCI
     */
    Produtos?: FciProduto[];
    /**
     * Quando verdadeiro retorna erro caso envie produtos com código repetido
     */
    ValidarCodigos?: boolean;
}
export interface FciProduto {
    /**
     * Código interno que identifica a mercadoria no estabelecimento
     */
    Codigo?: string;
    /**
     * Descrição da Mercadoria
     */
    Descricao?: string;
    /**
     * Código baseado na tabela da Nomenclatura Comum do MERCOSUL
     */
    Ncm?: string;
    /**
     * Código Global Trade Item Number, se houver
     */
    Gtin?: string;
    /**
     * Unidade a que se refere o valor de saída da mercadoria
     */
    UnidadeMedida?: string;
    /**
     * Valor de saída (comercialização) da mercadoria
     */
    ValorSaida?: number;
    /**
     * Valor da parcela importada do exterior (Obrigatório caso não for informado o Percentual Importado)
     */
    ValorImportado?: number;
    /**
     * Percentual do conteúdo de importação informado pelo contribuinte (Obrigatório caso não for informado o Valor Importado)
     */
    PercentualImportado?: number;
}
export interface FciRetorno extends Erros {
    Status?: boolean;
    Registros?: string;
}
