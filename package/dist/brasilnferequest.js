"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrasilNFeRequest = void 0;
const axios_1 = __importDefault(require("axios"));
class BrasilNFeRequest {
    constructor(token, url, userToken = "") {
        this._token = token;
        this._userToken = userToken;
        this._url = url;
        this._axiosInstance = axios_1.default.create({
            baseURL: this._url,
            timeout: 300000, // 5 minutos
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Token': this._token,
                'UserToken': this._userToken,
                'Package-Version': '1.22.3',
                'Package-Type': 'node.js'
            }
        });
    }
    async request(objectSender, metodo) {
        var _a;
        try {
            const response = await this._axiosInstance.post(metodo, objectSender);
            return response.data;
        }
        catch (error) {
            const errorMessage = ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`${new Date().toISOString()} - Erro ao efetuar requisição HTTPS com Brasil NFe: ${errorMessage}`);
        }
    }
}
exports.BrasilNFeRequest = BrasilNFeRequest;
