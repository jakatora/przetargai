import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders } = await import('../src/db/repos.js');
const { runTenderFetch } = await import('../src/jobs/fetchTenders.js');

const ZNAK = `${process.pid}${Date.now()}`.slice(-7);

test('cykl dobowy: ogłoszenie z BZP zastępuje wcześniejszą kopię z platformazakupowa.pl (link poboczny + kopia poza pulą)', async () => {
  const { tender: kopia } = await tenders.upsert({ externalId: `pz:${ZNAK}1`, title: 'Remont dachu szkoły w Przeworsku', organization: 'Gmina Przeworsk', deadline: '2099-03-01T09:00:00.000Z', source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}1`, klucz_dedup: null });
  assert.ok(kopia.klucz_dedup, 'upsert liczy klucz tożsamości');
  const ogloszenieBzp = { externalId: `2099/BZP ${ZNAK}/01`, title: 'Remont dachu szkoły w Przeworsku', organization: 'Gmina Przeworsk', deadline: '2099-03-01T10:00:00.000Z', cpvMain: '45261000', source: 'bzp', url: 'https://ezamowienia.gov.pl/mp-client/x' };
  const wynik = await runTenderFetch({ zrodla: [{ nazwa: 'bzp', pobierz: async () => [ogloszenieBzp] }], alarmujAi: async () => {}, alarmujZrodla: async () => {} });
  assert.equal(wynik.zastapione_kopie_platformy, 1);
  const zBzp = await tenders.findById(`2099~BZP_${ZNAK}~01`);
  assert.ok(zBzp, 'wpis BZP zapisany');
  assert.deepEqual(zBzp.zrodla_alternatywne.map((z) => z.source), ['platformazakupowa']);
  assert.equal(zBzp.zrodla_alternatywne[0].url, kopia.url);
  const poZmianie = await tenders.findById(kopia.id);
  assert.equal(poZmianie.zastapiony_przez, zBzp.id);
  const pula = await tenders.openPool({ swiezaKopia: true });
  assert.ok(pula.some((t) => t.id === zBzp.id), 'wpis BZP w puli');
  assert.ok(!pula.some((t) => t.id === kopia.id), 'kopia platformy poza pulą');
});
