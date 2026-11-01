/** @jest-environment node */
import { WorkerEngine, DEFAULT_TIMEOUT_MS } from '../hooks/workerEngine';
import { makeFactory, tick } from '../testUtils/fakeWorker';

// Поднимает движок и доводит его до готовности
async function readyEngine(options) {
  const { factory, workers } = makeFactory();
  const engine = new WorkerEngine(factory, options);
  engine.start();
  workers[0].ready();
  await tick();
  return { engine, workers };
}

describe('запуск и статусы', () => {
  test('до start() воркер не создаётся, статус idle', () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory);
    expect(engine.getStatus()).toBe('idle');
    expect(workers).toHaveLength(0);
  });

  test('start(): loading → ready; повторные start() не создают новых воркеров; подписчик получает ровно две смены статуса', async () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory);
    const listener = jest.fn();
    engine.subscribe(listener);
    engine.start(); engine.start(); engine.start();
    expect(workers).toHaveLength(1);
    expect(engine.getStatus()).toBe('loading');
    expect(workers[0].sent).toEqual([{ type: 'init' }]);
    workers[0].ready();
    expect(engine.getStatus()).toBe('ready');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('отписка работает', () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory);
    const listener = jest.fn();
    const off = engine.subscribe(listener);
    engine.start();
    off();
    workers[0].ready();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('запуск до готовности ждёт загрузку; таймаут отсчитывается от начала выполнения, а не от загрузки', async () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory);
    const promise = engine.run('print(1)', 'tests', { timeoutMs: 80 });
    await tick(120); // загрузка длится дольше таймаута
    expect(workers).toHaveLength(1);
    expect(workers[0].lastRun()).toBeUndefined(); // выполнение ещё не началось
    workers[0].ready();
    await tick();
    expect(workers[0].lastRun()).toMatchObject({ code: 'print(1)', tests: 'tests' });
    workers[0].answer({ output: 'готово' });
    expect(await promise).toMatchObject({ status: 'ok', output: 'готово' });
  });

  test('результат запуска доходит до вызывающего; идентификаторы запусков уникальны', async () => {
    const { engine, workers } = await readyEngine();
    const first = engine.run('a');
    await tick();
    const idFirst = workers[0].lastRun().id;
    workers[0].answer({ output: '1' });
    await first;
    const second = engine.run('b');
    await tick();
    expect(workers[0].lastRun().id).not.toBe(idFirst);
    workers[0].answer({ output: '2' });
    expect((await second).output).toBe('2');
  });
});

describe('очередь', () => {
  test('параллельные запуски выполняются по одному, в порядке вызова', async () => {
    const { engine, workers } = await readyEngine();
    const order = [];
    const runs = ['A', 'B', 'C'].map(name => engine.run(name).then(r => { order.push(r.output); return r; }));
    await tick();
    expect(workers[0].sent.filter(m => m.type === 'run')).toHaveLength(1); // пока идёт первый, остальные ждут
    for (const name of ['A', 'B', 'C']) {
      workers[0].answer({ output: name });
      await tick();
    }
    await Promise.all(runs);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  test('запуск, поставленный в очередь за зависшим, выполняется после перезапуска', async () => {
    const { engine, workers } = await readyEngine();
    const hung = engine.run('while True: pass', '', { timeoutMs: 40 });
    const next = engine.run('print(2)');
    expect((await hung).status).toBe('timeout');
    expect(workers).toHaveLength(2); // новый воркер поднят
    workers[1].ready();
    await tick();
    workers[1].answer({ output: '2' });
    expect((await next).output).toBe('2');
  });
});

describe('таймаут и остановка', () => {
  test('таймаут: воркер убит, новый поднят, результат объясняет причину', async () => {
    const { engine, workers } = await readyEngine();
    const result = await engine.run('while True: pass', '', { timeoutMs: 100 });
    expect(result).toMatchObject({ status: 'timeout', passed: false, output: '' });
    expect(result.error).toContain('Превышено время выполнения (0.1 с)');
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(engine.getStatus()).toBe('loading'); // Python-движок показывает перезапуск
  });

  test('таймаут по умолчанию берётся из настроек движка', async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10000);
    const { engine } = await readyEngine({ timeoutMs: 60 });
    expect((await engine.run('x')).status).toBe('timeout');
  });

  test('cancel(): запуск завершается статусом cancelled, воркер заменяется', async () => {
    const { engine, workers } = await readyEngine();
    const promise = engine.run('long()', '', { timeoutMs: 60000 });
    await tick();
    engine.cancel();
    expect(await promise).toMatchObject({ status: 'cancelled', passed: false, error: 'Выполнение остановлено' });
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  test('cancel() без выполняющегося запуска ничего не делает', async () => {
    const { engine, workers } = await readyEngine();
    engine.cancel();
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
    expect(engine.getStatus()).toBe('ready');
  });

  test('после завершения запуска таймер не срабатывает повторно', async () => {
    const { engine, workers } = await readyEngine();
    const promise = engine.run('x', '', { timeoutMs: 60 });
    await tick();
    workers[0].answer({});
    await promise;
    await tick(120);
    expect(workers).toHaveLength(1); // перезапуска не было
  });
});

describe('сбои', () => {
  test('ошибка загрузки: статус error, запуск возвращает понятный результат, воркер убит', async () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory, { label: 'JavaScript' });
    const promise = engine.run('1');
    await tick();
    workers[0].say({ type: 'init-error', message: 'Failed to fetch' });
    const result = await promise;
    expect(engine.getStatus()).toBe('error');
    expect(result).toMatchObject({ status: 'runtime_error', passed: false });
    expect(result.error).toBe('Не удалось загрузить JavaScript: Failed to fetch');
    expect(workers[0].terminated).toBe(true);
  });

  test('retry: start() после ошибки создаёт новый воркер, дальше всё работает', async () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory);
    engine.start();
    workers[0].say({ type: 'init-error', message: 'нет сети' });
    expect(engine.getStatus()).toBe('error');
    engine.start();
    expect(workers).toHaveLength(2);
    expect(engine.getStatus()).toBe('loading');
    workers[1].ready();
    expect(engine.getStatus()).toBe('ready');
  });

  test('следующий run() после ошибки сам пробует загрузить движок заново', async () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory);
    const first = engine.run('1');
    await tick();
    workers[0].say({ type: 'init-error', message: 'x' });
    await first;
    const second = engine.run('2');
    await tick();
    expect(workers).toHaveLength(2);
    workers[1].ready();
    await tick();
    workers[1].answer({ output: 'ok' });
    expect((await second).output).toBe('ok');
  });

  test('фабрика бросила исключение (Worker недоступен): статус error и сообщение', async () => {
    const engine = new WorkerEngine(() => { throw new Error('Worker is not defined'); });
    const result = await engine.run('1');
    expect(engine.getStatus()).toBe('error');
    expect(result.error).toContain('Worker is not defined');
  });

  test('ошибка воркера во время загрузки — это ошибка загрузки', () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory);
    engine.start();
    workers[0].fail('Script error');
    expect(engine.getStatus()).toBe('error');
  });

  test('падение воркера во время выполнения (например, память): понятный результат и перезапуск', async () => {
    const { engine, workers } = await readyEngine();
    const promise = engine.run('boom');
    await tick();
    workers[0].fail('Out of memory');
    const result = await promise;
    expect(result.status).toBe('runtime_error');
    expect(result.error).toContain('аварийно завершено');
    expect(result.error).toContain('Out of memory');
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  test('падение воркера без выполняющегося запуска тоже приводит к перезапуску', async () => {
    const { workers } = await readyEngine();
    workers[0].fail('внезапно');
    expect(workers).toHaveLength(2);
  });

  test('сообщения от уже убитого воркера игнорируются', async () => {
    const { engine, workers } = await readyEngine();
    const first = engine.run('a', '', { timeoutMs: 50 });
    await tick();
    const staleId = workers[0].lastRun().id;
    expect((await first).status).toBe('timeout');
    workers[1].ready();
    await tick();
    const second = engine.run('b');
    await tick();
    // запоздалый ответ «убитого» воркера: у него обработчики уже сняты
    expect(workers[0].onmessage).toBeNull();
    workers[1].say({ type: 'result', id: staleId, result: { status: 'ok', passed: true, output: 'ЧУЖОЙ' } }); // чужой id
    workers[1].answer({ output: 'свой' });
    expect((await second).output).toBe('свой');
  });

  test('ответ с неизвестным id не завершает текущий запуск', async () => {
    const { engine, workers } = await readyEngine();
    const promise = engine.run('x');
    await tick();
    workers[0].say({ type: 'result', id: 99999, result: { status: 'ok', output: 'не тот' } });
    let settled = false;
    promise.then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    workers[0].answer({ output: 'тот' });
    expect((await promise).output).toBe('тот');
  });
});

describe('режим recycle (лёгкие движки, JavaScript)', () => {
  test('после каждого запуска воркер заменяется новым, статус не мигает', async () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory, { recycle: true, label: 'JavaScript' });
    const statuses = [];
    engine.subscribe(() => statuses.push(engine.getStatus()));
    const first = engine.run('1');
    await tick();
    workers[0].ready();
    await tick();
    workers[0].answer({ output: 'раз' });
    expect((await first).output).toBe('раз');

    expect(workers[0].terminated).toBe(true);   // отработавший воркер уничтожен
    expect(workers).toHaveLength(2);            // новый уже поднят
    const before = statuses.length;

    const second = engine.run('2');
    await tick();
    workers[1].ready();
    await tick();
    workers[1].answer({ output: 'два' });
    expect((await second).output).toBe('два');
    expect(workers).toHaveLength(3);
    expect(statuses.slice(before).every(s => s === 'ready')).toBe(true); // замена воркера не видна в интерфейсе
    expect(statuses[0]).toBe('loading');
  });

  test('таймаут в recycle-режиме не показывает «загрузку»', async () => {
    const { factory, workers } = makeFactory();
    const engine = new WorkerEngine(factory, { recycle: true });
    engine.start();
    workers[0].ready();
    await tick();
    const result = await engine.run('while(true){}', '', { timeoutMs: 50 });
    expect(result.status).toBe('timeout');
    expect(engine.getStatus()).toBe('ready');
    expect(workers).toHaveLength(2);
  });
});

describe('остановка движка', () => {
  test('dispose(): воркер убит, статус idle, подписчики сброшены, выполняющийся запуск завершён', async () => {
    const { engine, workers } = await readyEngine();
    const listener = jest.fn();
    engine.subscribe(listener);
    const promise = engine.run('x', '', { timeoutMs: 60000 });
    await tick();
    engine.dispose();
    expect((await promise).status).toBe('cancelled');
    expect(workers[0].terminated).toBe(true);
    expect(engine.getStatus()).toBe('idle');
    expect(workers).toHaveLength(1); // новый воркер не создаётся
  });
});
