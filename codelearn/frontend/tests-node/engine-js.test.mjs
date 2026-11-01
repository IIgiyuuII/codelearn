// Движок JavaScript на реальных воркерах (worker_threads): режим recycle, изоляция, таймауты, сбои.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerEngine } from './.build/workerEngine.mjs';
import { nodeWorkerFactory, sleep } from './helpers.mjs';

const counter = { spawned: 0 };
const TESTS = 'assertEqual(f(2), 4);\nassertEqual(f(3), 9);';
const GOOD = 'const f = x => x * x;';
let engine;
const statuses = [];

before(() => {
  engine = new WorkerEngine(nodeWorkerFactory('js-worker.mjs', { counter }), { timeoutMs: 1500, label: 'JavaScript', recycle: true });
  engine.subscribe(() => statuses.push(engine.getStatus()));
});
after(() => engine.dispose());

test('первый запуск: решение проходит тесты; статусы loading → ready', async () => {
  const r = await engine.run(GOOD, TESTS);
  assert.equal(r.passed, true);
  assert.deepEqual(statuses.slice(0, 2), ['loading', 'ready']);
});

test('изоляция: глобальные переменные, прототипы и неявные глобальные не переживают запуск', async () => {
  await engine.run('globalThis.leak = 42; Array.prototype.patched = 1; implicitGlobal = 5;', '');
  const r = await engine.run('console.log(typeof globalThis.leak, typeof [].patched, typeof implicitGlobal)', '');
  assert.equal(r.output, 'undefined undefined undefined\n');
});

test('остатки таймеров прошлого запуска не мешают следующему', async () => {
  await engine.run('setInterval(() => {}, 1000)', '', { timeoutMs: 300 });
  assert.equal((await engine.run('console.log("чисто")', '')).output, 'чисто\n');
});

test('замена воркера не видна в интерфейсе: статус не уходит в loading', async () => {
  const mark = statuses.length;
  for (let i = 0; i < 3; i++) await engine.run('1', '');
  assert.ok(statuses.slice(mark).every(s => s === 'ready'));
});

test('каждый запуск получает новый воркер', async () => {
  const before = counter.spawned;
  for (let i = 0; i < 5; i++) await engine.run('1', '');
  assert.equal(counter.spawned - before, 5);
});

test('скорость: запуск «решение + тесты» вместе с заменой воркера укладывается в разумное время', async () => {
  const N = 20;
  const started = Date.now();
  for (let i = 0; i < N; i++) await engine.run(GOOD, TESTS);
  const average = (Date.now() - started) / N;
  console.log(`      ≈ ${average.toFixed(0)} мс на запуск (Node, worker_threads)`);
  assert.ok(average < 400, `среднее ${average} мс`);
});

test('while(true){}: таймаут по лимиту, дальше движок работает', async () => {
  const started = Date.now();
  const r = await engine.run('while (true) {}', '');
  assert.equal(r.status, 'timeout');
  assert.ok(Date.now() - started < 2500);
  assert.match(r.error, /1\.5 с/);
  assert.equal((await engine.run('console.log("жив")', '')).output, 'жив\n');
});

test('вечный setInterval и вечно ожидающий промис тоже завершаются по таймауту', async () => {
  assert.equal((await engine.run('setInterval(() => {}, 50)', '')).status, 'timeout');
  assert.equal((await engine.run('await new Promise(() => {})', '')).status, 'timeout');
});

test('«Стоп» останавливает цикл быстро', async () => {
  const pending = engine.run('while (true) {}', '', { timeoutMs: 20000 });
  await sleep(300);
  const t = Date.now();
  engine.cancel();
  const r = await pending;
  assert.equal(r.status, 'cancelled');
  assert.ok(Date.now() - t < 300);
  assert.equal((await engine.run('console.log(1)', '')).output, '1\n');
});

test('параллельные запуски идут по очереди', async () => {
  const runs = await Promise.all(['A', 'B', 'C', 'D'].map(x => engine.run(`console.log("${x}")`, '')));
  assert.equal(runs.map(r => r.output.trim()).join(''), 'ABCD');
});

test('сеть недоступна коду студента', async () => {
  const r = await engine.run('console.log(typeof fetch, typeof XMLHttpRequest, typeof WebSocket)', '');
  assert.equal(r.output, 'undefined undefined undefined\n');
});

test('необработанный отклонённый промис: настоящее событие окружения доходит до раннера', async () => {
  const r = await engine.run('Promise.reject(new Error("не пойман"))', '');
  assert.equal(r.status, 'runtime_error');
  assert.match(r.error, /не пойман/);
});

test('номер строки ошибки в настоящем V8', async () => {
  const r = await engine.run('let a = 1;\nlet b = 2;\nnull.foo;', '');
  assert.match(r.error, /TypeError.*\(строка 3\)$/);
});

test('падение воркера по памяти: понятный результат, движок восстанавливается', { timeout: 60000 }, async () => {
  const oom = new WorkerEngine(
    nodeWorkerFactory('js-worker.mjs', { resourceLimits: { maxOldGenerationSizeMb: 64 } }),
    { timeoutMs: 20000, label: 'JavaScript', recycle: true },
  );
  try {
    const r = await oom.run('const a = []; while (true) a.push(new Array(1e5).fill("x".repeat(100)));', '');
    assert.equal(r.status, 'runtime_error');
    assert.match(r.error, /аварийно/);
    assert.equal((await oom.run('console.log("восстановился")', '')).output, 'восстановился\n');
  } finally {
    oom.dispose();
  }
});
