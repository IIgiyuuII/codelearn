/** @jest-environment node */
import { setupWorkerCore } from '../hooks/workerCore';

function makeScope() {
  const posted = [];
  const scope = { postMessage: m => posted.push(m), onmessage: null };
  const send = async data => { await scope.onmessage({ data }); };
  return { scope, posted, send };
}

test('init: загружает раннер и отвечает ready', async () => {
  const { scope, posted, send } = makeScope();
  const loadRunner = jest.fn(async () => () => ({}));
  setupWorkerCore(scope, loadRunner);
  await send({ type: 'init' });
  expect(loadRunner).toHaveBeenCalledTimes(1);
  expect(posted).toEqual([{ type: 'ready' }]);
});

test.each([
  ['Error', new Error('CDN недоступен'), 'CDN недоступен'],
  ['строка', 'просто текст', 'просто текст'],
])('сбой загрузки (%s) → init-error с текстом', async (_, thrown, message) => {
  const { scope, posted, send } = makeScope();
  setupWorkerCore(scope, async () => { throw thrown; });
  await send({ type: 'init' });
  expect(posted).toEqual([{ type: 'init-error', message }]);
});

test('run: код и тесты передаются раннеру, результат отправляется с тем же id', async () => {
  const { scope, posted, send } = makeScope();
  const run = jest.fn(() => ({ status: 'ok', passed: true, output: 'x', error: '', durationMs: 3 }));
  setupWorkerCore(scope, async () => run);
  await send({ type: 'init' });
  await send({ type: 'run', id: 17, code: 'print(1)', tests: 'assert 1' });
  expect(run).toHaveBeenCalledWith('print(1)', 'assert 1');
  expect(posted[1]).toEqual({ type: 'result', id: 17, result: { status: 'ok', passed: true, output: 'x', error: '', durationMs: 3 } });
});

test('асинхронный раннер (JavaScript) ожидается до отправки результата', async () => {
  const { scope, posted, send } = makeScope();
  setupWorkerCore(scope, async () => async () => {
    await new Promise(r => setTimeout(r, 20));
    return { status: 'ok', passed: false, output: 'позже', error: '', durationMs: 20 };
  });
  await send({ type: 'init' });
  await send({ type: 'run', id: 1, code: '', tests: '' });
  expect(posted[1].result.output).toBe('позже');
});

test('run до загрузки раннера → понятная ошибка, а не падение воркера', async () => {
  const { scope, posted, send } = makeScope();
  setupWorkerCore(scope, async () => () => ({}));
  await send({ type: 'run', id: 5, code: 'x', tests: '' });
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ type: 'result', id: 5, result: { status: 'runtime_error', passed: false } });
  expect(posted[0].result.error).toContain('ещё не загружен');
});

test('неизвестные и пустые сообщения игнорируются', async () => {
  const { scope, posted, send } = makeScope();
  setupWorkerCore(scope, async () => () => ({}));
  await send({ type: 'что-то' });
  await send(undefined);
  await send(null);
  expect(posted).toEqual([]);
});
