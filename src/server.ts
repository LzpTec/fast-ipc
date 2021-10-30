import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import type { RequestHandler } from './shared.js';

export interface ServerConfig {
    onError: (err: unknown) => void;
    onClose?: () => void;
    socketRoot: string;
    namespace: string;
}

const defaultServerConfig: ServerConfig = {
    onError: (err) => { throw err; },
    socketRoot: "/tmp/",
    namespace: "fast-ipc."
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
                const stringArray = data.slice(33).split('⚑');

                const handler = this.#eventListeners[stringArray[0]];
                if (!handler)
                    return;

                let socketData: any;
                try {
                    const body = JSON.parse(stringArray.slice(1)[0]);
                    const response = await handler(body);
                    socketData = { i: data.slice(0, 33), e: null, r: response };
                } catch (err) {
                    socketData = { i: data.slice(0, 33), e: err, r: null };
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
