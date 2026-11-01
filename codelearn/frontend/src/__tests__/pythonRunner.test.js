/** @jest-environment node */
// Здесь проверяется JS-обвязка раннера на поддельном Pyodide. Сам Python-код раннера
// (вердикты, чистое пространство имён, обрезка вывода…) проверяется на настоящем Pyodide
// в tests-node/pythonRunner.test.mjs — запуск: npm run test:engine.
import { createRunner } from '../hooks/pythonRunner';

function fakePyodide(runSolution) {
  const globals = { get: jest.fn(name => (name === 'run_solution' ? runSolution : undefined)) };
  return { toPy: jest.fn(() => globals), runPython: jest.fn(), globals };
}
const reply = (status, output = '', error = '') => jest.fn(() => JSON.stringify({ status, output, error }));

test('раннер готовится в изолированных globals и берёт функцию run_solution', () => {
  const py = fakePyodide(reply('ok'));
  createRunner(py);
  expect(py.toPy).toHaveBeenCalledWith({});
  const [source, options] = py.runPython.mock.calls[0];
  expect(source).toContain('def run_solution(student_code, tests_code)');
  expect(options.globals).toBe(py.globals);
  expect(py.globals.get).toHaveBeenCalledWith('run_solution');
});

test('код и тесты передаются в Python как есть', () => {
  const fn = reply('ok');
  createRunner(fakePyodide(fn))('print(1)', 'assert 1');
  expect(fn).toHaveBeenCalledWith('print(1)', 'assert 1');
});

test.each([
  ['ok', 'assert 1', true, 'тесты были и прошли'],
  ['ok', '', false, 'без тестов зачёта нет'],
  ['ok', '   \n ', false, 'пустые тесты — не тесты'],
  ['test_failed', 'assert 0', false, 'тесты не прошли'],
  ['runtime_error', 'assert 1', false, 'ошибка выполнения'],
])('вердикт %s при тестах %j → passed=%s (%s)', (status, tests, passed) => {
  const result = createRunner(fakePyodide(reply(status, 'вывод', 'ошибка')))('code', tests);
  expect(result).toMatchObject({ status, passed, output: 'вывод', error: 'ошибка' });
  expect(typeof result.durationMs).toBe('number');
});

test('без второго аргумента тесты считаются пустыми', () => {
  const fn = reply('ok');
  const result = createRunner(fakePyodide(fn))('print(1)');
  expect(fn).toHaveBeenCalledWith('print(1)', '');
  expect(result.passed).toBe(false);
});

test('исключение внутри Pyodide превращается в runtime_error, а не падает', () => {
  const run = createRunner(fakePyodide(() => { throw new Error('Pyodide упал'); }));
  expect(run('x', 'assert 1')).toMatchObject({ status: 'runtime_error', passed: false, output: '', error: 'Pyodide упал' });
});

test('невалидный ответ раннера обрабатывается так же', () => {
  const run = createRunner(fakePyodide(() => 'это не JSON'));
  expect(run('x', 'assert 1')).toMatchObject({ status: 'runtime_error', passed: false });
});

test('замеряет длительность', () => {
  const run = createRunner(fakePyodide(() => { const t = Date.now(); while (Date.now() - t < 15); return JSON.stringify({ status: 'ok', output: '', error: '' }); }));
  expect(run('x').durationMs).toBeGreaterThanOrEqual(10);
});
