// Печатает сводку покрытия из coverage/lcov.info (для страницы результатов GitHub Actions).
import { readFileSync } from 'node:fs';

const lcov = readFileSync(new URL('../coverage/lcov.info', import.meta.url), 'utf8');
const sum = { LF: 0, LH: 0, FNF: 0, FNH: 0, BRF: 0, BRH: 0 };
for (const line of lcov.split('\n')) {
  const [key, value] = line.split(':');
  if (key in sum) sum[key] += Number(value);
}
const pct = (hit, found) => (found ? ((100 * hit) / found).toFixed(1) : '0.0');
console.log(`Строки: ${pct(sum.LH, sum.LF)}% (${sum.LH} из ${sum.LF})`);
console.log(`Функции: ${pct(sum.FNH, sum.FNF)}% (${sum.FNH} из ${sum.FNF})`);
console.log(`Ветвления: ${pct(sum.BRH, sum.BRF)}% (${sum.BRH} из ${sum.BRF})`);
