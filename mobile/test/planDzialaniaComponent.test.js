import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/PlanDzialania.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', loader: { '.js': 'jsx' }, jsxFactory: 'h',
  plugins: [{ name: 'boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.kind === 'entry-point' ? null : { path: a.path, external: true });
  } }],
});
function screen() {
  const slots = [], pending = [], effects = []; let cursor = 0, result;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i];
      if (!old || deps.some((v, j) => v !== old.deps[j])) {
        effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const request = (type, id) => new Promise((resolve, reject) => pending.push({ type, id, resolve, reject }));
  const modules = {
    react: hooks, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable' },
    '../api/client': { api: { getMatch: id => request('match', id), powiazanieSwz: id => request('swz', id) } },
    '../context/ThemeContext': { useStyle: () => ({}), tworzStyle: f => f },
    '../context/JezykContext': { useJezyk: () => ({ t: pl => pl }) },
    '../theme': { spacing: {}, radius: {} }, '../lib/format': { formatDate: x => x },
    '../lib/kanal': { POKAZUJ_ZAKUP: false },
    '../lib/planDzialania': { zbudujPlanDzialania: args => { result = args; return []; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports,
    h: (type, props, ...children) => ({ type, props, children }), require: n => modules[n] });
  return {
    render(id, plan = 'standard', flush = true) {
      cursor = 0; module.exports.default({ match: { id, tender: { id: `t-${id}` } }, plan, navigation: {} });
      if (flush) while (effects.length) effects.shift()();
      return result;
    },
    pending,
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function loadedA(s) {
  s.render('A');
  s.pending.find(r => r.type === 'match').resolve({ match: { termin_pytan: '2030-01-02' } });
  s.pending.find(r => r.type === 'swz').resolve({ powiazanie: { id: 1 } });
  await flush();
  assert.equal(s.render('A').swzPowiazana, true);
}
test('new tender never renders the previous deadline or SWZ even before effects run', async () => {
  const s = screen(); await loadedA(s);
  const b = s.render('B', 'standard', false);
  assert.equal(b.terminPytan, null); assert.equal(b.swzPowiazana, false);
});
test('failed new tender reads cannot retain metadata from the old tender', async () => {
  const s = screen(); await loadedA(s); s.render('B');
  s.pending.filter(r => r.id === 'B' || r.id === 't-B').forEach(r => r.reject(Error('offline')));
  await flush(); const b = s.render('B');
  assert.equal(b.terminPytan, null); assert.equal(b.swzPowiazana, false);
});
test('late old response cannot overwrite the new tender metadata', async () => {
  const s = screen(); s.render('A'); s.render('B');
  s.pending.filter(r => r.type === 'match').forEach(r => r.resolve({ match: { termin_pytan: r.id === 'A' ? 'OLD' : 'NEW' } }));
  s.pending.filter(r => r.type === 'swz').forEach(r => r.resolve({ powiazanie: r.id === 't-A' }));
  await flush(); const b = s.render('B');
  assert.equal(b.terminPytan, 'NEW'); assert.equal(b.swzPowiazana, false);
});
