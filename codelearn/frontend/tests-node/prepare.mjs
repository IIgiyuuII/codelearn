// Готовит исходники движка для запуска в чистом Node: копирует src/hooks/*.js в .build/*.mjs
// (в проекте файлы — ES-модули без "type": "module", Node без переименования их не загрузит).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = ['pythonRunner', 'jsRunner', 'workerCore', 'workerEngine'];

export async function prepare() {
  const out = path.join(here, '.build');
  await mkdir(out, { recursive: true });
  for (const name of SOURCES) {
    const source = await readFile(path.join(here, '..', 'src', 'hooks', `${name}.js`), 'utf8');
    // import ... from './x'  →  from './x.mjs'
    const rewritten = source.replace(/(from\s+['"])(\.\/[\w-]+)(['"])/g, '$1$2.mjs$3');
    await writeFile(path.join(out, `${name}.mjs`), rewritten);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepare();
  console.log(`Подготовлено: ${SOURCES.join(', ')} → tests-node/.build/`);
}
