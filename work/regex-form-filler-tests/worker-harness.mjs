import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = { postMessage: value => parentPort.postMessage(value) };
await import(workerData.module);
parentPort.on('message', data => self.onmessage({ data }));
