import { test } from 'node:test';
import { przypomnieniaWstrzymane } from '../src/lib/statusPrzetargu.js';
import { utworzLicznikZadan } from '../src/lib/licznikZadan.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/screens/SavedScreen.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', loader: { '.js': 'jsx' }, jsxFactory: 'h',
  plugins: [{ name: 'boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => args.kind === 'entry-point' ? null : { path: args.path, external: true });
  } }],
});
function screen(overrides = {}) {
  const slots = []; let cursor = 0; let focused;
  const item = { id: 's1', tender: { id: 't1', title: 'Budowa', deadline: '2099-01-01' }, status: 'rozwazam', reminder_enabled: false };
  const api = { getSaved: async () => ({ saved: [item] }), ...overrides };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback: fn => fn,
  };
  const modules = {
    react: hooks,
    'react-native': Object.fromEntries(['FlatList','View','Text','Pressable','ActivityIndicator','Switch','RefreshControl'].map(n => [n,n])),
    '@react-navigation/native': { useFocusEffect: fn => { focused = fn; } },
    '../api/client': { api },
    '../lib/licznikZadan': { utworzLicznikZadan },
    '../context/ThemeContext': { useTheme: () => ({ kolory: {} }), useStyle: () => ({}), tworzStyle: f => f },
    '../context/JezykContext': { useJezyk: () => ({ t: pl => pl, jezyk: 'pl' }) },
    '../context/SavedContext': { useSaved: () => ({ toggle: overrides.toggle }) },
    '../context/AuthContext': { useAuth: () => ({ user: { id: 'u1' } }) },
    '../theme': { spacing: {}, radius: {} },
    '../lib/format': { formatDate: () => '' },
    '../lib/termin': { opisTerminu: () => ({}), opisBrakuPrzypomnienia: () => ({}) },
    '../lib/kryteriaOceny': { znacznikKryteriow: () => null },
    '../lib/zmianyDokumentow': { znacznikZmian: () => null, znacznikOtwarcia: () => null },
    '../components/MatchCard': { ScoreBadge: 'ScoreBadge' },
    '../components/StatusPicker': { __esModule: true, default: 'StatusPicker' },
    '../lib/statusPrzetargu': { STATUS_DOMYSLNY: 'rozwazam', przypomnieniaWstrzymane },
    '../lib/kolejnoscZapisanych': { kolejnoscZapisanych: x => x, podsumowanieZapisanych: () => null },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports,
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    require: name => modules[name] || {},
  });
  const render = () => { cursor = 0; return module.exports.default({ navigation: { navigate() {} } }); };
  render(); const blur = focused();
  return { render, item, focus: () => focused(), blur };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; }
}
const card = state => state.render().props.renderItem({ item: state.render().props.data[0] });
const errorVisible = state => !!find(state.render().props.ListHeaderComponent, n => n.props.accessibilityRole === 'alert');

test('odrzucone usunięcie zachowuje kartę i wyjaśnia błąd bez ponownego odczytu', async () => {
  const state = screen({ toggle: async () => { throw Error('offline'); } }); await tick();
  await find(card(state), n => n.props.accessibilityLabel === 'Usuń z zapisanych').props.onPress();
  assert.equal(state.render().props.data.length, 1);
  assert.equal(errorVisible(state), true);
});
test('odrzucony status przywraca poprzedni etap i wyjaśnia błąd', async () => {
  const state = screen({ setStatus: async () => { throw Error('offline'); } }); await tick();
  await find(card(state), n => n.type === 'StatusPicker').props.onChange('zlozona');
  assert.equal(state.render().props.data[0].status, 'rozwazam');
  assert.equal(errorVisible(state), true);
});
test('odrzucone przypomnienie przywraca ustawienie i odblokowuje ponowienie', async () => {
  const state = screen({ setReminder: async () => { throw Error('offline'); } }); await tick();
  await find(card(state), n => n.type === 'Switch').props.onValueChange(true);
  assert.equal(state.render().props.data[0].reminder_enabled, false);
  assert.equal(find(card(state), n => n.type === 'Switch').props.disabled, false);
  assert.equal(errorVisible(state), true);
});
test('oczekujący zapis blokuje drugą akcję tej samej karty; karta znika dopiero po sukcesie', async () => {
  let done; let writes = 0;
  const state = screen({ toggle: () => { writes++; return new Promise(resolve => { done = resolve; }); } }); await tick();
  const action = find(card(state), n => n.props.accessibilityLabel === 'Usuń z zapisanych').props.onPress;
  const pending = action(); await action();
  assert.equal(writes, 1); assert.equal(state.render().props.data.length, 1);
  assert.equal(find(card(state), n => n.type === 'StatusPicker').props.disabled, true);
  done(); await pending;
  assert.equal(state.render().props.data.length, 0);
  assert.equal(errorVisible(state), false);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const savedItem = id => ({ id: `saved-${id}`, tender: { id, title: id, deadline: '2099-01-01' }, status: 'rozwazam', reminder_enabled: false });

test('starsza odpowiedź nie zastępuje nowszej listy', async () => {
  const old = deferred(); const recent = deferred(); let reads = 0;
  const state = screen({ getSaved: () => (++reads === 1 ? old.promise : recent.promise) });
  state.focus(); recent.resolve({ saved: [savedItem('new')] }); await tick();
  old.resolve({ saved: [savedItem('old')] }); await tick();
  assert.equal(state.render().props.data[0].tender.id, 'new');
});
test('odczyt sprzed usunięcia nie przywraca usuniętej karty', async () => {
  const old = deferred(); let reads = 0;
  const state = screen({
    getSaved: () => ++reads === 1 ? Promise.resolve({ saved: [savedItem('t1')] }) : old.promise,
    toggle: async () => false,
  }); await tick();
  state.focus();
  await find(card(state), n => n.props.accessibilityLabel === 'Usuń z zapisanych').props.onPress();
  old.resolve({ saved: [savedItem('t1')] }); await tick();
  assert.equal(state.render().props.data.length, 0);
});
test('odpowiedź po opuszczeniu ekranu jest ignorowana', async () => {
  const read = deferred();
  const state = screen({ getSaved: () => read.promise });
  state.blur(); read.resolve({ saved: [savedItem('old-account')] }); await tick();
  assert.notEqual(state.render().type, 'FlatList');
});
test('błędna odpowiedź refresh zachowuje listę i ostrzega zamiast pokazać pusty stan', async () => {
  let reads = 0;
  const state = screen({ getSaved: async () => ++reads === 1 ? { saved: [savedItem('t1')] } : {} });
  await tick(); state.focus(); await tick();
  assert.equal(state.render().props.data.length, 1);
  assert.equal(errorVisible(state), true);
});
test('wejście w trakcie zapisu nie pobiera starego stanu z serwera', async () => {
  const write = deferred(); let reads = 0;
  const state = screen({
    getSaved: async () => { reads++; return { saved: [savedItem('t1')] }; },
    setStatus: () => write.promise,
  }); await tick();
  const pending = find(card(state), n => n.type === 'StatusPicker').props.onChange('zlozona');
  state.focus(); assert.equal(reads, 1);
  write.resolve(); await pending;
  assert.equal(state.render().props.data[0].status, 'zlozona');
});

test('po złożeniu przypomnienia są opisane jako wstrzymane, a preferencja pozostaje edytowalna', async () => {
  const state = screen({ getSaved: async () => ({ saved: [{ ...savedItem('t1'), status: 'zlozona', reminder_enabled: true }] }) });
  await tick();
  const tree = card(state);
  assert.ok(find(tree, n => n.type === 'Text' && n.children.includes('Przypomnienia wstrzymane')));
  const control = find(tree, n => n.type === 'Switch');
  assert.equal(control.props.value, true);
  assert.equal(control.props.disabled, false);
  assert.equal(control.props.accessibilityLabel, 'Przypomnienia po powrocie do przygotowania oferty');
});
