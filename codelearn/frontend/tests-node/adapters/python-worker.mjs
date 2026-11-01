// Воркер Python для тестов: те же workerCore и pythonRunner, что в браузере, но Pyodide берётся из npm.
import { parentPort } from 'node:worker_threads';
import { loadPyodide } from 'pyodide';
import { setupWorkerCore } from '../.build/workerCore.mjs';
import { createRunner } from '../.build/pythonRunner.mjs';

const scope = { postMessage: m => parentPort.postMessage(m), set onmessage(fn) { parentPort.on('message', data => fn({ data })); } };
setupWorkerCore(scope, async () => createRunner(await loadPyodide()));
