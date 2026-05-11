"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrasilNFe = void 0;
const notafiscal_1 = require("./methods/notafiscal");
const eventos_1 = require("./methods/eventos");
const consultas_1 = require("./methods/consultas");
const empresa_1 = require("./methods/empresa");
const arquivos_1 = require("./methods/arquivos");
class BrasilNFe {
    constructor(token, userToken = "", url = "https://api.brasilnfe.com.br/services/") {
        this._empresa = null;
        const fiscalUrl = url + "Fiscal/";
        const empresaUrl = url + "Empresa/";
        this._notaFiscal = new notafiscal_1.NotaFiscal(token, fiscalUrl);
        this._eventos = new eventos_1.Eventos(token, fiscalUrl);
        this._consultas = new consultas_1.Consultas(token, fiscalUrl);
        this._arquivos = new arquivos_1.Arquivos(token, fiscalUrl);
        if (userToken) {
            this._empresa = new empresa_1.Empresa(token, empresaUrl, userToken);
        }
    }
    get notaFiscal() { return this._notaFiscal; }
    get eventos() { return this._eventos; }
    get consultas() { return this._consultas; }
    get empresa() {
        if (!this._empresa)
            throw new Error("UserToken não fornecido na inicialização.");
        return this._empresa;
    }
    get arquivos() { return this._arquivos; }
}
exports.BrasilNFe = BrasilNFe;
