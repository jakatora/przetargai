import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Wykonujemy rzeczywisty SavedProvider, podmieniając wyłącznie React i API.
// Pominięty efekt startowy odtwarza stan po nieudanym pierwszym odczycie.
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/context/SavedContext.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  loader: { '.js': 'jsx' }, jsxFactory: 'h',
  plugins: [{ name: 'boundaries', setup(b) {
    b.onResolve({ filter: /^(react|\.\.\/api\/client|\.\/AuthContext)$/ },
      ({ path }) => ({ path, external: true }));
  } }],
});

function provider(api, { start = false } = {}) {
  const states = [];
  const effects = [];
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useCallback: (fn) => fn, useContext: () => null, useEffect: (effect) => effects.push(effect),
    useMemo: (fn) => fn(), useRef: (value) => ({ current: value }),
    useState(initial) {
      const slot = states.length;
      states.push(typeof initial === 'function' ? initial() : initial);
      return [states[slot], (value) => {
        states[slot] = typeof value === 'function' ? value(states[slot]) : value;
      }];
    },
  };
  const module = { exports: {} };
  const context = {
    module, exports: module.exports,
    h: (type, props) => typeof type === 'function' ? type(props) : props.value,
    require(name) {
      if (name === 'react') return react;
      if (name === '../api/client') return { api };
      if (name === './AuthContext') return { useAuth: () => ({ user: { id: 'u1' } }) };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(bundled.outputFiles[0].text, context);
  const value = module.exports.SavedProvider({ children: null });
  const cleanups = start ? effects.map((effect) => effect()) : [];
  return { value, states, unmount: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

test('błąd odczytu przed przełączeniem: żadnej mutacji ani optymistycznej gwiazdki', async () => {
  let writes = 0;
  const { value, states } = provider({
    getSavedIds: async () => { throw new Error('offline'); },
    saveTender: async () => { writes++; }, unsaveTender: async () => { writes++; },
  });
  await assert.rejects(value.toggle('t1'), /offline/);
  assert.equal(writes, 0);
  assert.equal(states[0].size, 0);
  assert.equal(states[1], false);
});

test('pusta albo błędna odpowiedź nie jest pustą listą zapisanych', async () => {
  for (const response of [null, {}, { ids: null }, { ids: 't1' }]) {
    let writes = 0;
    const { value } = provider({
      getSavedIds: async () => response,
      saveTender: async () => { writes++; }, unsaveTender: async () => { writes++; },
    });
    await assert.rejects(value.toggle('t1'));
    assert.equal(writes, 0);
  }
});

test('odczyt serwera wybiera właściwą operację, także po nieudanym starcie', async () => {
  for (const saved of [true, false]) {
    const calls = [];
    const { value, states } = provider({
      getSavedIds: async () => ({ ids: saved ? ['t1'] : [] }),
      saveTender: async (id) => calls.push(['save', id]),
      unsaveTender: async (id) => calls.push(['unsave', id]),
    });
    assert.equal(await value.toggle('t1'), !saved);
    assert.deepEqual(calls, [[saved ? 'unsave' : 'save', 't1']]);
    assert.equal(states[0].has('t1'), !saved);
  }
});

test('odrzucona mutacja przywraca poprzednią gwiazdkę i przekazuje błąd do UI', async () => {
  const { value, states } = provider({
    getSavedIds: async () => ({ ids: ['t1'] }),
    unsaveTender: async () => { throw new Error('rejected'); },
  });
  await assert.rejects(value.toggle('t1'), /rejected/);
  assert.equal(states[0].has('t1'), true);
});

test('jawny zamiar zapisu lub usunięcia nie odwraca operacji po odczycie serwera', async () => {
  for (const desired of [true, false]) {
    let writes = 0;
    const { value, states } = provider({
      getSavedIds: async () => ({ ids: desired ? ['t1'] : [] }),
      saveTender: async () => { writes++; }, unsaveTender: async () => { writes++; },
    });
    assert.equal(await value.toggle('t1', desired), desired);
    assert.equal(writes, 0, 'stan już zgodny z zamiarem: bez przeciwnej operacji');
    assert.equal(states[0].has('t1'), desired);
  }
});

test('odświeżenie odróżnia znany pusty zbiór od błędu i nie wykonuje zapisu', async () => {
  let ok = false;
  const { value, states } = provider({ getSavedIds: async () => ok ? { ids: [] } : null });
  assert.equal(value.ready, false);
  assert.equal(await value.refresh(), false);
  assert.equal(states[1], false);
  ok = true;
  assert.equal(await value.refresh(), true);
  assert.equal(states[1], true);
  assert.equal(states[0].size, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('odczyt rozpoczęty przed zapisem nie cofa nowszej decyzji', async () => {
  const read = deferred();
  const calls = [];
  const { value, states } = provider({
    getSavedIds: () => { calls.push('read'); return read.promise; },
    saveTender: async () => { calls.push('save'); },
  });
  const refresh = value.refresh();
  const save = value.toggle('t1', true);
  await tick();
  assert.deepEqual(calls, ['read']);
  read.resolve({ ids: [] });
  await Promise.all([refresh, save]);
  assert.deepEqual(calls, ['read', 'save']);
  assert.equal(states[0].has('t1'), true);
});

test('dwa ekrany: zapis i usunięcie kończą się w kolejności decyzji użytkownika', async () => {
  const write = deferred(); const calls = [];
  const { value, states } = provider({
    getSavedIds: async () => ({ ids: [] }),
    saveTender: () => { calls.push('save'); return write.promise; },
    unsaveTender: async () => { calls.push('unsave'); },
  });
  const save = value.toggle('t1', true);
  const remove = value.toggle('t1', false);
  await tick();
  assert.deepEqual(calls, ['save']);
  assert.equal(states[0].has('t1'), true);
  write.resolve();
  await Promise.all([save, remove]);
  assert.deepEqual(calls, ['save', 'unsave']);
  assert.equal(states[0].has('t1'), false);
});

test('błąd pierwszego zapisu nie blokuje następnego przetargu', async () => {
  const calls = [];
  const { value, states } = provider({
    getSavedIds: async () => ({ ids: [] }),
    saveTender: async (id) => { calls.push(id); if (id === 't1') throw new Error('offline'); },
  });
  const first = assert.rejects(value.toggle('t1', true), /offline/);
  const second = value.toggle('t2', true);
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['t1', 't2']);
  assert.equal(states[0].has('t1'), false);
  assert.equal(states[0].has('t2'), true);
});

test('zmiana konta anuluje mutację oczekującą na poprzedni odczyt', async () => {
  const read = deferred(); let writes = 0;
  const { value, unmount } = provider({
    getSavedIds: () => read.promise,
    saveTender: async () => { writes++; },
  }, { start: true });
  const save = value.toggle('t1', true);
  const rejected = assert.rejects(save, /Konto zostało zmienione/);
  await tick();
  unmount();
  read.resolve({ ids: [] });
  await rejected;
  assert.equal(writes, 0);
});
