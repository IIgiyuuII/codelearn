// Скрытые тесты демо-курсов (db/seed.sql и db/seed_js.sql) проверяются эталонными решениями:
// эталон обязан проходить, заглушка из стартового кода и заведомо неверные решения — нет.
// Файлы разбираются как текст, база данных не нужна.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPyodide } from 'pyodide';
import { createRunner } from './.build/pythonRunner.mjs';
import { createJsRunner } from './.build/jsRunner.mjs';

const read = name => readFile(new URL(`../../db/${name}`, import.meta.url), 'utf8');
const solutions = JSON.parse(await readFile(new URL('./fixtures/seed-solutions.json', import.meta.url), 'utf8'));

// Разбор значений в `VALUES (...)` с SQL-строками ('…', кавычка удваивается), числами и NULL
function parseSqlValues(text) {
  const values = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (text[i] === "'" && text[i + 1] === "'") { s += "'"; i += 2; } else if (text[i] === "'") { i++; break; } else { s += text[i++]; }
      }
      values.push(s);
    } else if (/[-\d]/.test(c)) {
      let n = '';
      while (i < text.length && /[-\d.]/.test(text[i])) n += text[i++];
      values.push(Number(n));
    } else if (text.startsWith('NULL', i)) {
      values.push(null);
      i += 4;
    } else {
      i++;
    }
  }
  return values;
}

// Python: seed.sql
function pythonSeed(sql) {
  const tasks = [...sql.matchAll(/INSERT INTO tasks \([^)]*\) VALUES \(([\s\S]*?)\)\s*\nON CONFLICT/g)].map(m => {
    const v = parseSqlValues(m[1]);
    return { id: v[0], title: v[1], starter: v[3] };
  });
  const tests = new Map([...sql.matchAll(/INSERT INTO task_hidden_tests \([^)]*\) VALUES \(([\s\S]*?)\)\s*\nON CONFLICT/g)]
    .map(m => { const v = parseSqlValues(m[1]); return [v[1], v[2]]; }));
  return tasks.map(t => ({ ...t, tests: tests.get(t.id) }));
}

// JavaScript: seed_js.sql (строки в $t$…$t$)
function javascriptSeed(sql) {
  const tasks = [...sql.matchAll(/INSERT INTO tasks \([^)]*\) VALUES \(\s*'([^']+)',\s*\$t\$([\s\S]*?)\$t\$,\s*\$t\$([\s\S]*?)\$t\$/g)]
    .map(m => ({ title: m[1], starter: m[3] }));
  const tests = [...sql.matchAll(/INSERT INTO task_hidden_tests[^;]*?VALUES \(tid, \$t\$([\s\S]*?)\$t\$\)/g)].map(m => m[1]);
  return tasks.map((t, i) => ({ ...t, tests: tests[i] }));
}

let runPython;
before(async () => { runPython = createRunner(await loadPyodide()); }, { timeout: 120000 });

test('разбор seed.sql: 6 задач, у каждой есть скрытые тесты', async () => {
  const seed = pythonSeed(await read('seed.sql'));
  assert.equal(seed.length, 6);
  for (const t of seed) assert.ok(t.tests && t.tests.includes('assert'), `у задачи «${t.title}» нет тестов`);
});

test('Python-курс: эталон проходит, заглушка не проходит', async () => {
  for (const t of pythonSeed(await read('seed.sql'))) {
    const reference = solutions.python[t.title];
    assert.ok(reference, `нет эталонного решения для «${t.title}» — добавьте его в fixtures/seed-solutions.json`);
    assert.equal(runPython(reference, t.tests).passed, true, `эталон не проходит тесты задачи «${t.title}»`);
    assert.equal(runPython(t.starter, t.tests).passed, false, `заглушка проходит тесты задачи «${t.title}»`);
  }
});

test('разбор seed_js.sql: 6 задач, у каждой есть скрытые тесты', async () => {
  const seed = javascriptSeed(await read('seed_js.sql'));
  assert.equal(seed.length, 6);
  for (const t of seed) assert.ok(t.tests && t.tests.includes('assert'), `у задачи «${t.title}» нет тестов`);
});

test('JavaScript-курс: эталон проходит, заглушка не проходит', async () => {
  const run = createJsRunner({ watchRejections: h => process.on('unhandledRejection', h) });
  for (const t of javascriptSeed(await read('seed_js.sql'))) {
    const reference = solutions.javascript[t.title];
    assert.ok(reference, `нет эталонного решения для «${t.title}» — добавьте его в fixtures/seed-solutions.json`);
    assert.equal((await run(reference, t.tests)).passed, true, `эталон не проходит тесты задачи «${t.title}»`);
    assert.equal((await run(t.starter, t.tests)).passed, false, `заглушка проходит тесты задачи «${t.title}»`);
  }
});

test('JavaScript-курс: заведомо неверные решения отклоняются (запрет Math.max, мутация массива, регистр)', async () => {
  const run = createJsRunner({ watchRejections: h => process.on('unhandledRejection', h) });
  const byTitle = new Map(javascriptSeed(await read('seed_js.sql')).map(t => [t.title, t]));
  for (const [title, wrongs] of Object.entries(solutions.javascriptWrong)) {
    for (const wrong of wrongs) {
      assert.equal((await run(wrong, byTitle.get(title).tests)).passed, false, `неверное решение «${title}» прошло тесты: ${wrong}`);
    }
  }
});
