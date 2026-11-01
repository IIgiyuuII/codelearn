// Запуск: npm run test:engine
// Готовит исходники и запускает все *.test.mjs встроенным раннером Node (node --test).
// Файлы перечисляются явно: так работает и на Windows (где оболочка не раскрывает маски),
// и на Node 18/20 (где --test принимает маски не везде).
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepare } from './prepare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
await prepare();
const files = (await readdir(here)).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join(here, f));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
