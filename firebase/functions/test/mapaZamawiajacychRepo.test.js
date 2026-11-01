import { test } from 'node:test';
import assert from 'node:assert/strict';

/* Mapy „zamawiający → województwo” w `meta` (2026-11-01): zapis jako „klucz\twoj”, odczyt z powrotem do Map. */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { mapaZamawiajacych } = await import('../src/db/repos.js');

test('zapis i odczyt map: klucze ze spacjami, myślnikiem i tabulatorem w środku zostają całe', async () => {
  const mapy = {
    poNazwie: new Map([['komenda wojewódzka policji w łodzi', '10'], ['akademia górniczo-hutnicza im stanisława staszica w krakowie', '12']]),
    poMiescie: new Map([['września', '30']]),
    poMiejscowniku: new Map([['nowym sączu', '12']]),
  };
  await mapaZamawiajacych.zapisz(mapy, '2026-11-01T03:40:00.000Z');
  const odczyt = await mapaZamawiajacych.wczytaj({ swiezoscMs: 0 });
  assert.equal(odczyt.zbudowano_o, '2026-11-01T03:40:00.000Z');
  assert.deepEqual([...odczyt.poNazwie], [...mapy.poNazwie]);
  assert.equal(odczyt.poMiejscowniku.get('nowym sączu'), '12');
  assert.equal(odczyt.poMiescie.get('września'), '30');
});
