// Раннер решений на JavaScript (аналог pythonRunner.js).
//
// Решение и скрытые тесты выполняются как ОДНО тело асинхронной функции, а не двумя отдельными
// eval: так тесты видят и `function sum() {}`, и `const sum = () => {}` студента (объявления
// const/let при раздельном eval друг другу не видны). Между частями ставится служебная отметка
// стадии (rt.stage), по ней ошибка относится либо к решению, либо к тестам.
//
// Вердикт «тесты пройдены» — это «функция завершилась без исключения и дошла до конца тестов».
// Текст в console.log на вердикт не влияет.
//
// Что доступно коду: console (вывод собирается), таймеры (учитываются: раннер дожидается
// их срабатывания, как Node), assert / assertEqual / assertNotEqual / assertThrows.
//
// Границы безопасности: код выполняется в Web Worker — там нет ни DOM, ни localStorage (то есть
// токена входа). Прямое обращение к сети отключается (lockdownNetwork), но это не песочница:
// динамический import() остаётся. Полноценная защита — серверная перепроверка.

const MAX_OUT = 20000;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// Строк, которые движок добавляет перед телом new AsyncFunction(...): `async function anonymous(...\n) {\n`
const FUNCTION_HEADER_LINES = 2;

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

// ─── Сравнение значений ──────────────────────────────────────────────────────

export function deepEqual(a, b, stack = []) {
  if (a === b) return true; // 0 и -0 считаем равными
  if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b; // NaN равен NaN
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (stack.some(([x, y]) => x === a && y === b)) return true; // циклические ссылки
  const next = [...stack, [a, b]];

  if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k), next)) return false;
    return true;
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false;
    const rest = [...b];
    return [...a].every(v => rest.some(x => deepEqual(v, x, next)));
  }
  if (Array.isArray(a) && a.length !== b.length) return false;

  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k], next));
}

// ─── Форматирование значений для console.log (по образцу Node) ───────────────

const IDENT = /^[A-Za-z_$][\w$]*$/;
const quote = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

export function inspect(v, depth = 0, seen = []) {
  switch (typeof v) {
    case 'string': return quote(v);
    case 'number': return Object.is(v, -0) ? '-0' : String(v);
    case 'bigint': return `${v}n`;
    case 'boolean': case 'undefined': case 'symbol': return String(v);
    case 'function': {
      if (/^class\b/.test(Function.prototype.toString.call(v))) return `[class ${v.name || '(anonymous)'}]`;
      return v.name ? `[Function: ${v.name}]` : '[Function (anonymous)]';
    }
    default: break;
  }
  if (v === null) return 'null';
  if (seen.includes(v)) return '[Circular]';
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
  if (v instanceof RegExp) return String(v);

  const isArray = Array.isArray(v);
  const isMap = v instanceof Map;
  const isSet = v instanceof Set;
  if (depth > 3) return isArray ? '[Array]' : '[Object]';

  const inner = [...seen, v];
  let entries;
  let prefix = '';
  if (isArray) {
    entries = v.slice(0, 100).map(x => inspect(x, depth + 1, inner));
    if (v.length > 100) entries.push(`... ${v.length - 100} more items`);
  } else if (isMap) {
    prefix = `Map(${v.size}) `;
    entries = [...v].map(([k, x]) => `${inspect(k, depth + 1, inner)} => ${inspect(x, depth + 1, inner)}`);
  } else if (isSet) {
    prefix = `Set(${v.size}) `;
    entries = [...v].map(x => inspect(x, depth + 1, inner));
  } else {
    const proto = Object.getPrototypeOf(v);
    if (proto === null) prefix = '[Object: null prototype] ';
    else if (proto.constructor && proto.constructor.name && proto.constructor.name !== 'Object') prefix = `${proto.constructor.name} `;
    entries = Object.keys(v).map(k => `${IDENT.test(k) ? k : quote(k)}: ${inspect(v[k], depth + 1, inner)}`);
  }

  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return `${prefix}${open}${close}`;
  const oneLine = `${prefix}${open} ${entries.join(', ')} ${close}`;
  if (oneLine.length <= 72 && !oneLine.includes('\n')) return oneLine;
  const pad = '  '.repeat(depth);
  return `${prefix}${open}\n${pad}  ${entries.join(`,\n${pad}  `)}\n${pad}${close}`;
}

const formatArgs = args => args.map(a => (typeof a === 'string' ? a : inspect(a))).join(' ');

// ─── Вывод, таймеры, assert ──────────────────────────────────────────────────

function createOutput() {
  let text = '';
  let clipped = false;
  return {
    write(line) {
      if (clipped) return;
      text += `${line}\n`;
      if (text.length > MAX_OUT) {
        text = `${text.slice(0, MAX_OUT)}\n... (вывод обрезан)`;
        clipped = true;
      }
    },
    text: () => text,
  };
}

function createConsole(write) {
  const log = (...args) => write(formatArgs(args));
  const noop = () => {};
  return {
    log, info: log, debug: log, warn: log, error: log, dir: log, table: log,
    assert: (cond, ...args) => { if (!cond) write(`Assertion failed${args.length ? `: ${formatArgs(args)}` : ''}`); },
    trace: noop, group: noop, groupEnd: noop, time: noop, timeEnd: noop, count: noop, clear: noop,
  };
}

// Таймеры студента: раннер дожидается их срабатывания (как Node) и перехватывает их исключения.
function createTimers() {
  const realSetTimeout = setTimeout;
  const realSetInterval = setInterval;
  const realClear = clearTimeout; // clearTimeout/clearInterval взаимозаменяемы по спецификации
  const active = new Map();
  let waiters = [];
  let nextId = 1;
  let uncaught = { has: false, error: null };

  const settle = () => {
    if (active.size === 0) { waiters.forEach(resolve => resolve()); waiters = []; }
  };
  const guarded = (cb, args) => {
    try {
      cb(...args);
    } catch (e) {
      if (!uncaught.has) uncaught = { has: true, error: e };
    }
  };
  const clear = id => {
    const handle = active.get(id);
    if (handle === undefined) return;
    realClear(handle);
    active.delete(id);
    settle();
  };

  return {
    setTimeout(cb, ms, ...args) {
      if (typeof cb !== 'function') return 0;
      const id = nextId++;
      active.set(id, realSetTimeout(() => { active.delete(id); guarded(cb, args); settle(); }, ms));
      return id;
    },
    setInterval(cb, ms, ...args) {
      if (typeof cb !== 'function') return 0;
      const id = nextId++;
      active.set(id, realSetInterval(() => guarded(cb, args), ms));
      return id;
    },
    clearTimeout: clear,
    clearInterval: clear,
    drain: () => (active.size === 0 ? Promise.resolve() : new Promise(resolve => waiters.push(resolve))),
    clearAll() { [...active.keys()].forEach(clear); },
    uncaught: () => uncaught,
    nextTick: () => new Promise(resolve => realSetTimeout(resolve, 0)),
  };
}

const assertHelpers = {
  assert(cond, message) {
    if (!cond) throw new AssertionError(message);
  },
  assertEqual(actual, expected, message) {
    if (!deepEqual(actual, expected)) throw new AssertionError(message);
  },
  assertNotEqual(actual, expected, message) {
    if (deepEqual(actual, expected)) throw new AssertionError(message);
  },
  assertThrows(fn, message) {
    try { fn(); } catch (e) { return; }
    throw new AssertionError(message);
  },
};

const describe = e => (e && typeof e === 'object' && 'name' in e ? `${e.name}: ${e.message}` : `Uncaught ${inspect(e)}`);

// Номер строки в коде студента по трассировке V8 (Chrome/Edge/Node). В других движках формат
// стека иной — тогда строку просто не показываем. Строки скрытых тестов не раскрываются.
function studentLine(error, studentLines) {
  const m = error && typeof error.stack === 'string' && error.stack.match(/<anonymous>:(\d+):\d+/);
  if (!m) return '';
  const line = Number(m[1]) - FUNCTION_HEADER_LINES;
  return line >= 1 && line <= studentLines ? ` (строка ${line})` : '';
}

// ─── Раннер ──────────────────────────────────────────────────────────────────

/**
 * @param {{ watchRejections?: (handler: (reason: any) => void) => void }} [options]
 *   watchRejections подписывает раннер на «необработанные отклонения промисов» окружения
 *   (в воркере — событие unhandledrejection, в Node — process.on('unhandledRejection')).
 * @returns {(studentCode: string, testsCode?: string) => Promise<{status, passed, output, error, durationMs}>}
 *   status: 'ok' | 'test_failed' | 'runtime_error'
 */
export function createJsRunner({ watchRejections } = {}) {
  let current = null; // { unhandled: {reason} | null }
  if (watchRejections) {
    watchRejections(reason => {
      if (current && !current.unhandled) current.unhandled = { reason };
    });
  }

  return async function run(studentCode, testsCode = '') {
    const started = performance.now();
    const hasTests = testsCode.trim() !== '';
    const out = createOutput();
    const finish = (status, error = '') => ({
      status,
      passed: status === 'ok' && hasTests,
      output: out.text(),
      error,
      durationMs: Math.round(performance.now() - started),
    });

    // 1. Синтаксис решения и тестов проверяем по отдельности — чтобы ошибка не терялась в склейке
    try { new AsyncFunction(studentCode); } catch (e) { return finish('runtime_error', describe(e)); }
    if (hasTests) {
      try { new AsyncFunction(testsCode); } catch (e) { return finish('runtime_error', describe(e)); }
    }

    // 2. Одно тело функции: решение, отметка стадии, тесты
    const rt = { stage: 'solution' };
    const source = hasTests
      ? `${studentCode}\n;__rt__.stage = 'tests';\n${testsCode}\n;__rt__.stage = 'done';`
      : studentCode;
    const timers = createTimers();
    let fn;
    try {
      fn = new AsyncFunction(
        'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'assert', 'assertEqual', 'assertNotEqual', 'assertThrows', '__rt__', source,
      );
    } catch (e) {
      return finish('runtime_error', describe(e)); // например, повторное объявление служебного имени
    }

    // 3. Выполнение
    current = { unhandled: null };
    let failed = false;
    let failure = null;
    try {
      await fn(
        createConsole(out.write), timers.setTimeout, timers.setInterval, timers.clearTimeout, timers.clearInterval,
        assertHelpers.assert, assertHelpers.assertEqual, assertHelpers.assertNotEqual, assertHelpers.assertThrows, rt,
      );
      await timers.drain(); // дожидаемся таймеров, как это сделал бы Node
    } catch (e) {
      failed = true;
      failure = e;
    }
    await timers.nextTick(); // даём сработать unhandledrejection
    timers.clearAll();
    const unhandled = current.unhandled;
    current = null;

    if (!failed && timers.uncaught().has) { failed = true; failure = timers.uncaught().error; }
    if (!failed && unhandled) { failed = true; failure = unhandled.reason; }

    // 4. Вердикт
    if (failed) {
      if (failure instanceof AssertionError && rt.stage !== 'solution') {
        return finish('test_failed', `Тест не пройден${failure.message ? `: ${failure.message}` : ''}`);
      }
      const studentLines = studentCode.split('\n').length;
      return finish('runtime_error', describe(failure) + studentLine(failure, studentLines));
    }
    if (hasTests && rt.stage !== 'done') {
      return finish('runtime_error', 'Код завершился до запуска тестов (возможно, return на верхнем уровне)');
    }
    return finish('ok');
  };
}

// ─── Ограничение доступа к сети внутри воркера ───────────────────────────────

const BLOCKED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts',
  'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker',
];

/**
 * Делает сетевые API недоступными в области видимости воркера (и по цепочке прототипов).
 * Это снижает риск случайной или простой отправки данных наружу, но НЕ является песочницей.
 * @returns {string[]} имена, которые удалось отключить
 */
export function lockdownNetwork(scope) {
  const blocked = [];
  BLOCKED_GLOBALS.forEach(name => {
    for (let o = scope; o; o = Object.getPrototypeOf(o)) {
      if (!Object.prototype.hasOwnProperty.call(o, name)) continue;
      try {
        Object.defineProperty(o, name, { value: undefined, writable: false, configurable: false });
        blocked.push(name);
      } catch (e) { /* свойство нельзя переопределить — пропускаем */ }
    }
  });
  return blocked;
}
