import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { PythonEngine } from './pythonEngine';

// Единственный на всё приложение движок: Pyodide грузится один раз и переживает
// переходы между страницами. Воркер создаётся лениво — при первом start().
const engine = new PythonEngine(() => new Worker(new URL('./pyodide.worker.js', import.meta.url)));

/** Прогрев: начать загрузку Python заранее (вызывается после входа в приложение). */
export function preloadPython() {
  engine.start();
}

/**
 * @returns {{
 *   status: 'idle' | 'loading' | 'ready' | 'error',
 *   runCode: (code: string, hiddenTests?: string, options?: {timeoutMs?: number}) => Promise<object>,
 *   cancel: () => void,   // остановить выполняющийся код
 *   retry: () => void,    // попробовать загрузить Python ещё раз после ошибки
 * }}
 * Результат runCode: { status: 'ok' | 'test_failed' | 'runtime_error' | 'timeout' | 'cancelled',
 *                      passed, output, error, durationMs } — подробности в pythonRunner.js.
 */
export function usePyodide() {
  const status = useSyncExternalStore(engine.subscribe, engine.getStatus);

  useEffect(() => { engine.start(); }, []);

  const runCode = useCallback((code, hiddenTests = '', options) => engine.run(code, hiddenTests, options), []);
  const cancel = useCallback(() => engine.cancel(), []);
  const retry = useCallback(() => engine.start(), []);

  return { status, runCode, cancel, retry };
}
