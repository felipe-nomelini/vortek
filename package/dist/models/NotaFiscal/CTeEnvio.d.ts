import { Pessoa } from '../Outros/Pessoa';
import { NewError } from '../Outros/Erros';
export interface CteParticipante extends Pessoa {
    CpfCnpj?: string;
    Nome?: string;
    NomeFantasia?: string;
    Ie?: string;
}
export interface CteTomador extends CteParticipante {
    /**
     * Indicador de IE:
     * 1 - Contribuinte do ICMS
     * 2 - Contribuinte isento de inscrição
     * 9 - Não contribuinte
     */
    IndicadorIe?: number;
    /**
     * Tipo do participante do CT-e:
     * 0 - Remetente
     * 1 - Expedidor
     * 2 - Recebedor
     * 3 - Destinatário
     * 4 - Outros (Informar dados Tomador)
     */
    TipoTomador?: number;
}
export interface CteServico {
    /**
     * Tipo do Serviço:
     * 0 - Normal
     * 1 - Subcontratação
     * 2 - Redespacho
     * 3 - Redespacho Intermediário
     * 4 - Serviço Vinculado ao Multimodal
     * 6 - Transporte de Pessoas
     * 7 - Transporte de Valores
     * 8 - Excesso de Bagagem
     */
    Tipo?: number;
    /**
     * Código IBGE do município do início do transporte
     */
    CodMunicipioInicio?: number;
    /**
     * Nome do município do início do transporte
     */
    MunicipioInicio?: string;
    /**
     * Código IBGE do município do destino o transporte
     */
    CodMunicipioFim?: number;
    /**
     * Nome do município do destino do transporte
     */
    MunicipioFim?: string;
    /**
     * O valor total cobrado pela prestação do serviço de transporte.
     */
    ValorPrestacao?: number;
    /**
     * O valor líquido a receber pelo transportador.
     */
    ValorReceber?: number;
    /**
     * Lista de componentes que detalham como o valor total do frete foi formado.
     */
    Componentes?: Componente[];
}
export interface Componente {
    Nome?: string;
    Valor?: number;
}
export interface Documento {
    Chave?: string;
    PIN?: string;
}
export interface Carga {
    /**
     * Valor total da carga. (vCarga)
     */
    ValorTotal?: number;
    /**
     * Nome do Produto Predominante. (proPred)
     */
    ProdutoPredominante?: string;
    /**
     * Detalhes das quantidades da carga. (infQ)
     */
    Detalhes?: DetalheCarga[];
    /**
     * Documentos fiscais que acompanham a carga. (infNFe)
     */
    Documentos?: Documento[];
}
export interface DetalheCarga {
    /**
     * Código da Unidade de Medida (cUnid)
     * 0 - Metro Cúbico (M3)
     * 1 - Quilograma (KG)
     * 2 - Tonelada (TON)
     * 3 - Unidade (UNIDADE)
     * 4 - Litros (LITROS)
     * 5 - MMBTU (MMBTU)
     */
    CodUnidadeMedida?: number;
    /**
     * Quantidade da Carga (qCarga). Ex: 10000
     */
    Quantidade?: number;
    /**
     * Tipo de Medida. (tpMed). Ex: "quilos gramas"
     */
    TipoMedida?: string;
}
export interface CteImposto {
    /**
     * Informações do ICMS
     */
    ICMS?: CteICMS;
    /**
     * Valor total dos tributos federais e estaduais, aproximado conforme Lei 12.741/12.
     */
    ValorTotalTributos?: number;
    /**
     * Informações Adicionais de Interesse do Fisco.
     */
    InformacoesAdicionaisFisco?: string;
    /**
     * Informações sobre o ICMS Partilha (DIFAL/ICMS UF Fim).
     */
    Difal?: Difal;
    /**
     * Lista de PIS e COFINS (Tributos Federais).
     */
    TributosFederal?: TributoFederal;
}
export interface TributoFederal {
    /**
     * Valor do PIS retido. (vPIS)
     */
    ValorPis?: number;
    /**
     * Valor do COFINS retido. (vCOFINS)
     */
    ValorCofins?: number;
    /**
     * Valor do Imposto de Renda retido. (vIR)
     */
    ValorIr?: number;
    /**
     * Valor do INSS retido. (vINSS)
     */
    ValorInss?: number;
    /**
     * Valor da CSLL retida. (vCSLL)
     */
    ValorCsll?: number;
}
export interface CteICMS {
    /**
     * Código de Situação Tributária (CST) do ICMS. (Ex: 00, 20, 40, 41, 51, 60, 90, etc.)
     * Para empresas do Simples Nacional, é usando o 90 automáticamente.
     */
    CST?: string;
    /**
     * Base de Cálculo do ICMS. (vBC)
     */
    BaseCalculo?: number;
    /**
     * Alíquota do ICMS (em percentual). (pICMS)
     */
    Aliquota?: number;
    /**
     * Valor do ICMS. (vICMS)
     */
    Valor?: number;
    /**
     * Percentual de Redução da Base de Cálculo. (pRedBC)
     * Usado nos CSTs 20 e 90.
     */
    PercentualReducaoBaseCalculo?: number;
    /**
     * Alíquota do ICMS devido a Outra UF. (pICMSOutraUF)
     * Usado no CST OutraUF.
     */
    AliquotaOutraUF?: number;
    /**
     * Valor do ICMS devido a Outra UF. (vICMSOutraUF)
     * Usado no CST OutraUF.
     */
    ValorICMSOutraUF?: number;
}
export interface Difal {
    /**
     * Base de Cálculo do ICMS na UF de Destino. (vBCUFFim)
     */
    BaseCalculoUfDestino?: number;
    /**
     * Percentual do Fundo de Combate à Pobreza (FCP) na UF de destino. (pFCPUFFim)
     */
    PercentualFCPUfDestino?: number;
    /**
     * Alíquota interna da UF de destino para o ICMS. (pICMSUFFim)
     */
    AliquotaICMSUfDestino?: number;
    /**
     * Alíquota interestadual das UF envolvidas. (pICMSInter)
     */
    AliquotaInterestadual?: number;
    /**
     * Percentual de Partilha do ICMS (Ex: 80, 20, 0, etc.). (pICMSInterPart)
     */
    PercentualPartilhaICMS?: number;
    /**
     * Valor do Fundo de Combate à Pobreza (FCP) na UF de destino. (vFCPUFFim)
     */
    ValorFCPUfDestino?: number;
    /**
     * Valor total do ICMS devido à UF de destino (já com o FCP). (vICMSUFFim)
     */
    ValorICMSUfDestino?: number;
    /**
     * Valor do ICMS devido à UF de origem (Início). (vICMSUFIni)
     */
    ValorICMSUfInicio?: number;
}
export interface ModalCTe {
    /**
     * Modal do CT-e:
     * 1 - Rodoviário
     * 2 - Aéreo
     * 3 - Aquaviário
     * 4 - Ferroviário
     * 5 - Dutoviário
     * 6 - Multimodal
     */
    Tipo?: number;
    Rodoviario?: CteRodoviario;
}
export interface CteRodoviario {
    /**
     * Data prevista da entrega da carga
     */
    DtPrevEntrega?: string;
    /**
     * Indica se o transporte é lote completo ou não.
     * Sim - É transporte de lotação (veículo dedicado totalmente ao remetente)
     * Não - Não é lotação (carga compartilhada)
     */
    LoteCompleto?: boolean;
    /**
     * Código Identificador da Operação de Transporte (ANTT).
     */
    CIOT?: string;
    /**
     * Lista de coletas realizadas para compor o frete.
     */
    OCCs?: OCC[];
    /**
     * Informações de vale-pedágio
     */
    ValePedagios?: ValePedagio[];
    /**
     * Lista de veículos tracionadores usados no transporte.
     */
    Veiculos?: CteVeiculo[];
    /**
     * Lacres colocados no veículo ou no baú
     */
    Lacres?: string[];
    /**
     * Lista dos motoristas que realizarão a viagem.
     */
    Motoristas?: Motorista[];
}
export interface Motorista {
    /**
     * Nome do motorista
     */
    Nome?: string;
    /**
     * Cpf do motorista
     */
    Cpf?: string;
}
export interface CteVeiculo {
    /**
     * Código interno do veículo na transportadora (opcional).
     */
    CodigoInterno?: string;
    /**
     * RENAVAM do veículo.
     */
    Renavam?: string;
    /**
     * Placa do veículo.
     */
    Placa?: string;
    /**
     * Tara em KG.
     */
    Tara?: number;
    /**
     * Capacidade máxima em quilos.
     */
    CapacidadeKG?: number;
    /**
     * Capacidade em metros cúbicos.
     */
    CapacidadeM3?: number;
    /**
     * Tipo de propriedade do veículo.
     * Sim - Terceiros
     * Não - Proprio
     */
    TipoPropriedade?: boolean;
    /**
     * Tipo de veículo.
     * 0 - Tração
     * 1 - Reboque
     */
    TipoVeiculo?: number;
    /**
     * Tipo de rodado.
     * 0 - Não aplicavel
     * 1 - Truck
     * 2 - Toco
     * 3 - Cavalo Mecânico
     * 4 - Van
     * 5 - Utilitário
     * 6 - Outros
     */
    TipoRodado?: number;
    /**
     * Tipo de carroceria.
     * 0 - Não aplicavel
     * 1 - Aberta
     * 2 - Fechada
     * 3 - Graneleira
     * 4 - Porta Container
     * 5 - Sider
     */
    TipoCarroceria?: number;
    /**
     * UF da placa.
     */
    UfPlaca?: string;
    /**
     * Proprietário do veículo
     */
    Proprietario?: Proprietario;
}
export interface Proprietario {
    /**
     * Identificação do proprietário.
     */
    CpfCnpj?: string;
    /**
     * Registro nacional do proprietário do veículo na ANTT.
     */
    RNTRC?: string;
    /**
     * Termo de Autorização de Fretamento
     */
    TAF?: string;
    /**
     * número do registro do proprietário de veículo de carga no estado
     */
    NroRegEstadual?: string;
    /**
     * Nome/Razão Social
     */
    Nome?: string;
    /**
     * Inscrição Estadual
     */
    Ie?: string;
    /**
     * Inscrição Estadual
     */
    Uf?: string;
    /**
     * Tipo do proprietário:
     * 0 - TAC Agregado
     * 1 - TAC Independente
     * 2 - Outros
     */
    TipoProprietario?: number;
}
export interface ValePedagio {
    /**
     * É o número da compra/ordem do vale-pedágio emitido.
     */
    NumeroComprovante?: string;
    /**
     * CNPJ da empresa que emitiu o vale-pedágio
     */
    CnpjFornecedor?: string;
    /**
     * É o CNPJ de quem pagou o vale-pedágio
     */
    CnpjPagador?: string;
    /**
     * Valor Total do Vale-Pedágio
     */
    Valor?: number;
}
export interface OCC {
    Serie?: string;
    Numero?: number;
    DtEmissaoColeta?: string;
    Emissor?: EmissorOCC;
}
export interface EmissorOCC {
    /**
     * CNPJ do emissor da OCC
     */
    Cnpj?: string;
    /**
     * Inscrição estadual do emissor
     */
    Ie?: string;
    /**
     * Código interno da OCC na empresa emissora
     */
    CodigoInternoOCC?: string;
    /**
     * Estado do emissor da OCC
     */
    Uf?: string;
    /**
     * Telefone do emissor da OCC
     */
    Telefone?: string;
}
export interface CTeEnvio {
    Codigo?: number;
    Lote?: number;
    Serie?: number;
    Numero?: number;
    IdentificadorInterno?: string;
    /**
     * Tipo do Documento Fiscal:
     * 57 - CT-e
     * 67 - CT-e OS
     */
    ModeloDocumento?: number;
    /**
     * Tipo do Documento Fiscal:
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    /**
     * Tipo do Documento Fiscal:
     * 0 - CT-e Normal
     * 1 - CT-e de Complemento de Valores
     * 2 - CT-e de Anulação
     * 3 - CT-e Substituto
     */
    TipoCte?: number;
    Retira?: boolean;
    DtEmissao?: string;
    Cfop?: number;
    NaturezaOperacao?: string;
    Observacao?: string;
    Modal?: ModalCTe;
    Carga?: Carga;
    Imposto?: CteImposto;
    Servico?: CteServico;
    Tomador?: CteTomador;
    Destinatario?: CteParticipante;
    Remetente?: CteParticipante;
    Expedidor?: CteParticipante;
}
export interface CTeRetorno extends NewError {
    serie?: number;
    numero?: number;
    chave?: string;
    tipoAmbiente?: string;
    base64Xml?: string;
    base64DACTe?: string;
}
