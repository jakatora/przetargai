import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatDeadline } from '../src/lib/format.js';

test('szczegóły: wskazane terminy BZP i MGDK, UTC → CET', () => {
  assert.equal(formatDeadline('2026-11-30T08:00:00.000Z'), '30 listopada 2026, 09:00 (czas polski)');
  assert.equal(formatDeadline('2026-11-24T13:00:00.000Z'), '24 listopada 2026, 14:00 (czas polski)');
});

test('czas letni i granice zmian CET/CEST', () => {
  const cases = [
    ['2026-07-20T07:15:00Z', '20 lipca 2026, 09:15'],
    ['2026-03-29T00:59:00Z', '29 marca 2026, 01:59'],
    ['2026-03-29T01:00:00Z', '29 marca 2026, 03:00'],
    ['2026-10-25T00:59:00Z', '25 października 2026, 02:59'],
    ['2026-10-25T01:00:00Z', '25 października 2026, 02:00'],
  ];
  for (const [iso, expected] of cases) assert.equal(formatDeadline(iso), `${expected} (czas polski)`);
});

test('sama data i znaczniki końca dnia nie wymyślają godziny', () => {
  for (const iso of ['2026-12-01', '1.12.2026', '2026-12-01T22:59:59.999Z']) {
    assert.equal(formatDeadline(iso), '1 grudnia 2026');
  }
  assert.equal(formatDeadline('2026-07-20T21:59:59.999Z'), '20 lipca 2026');
  assert.equal(formatDeadline('2026-12-01T22:59:59.000Z', 'czas polski', 'baza_konkurencyjnosci'), '1 grudnia 2026');
  assert.equal(formatDeadline('2026-12-01T22:59:59.000Z', 'czas polski', 'platformazakupowa'), '1 grudnia 2026, 23:59 (czas polski)');
});

test('znana północ to godzina; dzień ustalamy w Polsce, nie z prefiksu UTC', () => {
  assert.equal(formatDeadline('2026-11-29T23:00:00Z'), '30 listopada 2026, 00:00 (czas polski)');
  assert.equal(formatDeadline('2026-07-19T22:00:00Z'), '20 lipca 2026, 00:00 (czas polski)');
  assert.equal(formatDeadline('2026-11-30T00:00:00Z'), '30 listopada 2026, 01:00 (czas polski)');
  assert.equal(formatDeadline('2026-11-30T23:59:00+01:00'), '30 listopada 2026, 23:59 (czas polski)');
});

test('lokalny termin bez strefy jest polski, brak i błędna data nie udają terminu', () => {
  assert.equal(formatDeadline('2026-11-30 09:00'), '30 listopada 2026, 09:00 (czas polski)');
  for (const iso of [null, undefined, '', 'nieznany', '2026-02-30', '2026-11-30T25:00:00Z']) assert.equal(formatDeadline(iso), 'brak danych');
  assert.equal(formatDeadline('2026-11-30T08:00Z', 'Polish time'), '30 listopada 2026, 09:00 (Polish time)');
});

test('wynik jest identyczny w strefach urządzenia Warszawa, Los Angeles i Tokio', () => {
  const script = `import { formatDeadline } from ${JSON.stringify(new URL('../src/lib/format.js', import.meta.url).href)};
    console.log(JSON.stringify(['2026-11-29T23:00Z','2026-07-20T07:15Z','2026-12-01'].map(x => formatDeadline(x))));`;
  const outputs = ['Europe/Warsaw', 'America/Los_Angeles', 'Asia/Tokyo'].map((TZ) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.equal(outputs[0], outputs[1]); assert.equal(outputs[0], outputs[2]);
});
