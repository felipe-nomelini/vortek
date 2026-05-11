export declare class BrasilNFeRequest {
    private _token;
    private _userToken;
    private _url;
    private _axiosInstance;
    constructor(token: string, url: string, userToken?: string);
    protected request<TReturn, TSender>(objectSender: TSender, metodo: string): Promise<TReturn>;
}
