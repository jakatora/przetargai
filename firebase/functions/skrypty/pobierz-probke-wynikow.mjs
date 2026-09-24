/*
 * Sonda: pobiera próbkę surowych ogłoszeń o WYNIKU z żywego BZP.
 *
 * Po co osobny skrypt, a nie fixture w repo: `htmlBody` jednego ogłoszenia waży
 * ~27 KB, więc próbka 200 ogłoszeń to ponad 4 MB — za dużo, żeby trzymać to w
 * git. Fixture'y kontraktowe (test/fixtures/wynik-*.json) to POJEDYNCZE ogłoszenia
 * wybrane z takiej próbki; próbkę odtwarza się tym skryptem.
 *
 * Użycie (z katalogu firebase/functions):
 *   node skrypty/pobierz-probke-wynikow.mjs 2026-09-22 > /dev/null
 * Wynik: probka-wyniki.json (gitignored) — wejście dla skrypty/pomiar-wynikow.mjs.
 *
 * Read-only, publiczne API BZP, bez klucza i bez logowania.
 */
import fs from 'node:fs';

const dzien = process.argv[2] ?? new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const rozmiar = Number(process.argv[3] ?? 200);

const url = new URL('https://ezamowienia.gov.pl/mo-board/api/v1/notice');
url.searchParams.set('NoticeType', 'TenderResultNotice');
url.searchParams.set('PublicationDateFrom', `${dzien}T00:00:00`);
url.searchParams.set('PublicationDateTo', `${dzien}T23:59:59`);
url.searchParams.set('PageSize', String(rozmiar));

const odpowiedz = await fetch(url);
if (!odpowiedz.ok) {
  console.error(`BZP odpowiedziało ${odpowiedz.status}`);
  process.exit(1);
}
const dane = await odpowiedz.json();
const lista = Array.isArray(dane) ? dane : (dane.content ?? dane.items ?? []);
fs.writeFileSync('probka-wyniki.json', JSON.stringify(lista, null, 1));
console.error(`zapisano probka-wyniki.json: ${lista.length} ogłoszeń z ${dzien}`);
