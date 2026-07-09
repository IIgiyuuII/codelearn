import { useState, useEffect, useRef } from 'react';

export function usePyodide() {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const pyodideRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    async function load() {
      try {
        // loadPyodide is injected via <script> in index.html
        const pyodide = await window.loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/',
        });
        if (!cancelled) {
          pyodideRef.current = pyodide;
          setStatus('ready');
        }
      } catch (e) {
        if (!cancelled) setStatus('error');
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  /**
   * Run Python code and return { output, error, durationMs }
   * studentCode + hiddenTests are concatenated and executed locally in Pyodide
   */
  async function runCode(studentCode, hiddenTests = '') {
    if (!pyodideRef.current) return { output: '', error: 'Pyodide не готов', durationMs: 0 };

    const fullCode = hiddenTests
      ? `${studentCode}\n\n# --- скрытые тесты ---\n${hiddenTests}`
      : studentCode;

    // Capture stdout/stderr
    pyodideRef.current.runPython(`
import sys
import io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
    `);

    const t0 = performance.now();
    let output = '';
    let error = '';

    try {
      await pyodideRef.current.runPythonAsync(fullCode);
      output = pyodideRef.current.runPython('sys.stdout.getvalue()');
      const err = pyodideRef.current.runPython('sys.stderr.getvalue()');
      if (err) error = err;
    } catch (e) {
      error = e.message || String(e);
      // Still collect any partial stdout
      try {
        output = pyodideRef.current.runPython('sys.stdout.getvalue()');
      } catch {}
    }

    const durationMs = Math.round(performance.now() - t0);

    // Restore stdout/stderr
    pyodideRef.current.runPython(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
    `);

    return { output, error, durationMs };
  }

  return { status, runCode };
}
