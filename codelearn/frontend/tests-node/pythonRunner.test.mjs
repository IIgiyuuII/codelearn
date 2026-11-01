// Реальный Python (Pyodide): вердикты, изоляция запусков, обрезка вывода.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPyodide } from 'pyodide';
import { createRunner } from './.build/pythonRunner.mjs';

let run;
before(async () => { run = createRunner(await loadPyodide()); }, { timeout: 120000 });

const TESTS = 'assert factorial(5) == 120\nassert factorial(0) == 1\nprint("✓ Все тесты пройдены!")';
const GOOD = 'def factorial(n):\n    return 1 if n == 0 else n*factorial(n-1)';

test('верное решение проходит тесты', () => {
  const r = run(GOOD, TESTS);
  assert.equal(r.status, 'ok');
  assert.equal(r.passed, true);
});

test('неверное решение → test_failed', () => {
  const r = run('def factorial(n):\n    return 0', TESTS);
  assert.equal(r.status, 'test_failed');
  assert.equal(r.passed, false);
  assert.equal(r.error, 'Тест не пройден');
});

test('сообщение assert из тестов показывается студенту', () => {
  const r = run(GOOD, 'assert factorial(5) == 121, "factorial(5) должен быть 120"');
  assert.match(r.error, /factorial\(5\) должен быть 120/);
});

test('print маркера успеха не засчитывается', () => {
  const r = run('def factorial(n): pass\nprint("✓ Все тесты пройдены!")', TESTS);
  assert.equal(r.status, 'test_failed');
});

test('верное решение с warnings.warn (вывод в stderr) всё равно засчитывается', () => {
  const r = run(`import warnings\nwarnings.warn("устаревшая конструкция")\n${GOOD}`, TESTS);
  assert.equal(r.passed, true);
});

test('тесты без финальной print-строки тоже проходят', () => {
  assert.equal(run(GOOD, 'assert factorial(5) == 120').passed, true);
});

test('нет утечки имён между запусками: пустой код после верного решения не проходит', () => {
  run(GOOD, '');
  const r = run('# пусто', TESTS);
  assert.equal(r.status, 'runtime_error');
  assert.match(r.error, /NameError/);
});

test('SyntaxError: читаемое сообщение без служебных кадров', () => {
  const r = run('def factorial(n:\n  return 1', TESTS);
  assert.equal(r.status, 'runtime_error');
  assert.match(r.error, /SyntaxError/);
  assert.doesNotMatch(r.error, /run_solution/);
});

test('NameError без тестов', () => {
  const r = run('x = undefined_name', '');
  assert.equal(r.status, 'runtime_error');
  assert.match(r.error, /NameError/);
  assert.doesNotMatch(r.error, /run_solution/);
});

test('обычный запуск: вывод есть, зачёта нет', () => {
  const r = run('print("привет")\nprint(1+1)', '');
  assert.equal(r.status, 'ok');
  assert.equal(r.passed, false);
  assert.equal(r.output, 'привет\n2\n');
});

test('пустые тесты — не зачёт', () => {
  assert.equal(run(GOOD, '   \n ').passed, false);
});

test('stdout восстанавливается после подмены студентом', () => {
  run('import sys\nsys.stdout = None\nsys.stderr = None', '');
  assert.equal(run('print("ok")', '').output, 'ok\n');
});

test('sys.exit() не ломает раннер', () => {
  const r = run('import sys\nsys.exit(0)', '');
  assert.equal(r.status, 'runtime_error');
  assert.match(r.error, /SystemExit/);
});

test('огромный вывод обрезается', () => {
  const r = run('print("x"*100000)', '');
  assert.ok(r.output.length < 20100);
  assert.match(r.output, /обрезан/);
});

test('assert внутри решения — ошибка выполнения с трассировкой, а не «тест не пройден»', () => {
  const r = run('def factorial(n):\n    assert n > 100\n    return 1', TESTS);
  assert.equal(r.status, 'runtime_error');
  assert.match(r.error, /<solution>/);
});

test('исключение в решении во время тестов → runtime_error', () => {
  const r = run('def factorial(n):\n    return 1/0', TESTS);
  assert.equal(r.status, 'runtime_error');
  assert.match(r.error, /ZeroDivisionError/);
});
