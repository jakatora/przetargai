/*
 * Kontrola buildu bez klikania: uruchamia aplikację w trybie PRZETARGAI_SMOKE,
 * czeka na zrzut okna i sprawdza, że ekran się wyrenderował i nie było błędów ładowania.
 * Użycie: `npm run smoke` (z katalogu desktop) albo `node skrypty/smoke.js <ścieżka.exe>`.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const png = path.join(os.tmpdir(), `przetargai-smoke-${Date.now()}.png`);
const exe = process.argv[2];
const polecenie = exe || require('electron');
const argumenty = exe ? [] : [path.resolve(__dirname, '..')];

// Uruchomione z terminala VS Code (sam jest Electronem) dziedziczy ELECTRON_RUN_AS_NODE=1,
// a wtedy Electron startuje jako goły Node, bez okna.
const { ELECTRON_RUN_AS_NODE, ...srodowisko } = process.env;

spawnSync(polecenie, argumenty, {
  env: { ...srodowisko, PRZETARGAI_SMOKE: png },
  stdio: 'inherit',
  timeout: 60_000,
});

if (!fs.existsSync(png) || fs.statSync(png).size < 10_000) {
  console.error('SMOKE: brak zrzutu okna — aplikacja się nie załadowała');
  process.exit(1);
}
const { bledy, tekst } = JSON.parse(fs.readFileSync(png + '.json', 'utf8'));
console.log('SMOKE zrzut:', png);
console.log('SMOKE tekst ekranu:', JSON.stringify(tekst.slice(0, 200)));
const krytyczne = bledy.filter((b) => b.startsWith('did-fail-load'));
if (bledy.length) console.log('SMOKE błędy konsoli:', bledy);
if (krytyczne.length || !tekst.trim()) process.exit(1);
console.log('SMOKE: OK');
