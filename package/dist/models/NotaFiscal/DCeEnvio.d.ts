import { Pessoa } from '../Outros/Pessoa';
import { NewError } from '../Outros/Erros';
export interface DCeEnvio {
    Codigo?: number;
    Lote?: number;
    Serie?: number;
    Numero?: number;
    IdentificadorInterno?: string;
    /**
     * Tipo de ambiente:
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    /**
     * Tipo do emitente:
     * 0 - App Fisco
     * 1 - Marketplace
     * 2 - Emissor próprio
     * 3 - Transportadora
     * 4 - ECT (Correios)
     */
    TipoEmitente?: number;
    /**
     * Nome do órgão fiscalizador (obrigatório quando TipoEmitente=0)
     */
    XOrgaoFisco?: string;
    /**
     * Sigla da UF do órgão fiscalizador (obrigatório quando TipoEmitente=0).
     * Se não preenchido, usa a UF da empresa emissora.
     */
    UfFisco?: string;
    /**
     * Modalidade de transporte:
     * 0 - Correios
     * 1 - Conta própria
     * 2 - Transportadora
     */
    ModalidadeTransporte?: number;
    /**
     * URL do site do marketplace (obrigatório quando TipoEmitente=1)
     */
    SiteMarketplace?: string;
    /**
     * Dados do remetente (pessoa física/jurídica que está enviando o pacote)
     */
    Remetente?: PessoaDCe;
    /**
     * Dados do destinatário
     */
    Destinatario?: PessoaDCe;
    /**
     * Itens/produtos declarados no conteúdo
     */
    Itens?: ItemDCe[];
    /**
     * Valor total declarado da DC-e
     */
    ValorTotal?: number;
    /**
     * Informações complementares (opcional, até 5000 caracteres)
     */
    InformacoesComplementares?: string;
    /**
     * Informações adicionais de interesse do fisco (opcional, até 2000 caracteres)
     */
    InformacoesAdicionaisFisco?: string;
    /**
     * Texto da declaração sobre contribuinte ICMS
     */
    DeclaracaoContribuinteICMS?: string;
    /**
     * Texto da declaração sobre crime tributário
     */
    DeclaracaoCrimeTributario?: string;
}
export interface PessoaDCe extends Pessoa {
    /**
     * CPF ou CNPJ
     */
    CpfCnpj?: string;
    /**
     * Nome ou Razão Social
     */
    Nome?: string;
}
export interface ItemDCe {
    /**
     * Descrição do produto/conteúdo (1-120 caracteres)
     */
    Descricao?: string;
    /**
     * Código NCM (2 ou 8 dígitos)
     */
    NCM?: string;
    /**
     * Quantidade
     */
    Quantidade?: number;
    /**
     * Valor unitário
     */
    ValorUnitario?: number;
    /**
     * Valor total do item
     */
    ValorTotal?: number;
    /**
     * Informações adicionais do produto (opcional, até 500 caracteres)
     */
    InformacoesAdicionais?: string;
}
export interface DCeRetorno extends NewError {
    serie?: number;
    numero?: number;
    chave?: string;
    tipoAmbiente?: string;
    base64Xml?: string;
    base64DACE?: string;
}
