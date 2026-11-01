/** @jest-environment node */
import { createJsRunner, inspect, deepEqual, lockdownNetwork, AssertionError } from '../hooks/jsRunner';

// Раннер без реального события необработанных промисов — оно проверяется в tests-node (настоящий воркер)
let triggerRejection;
const run = createJsRunner({ watchRejections: handler => { triggerRejection = handler; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUM_TESTS = 'assertEqual(sum(2, 3), 5);\nassertEqual(sum(-1, 1), 0);';

describe('вердикт', () => {
  test.each([
    ['function-объявление', 'function sum(a, b) { return a + b; }'],
    ['const со стрелкой (одна область видимости с тестами)', 'const sum = (a, b) => a + b;'],
    ['let с function expression', 'let sum = function (a, b) { return a + b; };'],
    ['class + const', 'class M { static sum(a, b) { return a + b; } }\nconst sum = M.sum;'],
  ])('верное решение: %s', async (_, code) => {
    expect(await run(code, SUM_TESTS)).toMatchObject({ status: 'ok', passed: true, error: '' });
  });

  test('неверное решение → test_failed без раскрытия подробностей', async () => {
    expect(await run('function sum(a, b) { return a - b; }', SUM_TESTS)).toMatchObject({
      status: 'test_failed', passed: false, error: 'Тест не пройден',
    });
  });

  test('сообщение автора теста показывается как подсказка', async () => {
    const r = await run('function sum(a, b) { return 0; }', 'assertEqual(sum(2, 3), 5, "2 + 3 должно быть 5");');
    expect(r.error).toBe('Тест не пройден: 2 + 3 должно быть 5');
  });

  test('пустая заглушка из стартового кода не проходит', async () => {
    expect((await run('function sum(a, b) {}', SUM_TESTS)).status).toBe('test_failed');
  });

  test('запуск без тестов: ok, но зачёта (passed) нет; пустые тесты — тоже', async () => {
    expect(await run('console.log("hi")', '')).toMatchObject({ status: 'ok', passed: false, output: 'hi\n' });
    expect((await run('const sum = (a, b) => a + b;', '  \n ')).passed).toBe(false);
  });

  test('console.log с маркером успеха не влияет на вердикт', async () => {
    const r = await run('function sum() {}\nconsole.log("✓ Все тесты пройдены!")', SUM_TESTS);
    expect(r.status).toBe('test_failed');
  });

  test('return на верхнем уровне не позволяет обойти тесты', async () => {
    const r = await run('return;\nfunction sum(a, b) { return a + b; }', SUM_TESTS);
    expect(r.status).toBe('runtime_error');
    expect(r.error).toContain('до запуска тестов');
  });

  test('assert внутри решения во время тестов — проваленный тест; на стадии решения — ошибка выполнения', async () => {
    const inTests = await run('function sum(a, b) { assert(a >= 0, "внутри"); return a + b; }', 'assertEqual(sum(1, 2), 3); sum(-1, 0);');
    expect(inTests.status).toBe('test_failed');
    expect((await run('assert(false, "в решении");', SUM_TESTS)).status).toBe('runtime_error');
  });
});

describe('assert-помощники', () => {
  test.each([
    ['assertEqual: массивы и объекты сравниваются по значению', 'assertEqual([1, [2, { a: 3 }]], [1, [2, { a: 3 }]]);', true],
    ['assertEqual: разные массивы', 'assertEqual([1, 2], [1, 3]);', false],
    ['assertNotEqual проходит на разных значениях', 'assertNotEqual(1, 2);', true],
    ['assertNotEqual падает на равных', 'assertNotEqual({ a: 1 }, { a: 1 });', false],
    ['assert с истиной', 'assert(1 === 1);', true],
    ['assert с ложью', 'assert(false);', false],
    ['assertThrows проходит, если функция бросает', 'assertThrows(() => { throw new Error("x"); });', true],
    ['assertThrows падает, если не бросает', 'assertThrows(() => 1);', false],
  ])('%s', async (_, tests, expected) => {
    const r = await run('const noop = 1;', tests);
    expect(r.passed).toBe(expected);
    expect(r.status).toBe(expected ? 'ok' : 'test_failed');
  });
});

describe('ошибки и номера строк', () => {
  test('SyntaxError в решении и в тестах', async () => {
    expect((await run('function sum(a, b {', SUM_TESTS)).error).toMatch(/^SyntaxError/);
    expect((await run('const sum = (a, b) => a + b;', 'assertEqual(sum(1, 2), 3')).error).toMatch(/^SyntaxError/);
  });

  test('ReferenceError и исключение, брошенное решением', async () => {
    expect((await run('const x = undefinedVar + 1;', '')).error).toMatch(/^ReferenceError: undefinedVar is not defined/);
    const r = await run('function sum() { throw new TypeError("boom"); }', SUM_TESTS);
    expect(r).toMatchObject({ status: 'runtime_error' });
    expect(r.error).toMatch(/^TypeError: boom/);
  });

  test('throw не-Error значения', async () => {
    expect((await run('throw "строка";', '')).error).toBe("Uncaught 'строка'");
    expect((await run('throw 42;', '')).error).toBe('Uncaught 42');
  });

  test('номер строки в коде студента', async () => {
    expect((await run('let a = 1;\nlet b = 2;\nnull.foo;', '')).error).toMatch(/TypeError.*\(строка 3\)$/);
    expect((await run('function sum(a, b) {\n  return a + b.x.y;\n}', 'sum(1, {})')).error).toMatch(/\(строка 2\)$/);
  });

  test('ошибка внутри скрытых тестов не раскрывает номер строки', async () => {
    const r = await run('const sum = (a, b) => a + b;', 'null.x;');
    expect(r.status).toBe('runtime_error');
    expect(r.error).not.toMatch(/строка/);
  });

  test('служебное имя, занятое решением, не роняет раннер', async () => {
    expect((await run('const __rt__ = 1;', 'assert(true)')).status).toBe('runtime_error');
  });
});

describe('async, таймеры, промисы', () => {
  test('async-функция и await в тестах', async () => {
    expect((await run('const sum = async (a, b) => a + b;', 'assertEqual(await sum(2, 3), 5);')).passed).toBe(true);
  });

  test('отклонённый промис в тестах → runtime_error', async () => {
    const r = await run('const f = async () => { throw new Error("async boom"); };', 'await f();');
    expect(r.status).toBe('runtime_error');
    expect(r.error).toContain('async boom');
  });

  test('раннер дожидается setTimeout, как Node: порядок вывода сохраняется', async () => {
    const r = await run('setTimeout(() => console.log("позже"), 30);\nconsole.log("сначала");', '');
    expect(r.output).toBe('сначала\nпозже\n');
    expect(r.durationMs).toBeGreaterThanOrEqual(25);
  });

  test('setInterval + clearInterval отрабатывает ровно нужное число раз и завершается', async () => {
    const r = await run('let i = 0;\nconst id = setInterval(() => { console.log(++i); if (i === 3) clearInterval(id); }, 10);', '');
    expect(r.output).toBe('1\n2\n3\n');
  });

  test('clearTimeout отменяет таймер', async () => {
    const r = await run('const id = setTimeout(() => console.log("не должно"), 20); clearTimeout(id); console.log("ок");', '');
    expect(r.output).toBe('ок\n');
  });

  test('аргументы таймера передаются в колбэк; не-функция игнорируется', async () => {
    const r = await run('setTimeout((a, b) => console.log(a + b), 5, 1, 2); setTimeout("строка", 5);', '');
    expect(r).toMatchObject({ status: 'ok', output: '3\n' });
  });

  test('исключение в колбэке таймера → runtime_error', async () => {
    const r = await run('setTimeout(() => { throw new RangeError("из таймера"); }, 5);', '');
    expect(r.status).toBe('runtime_error');
    expect(r.error).toMatch(/^RangeError: из таймера/);
  });

  test('AssertionError в колбэке таймера во время тестов → test_failed', async () => {
    const r = await run('const f = () => 7;\nsetTimeout(() => assertEqual(f(), 8, "колбэк"), 5);', 'void 0');
    expect(r).toMatchObject({ status: 'test_failed', error: 'Тест не пройден: колбэк' });
  });

  test('необработанное отклонение промиса (событие окружения) → runtime_error', async () => {
    const promise = run('await new Promise(r => setTimeout(r, 40));', '');
    await sleep(10);
    triggerRejection(new Error('никто не поймал'));
    const r = await promise;
    expect(r.status).toBe('runtime_error');
    expect(r.error).toContain('никто не поймал');
  });

  test('событие вне запуска игнорируется и не портит следующий запуск', async () => {
    triggerRejection(new Error('чужое'));
    expect((await run('const x = 1;', '')).status).toBe('ok');
  });
});

describe('вывод console', () => {
  const out = async code => (await run(code, '')).output;

  test('смешанные аргументы как в Node', async () => {
    expect(await out('console.log("a", 1, true, null, undefined, [1, "b", [2]], { x: 1, "y-z": "s" }, 10n, -0)'))
      .toBe("a 1 true null undefined [ 1, 'b', [ 2 ] ] { x: 1, 'y-z': 's' } 10n -0\n");
  });

  test('Map, Set, Date, RegExp, функции, класс', async () => {
    expect(await out('console.log(new Map([["a", 1]]), new Set([1, 2]), new Date(0), /x/g, function foo() {}, () => 1, class A {})'))
      .toBe("Map(1) { 'a' => 1 } Set(2) { 1, 2 } 1970-01-01T00:00:00.000Z /x/g [Function: foo] [Function (anonymous)] [class A]\n");
  });

  test('циклические ссылки, пустые структуры, предел глубины', async () => {
    expect(await out('const o = { a: 1 }; o.self = o; console.log(o); console.log([]); console.log({}); console.log({ a: { b: { c: { d: { e: 1 } } } } })'))
      .toBe("{ a: 1, self: [Circular] }\n[]\n{}\n{ a: { b: { c: { d: [Object] } } } }\n");
  });

  test('экземпляр класса, объект без прототипа, Error', async () => {
    expect(await out('class P { constructor() { this.x = 1; } }\nconsole.log(new P(), Object.create(null), new Error("e"))'))
      .toBe('P { x: 1 } [Object: null prototype] {} Error: e\n');
  });

  test('error, warn, info попадают в вывод; console.assert не бросает', async () => {
    expect(await out('console.error("err"); console.warn("warn"); console.info("info"); console.assert(1 === 2, "нет"); console.assert(true);'))
      .toBe('err\nwarn\ninfo\nAssertion failed: нет\n');
  });

  test('длинный массив усекается, огромный вывод обрезается', async () => {
    expect(await out('console.log(Array.from({ length: 150 }, (_, i) => i))')).toContain('... 50 more items');
    const big = await out('console.log("x".repeat(100000))');
    expect(big.length).toBeLessThan(20100);
    expect(big).toContain('обрезан');
  });

  test('длинный объект переносится на несколько строк', async () => {
    const text = await out('console.log({ alpha: "aaaaaaaaaaaaaaaa", beta: "bbbbbbbbbbbbbbbb", gamma: "cccccccccccccccc", delta: "dddd" })');
    expect(text.split('\n').length).toBeGreaterThan(2);
  });
});

describe('inspect и deepEqual', () => {
  test('inspect: примитивы и вложенность', () => {
    expect(inspect('a\nb\'c')).toBe("'a\\nb\\'c'");
    expect(inspect(Symbol('s'))).toBe('Symbol(s)');
    expect(inspect(new Date(NaN))).toBe('Invalid Date');
    expect(inspect([[[[[1]]]]])).toBe('[ [ [ [ [Array] ] ] ] ]');
  });

  test('deepEqual: структуры, NaN, 0/-0, типы', () => {
    expect(deepEqual([1, [2, { a: 3 }]], [1, [2, { a: 3 }]])).toBe(true);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(0, -0)).toBe(true);
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });

  test('deepEqual: Map, Set, Date, RegExp', () => {
    expect(deepEqual(new Map([[1, { a: 1 }]]), new Map([[1, { a: 1 }]]))).toBe(true);
    expect(deepEqual(new Map([[1, 1]]), new Map([[1, 2]]))).toBe(false);
    expect(deepEqual(new Set([1, { a: 1 }]), new Set([{ a: 1 }, 1]))).toBe(true);
    expect(deepEqual(new Set([1]), new Set([2]))).toBe(false);
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(new Date(5), new Date(6))).toBe(false);
    expect(deepEqual(/a/g, /a/g)).toBe(true);
    expect(deepEqual(/a/g, /a/i)).toBe(false);
  });

  test('deepEqual: циклические структуры не зацикливают сравнение', () => {
    const a = {}; a.self = a;
    const b = {}; b.self = b;
    expect(deepEqual(a, b)).toBe(true);
  });

  test('AssertionError — отдельный тип с понятным именем', () => {
    const e = new AssertionError('текст');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AssertionError');
  });
});

describe('lockdownNetwork', () => {
  test('сетевые API отключаются в области видимости и по цепочке прототипов', () => {
    const proto = { WebSocket() {}, safeInProto: 1 };
    const scope = Object.create(proto);
    Object.assign(scope, { fetch() {}, XMLHttpRequest() {}, importScripts() {}, keepMe: 1 });
    const blocked = lockdownNetwork(scope);
    expect(blocked).toEqual(expect.arrayContaining(['fetch', 'XMLHttpRequest', 'importScripts', 'WebSocket']));
    expect(scope.fetch).toBeUndefined();
    expect(scope.WebSocket).toBeUndefined();
    expect(scope.keepMe).toBe(1);
    expect(proto.safeInProto).toBe(1);
  });

  test('отключённое нельзя вернуть обратно: свойство неизменяемо', () => {
    const scope = { fetch() {} };
    lockdownNetwork(scope);
    expect(Object.getOwnPropertyDescriptor(scope, 'fetch')).toMatchObject({ value: undefined, writable: false, configurable: false });
    // студенческий код нестрогий (new AsyncFunction): присваивание там молча игнорируется, в строгом режиме — TypeError
    expect(() => { scope.fetch = () => 'вернули'; }).toThrow(TypeError);
    expect(scope.fetch).toBeUndefined();
  });

  test('отсутствующие и непереопределяемые свойства не вызывают ошибок', () => {
    const scope = {};
    Object.defineProperty(scope, 'fetch', { value: () => {}, configurable: false });
    expect(() => lockdownNetwork(scope)).not.toThrow();
    expect(() => lockdownNetwork({})).not.toThrow();
  });
});
