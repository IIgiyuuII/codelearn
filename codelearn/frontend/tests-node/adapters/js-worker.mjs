// Воркер JavaScript для тестов: те же workerCore и jsRunner, что в браузере.
// В отличие от Jest, здесь настоящий процесс: событие unhandledRejection приходит от Node.
import { parentPort } from 'node:worker_threads';
import { setupWorkerCore } from '../.build/workerCore.mjs';
import { createJsRunner, lockdownNetwork } from '../.build/jsRunner.mjs';

lockdownNetwork(globalThis);
const scope = { postMessage: m => parentPort.postMessage(m), set onmessage(fn) { parentPort.on('message', data => fn({ data })); } };
setupWorkerCore(scope, async () => createJsRunner({ watchRejections: handler => process.on('unhandledRejection', handler) }));
