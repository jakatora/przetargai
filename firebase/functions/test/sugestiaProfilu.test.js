import { test } from 'node:test';
import assert from 'node:assert/strict';
import { czasNaSugestie, opisDlaSugestii, noweZSugestii, opisSugestii } from '../src/lib/sugestiaProfilu.js';

const TERAZ = '2026-11-10T12:00:00.000Z';

test('czasNaSugestie: konto z profilem, starsze niż 2 dni, bez sugestii z ostatnich 14 dni', () => {
  const u = { keywords: ['dach'], created_at: '2026-11-01T00:00:00.000Z' };
  assert.equal(czasNaSugestie(u, TERAZ), true);
  assert.equal(czasNaSugestie({ ...u, created_at: '2026-11-09T00:00:00.000Z' }, TERAZ), false, 'świeże konto');
  assert.equal(czasNaSugestie({ ...u, keywords: [] }, TERAZ), false, 'pusty profil — nie ma od czego zacząć');
  assert.equal(czasNaSugestie({ ...u, profil_sugestia: { o: '2026-11-01T00:00:00.000Z' } }, TERAZ), false, 'sugestia sprzed 9 dni');
  assert.equal(czasNaSugestie({ ...u, profil_sugestia: { o: '2026-10-20T00:00:00.000Z' } }, TERAZ), true, 'sprzed 21 dni');
});

test('opis dla AI z tego, co klient podał; nowe = tylko czego konto nie ma', () => {
  assert.equal(opisDlaSugestii({ keywords: ['Remont posadzka żywica'], company_name: 'Posadzki Kowalski' }),
    'Słowa: Remont posadzka żywica. Firma: Posadzki Kowalski');
  assert.deepEqual(noweZSugestii({ keywords: ['Posadzka żywiczna'], cpv_codes: ['45430000-0'] },
    { keywords: ['posadzka zywiczna', 'posadzki przemysłowe'], cpv: ['45430000', '45450000'] }),
  { keywords: ['posadzki przemysłowe'], cpv: ['45450000'] });
  assert.match(opisSugestii({ keywords: [], cpv: ['90910000'], w_puli: 2 }).pl, /Dopisać kod CPV: 90910000 \(.+\)\? Wstępnie pasuje do tego dziś 2 przetargi/);
});
