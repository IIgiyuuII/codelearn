// Логика воркера, не привязанная к окружению: в браузере scope = self,
// в тестах (Node) — адаптер над worker_threads. Протокол сообщений:
//   main → worker: { type: 'init' } | { type: 'run', id, code, tests }
//   worker → main: { type: 'ready' } | { type: 'init-error', message }
//                  | { type: 'result', id, result }
//
// loadRunner() готовит язык (для Python — загружает Pyodide) и возвращает функцию
// run(code, tests) → результат (синхронный или Promise).

export function setupWorkerCore(scope, loadRunner) {
  let run = null;

  scope.onmessage = async event => {
    const msg = event.data || {};

    if (msg.type === 'init') {
      try {
        run = await loadRunner();
        scope.postMessage({ type: 'ready' });
      } catch (e) {
        scope.postMessage({ type: 'init-error', message: (e && e.message) || String(e) });
      }
      return;
    }

    if (msg.type === 'run') {
      const result = run
        ? await run(msg.code, msg.tests)
        : { status: 'runtime_error', passed: false, output: '', error: 'Движок ещё не загружен', durationMs: 0 };
      scope.postMessage({ type: 'result', id: msg.id, result });
    }
  };
}
