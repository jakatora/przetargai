import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/screens/AccountScreen.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', loader: { '.js': 'jsx' }, jsxFactory: 'h',
  plugins: [{ name: 'boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.kind === 'entry-point' ? null : { path: a.path, external: true });
  } }],
});
function screen(save) {
  const slots = []; let cursor = 0; const cleanups = [];
  let user = { id: 'u1', premium_tier: 'free', powiadomienia_pracownik_email: true };
  const updates = [], writes = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; cleanups.push(fn()); } },
  };
  const modules = {
    react: hooks,
    'react-native': Object.fromEntries(['View','Text','Pressable','Switch','Linking'].map(n => [n,n])),
    'expo-constants': { default: { expoConfig: {} }, __esModule: true },
    '../context/AuthContext': { useAuth: () => ({ user, setUser: u => { updates.push(u); user = u; } }) },
    '../context/ThemeContext': { useTheme: () => ({}), useStyle: () => ({}), tworzStyle: f => f },
    '../context/JezykContext': { useJezyk: () => ({ t: pl => pl, jezyki: [], etykiety: {} }) },
    '../api/client': { api: { ustawMaileSelekcji: value => { writes.push(value); return save(value); } } },
    '../lib/motyw': { PREFERENCJE: [], ETYKIETY_PREFERENCJI: {} },
    '../lib/selekcja': { opisProby: () => null },
    '../theme': { spacing: {}, radius: {}, typografia: {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, __DEV__: false,
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    require: name => modules[name] || { __esModule: true, default: name.split('/').at(-1) },
  });
  return { render() { cursor = 0; return module.exports.default({ navigation: {} }); }, writes, updates,
    unmount() { cleanups.forEach(fn => fn?.()); } };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) { const result = find(child, predicate); if (result) return result; }
    return;
  }
  if (predicate(node)) return node;
  for (const child of [...(node.children || []), node.props?.prawo]) { const result = find(child, predicate); if (result) return result; }
}
const toggle = s => find(s.render(), n => n.type === 'Switch');
const alert = s => find(s.render(), n => n.props.accessibilityRole === 'alert');
const response = value => ({ user: { id: 'u1', premium_tier: 'free', powiadomienia_pracownik_email: value } });

test('failed opt-out stays visible and retries the same explicit choice', async () => {
  let fail = true;
  const s = screen(async value => { if (fail) throw Error('offline'); return response(value); });
  await toggle(s).props.onValueChange(false);
  assert.ok(alert(s)); assert.equal(toggle(s).props.value, true); assert.equal(s.updates.length, 0);
  fail = false;
  await find(s.render(), n => n.props.title === 'Ponów zapis').props.onPress();
  assert.deepEqual(s.writes, [false, false]);
  assert.equal(toggle(s).props.value, false); assert.equal(alert(s), undefined);
});
test('concurrent taps cannot send conflicting preferences', async () => {
  let done;
  const s = screen(value => new Promise(resolve => { done = () => resolve(response(value)); }));
  const action = toggle(s).props.onValueChange;
  const pending = action(false); await action(true);
  assert.deepEqual(s.writes, [false]); assert.equal(toggle(s).props.disabled, true);
  done(); await pending; assert.equal(toggle(s).props.disabled, false);
});
test('row and switch use the same confirmed preference for opt-out and opt-in', async () => {
  const s = screen(async value => response(value));
  const row = () => find(s.render(), n => n.props.tytul === 'Maile o nowych przetargach');
  await row().props.onPress();
  assert.equal(toggle(s).props.value, false);
  await row().props.onPress();
  assert.equal(toggle(s).props.value, true);
  assert.deepEqual(s.writes, [false, true]);
});
test('late response after leaving cannot update another session', async () => {
  let done;
  const s = screen(value => new Promise(resolve => { done = () => resolve(response(value)); }));
  const pending = toggle(s).props.onValueChange(false); s.unmount(); done(); await pending;
  assert.equal(s.updates.length, 0);
});
for (const result of [undefined, { user: { id: 'other', powiadomienia_pracownik_email: false } }, response(true)]) {
  test(`unconfirmed or foreign profile is not accepted: ${JSON.stringify(result)}`, async () => {
    const s = screen(async () => result);
    await toggle(s).props.onValueChange(false);
    assert.ok(alert(s)); assert.equal(s.updates.length, 0);
  });
}
