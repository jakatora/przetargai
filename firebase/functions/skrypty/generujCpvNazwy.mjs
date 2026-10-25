// Generuje src/lib/cpvNazwy.js z katalogu CPV aplikacji mobilnej (jedno źródło prawdy: picker, z którego
// użytkownik wybiera kody). Uruchom po zmianie mobile/src/lib/cpvKatalog.js: `node skrypty/generujCpvNazwy.mjs`.
// Test cpvNazwy.test.js pilnuje, że plik jest aktualny.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { KATALOG_CPV } from '../../../mobile/src/lib/cpvKatalog.js';

const tu = path.dirname(fileURLToPath(import.meta.url));
const plaski = {};
for (const dzial of KATALOG_CPV) {
  plaski[dzial.kod] = dzial.nazwa;
  for (const d of dzial.dzieci ?? []) plaski[d.kod] = d.nazwa;
}
const linie = Object.entries(plaski).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `  '${k}': ${JSON.stringify(n)},`);
const tresc = `/* WYGENEROWANE przez skrypty/generujCpvNazwy.mjs z mobile/src/lib/cpvKatalog.js — nie edytuj ręcznie. */
export const NAZWY_CPV = Object.freeze({
${linie.join('\n')}
});
`;
writeFileSync(path.join(tu, '..', 'src', 'lib', 'cpvNazwy.js'), tresc);
console.log('cpvNazwy.js:', Object.keys(plaski).length, 'kodów');
