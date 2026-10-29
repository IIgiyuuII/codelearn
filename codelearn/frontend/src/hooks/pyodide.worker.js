/* eslint-env worker */
/* eslint-disable no-restricted-globals */

// Точка входа Web Worker: Python (Pyodide) работает здесь, а не в главном потоке,
// поэтому интерфейс не замирает во время выполнения, а зависший код можно убить.
import { setupWorkerCore } from './pythonWorkerCore';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/';

setupWorkerCore(self, async () => {
  if (!self.loadPyodide) importScripts(`${PYODIDE_URL}pyodide.js`);
  return self.loadPyodide({ indexURL: PYODIDE_URL });
});
