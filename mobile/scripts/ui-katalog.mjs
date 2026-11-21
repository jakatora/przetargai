/*
 * Regresja prawdziwego eksportu Expo + normalnego createApp/GET /tenders +
 * Firestore emulator. Bez atrapy katalogu i bez połączeń z produkcyjnym API.
 *
 * FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
 * EXPO_PUBLIC_API_URL=http://127.0.0.1:47831 npx expo export --platform web --clear --output-dir <web>
 * node --env-file=../firebase/functions/.env.test scripts/ui-katalog.mjs <web> <dowody>
 * PLAYWRIGHT_CORE wskazuje istniejący pakiet playwright-core. --serve zostawia
 * lokalny serwer do ręcznego sprawdzenia; login katalog-ui@example.invalid / IzolowanyTest123.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import express from '../../firebase/functions/node_modules/express/index.js';
const requireFunctions = createRequire(new URL('../../firebase/functions/package.json', import.meta.url));
const { initializeApp } = requireFunctions('firebase-admin/app');
const { getFirestore } = requireFunctions('firebase-admin/firestore');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8090' || process.env.NODE_ENV !== 'test') throw new Error('Wymagany lokalny emulator i NODE_ENV=test');
initializeApp({ projectId: 'demo-przetargai-katalog-ui' });
const { createApp } = await import('../../firebase/functions/src/app.js');
const { zasiejRzadkiKatalog } = await import('../../firebase/functions/test/fixtures/katalogRzadki.js');
const web = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ui-result.json'), JSON.stringify({ ok: false, status: 'running', startedAt: new Date().toISOString() }));
const apiUrl = 'http://127.0.0.1:47831';
const bundle = fs.readdirSync(path.join(web, '_expo/static/js/web')).map((f) => fs.readFileSync(path.join(web, '_expo/static/js/web', f), 'utf8')).join('');
assert.ok(bundle.includes(apiUrl));
assert.ok(!bundle.includes('cloudfunctions.net/api'));
const { ids } = await zasiejRzadkiKatalog('UI');
await getFirestore().collection('tenders').doc('UI-kaloszy').set({
  title: 'Linia do produkcji kaloszy — test lokalny', organization: 'Firma Testowa — emulator',
  source: 'bzp', cpv_main: '42990000-2', wojewodztwo: 'PL06',
  deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
  fetched_at: new Date(Date.now() + 1000).toISOString(), published_at: new Date().toISOString(),
});
const nativeFetch = globalThis.fetch;
const blockedServer = [];
globalThis.fetch = (url, ...args) => {
  if (new URL(url).hostname !== '127.0.0.1') { blockedServer.push(String(url)); throw new Error('Tylko lokalny serwer testowy'); }
  return nativeFetch(url, ...args);
};
const requests = [];
let hold = false;
const pending = [];
const release = () => { hold = false; pending.splice(0).forEach((fn) => fn()); };
const app = express();
app.post('/__test/release', (_req, res) => { release(); res.json({ ok: true }); });
app.get('/__test/state', (_req, res) => res.json({ pending: pending.length, requests }));
app.use(async (req, res, next) => {
  const entry = { url: req.originalUrl, method: req.method };
  requests.push(entry);
  res.on('finish', () => { entry.status = res.statusCode; });
  if (hold && req.path === '/tenders' && req.query.q === 'kaloszy' && req.query.kursor) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 15000);
      pending.push(() => { clearTimeout(timer); resolve(); });
    });
  }
  next();
});
app.use(createApp());
// API createApp ma końcowy 404, dlatego pliki obsługuje osobny router z przodu.
const host = express();
host.use((req, res, next) => /^\/(auth|tenders|matches|health|stats|api|__test)(\/|\?|$)/.test(req.originalUrl) ? app(req, res, next) : next());
host.use(express.static(web));
host.get(/.*/, (_req, res) => res.sendFile(path.join(web, 'index.html')));
const server = host.listen(47831, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const credentials = { email: 'katalog-ui@example.invalid', password: 'IzolowanyTest123' };
let r = await fetch(`${apiUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
if (r.status === 409) r = await fetch(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
assert.ok(r.ok); const { token } = await r.json();
if (process.argv.includes('--serve')) {
  console.log('LOCAL_UI_READY '+apiUrl); // wyłącznie syntetyczny projekt emulatora
} else {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ locale: 'pl-PL', viewport: { width: 390, height: 844 } });
  const blockedBrowser = [], errors = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(apiUrl+'/') || /^(data|blob):/.test(url)) return route.continue();
    blockedBrowser.push(url); return route.abort();
  });
  await context.addInitScript(({ token }) => {
    localStorage.setItem('przetargai_token', token);
    localStorage.setItem('przetargai.onboarding_pominiety', '1');
    localStorage.setItem('przetargai.lista_tryb', 'wszystkie');
  }, { token });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const visible = (text) => page.getByText(text, { exact: true }).filter({ visible: true }).first();
  async function click(text) {
    const el = visible(text); await el.waitFor({ timeout: 20000 }); await el.scrollIntoViewIfNeeded();
    await el.click({ timeout: 20000 });
  }
  const search = () => page.getByRole('textbox', { name: 'Szukaj w całym rynku', exact: true }).filter({ visible: true });
  async function finished() {
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="progressbar"]')].some((e) => e.getBoundingClientRect().height > 0), { timeout: 20000 });
    assert.equal(await visible('Nie udało się wczytać rynku').count(), 0);
  }
  async function calosc() {
    if (await visible('Więcej ogłoszeń').count()) {
      try { await visible('Więcej ogłoszeń').click({ timeout: 1500 }); }
      catch { /* przewinięcie do przycisku może samo uruchomić onEndReached */ }
    }
    await visible('27 przetargów').waitFor({ timeout: 20000 });
  }
  try {
    await page.goto(apiUrl); await search().waitFor({ timeout: 20000 });
    await search().fill('rumoszu');
    await visible('UI rumoszu roboty 0').waitFor({ timeout: 20000 });
    // Tytuł na karcie i count dopiero po potwierdzonym skanie; doklikaj pełną paginację.
    await finished();
    await calosc();
    await page.screenshot({ path: path.join(out, '01-rumoszu-najnowsze-mobile.png'), fullPage: true });
    await click('Filtry'); await click('Termin najbliżej'); await click('Filtry');
    await visible('UI rumoszu roboty 19').waitFor({ timeout: 20000 });
    await finished();
    await calosc();
    await page.screenshot({ path: path.join(out, '02-rumoszu-termin-mobile.png'), fullPage: true });
    // Opóźniona stara kontynuacja kończy się już PO zmianie pola, PRZED debounce.
    await click('Filtry'); await click('Najnowsze'); await click('Filtry');
    await visible('UI rumoszu roboty 0').waitFor({ timeout: 20000 });
    hold = true;
    await search().fill('kaloszy');
    await visible('Linia do produkcji kaloszy — test lokalny').waitFor({ timeout: 20000 });
    await page.screenshot({ path: path.join(out, '05-kaloszy-skan-w-tle.png'), fullPage: true });
    await click('Linia do produkcji kaloszy — test lokalny');
    await page.getByRole('link', { name: /Twoje przetargi, back/ }).filter({ visible: true }).waitFor({ timeout: 20000 });
    await page.getByRole('link', { name: /Twoje przetargi, back/ }).filter({ visible: true }).click();
    assert.equal(await search().inputValue(), 'kaloszy');
    assert.ok(pending.length > 0, 'test wymaga rzeczywiście wstrzymanej starej kontynuacji');
    await search().fill('QAZXSWEDC20261121');
    release();
    await visible('Brak wyników').waitFor({ timeout: 20000 });
    await finished();
    assert.equal(await search().inputValue(), 'QAZXSWEDC20261121');
    await page.screenshot({ path: path.join(out, '03-zmiana-po-szczegolach-pusty-wynik.png'), fullPage: true });
    for (const theme of ['jasny', 'ciemny']) {
      await page.evaluate((v) => localStorage.setItem('przetargai.motyw', v), theme);
      await page.reload(); await search().waitFor({ timeout: 20000 });
      await search().fill('rumoszu'); await visible('UI rumoszu roboty 0').waitFor({ timeout: 20000 });
      await click('Filtry');
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        for (const name of ['Wartość od', 'Wartość do']) {
          const field = page.getByRole('textbox', { name, exact: true }).filter({ visible: true });
          const box = await field.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${name} wychodzi poza ekran${width}`);
        }
        const title = visible(width < 360 ? 'Przetargi' : 'Twoje przetargi');
        const titleBox = await title.boundingBox();
        const savedBox = await page.getByRole('button', { name: 'Zapisane przetargi', exact: true }).filter({ visible: true }).boundingBox();
        assert.ok(titleBox && savedBox && titleBox.x + titleBox.width + 4 <= savedBox.x, 'tytuł nakłada się na Zapisane');
        await page.screenshot({ path: path.join(out, `04-panel-${theme}-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
    assert.deepEqual(errors, []);
    assert.ok(!requests.some((x) => x.url.startsWith('/tenders?') && x.status === 400), 'nie wysyłaj starych kursorów przy nowych filtrach');
    fs.writeFileSync(path.join(out, 'ui-result.json'), JSON.stringify({ ok: true, finishedAt: new Date().toISOString(), heldContinuation: true, expected: ids.length, errors, blockedBrowser, blockedServer, requests }, null, 2));
    console.log('UI_KATALOG_PASS');
  } catch (e) {
    await page.screenshot({ path: path.join(out, 'ui-failure.png'), fullPage: true });
    fs.writeFileSync(path.join(out, 'ui-result.json'), JSON.stringify({ ok: false, error: e.message, errors, requests }, null, 2));
    throw e;
  } finally { release(); await browser.close(); await new Promise((r) => server.close(r)); }
}
