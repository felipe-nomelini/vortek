import { Pessoa } from '../Outros/Pessoa';
export interface SpedEnvio {
    /**
     * Tipo do arquivo EFD (Padrão - 1)
     * 1 - SPED EFD FISCAL ICMS/IPI
     * 2 - SPED EFD CONTRIBUIÇÕES PIS/COFINS
     */
    TipoArquivo?: number;
    /**
     * Código do regime tributável (Padrão - 3)
     * 1 - Simples Nacional
     * 2 - Simples Nacional, excesso sublimite de receita bruta
     * 3 - Regime Normal
     */
    CRT?: number;
    /**
     * Ambiente de emissão das notas de saída (Padrão - 1)
     * 1 - Ambiente de Produção
     * 2 - Ambiente de Homologação
     */
    AmbienteNotasSaidas?: number;
    IncluirNotasSaidas?: boolean;
    DtInicio?: string;
    DtFim?: string;
    EfdIcmsIpiInfo?: EfdIcmsIpiInfo;
    EfdPisCofinsInfo?: EfdPisCofinsInfo;
    Contador?: Contador;
    DFes?: SpedDFe[];
    AjusteImpostos?: SpedAjusteImposto[];
    /**
     * Incluido até 12/2022
     */
    Inutilizadas?: SpedInutilizada[];
}
export interface EfdIcmsIpiInfo {
    /**
     * Código da finalidade do arquivo (Padrão - 0)
     * 0 - Remessa do arquivo original
     * 1 - Remessa do arquivo substituto
     */
    CodFinalidade?: number;
    /**
     * Perfil de apresentação do arquivo fiscal (Padrão - 0)
     * 0 - Perfil A
     * 1 - Perfil B
     * 2 - Perfil C
     */
    IndicadorPerfil?: number;
    /**
     * Indicador do tipo de atividade (Padrão - 10)
     * 0 - Industrial - Transformação
     * 1 - Industrial - Beneficiamento
     * 2 - Industrial - Montagem
     * 3 - Industrial - Acondicionamento ou Reacondicionamento
     * 4 - Industrial - Renovação ou Recondicionamento
     * 5 - Equiparado a industrial - Por opção
     * 6 - Equiparado a industrial - Importação Direta
     * 7 - Equiparado a industrial - Por lei específica
     * 8 - Equiparado a industrial - Não enquadrado nos códigos 05, 06 ou 07
     * 9 - Industrial ou equiparado - Outros
     * 10 - Outros
     */
    IndicadorAtividade?: number;
    /**
     * Indicador de Leituante Bloco K (Padrão - 0)
     * 0 - Leiaute simplificado
     * 1 - Leiaute completo
     * 2 - Leiaute restrito aos saldos de estoque
     */
    IndicadorLeituante?: number;
    /**
     * Valor total do saldo credor do período anterior
     */
    ValorSldCredorAnterior?: number;
    /**
     * Alimenta o bloco 1.
     */
    InformacoesFisco?: InformacoesFisco;
    /**
     * Alimenta o bloco H, destina-se a informar o inventário físico do estabelecimento.
     */
    SpedInventario?: SpedInventario[];
    /**
     * Alimenta o bloco K, destina-se a prestar informações mensais da produção e respectivo consumo de insumos, bem como do estoque escriturado;
     */
    SpedEscrituracao?: SpedEscrituracao[];
    /**
     * Operaçãoes com instrumentos de pagamentos eletrônicos (REG 1600/1601)
     */
    SpedOperacaoCartao?: SpedOperacaoCartao[];
    /**
     * Ajustes / benefícios / incentivos da Apuração do ICMS
     */
    AjustesApuracao?: AjusteApuracaoIcmsIpi[];
}
export interface EfdPisCofinsInfo {
    /**
     * Tipo de Escrituração (Padrão - 0)
     * 0 - Original
     * 1 - Retificadora
     */
    TipoEscrituracao?: number;
    /**
     * Indicador de tipo de atividade preponderante (Padrão - 9)
     * 0 - Industrial ou equiparado a industrial
     * 1 - Prestador de serviços
     * 2 - Atividade de comércio
     * 3 - Pessoas jurídicas referidas nos §§ 6º, 8º e 9º do art. 3º da Lei nº 9.718, de 1998
     * 4 - Atividade imobiliária
     * 9 - Outros
     */
    IndicadorTipoAtividadePreponderante?: number;
    /**
     * Indicador da natureza da pessoa jurídica (Padrão - NULL)
     * 0 - Pessoa jurídica em geral (não participante de SCP como sócia ostensiva)
     * 1 - Sociedade cooperativa (não participante de SCP como sócia ostensiva)
     * 2 - Entidade sujeita ao PIS/Pasep exclusivamente com base na Folha de Salários
     * 3 - Pessoa jurídica em geral participante de SCP como sócia ostensiva
     * 4 - Sociedade cooperativa participante de SCP como sócia ostensiva
     * 5 - Sociedade em Conta de Participação - SCP
     */
    IndicadorNaturezaPessoaJuridica?: number;
    /**
     * Indicador de situação especial (Padrão - NULL)
     * 0 - Abertura
     * 1 - Cisão
     * 2 - Fusão
     * 3 - Incorporação
     * 4 - Encerramento
     */
    IndicadorSituacaoEspecial?: number;
    /**
     * Código indicador da incidência tributária no período (Padrão - 2)
     * 1 - Escrituração de operações com incidência exclusivamente no regime não-cumulativo (Lucro Real)
     * 2 - Escrituração de operações com incidência exclusivamente no regime cumulativo (Lucro Presumido)
     * 3 - Escrituração de operações com incidência nos regimes não-cumulativo e cumulativo
     */
    IndicadorIncidenciaTributaria?: number;
    /**
     * Código indicador do Tipo de Contribuição Apurada no Período (Padrão - NULL)
     * 1 - Apuração da Contribuição Exclusivamente a Alíquota Básica
     * 2 - Apuração da Contribuição a Alíquotas Específicas (Diferenciadas e/ou por Unidade de Medida de Produto)
     */
    IndicadorTipoContribuicaoApurada?: number;
    /**
     * Código indicador de método de apropriação de créditos comuns, no caso de incidência no regime não-cumulativo (IndicadorIncidenciaTributaria = 1 ou 3) (Padrão - NULL)
     * 1 - Método de Apropriação Direta
     * 2 - Método de Rateio Proporcional (Receita Bruta)
     */
    IndicadorMetodoApropriacaoCredito?: number;
    /**
     * Código indicador do critério de escrituração e apuração adotado, no caso de incidência exclusivamente no regime cumulativo (IndicadorIncidenciaTributaria = 2),
     * pela pessoa jurídica submetida ao regime de tributação com base no lucro presumido (Padrão - NULL)
     * 1 - Regime de Caixa – Escrituração consolidada (Registro F500)
     * 2 - Regime de Competência - Escrituração consolidada (Registro F550)
     * 9 - Regime de Competência - Escrituração detalhada, com base nos registros dos Blocos "A", "C", "D" e "F".
     */
    IndicadorCriterioEscrituracao?: number;
    /**
     * Número do Recibo da Escrituração anterior a ser retificada, (TipoEscrituracao = 1)
     */
    NumReciboEscrituracaoAnterior?: string;
    /**
     * Ajustes do Crédito de PIS/Pasep e ajustes do Crédito de Cofins Apurado (M110 e M510)
     */
    AjustesApuracao?: AjusteApuracaoPisCofins[];
}
export interface SpedEscrituracao {
    DtInicio?: string;
    DtFim?: string;
    Escrituracao?: Escrituracao[];
    EscrituracaoCorrecao?: EscrituracaoCorrecao[];
    Producao?: Producao[];
    MovimentacaoInterna?: MovimentacaoInterna[];
}
export interface Escrituracao {
    /**
     * Indicador de propriedade/posse do item:
     * 0 - Item de propriedade do informante e em seu poder
     * 1 - Item de propriedade do informante em posse de terceiros
     * 2 - Item de propriedade de terceiros em posse do informante
     */
    IndicadorPropiedade?: number;
    Quantidade?: number;
    DtEstoqueFinal?: string;
    Produto?: SpedProdutoInfo;
    Participante?: SpedParticipante;
}
export interface EscrituracaoCorrecao {
    /**
     * Indicador de propriedade/posse do item:
     * 0 - Item de propriedade do informante e em seu poder
     * 1 - Item de propriedade do informante em posse de terceiros
     * 2 - Item de propriedade de terceiros em posse do informante
     */
    IndicadorPropiedade?: number;
    QuantidadeCorrecaoNegativa?: number;
    QuantidadeCorrecaoPositiva?: number;
    Produto?: SpedProdutoInfo;
    Participante?: SpedParticipante;
}
export interface Producao {
    DtInicio?: string;
    DtFim?: string;
    CodOrdemProducao?: string;
    Quantidade?: number;
    Produto?: SpedProdutoInfo;
    Insumos?: Insumo[];
}
export interface Insumo {
    /**
     * Data de saída do estoque para alocação ao produto.
     */
    DtSaida?: string;
    /**
     * Quantidade consumida do item.
     */
    Quantidade?: number;
    InsumoInfo?: SpedProdutoInfo;
}
export interface MovimentacaoInterna {
    /**
     * Data da movimentação interna.
     */
    DtMovimentacao?: string;
    /**
     * Quantidade movimentada do item de origem.
     */
    QuantidadeOrigem?: number;
    /**
     * Quantidade movimentada do item de destino.
     */
    QuantidadeDestino?: number;
    ProdutoOrigem?: SpedProdutoInfo;
    ProdutoDestino?: SpedProdutoInfo;
}
export interface SpedProdutoInfo {
    /**
     * Código do produto
     */
    CodProduto?: string;
    /**
     * Unidade de medida
     */
    UnidadeMedida?: string;
    /**
     * Nome do produto
     */
    NomeProduto?: string;
    /**
     * Tipo do item - Atividades Industriais, Comerciais e Serviços (Padrão 00 - Mercadoria para Revenda):
     * 00 - Mercadoria para Revenda
     * 01 - Matéria-Prima
     * 02 - Embalagem
     * 03 - Produto em Processo
     * 04 - Produto Acabado
     * 05 - Subproduto
     * 06 - Produto Intermediário
     * 07 - Material de Uso e Consumo
     * 08 - Ativo Imobilizado
     * 09 - Serviços
     * 10 - Outros insumos
     * 99 - Outras
     */
    TipoItem?: string;
    /**
     * Código do gênero do item. Consulte a tabela AQUI
     */
    CodGeneroItem?: string;
    /**
     * Código do serviço. Consulte a tabela AQUI
     */
    CodServico?: string;
    NCM?: string;
    CEST?: string;
}
export interface SpedInventario {
    /**
     * Motivo do Inventário (Padrão 1 - No final no período):
     * 1 - No final no período
     * 2 - Na mudança de forma de tributação da mercadoria (ICMS)
     * 3 - Na solicitação da baixa cadastral, paralisação temporária e outras situações
     * 4 - Na alteração de regime de pagamento – condição do contribuinte
     * 5 - Por determinação dos fiscos
     */
    MotivoInventario?: number;
    DtInventario?: string;
    Inventarios?: Inventario[];
}
export interface Inventario {
    /**
     * Indicador de propriedade/posse do item:
     * 0 - Item de propriedade do informante e em seu poder
     * 1 - Item de propriedade do informante em posse de terceiros
     * 2 - Item de propriedade de terceiros em posse do informante
     */
    IndicadorPropiedade?: number;
    Quantidade?: number;
    ValorUnitario?: number;
    ValorImpostoRenda?: number;
    DescricaoComplementar?: string;
    Produto?: SpedProdutoInfo;
    Participante?: SpedParticipante;
    /**
     * Código da conta analítica contábil debitada/creditada
     */
    CodCta?: string;
    InformacaoComplementar?: InformacaoComplementar[];
}
export interface SpedProdutoDFe extends SpedProdutoInfo {
    /**
     * Número do item na nota fiscal
     */
    NumeroItem?: number;
    CFOP?: number;
    ICMS?: string;
    AliqIcms?: number;
    /**
     * CST PIS (Padrão 50 - Emissão de Terceiros):
     * 50 - Mercadoria para Revenda
     */
    CSTPIS?: string;
    /**
     * CST COFINS (Padrão 50 - Emissão de Terceiros):
     * 50 - Mercadoria para Revenda
     */
    CSTCOFINS?: string;
    PlanoContaContabil?: PlanoContaContabil;
}
export interface AjusteFiscal {
    /**
     * Informação da SubApuração. (Obrigatório quando o terceiro número do CodigoAjuste estiver entre 3 e 8) (1900)
     */
    SubApuracao?: SubApuracao;
    /**
     * Código do ajustes/benefício/incentivo. (Obrigatório) (C197)
     */
    CodigoAjuste?: string;
    /**
     * Descrição complementar do ajuste do documento fiscal. (C197)
     */
    DescricaoComplementarAjuste?: string;
    /**
     * Descrição da observação vinculada ao lançamento fiscal. (Obrigatório) (0460)
     */
    DescricaoObservacao?: string;
    /**
     * Descrição complementar do código de observação. (C195)
     */
    DescricaoComplementar?: string;
    /**
     * Número do item na nota fiscal
     */
    NumeroItem?: number;
    /**
     * Busca todos os itens que tem o cfop e aplica o ajuste nos mesmos
     */
    Cfop?: number;
    /**
     * Busca todos os itens que tem o cst e aplica o ajuste nos mesmos
     */
    CstIcms?: string;
    /**
     * Busca todos os itens que tem a aliquota e aplica o ajuste nos mesmos
     */
    AliqIcms?: number;
    /**
     * Outros valores. (C197)
     */
    VlOutros?: number;
}
export interface AjusteApuracaoIcmsIpi {
    CodigoAjuste?: string;
    DescricaoComplementar?: string;
    Valor?: number;
    /**
     * Informação do registro E113
     */
    Documentos?: AjusteApuracaoDocumentos[];
}
export interface AjusteApuracaoDocumentos {
    /**
     * Modelo do documento fiscal informado (Padrão 55) (Obrigatório).
     * 6 - Nota Fiscal de Energia Elétrica
     * 21 - Nota Fiscal de Serviço de Comunicação
     * 22 - Nota Fiscal de Serviço de Telecomunicação
     * 28 - Nota Fiscal de Consumo/Fornecimento de Gás
     * 29 - Conta de Fornecimento D'água Canalizada
     * 55 - Nota Fiscal Eletrônica (NF-e)
     * 57 - Conhecimento de Transporte Eletrônico (CT-e)
     * 65 - Nota Fiscal do Consumidor Eletrônica (NFC-e)
     * 66 - Nota Fiscal de Energia Elétrica Eletrônica
     * 67 - Conhecimento de Transporte Eletrônico para outros serviços (CT-e OS)
     */
    ModeloDocumento?: number;
    Serie?: string;
    SubSerie?: string;
    Numero?: number;
    Chave?: string;
    DtEmissao?: string;
    Valor?: number;
    Produto?: SpedProdutoInfo;
    Participante?: SpedParticipante;
}
export interface AjusteApuracaoPisCofins {
    /**
     * Indicador do tipo de ajuste:
     * 0 - PIS/Pasep
     * 1 - COFINS
     */
    Tipo?: number;
    /**
     * Indicador do tipo de ajuste:
     * 0 - Ajuste de redução
     * 1 - Ajuste de acréscimo
     */
    Indicador?: number;
    /**
     * Código do ajuste, conforme a Tabela indicada no item 4.3.8.
     */
    CodigoAjuste?: string;
    /**
     * Descrição resumida do ajuste.
     */
    DescricaoComplementar?: string;
    /**
     * Número do processo, documento ou ato concessório ao qual o ajuste está vinculado, se houver.
     */
    NumeroDocumento?: string;
    /**
     * Data de referência do ajuste
     */
    DataReferenciaAjuste?: string;
    /**
     * Valor do ajuste.
     */
    Valor?: number;
}
export interface SubApuracao {
    /**
     * Descrição complementar das obrigações a recolher. (REG - 1900)
     */
    DescricaoComplementarSubApuracao?: string;
    /**
     * Descrição complementar das obrigações a recolher. (REG - 1921)
     */
    DescricaoComplementarAjusteSubApuracao?: string;
    /**
     * Código de ajuste da SUB-APUARÇÃO e dedução (REG - 1921)
     */
    CodigoAjusteSubApuracao?: string;
    /**
     * Código da obrigação a recolher (REG - 1926)
     */
    CodigoObrigacao?: string;
    /**
     * Código de receita referente à obrigação, próprio da unidade da federação, conforme legislação estadual. (REG - 1926)
     */
    CodigoReceitaObrigacao?: string;
    /**
     * Descrição complementar das obrigações a recolher. (REG - 1926)
     */
    DescricaoComplementarObrigacao?: string;
}
export interface DocArrecadacao {
    /**
     * Código do modelo do documento de arrecadação:
     * 0 - documento estadual de arrecadação
     * 1 - GNRE
     */
    TipoDocumento?: number;
    /**
     * Unidade federada beneficiária do recolhimento
     */
    Uf?: string;
    /**
     * Código completo da autenticação bancária
     */
    CodigoAutBancaria?: string;
    /**
     * Número do documento de arrecadação
     */
    Numero?: string;
    /**
     * Valor do total do documento de arrecadação (principal, atualização monetária, juros e multa)
     */
    Valor?: number;
    /**
     * Data de vencimento do documento de arrecadação
     */
    DtVencimento?: string;
    /**
     * Data de pagamento do documento de arrecadação ou data do vencimento, no caso de ICMS antecipado a recolher.
     */
    DtPagamento?: string;
}
export interface InformacaoComplementar {
    BcIcms?: number;
    CstIcms?: string;
    ValorIcms?: number;
}
export interface PlanoContaContabil {
    DescricaoPlano?: string;
    CodigoPlano?: string;
    /**
     * Código da natureza da conta/grupo de contas (Padrão 1):
     * 1 - Contas de ativo
     * 2 - Contas de passivo
     * 3 - Patrimônio líquido
     * 4 - Contas de resultado
     * 5 - Contas de compensação
     * 9 - Outras
     */
    CodigoNatureza?: number;
    /**
     * Indicador do tipo de conta:
     * 0 - Analítica (conta)
     * 1 - Sintética (grupo de contas)
     */
    TipoConta?: number;
    Nivel?: number;
    CodigoContaCorrelacionadaRFB?: string;
    DtInclusao_Alteracao?: string;
}
export interface Contador extends Pessoa {
    /**
     * Nome do contabilista.
     */
    Nome?: string;
    /**
     * Número de inscrição do contabilista no Conselho Regional de Contabilidade.
     */
    crc?: string;
    /**
     * CPF do contabilista.
     */
    cpf?: string;
    /**
     * Número de inscrição do escritório de contabilidade no CNPJ, se houver.
     */
    cnpj?: string;
}
export interface InformacoesFisco {
    /**
     * Existem informações acerca de créditos de ICMS a serem controlados, definidos pela Sefaz: S - Sim; N -Não
     */
    IndCreditoIcmsControlado?: boolean;
    /**
     * Ocorreu averbação (conclusão) de exportação no período: S - Sim; N - Não
     */
    IndExportacaoPer?: boolean;
    /**
     * A empresa prestou serviços de transporte aéreo de cargas e de passageiros: S - Sim; N - Não
     */
    IndTranspAereo?: boolean;
    /**
     * É comercio varejista de combustíveis com movimentação e/ou estoque no período: S - Sim; N - Não
     */
    IndVarejistaCombustivel?: boolean;
    /**
     * Usinas de açúcar e/álcool – O estabelecimento é produtor de açúcar e/ou álcool carburante com movimentação e/ou estoque no período: S - Sim; N - Não
     */
    IndUnsina?: boolean;
    /**
     * Sendo o registro obrigatório em sua Unidade de Federação, existem informações a serem prestadas neste registro: S - Sim; N - Não
     */
    IndInfoPrestadas?: boolean;
    /**
     * A empresa é distribuidora de energia e ocorreu fornecimento de energia elétrica para consumidores de outra UF: S - Sim; N - Não
     */
    IndDistribuidoraEnergia?: boolean;
    /**
     * Realizou vendas com Cartão de Crédito ou de débito: S - Sim; N - Não
     */
    IndVendasCartao?: boolean;
    /**
     * Reg. 1700 – Foram emitidos documentos fiscais em papel no período em unidade da federação que exija o controle de utilização de documentos fiscais: S - Sim; N - Não
     */
    IndDocumentosFiscaisPapel?: boolean;
    /**
     * Possui informações GIAF1? : S - Sim; N - Não
     */
    IndGiaf1?: boolean;
    /**
     * Possui informações GIAF3? : S - Sim; N - Não
     */
    IndGiaf3?: boolean;
    /**
     * Possui informações GIAF4? : S - Sim; N - Não
     */
    IndGiaf4?: boolean;
    /**
     * Possui informações consolidadas de saldos de restituição, ressarcimento e complementação do ICMS?
     */
    IndRestRessarcComplIcms?: boolean;
}
export interface SpedDFe {
    /**
     * Modo de informação do documento (Padrão 1) (Obrigatório).
     * 1 - Informar contúdo do xml
     * 2 - Informar conteúdo das propriedades contidas nos documentos
     * 3 - Substituir ou adicionar informaçoes ao documento emitido internamente (buscar Notas internas = verdadeiro)
     */
    ModoInfoDFe?: number;
    /**
     * Chave da DF-e que terá informações adicionadas ou substituidas (Obrigatório quando a propriedade TipoDFe = 3).
     */
    ChaveDFe?: string;
    /**
     * Modelo do documento fiscal informado (Padrão 55) (Obrigatório).
     * 6 - Nota Fiscal de Energia Elétrica
     * 10 - Nota Fiscal de Serviço (NFS-e)
     * 21 - Nota Fiscal de Serviço de Comunicação
     * 22 - Nota Fiscal de Serviço de Telecomunicação
     * 28 - Nota Fiscal de Consumo/Fornecimento de Gás
     * 29 - Conta de Fornecimento D'água Canalizada
     * 55 - Nota Fiscal Eletrônica (NF-e)
     * 57 - Conhecimento de Transporte Eletrônico (CT-e)
     * 65 - Nota Fiscal do Consumidor Eletrônica (NFC-e)
     * 66 - Nota Fiscal de Energia Elétrica Eletrônica
     * 67 - Conhecimento de Transporte Eletrônico para outros serviços (CT-e OS)
     */
    ModeloDocumento?: number;
    /**
     * Informações do xml (Obrigatório).
     */
    Base64Xml?: string;
    /**
     * Emissão própia? (Obrigatório).
     */
    EmissaoPropia?: boolean;
    /**
     * Situação da nota fiscal (Obrigatório).
     * 0 - Documento regular
     * 1 - Escrituração extemporânea de documento regular
     * 2 - Documento cancelado
     * 3 - Escrituração extemporânea de documento cancelado
     * 4 - NF-e, NFC-e ou CT-e - denegado até 12/2022
     * 6 - Documento Fiscal Complementar
     * 7 - Escrituração extemporânea de documento complementar
     * 8 - Documento Fiscal emitido com base em Regime Especial ou Norma Específica
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
    Produtos?: SpedProdutoDFe[];
    /**
     * Ajustes Fiscais
     */
    AjustesFiscais?: AjusteFiscal[];
    /**
     * Ajustes Fiscais
     */
    DocArrecadacoes?: DocArrecadacao[];
    /**
     * Informações do documento fiscal
     */
    DFeInfo?: DFeInfo;
}
export interface DFeComplemento {
    Cfop?: number;
    /**
     * CST Icms Transporte:
     * 00
     * 20
     * 40
     * 41
     * 51
     * 60
     * 90
     */
    CstIcms?: string;
    CstPis?: string;
    CstCofins?: string;
    /**
     * Indicador do tipo do frete:
     * 0 - Por conta de terceiros
     * 1 - Por conta do emitente
     * 2 - Por conta do destinatário
     * 9 - Sem cobrança de frete
     */
    IndicadorFrete?: number;
    /**
     * Alíquota de ICMS (Apenas para entrada de C500 - Contas)
     */
    AliqIcms?: number;
    /**
     * Base de calculo do ICMS (Apenas para entrada de C500 - Contas)
     */
    BcIcms?: number;
    PlanoContaContabil?: PlanoContaContabil;
}
export interface SpedInutilizada {
    Serie?: number;
    Numero?: number;
    /**
     * Modelo do documento fiscal informado (Obrigatório).
     * 55 - NF-e Nota Fiscal Eletrônica
     * 57 - CT-e Conhecimento de Transporte Eletrônico
     * 65 - NFC-e Nota Fiscal do Consumidor Eletrônica
     */
    ModeloDocumento?: number;
}
export interface SpedAjusteImposto {
    /**
     * Tipo do Ajuste (Obrigatório).
     * 1 - ICMS
     * 2 - PIS
     * 3 - COFINS
     */
    Tipo?: number;
    FilterNCM?: string;
    FilterCFOP?: number;
    CST?: string;
    Aliquota?: number;
}
export interface SpedOperacaoCartao {
    /**
     * Identificação da instituição que efetuou o pagamento
     */
    Participante?: SpedParticipante;
    /**
     * Identificação do intermediador da transação
     */
    Intermediador?: SpedParticipante;
    /**
     * Valor total bruto das vendas e/ou prestações de serviços no campo de incidência do ICMS, incluindo operações com imunidade do imposto
     */
    TotalVendas?: number;
    /**
     * Valor total bruto das prestações de serviços no campo de incidência do ISS
     */
    TotalIss?: number;
    /**
     * Valor total de operações deduzido dos valores dos campos TotalVendas e TotalIss.
     */
    TotalOutros?: number;
}
export interface DFeInfo {
    Chave?: string;
    Serie?: string;
    /**
     * Código de classe de consumo de energia elétrica ou gás
     * 1 - Comercial
     * 2 - Consumo Próprio
     * 3 - Iluminação Pública
     * 4 - Industrial
     * 5 - Poder Público
     * 6 - Residencial
     * 7 - Rural
     * 8 - Serviço Público
     * Código de classe de consumo de fornecimento d'água
     * 0 - registro consolidando os documentos de consumo residencial até R$ 50,00
     * 1 - registro consolidando os documentos de consumo residencial de R$ 50,01 a R$ 100,00
     * 2 - registro consolidando os documentos de consumo residencial de R$ 100,01 a R$ 200,00
     * 3 - registro consolidando os documentos de consumo residencial de R$ 200,01 a R$ 300,00
     * 4 - registro consolidando os documentos de consumo residencial de R$ 300,01 a R$ 400,00
     * 5 - registro consolidando os documentos de consumo residencial de R$ 400,01 a R$ 500,00
     * 6 - registro consolidando os documentos de consumo residencial de R$ 500,01 a R$ 1000,00
     * 7 - registro consolidando os documentos de consumo residencial acima de R$ 1.000,01
     * 20 - registro consolidando os documentos de consumo comercial/industrial até R$ 50,00
     * 21 - registro consolidando os documentos de consumo comercial/industrial de R$ 50,01 a R$ 100,00
     * 22 - registro consolidando os documentos de consumo comercial/industrial de R$ 100,01 a R$ 200,00
     * 23 - registro consolidando os documentos de consumo comercial/industrial de R$ 200,01 a R$ 300,00
     * 24 - registro consolidando os documentos de consumo comercial/industrial de R$ 300,01 a R$ 400,00
     * 25 - registro consolidando os documentos de consumo comercial/industrial de R$ 400,01 a R$ 500,00
     * 26 - registro consolidando os documentos de consumo comercial/industrial de R$ 500,01 a R$ 1.000,00
     * 27 - registro por documento fiscal de consumo comercial/industrial acima de R$ 1.000,01
     * 80 - registro consolidando os documentos de consumo de órgão público
     * 90 - registro consolidando os documentos de outros tipos de consumo até R$ 50,00
     * 91 - registro consolidando os documentos de outros tipos de consumo de R$ 50,01 a R$ 100,00
     * 92 - registro consolidando os documentos de outros tipos de consumo de R$ 100,01 a R$ 200,00
     * 93 - registro consolidando os documentos de outros tipos de consumo de R$ 200,01 a R$ 300,00
     * 94 - registro consolidando os documentos de outros tipos de consumo de R$ 300,01 a R$ 400,00
     * 95 - registro consolidando os documentos de outros tipos de consumo de R$ 400,01 a R$ 500,00
     * 96 - registro consolidando os documentos de outros tipos de consumo de R$ 500,01 a R$ 1.000,00
     * 97 - registro consolidando os documentos de outros tipos de consumo acima de R$ 1.000,01
     * 99 - registro por documento fiscal emitido
     */
    CodConsumo?: number;
    Numero?: number;
    DtEmissao?: string;
    Observacao?: string;
    Valor?: number;
    Desconto?: number;
    /**
     * Código do grupo de tensão
     * 1 - A1 - Alta tensão (230kV ou mais)
     * 2 - A2 - Alta tensão (88 a 138kV)
     * 3 - A3 - Alta tensão (69kV)
     * 4 - A3a - Alta tensão (30kV a 44kV)
     * 5 - A4 - Alta tensão (2,3kV a 25kV)
     * 6 - AS - Alta tensão subterrâneo
     * 7 - B1 - Residencial
     * 8 - B1 - Residencial baixa renda
     * 9 - B2 - Rural
     * 10 - B2 - Cooperativa de eletrificação rural
     * 11 - B2 - Serviço público de irrigação
     * 12 - B3 - Demais classes
     * 13 - B4a - Iluminação pública - rede de distribuição
     * 14 - B4b - Iluminação pública - bulbo de lâmpada
     */
    CodGrupoTensao?: number;
    /**
     * Código do tipo de ligação
     * 1 - Monofásico
     * 2 - Bifásico
     * 3 - Trifásico
     */
    TipoLigacao?: number;
    /**
     * Código do Tipo de Assinante:
     * 1 - Comercial/Industrial
     * 2 - Poder Público
     * 3 - Residencial/Pessoa física
     * 4 - Público
     * 5 - Semi-Público
     * 6 - Outros
     */
    TipoAssinante?: number;
    DFeComplemento?: DFeComplemento;
    Participante?: SpedParticipante;
}
export interface SpedParticipante extends Pessoa {
    CpfCnpj?: string;
    Ie?: string;
    NmParticipante?: string;
    IndicadorIe?: number;
}
