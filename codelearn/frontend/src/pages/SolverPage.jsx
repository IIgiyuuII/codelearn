import React, { useEffect, useState, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../api';
import { usePyodide } from '../hooks/usePyodide';
import './SolverPage.css';

export default function SolverPage({ taskId, onBack }) {
  const [task, setTask] = useState(null);
  const [examples, setExamples] = useState([]);
  const [code, setCode] = useState('');
  const [output, setOutput] = useState(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [toast, setToast] = useState(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [activeExample, setActiveExample] = useState(0);

  // Сплиттер — высота верхней панели в процентах
  const [splitPct, setSplitPct] = useState(62);
  const isDragging = useRef(false);
  const splitContainerRef = useRef(null);

  const { status: pyStatus, runCode } = usePyodide();
  const toastTimer = useRef(null);
  const editorRef = useRef(null);

  useEffect(() => {
    api.getTask(taskId).then(data => {
      setTask(data);
      setCode(data.starterCode || '');
    });
    api.getExamples(taskId).then(data => {
      setExamples(data.examples || []);
    });
    api.getProgress().then(data => {
      if (data.solvedTasks?.includes(taskId)) setSolved(true);
    });
  }, [taskId]);

  // ─── Сплиттер ────────────────────────────────────────────────────────────
  const onMouseDownSplitter = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e) => {
      if (!isDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };

    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ─── Toast ───────────────────────────────────────────────────────────────
  function showToast(type, text) {
    setToast({ type, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  // ─── Run ─────────────────────────────────────────────────────────────────
  async function handleRun() {
    if (pyStatus !== 'ready') return;
    setRunning(true);
    setOutput(null);
    setOutputOpen(false);
    const { output: out, error, durationMs } = await runCode(code);
    const result = { text: error || out || '(нет вывода)', isError: !!error, passed: null, durationMs };
    setOutput(result);
    if (error || out) setOutputOpen(true);
    setRunning(false);
  }

  // ─── Check ───────────────────────────────────────────────────────────────
  async function handleCheck() {
    if (pyStatus !== 'ready') return;
    setChecking(true);
    setOutput(null);
    setOutputOpen(false);

    try {
      const { tests, error: fetchErr } = await api.getTests(taskId);
      if (fetchErr) {
        setOutput({ text: fetchErr, isError: true, passed: false, durationMs: 0 });
        setOutputOpen(true);
        showToast('error', 'Ошибка получения тестов');
        setChecking(false);
        return;
      }

      const { output: out, error, durationMs } = await runCode(code, tests);
      const passed = !error && out.includes('✓ Все тесты пройдены!');

      setOutput({ text: error || out || '(нет вывода)', isError: !!error, passed, durationMs });

      if (passed) {
        setSolved(true);
        setOutputOpen(false);
        await api.markSolved(taskId);
        showToast('success', '✓ Задача решена!');
      } else {
        setOutputOpen(true);
        showToast('error', '✗ Тесты не пройдены');
      }
    } catch (e) {
      setOutput({ text: 'Ошибка: ' + e.message, isError: true, passed: false, durationMs: 0 });
      setOutputOpen(true);
      showToast('error', 'Ошибка проверки');
    }
    setChecking(false);
  }

  function resetCode() {
    if (task) setCode(task.starterCode || '');
    setOutput(null);
    setOutputOpen(false);
  }

  function formatOutput(text) {
    if (!text) return '';
    if (text.includes('Traceback (most recent call last)')) {
      const lines = text.split('\n');
      const meaningful = lines.filter(l =>
        l.trim() &&
        !l.startsWith('  File "/lib/python') &&
        !l.includes('_pyodide') &&
        !l.includes('eval_code') &&
        !l.includes('CodeRunner') &&
        !l.includes('run_async') &&
        !l.includes('coroutine =')
      );
      return meaningful.join('\n') || text;
    }
    return text;
  }

  const iconState = !output ? 'none' : (output.isError || output.passed === false) ? 'error' : 'info';
  const pyReady = pyStatus === 'ready';
  const busy = checking || running;

  if (!task) return <div className="solver-loading">Загрузка задачи...</div>;

  return (
    <div className="solver-layout">

      {/* Toast */}
      {toast && (
        <div className={`solver-toast solver-toast-${toast.type}`}>{toast.text}</div>
      )}

      {/* ── Левая панель ── */}
      <aside className="solver-aside">
        <div className="solver-aside-header">
          <button className="solver-back" onClick={onBack}>← Все задачи</button>
        </div>

        <div className="solver-task-meta">
          <span className="solver-task-topic">{task.topic}</span>
          <span className={`solver-task-diff diff-${task.difficulty}`}>
            {task.difficulty === 'easy' ? 'лёгкая' : task.difficulty === 'medium' ? 'средняя' : 'сложная'}
          </span>
        </div>

        <h1 className="solver-task-title">{task.title}</h1>

        {solved && (
          <div className="solver-solved-badge">
            <span className="solver-solved-icon">✓</span>Задача решена
          </div>
        )}

        <p className="solver-task-desc">{task.description}</p>

        <div className="solver-wasm-info">
          <div className={`solver-wasm-dot ${pyStatus}`} />
          <span>
            {pyStatus === 'loading' && 'Загрузка Python (WASM)...'}
            {pyStatus === 'ready' && 'Python готов · WASM'}
            {pyStatus === 'error' && 'Ошибка загрузки Python'}
          </span>
        </div>
      </aside>

      {/* ── Правая панель ── */}
      <div className="solver-right" ref={splitContainerRef}>

        {/* ── Верхняя часть: редактор ── */}
        <div className="solver-editor-wrap" style={{ height: `${splitPct}%` }}>
          <div className="solver-editor-header">
            <span className="solver-lang-badge">Python 3</span>
            <div className="solver-editor-actions">
              {iconState !== 'none' && (
                <div className="output-popover-anchor">
                  <button
                    className={`solver-output-btn solver-output-btn-${iconState} ${outputOpen ? 'active' : ''}`}
                    onClick={() => setOutputOpen(o => !o)}
                    title={outputOpen ? 'Закрыть' : 'Показать вывод'}
                  >
                    <span className="output-btn-icon">{iconState === 'error' ? '✕' : '›'}</span>
                  </button>

                  <div className={`output-popover output-popover-${iconState} ${outputOpen ? 'open' : ''}`}>
                    <div className="output-popover-arrow" />
                    <div className="output-popover-header">
                      <span className="output-popover-title">
                        {output?.passed === false && !output?.isError && '✗ Тесты не пройдены'}
                        {output?.isError && '✗ Ошибка выполнения'}
                        {output?.passed === null && !output?.isError && '› Вывод программы'}
                      </span>
                      <div className="output-popover-meta">
                        <span>{output?.durationMs}мс · WASM</span>
                        <button className="output-popover-close" onClick={() => setOutputOpen(false)}>✕</button>
                      </div>
                    </div>
                    <pre className="output-popover-text">{formatOutput(output?.text)}</pre>
                  </div>
                </div>
              )}
              <button className="solver-btn-reset" onClick={resetCode} disabled={busy}>сбросить</button>
            </div>
          </div>

          <Editor
            height="100%"
            language="python"
            theme="vs-dark"
            value={code}
            onChange={v => setCode(v || '')}
            onMount={e => { editorRef.current = e; }}
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              tabSize: 4,
              padding: { top: 16 },
            }}
          />
        </div>

        {/* ── Сплиттер ── */}
        <div className="solver-splitter" onMouseDown={onMouseDownSplitter}>
          <div className="solver-splitter-handle" />
        </div>

        {/* ── Нижняя часть: примеры тестов ── */}
        <div className="solver-examples-wrap" style={{ height: `${100 - splitPct}%` }}>
          <div className="solver-examples-header">
            <span className="solver-examples-title">Примеры</span>
            {/* Вкладки */}
            <div className="solver-examples-tabs">
              {examples.map((ex, i) => (
                <button
                  key={ex.id}
                  className={`solver-example-tab ${activeExample === i ? 'active' : ''}`}
                  onClick={() => setActiveExample(i)}
                >
                  Тест {i + 1}
                </button>
              ))}
              {examples.length === 0 && (
                <span className="solver-examples-empty">нет примеров</span>
              )}
            </div>

            {/* Кнопки действий */}
            <div className="solver-actions-inline">
              <button className="solver-btn-run" onClick={handleRun} disabled={!pyReady || busy}>
                {running ? '⏳' : '▶ Запустить'}
              </button>
              <button className="solver-btn-check" onClick={handleCheck} disabled={!pyReady || busy}>
                {checking ? '⏳ Проверка...' : '✓ Проверить'}
              </button>
            </div>
          </div>

          {/* Содержимое активного теста */}
          {examples.length > 0 && examples[activeExample] && (
            <div className="solver-example-content">
              <div className="solver-example-row">
                <div className="solver-example-block">
                  <div className="solver-example-label">Входные данные</div>
                  <pre className="solver-example-code">{examples[activeExample].input}</pre>
                </div>
                <div className="solver-example-arrow">→</div>
                <div className="solver-example-block">
                  <div className="solver-example-label">Ожидаемый результат</div>
                  <pre className="solver-example-code solver-example-code-out">{examples[activeExample].output}</pre>
                </div>
              </div>
              {examples[activeExample].explanation && (
                <div className="solver-example-explanation">
                  💡 {examples[activeExample].explanation}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
