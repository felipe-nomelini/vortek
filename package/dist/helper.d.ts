export declare enum TipoRateio {
    Substituir = 0,
    Somar = 1,
    Subtrair = 2
}
export declare class BrasilNFeHelper {
    /**
     * Distribui um valor total entre os itens da lista com base na proporção de um segundo seletor.
     */
    static ratear<T>(itens: T[], valorTotal: number, seletor: (item: T) => number, seletorProporcao: (item: T) => number, tipoRateio: TipoRateio, atualizarItem: (item: T, novoValor: number) => void): void;
    private static aplicarRateio;
}
