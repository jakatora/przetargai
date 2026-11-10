import { test } from 'node:test';
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
  const item = { id: 's1', tender: { id: 't1', title: 'Budowa', deadline: '2099-01-01' }, status: 'nowy', reminder_enabled: false };
  const api = { getSaved: async () => ({ saved: [item] }), ...overrides };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback: fn => fn,
  };
  const modules = {
    react: hooks,
    'react-native': Object.fromEntries(['FlatList','View','Text','Pressable','ActivityIndicator','Switch'].map(n => [n,n])),
    '@react-navigation/native': { useFocusEffect: fn => { focused = fn; } },
    '../api/client': { api },
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
    '../lib/statusPrzetargu': { STATUS_DOMYSLNY: 'nowy' },
    '../lib/kolejnoscZapisanych': { kolejnoscZapisanych: x => x },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports,
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    require: name => modules[name] || {},
  });
  const render = () => { cursor = 0; return module.exports.default({ navigation: { navigate() {} } }); };
  render(); focused();
  return { render, item };
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
  await find(card(state), n => n.type === 'StatusPicker').props.onChange('oferta_zlozona');
  assert.equal(state.render().props.data[0].status, 'nowy');
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
