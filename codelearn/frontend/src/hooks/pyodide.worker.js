/* eslint-env worker */
/* eslint-disable no-restricted-globals */

// Точка входа Web Worker для Python: Pyodide работает здесь, а не в главном потоке.
import { setupWorkerCore } from './workerCore';
import { createRunner } from './pythonRunner';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/';

setupWorkerCore(self, async () => {
  if (!self.loadPyodide) importScripts(`${PYODIDE_URL}pyodide.js`);
  return createRunner(await self.loadPyodide({ indexURL: PYODIDE_URL }));
});
