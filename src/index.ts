import { fast as uuid } from 'fast-unique-id';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

type RequestHandler = (data: any) => any | Promise<any>;
type PromiseHandler = { resolve: (res: any) => void, reject: (err: any) => void };

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

const defaultServerConfig: ServerConfig = {
    onError: (err) => { throw err; },
    socketRoot: "/tmp/",
    namespace: "fast-ipc."
};

const defaultClientConfig: ClientConfig = {
    onError: (err) => { throw err; },
    socketRoot: "/tmp/",
    namespace: "fast-ipc.",
    timeout: 2000
};

export class server {
    readonly #eventListeners: { [event: string]: RequestHandler; } = {};
    readonly #config: ServerConfig;
    readonly #serverPath: string;

    constructor(serverName: string, config?: Partial<ServerConfig>) {
        this.#config = Object.assign({}, defaultServerConfig, config);
        this.#serverPath = path.join(this.#config.socketRoot, this.#config.namespace + serverName);
        try {
            fs.unlinkSync(this.#serverPath);
        } catch (err) { }
        this.#createServer(serverName);
    }

    #createServer(serverName: string) {
        const ipcServer = net.createServer((socket: net.Socket) => {
            const parse = async (data: string) => {
                const stringArray = data.slice(18).split('⚑');

                const handler = this.#eventListeners[stringArray[0]];
                if (!handler)
                    return;

                let socketData: any;
                try {
                    const body = JSON.parse(stringArray.slice(1)[0]);
                    const response = await handler(body);
                    socketData = { i: data.slice(0, 18), e: null, r: response };
                } catch (err) {
                    socketData = { i: data.slice(0, 18), e: err, r: null };
                } finally {
                    if (socket.writable)
                        socket.write(JSON.stringify(socketData) + '⚑');
                }
            }

            let previousData = '';
            const parseChunk = (data: string) => {
                let lastIndex = -2,
                    indexes = [];

                while (lastIndex !== -1)
                    lastIndex = data.indexOf('\f', lastIndex !== -2 ? lastIndex + 1 : 0), indexes.push(lastIndex)

                const separatorsCount = indexes.length - 1;

                if (separatorsCount) {
                    for (let i = 0, l = separatorsCount; i < l; i++) {
                        let chunk = data.slice(indexes[i - 1] + 1, indexes[i]);

                        if (previousData)
                            chunk = previousData + chunk, previousData = '';

                        parse(chunk);
                    }
                    previousData = data.slice(indexes[separatorsCount - 1] + 1);
                } else {
                    previousData += data;
                }
            }

            socket
                .on('data', parseChunk)
                .on('error', (err) => {
                    return this.#config.onError(err);
                })
                .on('close', () => {
                    socket.removeAllListeners();
                    socket.destroy();
                })
                .setEncoding('utf8');

        })
            .on('error', err => {
                return this.#config.onError(err);
            })
            .on('close', () => {
                ipcServer.removeAllListeners();
                setTimeout(() => this.#createServer(serverName), 1000);
                if (this.#config?.onClose)
                    return this.#config.onClose();

                return this.#config.onError(`ipc server ${serverName} closed`);
            })
            .listen(this.#serverPath);

        process.on("exit", () => {
            try { fs.unlinkSync(this.#serverPath) } catch (err) { }
        });
    }

    on(event: string, handler: RequestHandler) {
        this.#eventListeners[event] = handler;
        return this;
    }
}

export class client {
    readonly #resMap: { [id: string]: PromiseHandler } = {};
    readonly #backlogs: [string, any, PromiseHandler][] = [];
    readonly #config: ClientConfig;
    readonly #now = Date.now();
    readonly #serverPath: string;

    #connected: boolean = false;
    #ipcClient?: net.Socket;

    constructor(serverName: string, config?: Partial<ClientConfig>) {
        this.#config = Object.assign({}, defaultClientConfig, config);
        this.#serverPath = path.join(this.#config.socketRoot, this.#config.namespace + serverName);
        this.#connect(serverName);
    }

    #connect(serverName: string) {
        if (this.#ipcClient)
            this.#ipcClient.destroy();

        const exec = (json: { i: string, e: any, r: any }) => {
            const callback = this.#resMap[json.i];

            if (json.e)
                callback.reject(json.e);
            else
                callback.resolve(json.r);

            delete this.#resMap[json.i];
        }

        let previousData = '';
        const parseChunk = (data: string) => {
            let lastIndex = -2,
                indexes = [];

            while (lastIndex !== -1)
                lastIndex = data.indexOf('⚑', lastIndex !== -2 ? lastIndex + 1 : 0), indexes.push(lastIndex)

            const separatorsCount = indexes.length - 1;

            if (separatorsCount) {
                for (let i = 0, l = separatorsCount; i < l; i++) {
                    let chunk = data.slice(indexes[i - 1] + 1, indexes[i]);
                    if (previousData) chunk = previousData + chunk, previousData = '';
                    exec(JSON.parse(chunk));
                }
                previousData = data.slice(indexes[separatorsCount - 1] + 1);
            } else previousData += data;
        };

        this.#ipcClient = net.createConnection(this.#serverPath, () => {
            this.#connected = true;
            if (this.#backlogs.length > 0) {
                for (let i = this.#backlogs.length; i--;) {
                    const pop = this.#backlogs.pop();
                    if (pop)
                        this.#doSend(...pop);
                }
            }
        })
            .on('error', (err) => {
                if (Date.now() - this.#now <= this.#config.timeout)
                    return;

                if (this.#config?.onError)
                    return this.#config.onError(err);

                throw err;
            })
            .on('close', () => {
                this.#connected = false;
                this.#connect(serverName);
            })
            .on('data', parseChunk)
            .setEncoding('utf8');
    }

    send<T>(type: string, data: any): Promise<T> {
        const promise = new Promise<T>((resolve, reject) => {
            if (!this.#connected)
                return this.#backlogs.push([type, data, { resolve, reject }]);

            this.#doSend(type, data, { resolve, reject });
        });

        return promise;
    }

    #doSend(type: string, req: any, promise: PromiseHandler) {
        const id: string = uuid();
        this.#resMap[id] = promise;
        const data = JSON.stringify(req);
        let msg = [type, data].join('⚑');
        if (msg.indexOf('\f') > -1)
            msg = msg.replace(/\f/g, '\n');

        this.#ipcClient?.write(`${id}${msg}\f`);
    }

    public get connected() {
        return this.#connected;
    }

}