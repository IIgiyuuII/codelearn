import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { WorkerEngine } from './workerEngine';

// По одному движку на язык на всё приложение. Воркеры создаются лениво — при первом start().
const ENGINES = {
  // Pyodide тяжёлый (секунды и ~10 МБ), поэтому грузится один раз и живёт долго
  python: new WorkerEngine(
    () => new Worker(new URL('./pyodide.worker.js', import.meta.url)),
    { label: 'Python' },
  ),
  // JavaScript лёгкий: воркер заменяется после каждого запуска, и запуски полностью изолированы
  javascript: new WorkerEngine(
    () => new Worker(new URL('./js.worker.js', import.meta.url)),
    { label: 'JavaScript', recycle: true, timeoutMs: 5000 },
  ),
};

export const SUPPORTED_LANGUAGES = Object.keys(ENGINES);
export const LANGUAGE_NAMES = { python: 'Python', javascript: 'JavaScript', ruby: 'Ruby' };

const noopSubscribe = () => () => {};
// Заглушки: язык ещё неизвестен (задача грузится) или не поддерживается (например, Ruby)
const idle = { subscribe: noopSubscribe, getStatus: () => 'idle', start() {}, cancel() {}, run: () => Promise.resolve(null) };
const unsupported = {
  ...idle,
  getStatus: () => 'unsupported',
  run: () => Promise.resolve({
    status: 'runtime_error', passed: false, output: '', durationMs: 0,
    error: 'Запуск кода на этом языке пока не поддерживается',
  }),
};

function pick(language) {
  if (!language) return idle;
  return ENGINES[language] || unsupported;
}

/** Прогрев Python после входа: Pyodide большой, пусть грузится, пока студент выбирает задачу. */
export function preloadPython() {
  ENGINES.python.start();
}

/**
 * @param {string | null | undefined} language  'python' | 'javascript' | другое (не поддерживается) | пусто (ещё неизвестно)
 * @returns {{
 *   status: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported',
 *   runCode: (code: string, hiddenTests?: string, options?: {timeoutMs?: number}) => Promise<object>,
 *   cancel: () => void,   // остановить выполняющийся код
 *   retry: () => void,    // попробовать загрузить движок ещё раз после ошибки
 * }}
 * Результат runCode: { status: 'ok' | 'test_failed' | 'runtime_error' | 'timeout' | 'cancelled',
 *                      passed, output, error, durationMs }.
 */
export function useCodeEngine(language) {
  const engine = pick(language);
  const status = useSyncExternalStore(engine.subscribe, engine.getStatus);

  useEffect(() => { engine.start(); }, [engine]);

  const runCode = useCallback((code, hiddenTests = '', options) => engine.run(code, hiddenTests, options), [engine]);
  const cancel = useCallback(() => engine.cancel(), [engine]);
  const retry = useCallback(() => engine.start(), [engine]);

  return { status, runCode, cancel, retry };
}
