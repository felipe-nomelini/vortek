"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Eventos = void 0;
const brasilnferequest_1 = require("../brasilnferequest");
class Eventos extends brasilnferequest_1.BrasilNFeRequest {
    constructor(token, url) { super(token, url); }
    async cancelarNotaFiscal(envio) {
        return this.request(envio, "CancelarNotaFiscal");
    }
    async cancelarNF(envio) {
        return this.request(envio, "CancelNF");
    }
    async enviarCartaCorrecao(envio) {
        return this.request(envio, "EnviarCartaCorrecao");
    }
    async inutilizarNumeracao(envio) {
        return this.request(envio, "InutilizarNumeracao");
    }
    async manifestarNotaFiscal(envio) {
        return this.request(envio, "ManifestarNotaFiscal");
    }
    async encerrarManifestoTransporte(envio) {
        return this.request(envio, "EncerrarManifestoTransporte");
    }
}
exports.Eventos = Eventos;
