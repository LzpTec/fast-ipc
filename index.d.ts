declare type RequestHandler = (data: any) => any | Promise<any>;
export interface serverConfig {
    onError?: (err: unknown) => void;
    onClose?: () => void;
}
export interface clientConfig {
    onError?: (err: unknown) => void;
    timeout?: number;
}
export declare class server {
    #private;
    constructor(serverName: string, config?: serverConfig);
    on(event: string, handler: RequestHandler): this;
}
export declare class client {
    #private;
    constructor(serverName: string, config?: clientConfig);
    send<T>(type: string, data: any): Promise<T>;
    get connected(): boolean;
}
export {};
