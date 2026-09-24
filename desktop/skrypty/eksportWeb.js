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
execSync(`npx expo export --platform web --output-dir "${WYJSCIE}"`, { cwd: MOBILE, stdio: 'inherit' });

if (!fs.existsSync(path.join(WYJSCIE, 'index.html'))) {
  throw new Error('Eksport webowy nie utworzył index.html');
}

fs.mkdirSync(path.join(DESKTOP, 'build'), { recursive: true });
fs.copyFileSync(path.join(MOBILE, 'assets', 'icon.png'), path.join(DESKTOP, 'build', 'icon.png'));
console.log('Eksport webowy gotowy:', WYJSCIE);
