export interface SintegraEnvio {
    /**
     * Código do regime tributável (Padrão - 3)
     * 1 - Simples Nacional
     * 2 - Simples Nacional, excesso sublimite de receita bruta
     * 3 - Regime Normal
     */
    CRT?: number;
    /**
     * Código de identificação da estrutura do arquivo magnético entregue (Padrão - 3)
     * 1 - Estrutura conforme Convênio ICMS 57/95, na versão estabelecida pelo Convênio ICMS 31/99 e com as alterações promovidas até o Convênio ICMS 30/02.
     * 2 - Estrutura conforme Convênio ICMS 57/95, na versão estabelecida pelo Convênio ICMS 69/02 e com as alterações promovidas pelo Convênio ICMS 142/02.
     * 3 - Estrutura conforme Convênio ICMS 57/95, com as alterações promovidas pelo Convênio ICMS 76/03.
     */
    CodIdConvenio?: number;
    /**
     * Código da identificação da natureza das operações informadas (Padrão - 3)
     * 1 - Interestaduais somente operações sujeitas ao regime de Substituição Tributária
     * 2 - Interestaduais - operações com ou sem Substituição Tributária
     * 3 - Totalidade das operações do informante
     */
    CodIdNaturezaOperacao?: number;
    /**
     * Finalidade da apresentação do arquivo magnético (Padrão - 1)
     * 1 - Normal
     * 2 - Retificação total de arquivo: substituição total de informações prestadas pelo contribuinte referentes a este período
     * 3 - Retificação aditiva de arquivo: acréscimo de informação não incluída em arquivos já apresentados
     * 5 - Desfazimento: arquivo de informação referente a operações/prestações não efetivadas . Neste caso, o arquivo deverá conter, além dos registros tipo 10 e tipo 90, apenas os registros referentes às operações/prestações não efetivadas
     */
    CodFinalidade?: number;
    DtInicio?: string;
    DtFim?: string;
    IncluirNotasSaidas?: boolean;
    DFes?: SintegraDFe[];
    /**
     * Registro de inventário (Registro N° 74)
     */
    Inventario?: SintegraInventario[];
}
export interface SintegraDFe {
    /**
     * Informações do xml (Obrigatório).
     */
    Base64Xml?: string;
    /**
     * Emissão própia? (Obrigatório).
     */
    EmissaoPropia?: boolean;
    /**
     * Modelo do documento fiscal informado (Padrão 55) (Obrigatório).
     * 55 - NF-e Nota Fiscal Eletrônica
     * 57 - CT-e Conhecimento de Transporte Eletrônico
     * 65 - NFC-e Nota Fiscal do Consumidor Eletrônica
     */
    ModeloDocumento?: number;
    /**
     * Situação da nota fiscal.
     * 0 - Documento Fiscal Cancelado
     * 1 - Documento Fiscal Normal
     * 2 - Documento com USO DENEGADO (NFe e CTe)
     * 3 - Documento com USO inutilizado (NFe e CTe)
     * 4 - Lançamento Extemporâneo de Documento Fiscal Normal
     * 5 - Lançamento Extemporâneo de Documento Fiscal Cancelado
     */
    Situacao?: number;
    /**
     * Descrição do arquivo (Opcional).
     */
    Descricao?: string;
    /**
     * Data de entrada/saída
     */
    DtEntradaSaida?: string;
    /**
     * Produtos
     */
    Produtos?: SintegraProdutoDFe[];
}
export interface SintegraProdutoDFe {
    /**
     * Número do item na nota fiscal
     */
    NumeroItem?: number;
    /**
     * Código do produto
     */
    CodProduto?: string;
    /**
     * CFOP
     */
    CFOP?: number;
    /**
     * ICMS
     */
    ICMS?: string;
    /**
     * Nome do produto
     */
    NomeProduto?: string;
}
export interface SintegraInventario {
    DtInventario?: string;
    CodProduto?: string;
    Quantidade?: number;
    /**
     * Valor total do produto, quantidade multiplicada pelo valor unitário.
     */
    Valor?: number;
    /**
     * Tabela de código de posse das mercadorias inventariadas (Padrão - 1)
     * 1 - Mercadorias de propriedade do Informante e em seu poder
     * 2 - Mercadorias de propriedade do Informante em poder de terceiros
     * 3 - Mercadorias de propriedade de terceiros em poder do Informante
     */
    CodPosseMercadoria?: number;
    CNPJPossuidor?: string;
    IEPossuidor?: string;
    UFPossuidor?: string;
    NmProduto?: string;
    NCM?: string;
    UnidadeMedida?: string;
    AliquotaIPI?: number;
    AliquotaICMS?: number;
    RedBCICMS?: number;
    BCICMSST?: number;
}
