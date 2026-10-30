/* eslint-env worker */
/* eslint-disable no-restricted-globals */

// Точка входа Web Worker для JavaScript. Движок пересоздаёт этот воркер после каждого запуска
// (режим recycle), поэтому состояние одного запуска не может повлиять на следующий.
import { setupWorkerCore } from './workerCore';
import { createJsRunner, lockdownNetwork } from './jsRunner';

lockdownNetwork(self);

setupWorkerCore(self, async () =>
  createJsRunner({
    watchRejections: handler =>
      self.addEventListener('unhandledrejection', event => {
        event.preventDefault();
        handler(event.reason);
      }),
  }),
);
