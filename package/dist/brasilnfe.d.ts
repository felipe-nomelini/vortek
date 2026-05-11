import { NotaFiscal } from './methods/notafiscal';
import { Eventos } from './methods/eventos';
import { Consultas } from './methods/consultas';
import { Empresa } from './methods/empresa';
import { Arquivos } from './methods/arquivos';
export declare class BrasilNFe {
    private _notaFiscal;
    private _eventos;
    private _consultas;
    private _empresa;
    private _arquivos;
    constructor(token: string, userToken?: string, url?: string);
    get notaFiscal(): NotaFiscal;
    get eventos(): Eventos;
    get consultas(): Consultas;
    get empresa(): Empresa;
    get arquivos(): Arquivos;
}
