// Каждый тест получает свежую копию модуля: движки в useCodeEngine — одиночки на всё приложение.
// Всё (react, react-dom, тестовая библиотека, хук) загружается внутри одной изолированной области,
// иначе у хука и рендерера оказались бы разные экземпляры React.
import { makeFactory, tick } from '../testUtils/fakeWorker';

const loadedLibraries = [];
afterEach(() => { loadedLibraries.splice(0).forEach(RTL => RTL.cleanup()); });

function load() {
  const py = makeFactory();
  const js = makeFactory();
  let loaded;
  // При загрузке тестовая библиотека сама регистрирует хуки Jest (afterEach и др.) — внутри теста это
  // запрещено, поэтому на время загрузки прячем эти функции, а очистку делаем вручную (см. afterEach выше).
  const hidden = ['beforeAll', 'afterAll', 'beforeEach', 'afterEach'];
  const saved = Object.fromEntries(hidden.map(name => [name, global[name]]));
  hidden.forEach(name => { global[name] = undefined; });
  try {
    jest.isolateModules(() => {
      jest.doMock('../hooks/workerFactories', () => ({ createPythonWorker: py.factory, createJavaScriptWorker: js.factory }));
      loaded = { RTL: require('@testing-library/react'), mod: require('../hooks/useCodeEngine') };
    });
  } finally {
    hidden.forEach(name => { global[name] = saved[name]; });
  }
  global.IS_REACT_ACT_ENVIRONMENT = true;
  loadedLibraries.push(loaded.RTL);
  return { ...loaded, py: py.workers, js: js.workers };
}

test('язык ещё неизвестен (задача грузится): статус idle, ничего не запускается', () => {
  const { RTL, mod, py, js } = load();
  const { result } = RTL.renderHook(() => mod.useCodeEngine(null));
  expect(result.current.status).toBe('idle');
  expect(py).toHaveLength(0);
  expect(js).toHaveLength(0);
});

test('язык без движка (Ruby): статус unsupported, запуск возвращает понятную ошибку, воркеры не создаются', async () => {
  const { RTL, mod, py, js } = load();
  const { result } = RTL.renderHook(() => mod.useCodeEngine('ruby'));
  expect(result.current.status).toBe('unsupported');
  const res = await result.current.runCode('puts 1', 'assert');
  expect(res).toMatchObject({ status: 'runtime_error', passed: false });
  expect(res.error).toContain('не поддерживается');
  expect(py).toHaveLength(0);
  expect(js).toHaveLength(0);
  expect(() => { result.current.cancel(); result.current.retry(); }).not.toThrow();
});

test('python: хук запускает движок, статус обновляется при готовности, код и тесты доходят до воркера', async () => {
  const { RTL, mod, py, js } = load();
  const { result } = RTL.renderHook(() => mod.useCodeEngine('python'));
  expect(py).toHaveLength(1);
  expect(js).toHaveLength(0);
  expect(result.current.status).toBe('loading');
  RTL.act(() => py[0].ready());
  expect(result.current.status).toBe('ready');

  let promise;
  RTL.act(() => { promise = result.current.runCode('print(1)', 'assert 1'); });
  await RTL.act(async () => { await tick(); });
  expect(py[0].lastRun()).toMatchObject({ code: 'print(1)', tests: 'assert 1' });
  await RTL.act(async () => { py[0].answer({ output: '1\n' }); });
  expect(await promise).toMatchObject({ status: 'ok', output: '1\n' });
});

test('javascript: отдельный движок со своим воркером; python при этом не трогается', () => {
  const { RTL, mod, py, js } = load();
  const { result } = RTL.renderHook(() => mod.useCodeEngine('javascript'));
  expect(js).toHaveLength(1);
  expect(py).toHaveLength(0);
  RTL.act(() => js[0].ready());
  expect(result.current.status).toBe('ready');
});

test('движок один на приложение: несколько потребителей не создают лишних воркеров', () => {
  const { RTL, mod, py } = load();
  RTL.renderHook(() => mod.useCodeEngine('python'));
  RTL.renderHook(() => mod.useCodeEngine('python'));
  RTL.renderHook(() => mod.useCodeEngine('python'));
  expect(py).toHaveLength(1);
});

test('движок переживает размонтирование страницы (Pyodide не грузится заново)', () => {
  const { RTL, mod, py } = load();
  const first = RTL.renderHook(() => mod.useCodeEngine('python'));
  RTL.act(() => py[0].ready());
  first.unmount();
  const second = RTL.renderHook(() => mod.useCodeEngine('python'));
  expect(py).toHaveLength(1);
  expect(second.result.current.status).toBe('ready');
});

test('смена языка в одном компоненте переключает движок (язык стал известен после загрузки задачи)', () => {
  const { RTL, mod, py, js } = load();
  const { result, rerender } = RTL.renderHook(({ lang }) => mod.useCodeEngine(lang), { initialProps: { lang: null } });
  expect(result.current.status).toBe('idle');
  rerender({ lang: 'javascript' });
  expect(js).toHaveLength(1);
  expect(py).toHaveLength(0);
  expect(result.current.status).toBe('loading');
});

test('preloadPython прогревает только Python и идемпотентен', () => {
  const { mod, py, js } = load();
  mod.preloadPython();
  mod.preloadPython();
  expect(py).toHaveLength(1);
  expect(js).toHaveLength(0);
});

test('retry после ошибки загрузки заново запускает движок; cancel останавливает выполнение', async () => {
  const { RTL, mod, py } = load();
  const { result } = RTL.renderHook(() => mod.useCodeEngine('python'));
  RTL.act(() => py[0].say({ type: 'init-error', message: 'нет сети' }));
  expect(result.current.status).toBe('error');
  RTL.act(() => result.current.retry());
  expect(py).toHaveLength(2);
  expect(result.current.status).toBe('loading');
  RTL.act(() => py[1].ready());

  let promise;
  RTL.act(() => { promise = result.current.runCode('while True: pass', '', { timeoutMs: 60000 }); });
  await RTL.act(async () => { await tick(); });
  RTL.act(() => result.current.cancel());
  expect((await promise).status).toBe('cancelled');
});

test('публичные списки языков согласованы с движками', () => {
  const { mod } = load();
  expect(mod.SUPPORTED_LANGUAGES).toEqual(['python', 'javascript']);
  expect(mod.LANGUAGE_NAMES).toMatchObject({ python: 'Python', javascript: 'JavaScript', ruby: 'Ruby' });
});
