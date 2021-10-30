import * as net from 'net';
import * as path from 'path';
import type { PromiseHandler } from './shared.js';
import { uuid } from './shared.js';

export interface ClientConfig {
    onError: (err: unknown) => void;
    timeout: number;
    socketRoot: string;
    namespace: string;
}

const defaultClientConfig: ClientConfig = {
    onError: (err) => { throw err; },
    socketRoot: "/tmp/",
    namespace: "fast-ipc.",
    timeout: 2000
};

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
