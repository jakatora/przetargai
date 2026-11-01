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

test('duża mapa w kilku częściach wraca cała; pamięć po zapisie zna datę budowy (bez drugiej przebudowy)', async () => {
  const poNazwie = new Map(Array.from({ length: 500 }, (_, i) => [`urząd gminy numer ${i} w miejscowości długiej`, String(2 + (i % 16) * 2).padStart(2, '0')]));
  const mapy = { poNazwie, poMiescie: new Map([['łódź', '10']]), poMiejscowniku: new Map(), poNazwieNip: new Map([['gmina łańcut', '7941804230']]) };
  await mapaZamawiajacych.zapisz(mapy, '2026-11-02T03:40:00.000Z', { maksBajtow: 4000 });
  assert.equal((await mapaZamawiajacych.wczytaj()).zbudowano_o, '2026-11-02T03:40:00.000Z', 'z pamięci, z datą');
  const odczyt = await mapaZamawiajacych.wczytaj({ swiezoscMs: 0 });
  assert.equal(odczyt.poNazwie.size, 500);
  assert.deepEqual([...odczyt.poNazwie], [...poNazwie]);
  assert.equal(odczyt.poNazwieNip.get('gmina łańcut'), '7941804230');
  assert.equal(odczyt.poMiejscowniku.size, 0);
});
