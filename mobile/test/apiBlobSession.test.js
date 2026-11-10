import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/api/client.js', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'local-api', setup(b) {
    b.onResolve({ filter: /^\.\.\/config$/ }, () => ({ path: 'config', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const API_URL="https://local.invalid";' }));
  } }],
});

function client() {
  const requests = [];
  const module = { exports: {} };
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports, setTimeout, clearTimeout, AbortController,
    fetch: (url, options) => new Promise((resolve) => requests.push({ url, options, resolve })),
  });
  return { ...module.exports, requests };
}

const unauthorized = () => ({
  ok: false, status: 401, json: async () => ({ error: { message: 'Sesja wygasła' } }),
});

for (const action of ['pobierzPismoWord', 'wypelnijZalacznikPlik']) {
  test(`${action}: opóźnione 401 nie wylogowuje nowej sesji`, async () => {
    const c = client(); let expired = 0;
    c.onSesjaWygasla(() => expired++);
    c.setAuthToken('old-test-session');
    const pending = c.api[action]({ nazwa: 'test', tresc: 'test' });
    assert.equal(c.requests[0].options.headers.Authorization, 'Bearer old-test-session');
    c.setAuthToken('new-test-session');
    c.requests[0].resolve(unauthorized());
    await assert.rejects(pending, (err) => err.status === 401);
    assert.equal(expired, 0);
  });
}

test('401 bieżącej sesji nadal uruchamia obsługę wylogowania', async () => {
  const c = client(); let expired = 0;
  c.onSesjaWygasla(() => expired++);
  c.setAuthToken('current-test-session');
  const pending = c.api.pobierzPismoWord({ nazwa: 'test', tresc: 'test' });
  c.requests[0].resolve(unauthorized());
  await assert.rejects(pending, (err) => err.status === 401);
  assert.equal(expired, 1);
});

test('401 po zakończeniu sesji nie uruchamia wylogowania drugi raz', async () => {
  const c = client(); let expired = 0;
  c.onSesjaWygasla(() => expired++);
  c.setAuthToken('old-test-session');
  const pending = c.api.pobierzPismoWord({ nazwa: 'test', tresc: 'test' });
  c.setAuthToken(null);
  c.requests[0].resolve(unauthorized());
  await assert.rejects(pending);
  assert.equal(expired, 0);
});

test('200 ze starej sesji nie udostępnia dokumentu nowemu kontu', async () => {
  const c = client(); let bodyRead = false;
  c.setAuthToken('old-test-session');
  const pending = c.api.pobierzPismoWord({ nazwa: 'test', tresc: 'test' });
  c.setAuthToken('new-test-session');
  c.requests[0].resolve({ ok: true, status: 200, blob: async () => { bodyRead = true; return 'private'; } });
  await assert.rejects(pending, /Konto zostało zmienione/);
  assert.equal(bodyRead, false);
});

test('zmiana konta podczas odczytu ciała pliku też blokuje udostępnienie', async () => {
  const c = client(); let finishBody;
  c.setAuthToken('old-test-session');
  const pending = c.api.pobierzPismoWord({ nazwa: 'test', tresc: 'test' });
  c.requests[0].resolve({ ok: true, status: 200, blob: () => new Promise((resolve) => { finishBody = resolve; }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishBody, 'function');
  c.setAuthToken('new-test-session');
  finishBody('private');
  await assert.rejects(pending, /Konto zostało zmienione/);
});

test('bieżąca sesja pobiera plik wraz z nazwą i typem', async () => {
  const c = client();
  c.setAuthToken('current-test-session');
  const pending = c.api.pobierzPismoWord({ nazwa: 'test', tresc: 'test' });
  c.requests[0].resolve({ ok: true, status: 200,
    headers: { get: (name) => name === 'x-plik' ? 'Pismo%20test.docx' : 'application/test' },
    blob: async () => 'document-body',
  });
  const result = await pending;
  assert.equal(result.blob, 'document-body');
  assert.equal(result.nazwaPliku, 'Pismo test.docx');
  assert.equal(result.typMime, 'application/test');
});
