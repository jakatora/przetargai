import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as podprogowe from '../src/lib/podprogowe.js';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/screens/PodprogoweUstawieniaScreen.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', loader: { '.js': 'jsx' }, jsxFactory: 'h',
  plugins: [{ name: 'boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.kind === 'entry-point' ? null : { path: a.path, external: true });
  } }],
});
function screen(read) {
  const slots = []; let cursor = 0, focus;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback: fn => fn,
  };
  const modules = {
    react: hooks,
    'react-native': Object.fromEntries(['View','Text','Pressable','ActivityIndicator'].map(n => [n,n])),
    '@react-navigation/native': { useFocusEffect: fn => { focus = fn; } },
    '../context/ThemeContext': { useTheme: () => ({ kolory: {} }), useStyle: () => ({}), tworzStyle: f => f },
    '../api/client': { api: { podprogowePreferencje: read } },
    '../lib/podprogowe': podprogowe,
    '../theme': { spacing: {}, radius: {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, React: { Fragment: 'Fragment' },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    require: name => modules[name] || { __esModule: true, default: name.split('/').at(-1) },
  });
  const render = () => { cursor = 0; return module.exports.default(); };
  render(); const blur = focus();
  return { render, focus: () => focus(), blur };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) { const r = find(c, predicate); if (r) return r; } return; }
  if (predicate(node)) return node;
  for (const child of node.children || []) { const result = find(child, predicate); if (result) return result; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const hasText = (s, text) => !!find(s.render(), n => n.children.includes(text));
const empty = s => hasText(s, 'Nie masz jeszcze żadnego obszaru pod radarem.');
const alert = s => find(s.render(), n => n.props.accessibilityRole === 'alert');
const response = name => ({ preferencje: [{ id: name, branza: name, prog_netto: 170000 }] });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

test('first failed read does not pretend the account has no areas; retry reads only', async () => {
  let fail = true;
  const s = screen(async () => { if (fail) throw Error('offline'); return response('Budowa'); }); await tick();
  assert.ok(alert(s)); assert.equal(empty(s), false);
  assert.equal(find(s.render(), n => n.type === 'ActivityIndicator'), undefined);
  fail = false;
  await find(s.render(), n => n.props.title === 'Ponów wczytanie obszarów').props.onPress();
  assert.equal(hasText(s, 'Budowa'), true); assert.equal(alert(s), undefined);
});
test('failed refresh preserves last known list with an explicit stale warning', async () => {
  let fail = false;
  const s = screen(async () => { if (fail) throw Error('offline'); return response('Mazowsze'); }); await tick();
  fail = true; s.focus(); await tick();
  assert.ok(alert(s)); assert.equal(hasText(s, 'Mazowsze'), true); assert.equal(empty(s), false);
});
test('late older response cannot overwrite the newer area list', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const s = screen(() => (++calls === 1 ? first.promise : second.promise));
  s.focus(); second.resolve(response('Nowa')); await tick();
  first.resolve(response('Stara')); await tick();
  assert.equal(hasText(s, 'Nowa'), true); assert.equal(hasText(s, 'Stara'), false);
});
test('late error from an abandoned read cannot spoil a new successful read', async () => {
  const old = deferred(); let calls = 0;
  const s = screen(() => (++calls === 1 ? old.promise : Promise.resolve(response('Nowa'))));
  s.blur(); s.focus(); await tick(); old.reject(Error('offline')); await tick();
  assert.equal(alert(s), undefined); assert.equal(hasText(s, 'Nowa'), true);
});
test('invalid response is an error while a confirmed empty array is a real empty state', async () => {
  const invalid = screen(async () => ({})); await tick();
  assert.ok(alert(invalid)); assert.equal(empty(invalid), false);
  const valid = screen(async () => ({ preferencje: [] })); await tick();
  assert.equal(alert(valid), undefined); assert.equal(empty(valid), true);
});
