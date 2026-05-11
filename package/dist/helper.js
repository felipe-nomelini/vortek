"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrasilNFeHelper = exports.TipoRateio = void 0;
var TipoRateio;
(function (TipoRateio) {
    TipoRateio[TipoRateio["Substituir"] = 0] = "Substituir";
    TipoRateio[TipoRateio["Somar"] = 1] = "Somar";
    TipoRateio[TipoRateio["Subtrair"] = 2] = "Subtrair";
})(TipoRateio || (exports.TipoRateio = TipoRateio = {}));
class BrasilNFeHelper {
    /**
     * Distribui um valor total entre os itens da lista com base na proporção de um segundo seletor.
     */
    static ratear(itens, valorTotal, seletor, seletorProporcao, tipoRateio, atualizarItem) {
        const totalProporcao = itens.reduce((sum, item) => sum + seletorProporcao(item), 0);
        if (totalProporcao === 0)
            return;
        let somaArredondada = 0;
        const ultimoIndex = itens.length - 1;
        for (let i = 0; i < itens.length; i++) {
            const item = itens[i];
            const propValor = seletorProporcao(item);
            let proporcao = propValor / totalProporcao;
            let valorRateado = parseFloat(((proporcao * valorTotal) / propValor).toFixed(6)); // Math.Round com 6 casas
            if (i === ultimoIndex) {
                valorRateado = (valorTotal - somaArredondada) / propValor;
            }
            somaArredondada += valorRateado * propValor;
            const valorAtual = seletor(item);
            const novoValor = this.aplicarRateio(valorAtual, valorRateado, tipoRateio);
            atualizarItem(item, novoValor);
        }
    }
    static aplicarRateio(valorAtual, valorRateado, tipoRateio) {
        switch (tipoRateio) {
            case TipoRateio.Substituir:
                return valorRateado;
            case TipoRateio.Somar:
                return valorAtual + valorRateado;
            case TipoRateio.Subtrair:
                return valorAtual - valorRateado;
            default:
                return valorAtual;
        }
    }
}
exports.BrasilNFeHelper = BrasilNFeHelper;
