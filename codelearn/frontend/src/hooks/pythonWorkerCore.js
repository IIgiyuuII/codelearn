// Логика воркера, не привязанная к окружению: в браузере scope = self,
// в тестах (Node) — адаптер над worker_threads. Протокол сообщений:
//   main → worker: { type: 'init' } | { type: 'run', id, code, tests }
//   worker → main: { type: 'ready' } | { type: 'init-error', message }
//                  | { type: 'result', id, result }
import { createRunner } from './pythonRunner';

export function setupWorkerCore(scope, loadPyodide) {
  let run = null;

  scope.onmessage = async event => {
    const msg = event.data || {};

    if (msg.type === 'init') {
      try {
        run = createRunner(await loadPyodide());
        scope.postMessage({ type: 'ready' });
      } catch (e) {
        scope.postMessage({ type: 'init-error', message: (e && e.message) || String(e) });
      }
      return;
    }

    if (msg.type === 'run') {
      const result = run
        ? run(msg.code, msg.tests)
        : { status: 'runtime_error', passed: false, output: '', error: 'Python ещё не загружен', durationMs: 0 };
      scope.postMessage({ type: 'result', id: msg.id, result });
    }
  };
}
