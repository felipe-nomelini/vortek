export interface ManifestoTransporteEnvio {
    /**
     * Tipo de ambiente (Padrão 2)
     * 1 - Produção
     * 2 - Homologação
     */
    tipoAmbiente?: number;
    identificadorInterno?: string;
    codigo?: number;
    lote?: number;
    numero?: number;
    serie?: number;
    /**
     * Tipo de emitente (Padrão 2)
     * 1 - Prestador de Serviço de Transporte
     * 2 - Transportador de carga própria
     */
    tipoEmitente?: number;
    DataEmissao?: string;
    ufCarregamento?: string;
    ufDescarregamento?: string;
    observacao?: string;
    observacaoFisco?: string;
    /**
     * Modalidade de Transporte (Padrão 1)
     * 1 - Rodoviário
     * 2 - Aério
     * 3 - Aquaviário
     * 4 - Ferroviário
     */
    modalidade?: number;
    /**
     * Valor total da carga / mercadorias transportadas
     */
    valor?: number;
    /**
     * Peso Bruto Total da Carga / Mercadorias transportadas em KG
     */
    peso?: number;
    Rodoviario?: Rodoviario;
    Aerio?: Aerio;
    Aquaviario?: Aquaviario;
    Ferroviario?: Ferroviario;
    seguros?: Seguro[];
    carregamentos?: Carregamento[];
    descarregamentos?: Descarregamento[];
    percursoUfs?: string[];
}
export interface Aerio {
    nacionalidade?: string;
    matricula?: string;
    numeroVoo?: string;
    arodromoEmbarque?: string;
    arodromoDestino?: string;
    dataVoo?: string;
}
export interface Aquaviario {
    cnpjAgencia?: string;
    tipoEmbarcacao?: number;
    codEmbarcacao?: string;
    nomeEmbarcacao?: string;
    numeroViagem?: string;
    codPortoEmbarque?: string;
    codPortoDestino?: string;
}
export interface Ferroviario {
    prefixo?: string;
    DataLiberacao?: string;
    origem?: string;
    destino?: string;
    quantidadeVagoes?: number;
    Vagoes?: Vagao[];
}
export interface Vagao {
    serie?: number;
    numero?: number;
    sequencia?: number;
    toneladaUtil?: number;
    /**
     * Peso Base de Cálculo de Frete em Toneladas
     */
    pesoBc?: number;
    /**
     * Peso Real em Toneladas
     */
    pesoReal?: number;
}
export interface Rodoviario {
    /**
     * Tipo de Rodado (Padrão 1)
     * 1 - Truck
     * 2 - Toco
     * 3 - Cavalo Mecânico
     * 4 - VAN
     * 5 - Utilitário
     * 6 - Outros
     */
    tipoRodado?: number;
    /**
     * Tipo de Carroceria (Padrão 1)
     * 0 - Não aplicavel
     * 1 - Aberta
     * 2 - Fechado Baú
     * 3 - Granelera
     * 4 - Porta Container
     * 5 - Sider
     */
    tipoCarroceria?: number;
    placa?: string;
    renavan?: string;
    uf?: string;
    /**
     * Tara em KG
     */
    tara?: number;
    condutores?: Condutor[];
}
export interface Condutor {
    nome?: string;
    cpf?: string;
}
export interface Carregamento {
    codMunicipio?: number;
    municipio?: string;
}
export interface Descarregamento {
    codMunicipio?: number;
    municipio?: string;
    chaveDfe?: string;
    transportePerigosos?: TransportePerigosoInfo[];
}
export interface TransportePerigosoInfo {
    codigoONU?: string;
    quantidade?: number;
}
export interface Seguro {
    /**
     * Identificação do Ambiente (Padrão 1)
     * 1 - Emitente do MDF-e
     * 2 - Responsável pela contratação
     */
    indicadorResponsavel?: number;
    cpfCnpjResponsavel?: string;
    cnpjSegurador?: string;
    nomeSegurador?: string;
}
