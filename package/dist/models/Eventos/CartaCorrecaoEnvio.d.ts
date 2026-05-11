export interface CartaCorrecaoEnvio {
    /**
     * Ambiente de emissão do evento (Padrão 1)
     * 1 - Produção
     * 2 - Homologação
     */
    TipoAmbiente?: number;
    /**
     * Chave do documento
     */
    ChaveNF?: string;
    /**
     * Descrição da correção
     */
    Correcao?: string;
    /**
     * Número sequencial do evento
     */
    NumeroSequencial?: number;
    /**
     * Lista de Correções (Somente CTe)
     */
    Correcoes?: Correcao[];
}
export interface Correcao {
    Campo?: string;
    Grupo?: string;
    Valor?: string;
}
