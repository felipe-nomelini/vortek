"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Arquivos = void 0;
const brasilnferequest_1 = require("../brasilnferequest");
class Arquivos extends brasilnferequest_1.BrasilNFeRequest {
    constructor(token, url) {
        super(token, url);
    }
    // -------- Métodos alinhados ao SDK principal (C#) --------
    async obterArquivoSintegra(sintegraEnvio) {
        return this.request(sintegraEnvio, "ObterArquivoSintegra");
    }
    async obterArquivoFci(fciEnvio) {
        return this.request(fciEnvio, "ObterArquivoFci");
    }
    async obterArqEnerCom(arqEnerComEnvio) {
        return this.request(arqEnerComEnvio, "ObterArquivoNFEnerCom");
    }
    async obterArquivoSped(spedEnvio) {
        return this.request(spedEnvio, "ObterArquivoSped");
    }
    async obterArquivoSpedUnificado(unificarSpedEnvio) {
        return this.request(unificarSpedEnvio, "ObterArquivoSpedUnificado");
    }
    async recriarArquivoSped(codigo) {
        return this.request(codigo, `RecriarArquivoSped/?codigo=${codigo}`);
    }
    async pegarArquivo(pegarArquivoEnvio) {
        const base64String = await this.request(pegarArquivoEnvio, "GetFile");
        return Buffer.from(base64String, 'base64');
    }
    async pegarArquivoEvento(pegarArquivoEventoEnvio) {
        const base64String = await this.request(pegarArquivoEventoEnvio, "GetFileFromEvent");
        return Buffer.from(base64String, 'base64');
    }
    async obterArquivosPorRange(pegarArquivosRangeEnvio) {
        return this.request(pegarArquivosRangeEnvio, "ObterArquivosPorRange");
    }
    // -------- Aliases mantidos para compatibilidade com versões anteriores do SDK Node --------
    async gerarArquivoSintegra(sintegraEnvio) {
        return this.request(sintegraEnvio, "GerarArquivoSintegra");
    }
    async gerarArquivoFci(fciEnvio) {
        return this.request(fciEnvio, "GerarArquivoFci");
    }
    async gerarArquivoSped(spedEnvio) {
        return this.request(spedEnvio, "GerarArquivoSped");
    }
    async unificarArquivoSped(unificarSpedEnvio) {
        return this.request(unificarSpedEnvio, "UnificarArquivoSped");
    }
    async obterArquivoNotaFiscal(pegarArquivoEnvio) {
        const base64String = await this.request(pegarArquivoEnvio, "ObterArquivoNotaFiscal");
        return Buffer.from(base64String, 'base64');
    }
    async obterArquivoEvento(pegarArquivoEventoEnvio) {
        const base64String = await this.request(pegarArquivoEventoEnvio, "ObterArquivoEvento");
        return Buffer.from(base64String, 'base64');
    }
    async obterArquivosPorPeriodo(pegarArquivosRangeEnvio) {
        return this.request(pegarArquivosRangeEnvio, "ObterArquivosPorPeriodo");
    }
}
exports.Arquivos = Arquivos;
