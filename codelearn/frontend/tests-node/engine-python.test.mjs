// Движок Python на реальных воркерах и реальном Pyodide.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerEngine } from './.build/workerEngine.mjs';
import { nodeWorkerFactory, sleep } from './helpers.mjs';

const counter = { spawned: 0 };
const TESTS = 'assert f(2) == 4\nassert f(3) == 9';
const GOOD = 'def f(x): return x*x';
let engine;
const statuses = [];

before(() => {
  engine = new WorkerEngine(nodeWorkerFactory('python-worker.mjs', { counter }), { timeoutMs: 1500, label: 'Python' });
  engine.subscribe(() => statuses.push(engine.getStatus()));
});
after(() => engine.dispose());

test('до start() воркер не создан', () => {
  assert.equal(engine.getStatus(), 'idle');
  assert.equal(counter.spawned, 0);
});

test('холодный запуск: загрузка Python не входит в таймаут выполнения', { timeout: 120000 }, async () => {
  const started = Date.now();
  const r = await engine.run('print("hi")', '', { timeoutMs: 400 });
  assert.equal(r.status, 'ok');
  assert.equal(r.output, 'hi\n');
  assert.ok(Date.now() - started > 400, 'загрузка заняла больше таймаута, а запуск всё равно успешен');
  assert.deepEqual(statuses.slice(0, 2), ['loading', 'ready']);
});

test('один раз загрузили — много раз запускаем (воркер не пересоздаётся)', async () => {
  const before = counter.spawned;
  for (let i = 0; i < 5; i++) await engine.run(GOOD, TESTS);
  assert.equal(counter.spawned, before);
});

test('вердикты через воркер', async () => {
  assert.equal((await engine.run(GOOD, TESTS)).passed, true);
  assert.equal((await engine.run('def f(x): return 0', TESTS)).status, 'test_failed');
  assert.match((await engine.run('x = =', '')).error, /SyntaxError/);
});

test('бесконечный цикл: таймаут по лимиту, воркер заменён, движок восстанавливается', { timeout: 60000 }, async () => {
  const before = counter.spawned;
  const started = Date.now();
  const r = await engine.run('while True:\n    pass', '');
  const elapsed = Date.now() - started;
  assert.equal(r.status, 'timeout');
  assert.ok(elapsed >= 1400 && elapsed < 3000, `лимит 1500 мс, сработало за ${elapsed}`);
  assert.match(r.error, /Превышено время выполнения \(1\.5 с\)/);
  assert.equal(engine.getStatus(), 'loading');
  assert.equal(counter.spawned, before + 1);
  const next = await engine.run('print(1+1)', '');
  assert.equal(next.output, '2\n');
  assert.equal(engine.getStatus(), 'ready');
});

test('тяжёлое, но конечное вычисление укладывается в лимит', async () => {
  const r = await engine.run('print(sum(range(2_000_000)))', '', { timeoutMs: 5000 });
  assert.equal(r.status, 'ok');
  assert.equal(r.output.trim(), '1999999000000');
});

test('«Стоп» останавливает цикл быстро', { timeout: 60000 }, async () => {
  const pending = engine.run('while True:\n    pass', '', { timeoutMs: 20000 });
  await sleep(500);
  const t = Date.now();
  engine.cancel();
  const r = await pending;
  assert.equal(r.status, 'cancelled');
  assert.ok(Date.now() - t < 300);
  assert.equal((await engine.run('print("жив")', '')).output, 'жив\n');
});

test('параллельные запуски идут по очереди, ответы не перепутываются', async () => {
  const order = [];
  const runs = await Promise.all([
    engine.run('import time\nt=time.time()\nwhile time.time()-t<0.4: pass\nprint("A")').then(r => { order.push('A'); return r; }),
    engine.run('print("B")').then(r => { order.push('B'); return r; }),
    engine.run('print("C")').then(r => { order.push('C'); return r; }),
  ]);
  assert.equal(runs.map(r => r.output.trim()).join(''), 'ABC');
  assert.equal(order.join(''), 'ABC');
});

test('запуск в очереди за зависшим выполняется после перезапуска', { timeout: 60000 }, async () => {
  const [hung, after] = await Promise.all([
    engine.run('while True: pass', '', { timeoutMs: 800 }),
    engine.run('print("после")'),
  ]);
  assert.equal(hung.status, 'timeout');
  assert.equal(after.output, 'после\n');
});

test('студент ломает окружение (sys.exit, подмена stdout) — следующий запуск не страдает', async () => {
  await engine.run('import sys\nsys.stdout=None\nsys.exit(1)');
  assert.equal((await engine.run('print("ok")')).output, 'ok\n');
});
