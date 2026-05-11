"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Consultas = void 0;
const brasilnferequest_1 = require("../brasilnferequest");
class Consultas extends brasilnferequest_1.BrasilNFeRequest {
    constructor(token, url) { super(token, url); }
    // -------- Métodos alinhados ao SDK principal (C#) --------
    async statusSefaz(envio) {
        return this.request(envio, "StatusSefaz");
    }
    async calcularImpostos(produtos) {
        return this.request(produtos, "CalcularImpostos");
    }
    async preVisualizarNotaFiscal(envio) {
        return this.request(envio, "PreVisualizarNotaFiscal");
    }
    async buscarNotaFiscalServico(envio) {
        return this.request(envio, "BuscarNotaFiscalServico");
    }
    async buscarNotaFiscal(envio) {
        return this.request(envio, "BuscarNotaFiscal");
    }
    async consultarCadastroSefaz(envio) {
        return this.request(envio, "ConsultarCadastroSefaz");
    }
    async buscarArquivoSped(codigo) {
        return this.request(codigo, `BuscarArquivoSped/?codigo=${codigo}`);
    }
    // -------- Aliases mantidos para compatibilidade com versões anteriores do SDK Node --------
    async consultarStatusSefaz(envio) {
        return this.request(envio, "ConsultarStatusSefaz");
    }
    async obterNotasFiscais(envio) {
        return this.request(envio, "ObterNotasFiscais");
    }
    async obterArquivoSped(codigo) {
        return this.request(codigo, `ObterArquivoSped/?codigo=${codigo}`);
    }
}
exports.Consultas = Consultas;
