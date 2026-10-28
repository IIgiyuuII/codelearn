import { useState, useEffect, useRef, useCallback } from 'react';
import { createRunner } from './pythonRunner';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/';

export function usePyodide() {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const runnerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    async function load() {
      try {
        // loadPyodide подключается через <script> в public/index.html
        const pyodide = await window.loadPyodide({ indexURL: PYODIDE_URL });
        if (!cancelled) {
          runnerRef.current = createRunner(pyodide);
          setStatus('ready');
        }
      } catch (e) {
        console.error('Не удалось загрузить Pyodide:', e);
        if (!cancelled) setStatus('error');
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  /**
   * Выполняет код студента (и, если переданы, скрытые тесты) локально в Pyodide.
   * Возвращает { status, passed, output, error, durationMs } — см. pythonRunner.js.
   * Вердикт `passed` определяется результатом выполнения, а не текстом в stdout.
   */
  const runCode = useCallback(async (studentCode, hiddenTests = '') => {
    if (!runnerRef.current) {
      return { status: 'runtime_error', passed: false, output: '', error: 'Pyodide не готов', durationMs: 0 };
    }
    return runnerRef.current(studentCode, hiddenTests);
  }, []);

  return { status, runCode };
}
