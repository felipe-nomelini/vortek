export interface Pessoa {
    Endereco?: Endereco;
    Contato?: Contato;
}
export interface Endereco {
    Cep?: string;
    Logradouro?: string;
    Complemento?: string;
    Numero?: string;
    Bairro?: string;
    CodMunicipio?: string;
    Municipio?: string;
    Uf?: string;
    CodPais?: number;
    Pais?: string;
}
export interface Contato {
    Telefone?: string;
    Email?: string;
    Fax?: string;
}
export interface NewPessoa {
    endereco?: NewEndereco;
    contato?: NewContato;
}
export interface NewEndereco {
    cep?: string;
    logradouro?: string;
    complemento?: string;
    numero?: string;
    bairro?: string;
    codMunicipio?: string;
    municipio?: string;
    uf?: string;
    codPais?: number;
    pais?: string;
}
export interface NewContato {
    telefone?: string;
    email?: string;
    fax?: string;
}
