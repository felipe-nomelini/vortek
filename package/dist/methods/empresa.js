"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Empresa = void 0;
const brasilnferequest_1 = require("../brasilnferequest");
class Empresa extends brasilnferequest_1.BrasilNFeRequest {
    constructor(token, url, userToken) { super(token, url, userToken); }
    async alterarCertificado(certificado) {
        return this.request(certificado, "AlterarCertificado");
    }
    async verificarCertificado(certificado) {
        return this.request(certificado, "VerifyCertificate");
    }
    async adicionarEmpresa(empresa) {
        return this.request(empresa, "AdicionarEmpresa");
    }
    async editarEmpresa(empresa) {
        return this.request(empresa, "EditarEmpresa");
    }
    async buscarEmpresa() {
        return this.request("", "BuscarEmpresa");
    }
    async buscarTodasEmpresas() {
        return this.request("", "BuscarTodasEmpresas");
    }
}
exports.Empresa = Empresa;
