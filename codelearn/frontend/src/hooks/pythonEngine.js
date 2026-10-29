// Единый Python-движок приложения.
//
// • Pyodide загружается ОДИН раз и живёт в отдельном Web Worker (создаётся лениво, при start()).
// • Зависший код (бесконечный цикл) останавливается по таймауту или кнопкой «Стоп»:
//   воркер уничтожается (Worker.terminate), а новый сразу поднимается в фоне — к следующему
//   запуску он, как правило, уже готов. Прерывание через SharedArrayBuffer не используется:
//   оно требует заголовков COOP/COEP, а они усложняют хостинг.
// • Запуски идут строго по очереди. Таймаут отсчитывается от начала выполнения, а не от
//   загрузки Python.
//
// Класс не зависит от браузера: воркер создаёт переданная фабрика (в тестах — на worker_threads).

export const DEFAULT_TIMEOUT_MS = 10000;

const failure = (error, status = 'runtime_error') => ({
  status, passed: false, output: '', error, durationMs: 0,
});

export class PythonEngine {
  /**
   * @param {() => {postMessage, terminate, onmessage, onerror}} createWorker
   * @param {{timeoutMs?: number}} [options]
   */
  constructor(createWorker, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this._createWorker = createWorker;
    this._timeoutMs = timeoutMs;
    this._worker = null;
    this._status = 'idle'; // idle | loading | ready | error
    this._listeners = new Set();
    this._ready = Promise.resolve();
    this._current = null;  // выполняющийся сейчас запуск
    this._chain = Promise.resolve();
    this._nextId = 1;

    // Стабильные ссылки — нужны для useSyncExternalStore
    this.getStatus = () => this._status;
    this.subscribe = listener => {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    };
  }

  /** Запускает загрузку Python, если она ещё не идёт. После ошибки повторный вызов пробует снова. */
  start() {
    if (!this._worker) this._spawn();
  }

  /** Выполняет код (и скрытые тесты). Всегда резолвится объектом результата, никогда не отклоняется. */
  run(code, tests = '', options = {}) {
    const timeoutMs = options.timeoutMs || this._timeoutMs;
    const result = this._chain.then(() => this._runNow(code, tests, timeoutMs));
    this._chain = result.catch(() => {});
    return result;
  }

  /** Останавливает выполняющийся код. Если ничего не выполняется — ничего не делает. */
  cancel() {
    this._abortCurrent('cancelled', 'Выполнение остановлено');
  }

  /** Полностью останавливает движок (для тестов и выгрузки). */
  dispose() {
    this._abortCurrent('cancelled', 'Движок остановлен', false);
    this._kill();
    this._setStatus('idle');
    this._listeners.clear();
  }

  // ─── внутреннее ───────────────────────────────────────────────────────────

  _setStatus(status) {
    if (status === this._status) return;
    this._status = status;
    this._listeners.forEach(listener => listener());
  }

  _spawn() {
    this._setStatus('loading');
    let resolveReady;
    let rejectReady;
    this._ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this._ready.catch(() => {}); // ошибку обработает тот, кто ждёт, иначе — без шума в консоли

    let worker;
    try {
      worker = this._createWorker();
    } catch (e) {
      this._initFailed(e, rejectReady);
      return;
    }
    this._worker = worker;

    worker.onmessage = event => {
      if (worker !== this._worker) return; // сообщение от уже убитого воркера
      const msg = event.data || {};
      if (msg.type === 'ready') {
        this._setStatus('ready');
        resolveReady();
      } else if (msg.type === 'init-error') {
        this._initFailed(new Error(msg.message), rejectReady);
      } else if (msg.type === 'result') {
        this._finish(msg.id, msg.result);
      }
    };

    worker.onerror = event => {
      if (worker !== this._worker) return;
      if (event && event.preventDefault) event.preventDefault();
      const message = (event && event.message) || 'неизвестная ошибка воркера';
      if (this._status === 'loading') this._initFailed(new Error(message), rejectReady);
      else this._crashed(message);
    };

    worker.postMessage({ type: 'init' });
  }

  _kill() {
    const worker = this._worker;
    this._worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    try { worker.terminate(); } catch (e) { /* уже завершён */ }
  }

  _initFailed(error, rejectReady) {
    this._kill();
    this._setStatus('error');
    rejectReady(error);
  }

  _finish(id, result) {
    const current = this._current;
    if (!current || current.id !== id) return;
    clearTimeout(current.timer);
    this._current = null;
    current.resolve(result);
  }

  // Убивает воркер вместе с выполняющимся запуском и сразу поднимает новый в фоне.
  _abortCurrent(status, error, respawn = true) {
    const current = this._current;
    if (!current) return false;
    clearTimeout(current.timer);
    this._current = null;
    this._kill();
    if (respawn) this._spawn();
    current.resolve({
      status, passed: false, output: '', error,
      durationMs: Math.round(performance.now() - current.started),
    });
    return true;
  }

  _crashed(message) {
    const text = `Выполнение аварийно завершено (${message}). Возможно, не хватило памяти.`;
    if (!this._abortCurrent('runtime_error', text)) {
      this._kill();
      this._spawn();
    }
  }

  async _runNow(code, tests, timeoutMs) {
    for (let attempt = 0; ; attempt++) {
      if (!this._worker) this._spawn();
      try {
        await this._ready;
      } catch (e) {
        return failure(`Не удалось загрузить Python: ${e.message}`);
      }
      if (this._status === 'ready' && this._worker) break;
      if (attempt >= 2) return failure('Python недоступен, попробуйте ещё раз');
    }

    return new Promise(resolve => {
      const id = this._nextId++;
      const timer = setTimeout(() => {
        const seconds = Math.round((timeoutMs / 1000) * 10) / 10;
        this._abortCurrentById(id, 'timeout',
          `Превышено время выполнения (${seconds} с). Проверьте код на бесконечные циклы и слишком медленные алгоритмы.`);
      }, timeoutMs);
      this._current = { id, resolve, timer, started: performance.now() };
      try {
        this._worker.postMessage({ type: 'run', id, code, tests });
      } catch (e) {
        this._crashed(e.message);
      }
    });
  }

  _abortCurrentById(id, status, error) {
    if (this._current && this._current.id === id) this._abortCurrent(status, error);
  }
}
