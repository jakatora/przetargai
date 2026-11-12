import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/hooks/useNoteDraft.js', import.meta.url))], bundle: true, write: false, format: 'cjs', external: ['react'] });
function draft(persist, initial = 'start') {
  const values = []; let cursor = 0;
  const react = {
    useState(initial) { const slot = cursor++; if (!(slot in values)) values[slot] = initial; return [values[slot], v => { values[slot] = v; }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in values)) values[slot] = { current: initial }; return values[slot]; },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: () => react });
  return () => { cursor = 0; return module.exports.useNoteDraft(initial, persist); };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('odpowiedź starego zapisu nie kasuje tekstu dopisanego podczas oczekiwania', async () => {
  const request = deferred(); const sent = [];
  const render = draft(text => { sent.push(text); return request.promise; });
  render().change('wersja pierwsza');
  const pending = render().save();
  render().change('wersja pierwsza i nowe informacje');
  assert.equal(render().busy, true);
  request.resolve({ notatka: 'wersja pierwsza' }); await pending;
  assert.deepEqual(sent, ['wersja pierwsza']);
  assert.equal(render().text, 'wersja pierwsza i nowe informacje');
  assert.equal(render().status, 'dirty');
});
test('potwierdzony zapis bieżącej wersji przyjmuje normalizację serwera', async () => {
  const render = draft(async () => ({ notatka: 'tekst' }), ' tekst ');
  await render().save();
  assert.equal(render().text, 'tekst'); assert.equal(render().status, 'saved');
});
test('podwójne kliknięcie nie wysyła równoległych zapisów', async () => {
  const request = deferred(); let writes = 0;
  const render = draft(() => { writes++; return request.promise; });
  const action = render().save;
  const pending = action(); await action(); assert.equal(writes, 1);
  request.resolve({ notatka: 'start' }); await pending;
  assert.equal(render().busy, false);
});
test('błąd nie usuwa szkicu, a ponowienie wysyła najnowszy tekst', async () => {
  let online = false; const sent = [];
  const render = draft(async text => { sent.push(text); if (!online) throw Error('offline'); return { notatka: text }; });
  render().change('ważne informacje');
  await assert.rejects(render().save(), /offline/);
  assert.equal(render().text, 'ważne informacje'); assert.equal(render().status, 'error');
  assert.equal(render().busy, false);
  render().change('ważne informacje i uzupełnienie'); online = true;
  await render().save();
  assert.equal(sent[1], 'ważne informacje i uzupełnienie'); assert.equal(render().status, 'saved');
});
test('błędna odpowiedź serwera nie czyści pola i nie potwierdza zapisu', async () => {
  const render = draft(async () => ({}), 'nie kasuj');
  await assert.rejects(render().save());
  assert.equal(render().text, 'nie kasuj'); assert.equal(render().status, 'error');
});
