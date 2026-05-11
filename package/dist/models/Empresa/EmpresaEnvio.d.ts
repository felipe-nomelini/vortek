import { Endereco, Contato } from '../Outros/Pessoa';
export interface EmpresaEnvio {
    /**
     * CNPJ
     */
    CNPJ?: string;
    /**
     * Nome Fantasia
     */
    NmFantasia?: string;
    /**
     * Razão Social
     */
    RzSocial?: string;
    /**
     * Tipo da empresa
     * 1 - Matriz
     */
    TipoEmpresa?: number;
    /**
     * Inscrição Estadual
     */
    IE?: string;
    /**
     * Inscrição Municipal
     */
    IM?: string;
    /**
     * Código Regime Tributário
     * 1 - Simples Nacional
     * 2 - Simples Nacional - Exesso Sublimite
     * 3 - Regime Normal
     */
    CRT?: number;
    /**
     * CNPJ
     */
    CNAE?: string;
    /**
     * Identificado do código de segurança do contribuinte (NFC-e)
     */
    IdentificadorCSC?: string;
    /**
     * Código de segurança do contribuinte (NFC-e)
     */
    CodigoCSC?: string;
    /**
     * Token Brasil NFe (Sómente para consulta)
     */
    Token?: string;
    /**
     * Site da empresa
     */
    Site?: string;
    /**
     * Código do grupo
     */
    CodGrupo?: number;
    /**
     * Informações de endereço
     */
    Endereco?: Endereco;
    /**
     * Informações de contato
     */
    Contato?: Contato;
    /**
     * Configurações da empresa
     */
    Configuracao?: Configuracao;
}
export interface Configuracao {
    /**
     * Informações de NFe
     */
    NFe?: NFe;
    /**
     * Informações de NFC-e
     */
    NFCe?: NFCe;
    /**
     * Informações de NFS-e
     */
    NFSe?: NFSe;
    /**
     * Informações de Serviços
     */
    Servicos?: Servicos;
}
export interface NFSe {
    /**
     * Código tipo ambiente emissão NFS-e
     * 1 - Produção
     * 2 - Homologação
     */
    CodTipoAmbiente?: number;
    /**
     * Token da empresa que possui a procuração para emissão de notas
     */
    TokenProcurador?: string;
    /**
     * Login (somente municípios que utilizam login/senha para autenticação no webservice)
     */
    LoginWebService?: string;
    /**
     * Senha (somente municípios que utilizam login/senha para autenticação no webservice)
     */
    SenhaWebService?: string;
    /**
     * Cpf do usuário vinculado a empresa (somente municípios que utilizam login/senha para autenticação no webservice)
     */
    CpfWebService?: string;
    /**
     * Controle de série e numeração interno?
     * Verdadeiro - A série e numeração e controlado pelo brasil NFe
     * Falso - A série e númeração e obrigatóriamente enviada pela API
     */
    ControleNumeracaoInterno?: boolean;
}
export interface NFe {
    /**
     * Código Tipo Ambiente Emissão NF-e
     * 1 - Produção
     * 2 - Homologação
     */
    CodTipoAmbiente?: number;
    /**
     * Controle de série e numeração interno?
     * Verdadeiro - A série e numeração e controlado pelo brasil NFe
     * Falso - A série e númeração e obrigatóriamente enviada pela API
     */
    ControleNumeracaoInterno?: boolean;
}
export interface NFCe {
    /**
     * Código Tipo Ambiente Emissão NFC-e
     * 1 - Produção
     * 2 - Homologação
     */
    CodTipoAmbiente?: number;
    /**
     * Controle de série e numeração interno?
     * Verdadeiro - A série e numeração e controlado pelo brasil NFe
     * Falso - A série e númeração e obrigatóriamente enviada pela API
     */
    ControleNumeracaoInterno?: boolean;
}
export interface Servicos {
    /**
     * Serviço de MDF-e/CT-e?
     * Verdadeiro - Serviço de emissão de MDF-e/CT-e ativado
     * Falso - Serviço de emissão de MDF-e/CT-e desativado
     */
    MDFeCTe?: boolean;
    /**
     * Serviço de NFe/NFCe?
     * Verdadeiro - Serviço de emissão de NFe/NFCe ativado
     * Falso - Serviço de emissão de NFe/NFCe desativado
     */
    NFeNFCe?: boolean;
    /**
     * Serviço de NFSe?
     * Verdadeiro - Serviço de emissão de NFS-e ativado
     * Falso - Serviço de emissão de NFS-e desativado
     */
    NFSe?: boolean;
    /**
     * Serviço do Sintegra?
     * Verdadeiro - Serviço de emissão de Sped ativado
     * Falso - Serviço de emissão de Sped desativado
     */
    Sped?: boolean;
    /**
     * Serviço do Sintegra?
     * Verdadeiro - Serviço de emissão de Sintegra ativado
     * Falso - Serviço de emissão de Sintegra desativado
     */
    Sintegra?: boolean;
    /**
     * Serviço de CF-e SAT?
     * Verdadeiro - Serviço de emissão de CF-e SAT ativado
     * Falso - Serviço de emissão de CF-e SAT desativado
     */
    CFeSat?: boolean;
}
