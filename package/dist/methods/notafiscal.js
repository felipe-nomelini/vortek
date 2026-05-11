"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotaFiscal = void 0;
const brasilnferequest_1 = require("../brasilnferequest");
class NotaFiscal extends brasilnferequest_1.BrasilNFeRequest {
    constructor(token, url) {
        super(token, url);
    }
    async enviarNotaFiscal(notaFiscal, crt) {
        return this.request(notaFiscal, "EnviarNotaFiscal");
    }
    async enviarNotaFiscalLote(notaFiscalLote, crt) {
        return this.request(notaFiscalLote, "EnviarNotaFiscalLote");
    }
    async enviarNotaFiscalServico(notaFiscal) {
        return this.request(notaFiscal, "EnviarNotaFiscalServico");
    }
    async enviarManifestoTransporte(manifestoTransporte) {
        return this.request(manifestoTransporte, "EnviarManifestoTransporte");
    }
    async enviarNFEnerCom(nFEnerComEnvio) {
        return this.request(nFEnerComEnvio, "EnviarNFEnerCom");
    }
    async enviarNotaFiscalComplementar(notaFiscal) {
        return this.request(notaFiscal, "EnviarNotaFiscalComplementar");
    }
    async enviarConhecimentoTransporte(cteEnvio) {
        return this.request(cteEnvio, "EnviarConhecimentoTransporte");
    }
    async enviarDeclaracaoConteudo(dceEnvio) {
        return this.request(dceEnvio, "EnviarDeclaracaoConteudo");
    }
}
exports.NotaFiscal = NotaFiscal;
