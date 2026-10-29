/*
 * Buduje eksport webowy aplikacji mobilnej i kopiuje go do desktop/web.
 * Ikonę bierze z tej samej grafiki co sklepy (mobile/assets/icon.png, 1024 px) —
 * electron-builder sam robi z niej .ico.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DESKTOP = path.resolve(__dirname, '..');
const MOBILE = path.resolve(DESKTOP, '..', 'mobile');
const WYJSCIE = path.join(DESKTOP, 'web');

fs.rmSync(WYJSCIE, { recursive: true, force: true });
/*
 * `--clear` (2026-10-29): Metro wpisuje `process.env.EXPO_PUBLIC_*` w kod przy transformacji i trzyma wynik
 * w pamięci podręcznej WSPÓLNEJ dla wszystkich klonów. Podgląd z `EXPO_PUBLIC_API_URL=http://localhost:8096`
 * (lokalny serwer testowy) zostawił w cache `config.js`, a build Windows 1.2.0 celował w localhost —
 * aplikacja pokazywała „Brak połączenia z serwerem”. Build wydania zawsze z czystą pamięcią.
 */
const { EXPO_PUBLIC_API_URL, ...srodowiskoEksportu } = process.env;
if (EXPO_PUBLIC_API_URL) console.warn(`Pomijam EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL} — build wydania celuje w produkcję.`);
execSync(`npx expo export --platform web --clear --output-dir "${WYJSCIE}"`, { cwd: MOBILE, stdio: 'inherit', env: srodowiskoEksportu });

if (!fs.existsSync(path.join(WYJSCIE, 'index.html'))) {
  throw new Error('Eksport webowy nie utworzył index.html');
}

// Strażnik: paczka MUSI celować w produkcyjne API i nie może zawierać adresów lokalnych.
const katalogJs = path.join(WYJSCIE, '_expo', 'static', 'js', 'web');
const kod = fs.readdirSync(katalogJs).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(katalogJs, f), 'utf8')).join(' ');
if (!kod.includes('europe-central2-przetargai.cloudfunctions.net/api')) throw new Error('Eksport webowy nie zawiera adresu produkcyjnego API');
const lokalne = kod.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g);
if (lokalne) throw new Error(`Eksport webowy celuje w adres lokalny: ${[...new Set(lokalne)].join(', ')}`);

fs.mkdirSync(path.join(DESKTOP, 'build'), { recursive: true });
fs.copyFileSync(path.join(MOBILE, 'assets', 'icon.png'), path.join(DESKTOP, 'build', 'icon.png'));
console.log('Eksport webowy gotowy:', WYJSCIE);
