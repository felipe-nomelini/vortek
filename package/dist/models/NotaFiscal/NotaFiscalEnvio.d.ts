import { Pessoa } from '../Outros/Pessoa';
export interface Cliente extends Pessoa {
    CpfCnpj?: string;
    NmCliente?: string;
    /**
     * 1 - Contribuinte ICMS (informar a IE do destinatário)
     * 2 - Contribuinte isento de Inscrição no cadastro de Contribuintes do ICMS
     * 9 - Não Contribuinte, que pode ou não possuir Inscrição Estadual no Cadastro de Contribuintes do ICMS
     */
    IndicadorIe?: number;
    Ie?: string;
    IsUf?: string;
}
export interface Entrega extends Pessoa {
    CpfCnpj?: string;
    Nome?: string;
    Ie?: string;
}
export interface Produto {
    /**
     * Descrição do Produto
     */
    NmProduto?: string;
    /**
     * Código do produto ou serviço
     */
    CodProdutoServico?: string;
    /**
     * GTIN (Global Trade Item Number) do produto, antigo código EAN ou código de barras (Noramalmente sem GTIN)
     */
    EAN?: string;
    /**
     * Código NCM (8 posições). Em caso de item de serviço ou item que não tenham produto (Ex. transferência de
     * crédito, crédito do ativo imobilizado, etc.), informar o código 00 (zeros) (v2.0)
     */
    NCM?: string;
    /**
     * Código CEST
     */
    CEST?: string;
    /**
     * Quantidade Comercial  do produto, alterado para aceitar de 0 a 4 casas decimais e 11 inteiros.
     */
    Quantidade?: number;
    /**
     * Quantidade Comercial do produto tributável, alterado para aceitar de 0 a 4 casas decimais e 11 inteiros.
     */
    QuantidadeTributavel?: number;
    /**
     * Unidade comercial (Unidade de Medida)
     */
    UnidadeComercial?: string;
    /**
     * Unidade comercial (Unidade de Medida Tributável)
     */
    UnidadeComercialTributavel?: string;
    /**
     * Valor do Desconto
     */
    ValorDesconto?: number;
    /**
     * Valor Unitario
     */
    ValorUnitario?: number;
    /**
     * Valor Unitario Tributável
     */
    ValorUnitarioTributavel?: number;
    /**
     * Valor Total Bruto
     */
    ValorTotal?: number;
    /**
     * Valor Seguro
     */
    ValorSeguro?: number;
    /**
     * Valor Frete
     */
    ValorFrete?: number;
    /**
     * Valor Outras Despesas
     */
    ValorOutrasDespesas?: number;
    /**
     * Código Fiscal de Operações e Prestações
     */
    CFOP?: number;
    /**
     * Número do item do Pedido de Compra
     */
    NItemPed?: number;
    /**
     * Número do Pedido de Compra
     */
    xPed?: string;
    /**
     * Número de controle da FCI - Ficha de Conteúdo de Importação
     */
    nFCI?: string;
    /**
     * Código de Beneficio Fiscal na UF
     */
    cBenef?: string;
    /**
     * Informaçoes adicional
     */
    InformacaoAdicional?: string;
    /**
     * 0 - Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8
     * 1 - Estrangeira - Importação direta, exceto a indicada no código 6
     * 2 - Estrangeira - Adquirida no mercado interno, exceto a indicada no código 7
     * 3 - Nacional, mercadoria ou bem com Conteúdo de Importação superior a 40% e inferior ou igual a 70%
     * 4 - Nacional, cuja produção tenha sido feita em conformidade com os processos produtivos básicos de que tratam as legislações citadas nos Ajustes
     * 5 - Nacional, mercadoria ou bem com Conteúdo de Importação inferior ou igual a 40%
     * 6 - Estrangeira - Importação direta, sem similar nacional, constante em lista da CAMEX e gás natural
     * 7 - Estrangeira - Adquirida no mercado interno, sem similar nacional, constante lista CAMEX e gás natural
     * 8 - Nacional, mercadoria ou bem com Conteúdo de Importação superior a 70%
     */
    OrigemProduto?: number;
    /**
     * Código do grupo tributário cadastrado no Painel, para automação de impostos
     */
    CodTributação?: string;
    /**
     * ICMS, IPI, PIS, COFINS
     */
    Imposto?: Imposto;
    Combustivel?: Combustivel;
    DeclaracaoImportacao?: DeclaracaoImportacao;
    /**
     * Rastreabilidade do produto (lote, validade, fabricação). Comum para medicamentos, agrotóxicos, bebidas.
     */
    Rastros?: Rastreabilidade[];
}
export interface Rastreabilidade {
    /**
     * Número do lote do produto (1-20 caracteres)
     */
    NumeroLote?: string;
    /**
     * Quantidade de produto no lote
     */
    QuantidadeLote?: number;
    /**
     * Data de fabricação/produção
     */
    DataFabricacao?: string;
    /**
     * Data de validade
     */
    DataValidade?: string;
    /**
     * Código de agregação (opcional)
     */
    CodigoAgregacao?: string;
}
export interface Imposto {
    IBSCBS?: IBSCBS;
    ICMS?: ICMS;
    IPI?: IPI;
    PIS?: PIS;
    COFINS?: COFINS;
    Importacao?: Importacao;
}
export interface IBSCBS {
    /**
     * Código de Classificação Tributária (Padrão 000001)
     */
    CodClassificacaoTributaria?: string;
    /**
     * Base de cálculo
     */
    BaseCalculo?: number;
    /**
     * Alíquota do IBS de competência das UF
     */
    AliquotaIBSUF?: number;
    /**
     * Alíquota do IBS de competência do Município
     */
    AliquotaIBSMun?: number;
    /**
     * Alíquota da CBS
     */
    AliquotaCBS?: number;
}
export interface ICMS {
    /**
     * Código da Situação Tributária (CST)
     */
    CodSituacaoTributaria?: string;
    /**
     * Alíquota ICMS - Obrigatório para situação tributária nº 101 e 201
     */
    AliquotaICMS?: number;
    /**
     * Alíquota ICMS ST - Obrigatório para situação tributária nº 101 e 201
     */
    AliquotaICMSST?: number;
    /**
     * Alíquota - Obrigatório para situação tributária nº 201, 202 e 203
     */
    AliquotaMVA?: number;
    /**
     * Alíquota aplicável de cálculo de crédito - Obrigatório para situação tributária nº 101 e 201
     */
    AliquotaCredito?: number;
    /**
     * Redução ICMS
     */
    RedICMS?: number;
    /**
     * Redução ICMS ST
     */
    RedICMSST?: number;
    /**
     * Base de Cálculo (Quando não informado, é o valor dos produtos)
     */
    BaseCalculo?: number;
    /**
     * Valor do Icms (Calculado Automaticamente quando não informado)
     */
    ValorIcms?: number;
    /**
     * 1 - Táxi;
     * 2 - Deficiente Físico;
     * 3 - Produtor Agropecuário;
     * 4 - Frotista / Locadora;
     * 5 - Diplomático / Consular;
     * 6 - Utilitários e Motocicletas da Amazônia Ocidental e Áreas de Livre Comércio (Resolução 714/88 e 790/94 – CONTRAN e suas alterações);
     * 7 - SUFRAMA
     * 8 - Venda a Orgãos Publicos
     * 9 - Outros. (v2.0)
     * 10 - Deficiente Condutor (Convênio ICMS 38/12). (v3.1)
     * 11 - Deficiente não Condutor (Convênio ICMS 38/12). (v3.1)
     * 16 - Olimpíadas Rio 2016
     */
    motivoDesoneracaoIcms?: number;
    valorDesoneracaoIcms?: number;
    /**
     * Percentual de diferimento (Utilizado somente no CST 51)
     */
    aliquotaDiferimento?: number;
    /**
     * 0 - Margem Valor Agregado (%)
     * 1 - Pauta (valor)
     * 2 - Preço Tabelado Máximo (valor)
     * 3 - Valor da Operação
     */
    modalidadeBcIcms?: number;
}
export interface IPI {
    /**
     * Código de Enquadramento Legal do IPI
     */
    CodEnquadramento?: string;
    /**
     * Código da Situação Tributária do IPI
     */
    CodSituacaoTributaria?: string;
    /**
     * Aliquota do IPI
     */
    Aliquota?: number;
    /**
     * Valor do IPI devolvido
     */
    ValorIpiDevolvido?: number;
    /**
     * Percentual da mercadoria devolvida
     */
    PercentualMercadoriaDevolvida?: number;
}
export interface PIS {
    /**
     * Código da Situação Tributária do PIS
     */
    CodSituacaoTributaria?: string;
    /**
     * Aliquota do PIS
     */
    Aliquota?: number;
    /**
     * Base de Cálculo (Quando não informado, é o valor dos produtos)
     */
    BaseCalculo?: number;
}
export interface COFINS {
    /**
     * Código da Situação Tributária do COFINS
     */
    CodSituacaoTributaria?: string;
    /**
     * Aliquota do COFINS
     */
    Aliquota?: number;
    /**
     * Base de Cálculo (Quando não informado, é o valor dos produtos)
     */
    BaseCalculo?: number;
}
export interface Importacao {
    BaseCalculo?: number;
    DespesasAduaneiras?: number;
    Valor?: number;
    ValorIOF?: number;
}
export interface Pagamento {
    /**
     * 0 - A vista, 1 - Prazo
     */
    IndicadorPagamento?: number;
    Desconto?: number;
    Descricao?: string;
    /**
     * 01 - Dinheiro
     * 02 - Cheque
     * 03 - Cartão de Crédito
     * 04 - Cartão de Débito
     * 05 - Cartão da Loja (Private Label), Crediário Digital, Outros Crediários
     * 10 - Vale Alimentação
     * 11 - Vale Refeição
     * 12 - Vale Presente
     * 13 - Vale Combustível
     * 14 - Duplicata Mercantil
     * 15 - Boleto Bancário
     * 16 - Depósito Bancário
     * 17 - Pagamento Instantâneo (PIX) - Dinâmico
     * 18 - Transferencia Bancária, Carteira Digital
     * 19 - Programa de fidelidade, cashback, crédito virtual
     * 20 - Pagamento Instantâneo (PIX) - Estático
     * 21 - Crédito em Loja de Devolução
     * 22 - Pagamento Eletrônico não Informado - falha de hardware do sistema emissor
     * 90 - Sem pagamento
     * 99 - Outros
     */
    FormaPagamento?: string;
    VlPago?: number;
    VlTroco?: number;
    /**
     * Pagamento integrado com automação?
     */
    TipoIntegracao?: boolean;
    CNPJCredenciadora?: string;
    /**
     * 01 - Visa
     * 02 - Mastercard
     * 03 - American Express
     * 04 - Sorocred
     * 05 - Diners Club
     * 06 - Elo
     * 07 - Hipercard
     * 08 - Aura
     * 09 - Cabal
     * 99 - Outros
     */
    BandeiraOperadora?: string;
    NumeroAutorizacao?: string;
}
export interface Cobranca {
    Fatura?: Fatura;
    Parcelas?: Parcela[];
}
export interface Fatura {
    Numero?: string;
    Valor?: number;
    Desconto?: number;
    ValorLiquido?: number;
}
export interface Parcela {
    Vencimento?: string;
    Valor?: number;
}
export interface Transporte {
    /**
     * 0 - Contratação do Frete por conta do Remetente (CIF)
     * 1 - Contratação do Frete por conta do Destinatário (FOB)
     * 2 - Contratação do Frete por conta de Terceiros
     * 3 - Transporte Próprio por conta do Remetente
     * 4 - Transporte Próprio por conta do Destinatário
     * 9 - Sem Ocorrência de Transporte
     */
    ModalidadeFrete?: number;
    NmTransportador?: string;
    CNPJ?: string;
    NmMunicipio?: string;
    DsEndereco?: string;
    IE?: string;
    UF?: string;
    Vagao?: string;
    Balsa?: string;
    Veiculo?: Veiculo;
    Reboque?: Reboque[];
    Volume?: Volume;
    Volumes?: Volume[];
}
export interface Veiculo {
    Placa?: string;
    UF?: string;
    RNTC?: string;
}
export interface Volume {
    Numero?: string;
    QuantidadeVolume?: number;
    Especie?: string;
    Marca?: string;
    PesoBruto?: number;
    PesoLiquido?: number;
    Lacres?: string[];
}
export interface Reboque {
    Placa?: string;
    UF?: string;
    RNTC?: string;
}
export interface Combustivel {
    CodProdutoANP?: string;
    DescricaoProdutoANP?: string;
    UFConsumo?: string;
}
export interface Exporta {
    /**
     * Descrição do local de despacho
     */
    LocalDespacho?: string;
    /**
     * Sigla da UF de Embarque ou de transposição de fronteira
     */
    UFSaidaPais?: string;
    /**
     * Descrição do Local de Embarque ou de transposição de fronteira
     */
    LocalEmbarqueTransp?: string;
}
export interface DeclaracaoImportacao {
    /**
     * Número do Documento de Importação (DI, DSI, DIRE, ...)
     */
    Numero?: string;
    /**
     * Data de Registro do documento de importação
     */
    DataRegistro?: string;
    /**
     * Local de Desembaraço Aduaneiro
     */
    LocalDesenbaraco?: string;
    /**
     * Sigla da UF onde ocorreu o Desembaraço Aduaneiro
     */
    UfDesenbaraco?: string;
    /**
     * Data do Desembaraço Aduaneiro
     */
    DataDesenbaraco?: string;
    /**
     * Via de transporte internacional informada na Declaração de Importação (DI)
     * 1 - Marítima
     * 2 - Fluvial
     * 3 - Lacustre
     * 4 - Aérea
     * 5 - Postal
     * 6 - Ferroviária
     * 7 - Rodoviária
     * 8 - Conduto / Rede Transmissão
     * 9 - Meios Próprios
     * 10 - Entrada / Saída ficta
     * 11 - Courier
     * 12 - Handcarry
     */
    TipoViaTransporte?: number;
    /**
     * Valor da AFRMM - Adicional ao Frete para Renovação da Marinha Mercante
     */
    ValorAFRMM?: number;
    /**
     * Forma de importação quanto a intermediação
     * 1 - Importação por conta própria
     * 2 - Importação por conta e ordem
     * 3 - Importação por encomenda
     */
    TipoIntermedio?: number;
    /**
     * CNPJ do adquirente ou do encomendante
     */
    Cnpj?: string;
    /**
     * Sigla da UF do adquirente ou do encomendante
     */
    Uf?: string;
    /**
     * Código do Exportador
     */
    CodExportador?: string;
    /**
     * Código do Fabricante Extrangeiro
     */
    CodFabricante?: string;
}
export interface NotaFiscalEnvio {
    /**
     * Série da nota Fiscal
     */
    Serie?: number;
    /**
     * Número da nota fiscal
     */
    Numero?: number;
    /**
     * Lote da Nota Fiscal
     */
    Lote?: number;
    /**
     * Data e Hora da saída ou de entrada da produto/serviço
     */
    DataEntradaSaida?: string;
    /**
     * Data e Hora da saída ou de entrada da produto/serviço (Envia a data atual caso não informada)
     */
    DataEmissao?: string;
    /**
     * B03 - Código numérico que compõe a Chave de Acesso. Número aleatório gerado pelo emitente para cada NF-e.
     */
    Codigo?: string;
    /**
     * Utilizar quando o tipo de emissão for diferente normal
     */
    Justificativa?: string;
    /**
     * Notas fiscal de Referência
     */
    NFReferencia?: string[];
    /**
     * Indicador de presença do comprador no estabelecimento comercial no momento da operação
     * 0 - Não se aplica
     * 1 - Operação presencial;
     * 2 - Operação não presencial, pela Internet;
     * 3 - Operação não presencial, Teleatendimento;
     * 4 - NFC-e em operação com entrega a domicílio;
     * 5 - Presencial fora do estabelecimento;
     * 9 - Operação não presencial, outros.
     */
    IndicadorPresenca?: number;
    /**
     * Indicador de intermediador/marketplace
     * falso - Operação sem intermediador
     * verdadeiro - Operação em site ou plataforma de terceiros;
     */
    IndicadorIntermediador?: boolean;
    /**
     * Indica operação com Consumidor final (NFCe de ser 1 Validar!)
     * Falso - Normal;
     * Verdadeiro - Consumidor final;
     */
    ConsumidorFinal?: boolean;
    /**
     * Indica operação com Consumidor final (NFCe de ser 1 Validar!)
     * Falso - Normal;
     * Verdadeiro - Consumidor final;
     */
    CalcularIBPT?: boolean;
    /**
     * Descrição da Natureza da Operação
     */
    NaturezaOperacao?: string;
    /**
     * Código do modelo do Documento Fiscal (Padrão 55)
     * 55 - NF-e
     * 65 - NFC-e
     */
    ModeloDocumento?: number;
    /**
     * Finalidade da emissão da NF-e
     * 1 - Normal
     * 2 - Complementar
     * 3 - Ajuste
     * 4 - Devolução
     */
    Finalidade?: number;
    /**
     * Identificação do Ambiente
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    Observacao?: string;
    ObservacaoFisco?: string;
    IdentificadorInterno?: string;
    EnviarEmail?: boolean;
    Cliente?: Cliente;
    Produtos?: Produto[];
    Pagamentos?: Pagamento[];
    Cobranca?: Cobranca;
    Transporte?: Transporte;
    Exporta?: Exporta;
    Entrega?: Entrega;
    /**
     * Retenções federais totais da nota (IRRF, PIS/COFINS/CSLL retidos, Previdência). Gera a tag retTrib no XML.
     */
    Retencoes?: RetencoesFederais;
}
export interface RetencoesFederais {
    /**
     * Base de cálculo do IRRF
     */
    BaseCalculoIRRF?: number;
    /**
     * Valor retido do IRRF
     */
    ValorIRRF?: number;
    /**
     * Valor retido de PIS
     */
    ValorRetidoPIS?: number;
    /**
     * Valor retido de COFINS
     */
    ValorRetidoCOFINS?: number;
    /**
     * Valor retido de CSLL
     */
    ValorRetidoCSLL?: number;
    /**
     * Base de cálculo da retenção da Previdência Social
     */
    BaseCalculoRetencaoPrevidencia?: number;
    /**
     * Valor da retenção da Previdência Social
     */
    ValorRetencaoPrevidencia?: number;
}
export interface NotaFiscalLoteEnvio {
    /**
     * Identificação do Ambiente
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    /**
     * Código do modelo do Documento Fiscal (Padrão 55)
     * 55 - NF-e
     * 65 - NFC-e
     */
    ModeloDocumento?: number;
    /**
     * Lote da Nota Fiscal
     */
    Lote?: number;
    nFInfos?: NotaFiscalEnvio[];
}
