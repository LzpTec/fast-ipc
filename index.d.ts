declare type RequestHandler = (data: any) => any | Promise<any>;
export interface ServerConfig {
    onError: (err: unknown) => void;
    onClose?: () => void;
    socketRoot: string;
    namespace: string;
}
export interface ClientConfig {
    onError: (err: unknown) => void;
    timeout: number;
    socketRoot: string;
    namespace: string;
}
export declare class server {
    #private;
    constructor(serverName: string, config?: Partial<ServerConfig>);
    on(event: string, handler: RequestHandler): this;
}
export declare class client {
    #private;
    constructor(serverName: string, config?: Partial<ClientConfig>);
    send<T>(type: string, data: any): Promise<T>;
    get connected(): boolean;
}
export {};
