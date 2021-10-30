import test from 'ava';
import { client, server } from '../dist/index.js';

const serverInstance = new server('log'),
    clientInstance = new client('log');

test('data', async t => {
    serverInstance.on('123', (d) => {
        t.deepEqual(d, { data: 'test' });
        return 123;
    });

    await clientInstance.send('123', { data: 'test' })
        .then(response => {
            t.deepEqual(response, 123);
            t.pass();
        })
        .catch(error => {
            t.fail("Expected a response, got an error instead: " + error);
        });
});

test('error', async t => {
    serverInstance.on('testError', (d) => {
        t.deepEqual(d, { data: 'test' });
        throw `Error`;
    });

    await clientInstance.send('testError', { data: 'test' })
        .then(response => {
            t.fail("Expected an error, got a response instead: " + response);
        })
        .catch(error => {
            t.is(error, `Error`);
            t.pass();
        });
});