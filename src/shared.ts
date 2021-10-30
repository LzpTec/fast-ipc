import hyperid from 'hyperid';

export type RequestHandler = (data: any) => any | Promise<any>;
export type PromiseHandler = { resolve: (res: any) => void, reject: (err: any) => void };
export const uuid = hyperid({ fixedLength: true });
