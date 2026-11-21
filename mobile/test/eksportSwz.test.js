import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/eksportSwz.js', import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' });
function environment(platform, available = true) {
  const writes = [], shares = [], links = [], blobs = [];
  class File {
    constructor(dir, name) { this.uri = dir + name; }
    create() { writes.push({ create: this.uri }); }
    write(value) { writes.push({ uri: this.uri, text: value }); }
  }
  const modules = {
    'react-native': { Platform: { OS: platform } },
    'expo-file-system': { File, Paths: { cache: 'file:///private-cache/' } },
    'expo-sharing': { isAvailableAsync: async () => available, shareAsync: async (uri, options) => shares.push({ uri, options }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: (name) => modules[name], Blob,
    URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:local'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() { links.push({ href: this.href, filename: this.download }); }, remove() {} }), body: { appendChild() {} } },
    setTimeout: (fn) => fn(),
  });
  return { save: module.exports.zapiszEksportSwz, writes, shares, links, blobs };
}
const report = { nazwa: 'PrzetargAI-SWZ-own-proceeding.json', typ_mime: 'application/json', tresc: '{"wersje":[{"numer":1}]}' };

test('eksport web zapisuje plik JSON o niezmienionej treści, bez schowka i wysyłki', async () => {
  const e = environment('web'); await e.save(report);
  assert.equal(e.links[0].filename, report.nazwa);
  assert.equal(await e.blobs[0].text(), report.tresc);
  assert.equal(e.shares.length, 0); assert.equal(e.writes.length, 0);
});
test('eksport natywny przekazuje lokalny plik, nie zdalny URL ani treść w intencji', async () => {
  const e = environment('android'); await e.save(report);
  assert.equal(e.writes[1].text, report.tresc);
  assert.equal(e.shares[0].uri, 'file:///private-cache/' + report.nazwa);
  assert.equal(e.shares[0].options.mimeType, 'application/json');
  assert.equal(e.blobs.length, 0);
});
test('brak udostępniania nie tworzy pliku; podmiana ścieżki lub MIME jest odrzucona', async () => {
  const e = environment('ios', false);
  await assert.rejects(() => e.save(report), /niedostępne/);
  assert.equal(e.writes.length, 0);
  const f = environment('web');
  await assert.rejects(() => f.save({ ...report, nazwa: '../secret.json' }), /poprawnego eksportu/);
  await assert.rejects(() => f.save({ ...report, typ_mime: 'text/html' }), /poprawnego eksportu/);
  assert.equal(f.links.length, 0);
});
