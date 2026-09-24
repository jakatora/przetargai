/*
 * Sonda pomiarowa etapu 6: weryfikuje reguły parsera wyników na żywej próbce BZP.
 *
 * Wejście: probka-wyniki.json (skrypty/pobierz-probke-wynikow.mjs).
 * Użycie:  node skrypty/pomiar-wynikow.mjs
 *
 * Pomiary z 2026-09-24 na 200 ogłoszeniach z 2026-09-22 — liczby, które
 * zadecydowały o kształcie src/lib/wynikiParser.js:
 *
 *   blokow z 5.1.)                                545
 *   czesci wg procedureResult                     545   (200/200 ogłoszeń zgodnych)
 *   blokow z niepustym procedureResult[nr-1]      545   (indeks = NUMER części)
 *   wykonawca HTML vs contractors[nr-1] zgodne    387   (rozne: 0)
 *   uniewazniona czesc z wykonawca                  0
 *   czesci: umowa 395 | uniewaznienie 150            (27,5 % unieważnień)
 *   cena 6.4 stary regex 365 | nowy 404              (+39 = 9,6 % odzyskane)
 *
 * 🚨 Gdyby któraś z tych liczb się rozjechała, parser trzeba PONOWNIE zmierzyć,
 * a nie „poprawić na oko" — te reguły wyszły z pomiaru, nie z dokumentacji
 * (dokumentacji BZP dla htmlBody nie ma).
 */
import fs from 'node:fs';
import { parsujWynik } from '../src/lib/wynikiParser.js';

const lista = JSON.parse(fs.readFileSync('probka-wyniki.json', 'utf8'));
const txt = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ENC = { '&amp;': '&', '&quot;': '"', '&#34;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
const dek = (s) => String(s).replace(/&(?:amp|quot|apos|lt|gt|nbsp|#34|#39);/g, (m) => ENC[m] ?? m).replace(/\s+/g, ' ').trim();

let blokow = 0, zgodneOgl = 0, ctrDlugoscOk = 0;
let umowa = 0, uniew = 0, uniewZWykonawca = 0;
let zgodneWyk = 0, rozneWyk = 0;
let cenaStary = 0, cenaNowy = 0;
let w455 = 0, szacunekOgl = 0;
const STARY = /(\d[\d\s ]*,\d{1,2})\s*(?:PLN|zł)/i;

for (const surowe of lista) {
  const wynik = parsujWynik(surowe);
  const prRaw = String(surowe.procedureResult || '').split(';');
  const niepuste = prRaw.filter(Boolean);
  const ctr = surowe.contractors ?? [];
  if (ctr.length === prRaw.length) ctrDlugoscOk++;
  if (wynik.czesci.length === niepuste.length) zgodneOgl++;
  blokow += wynik.czesci.length;
  if (wynik.wartoscSzacowanaNetto !== null) szacunekOgl++;

  const blokiHtml = txt(surowe.htmlBody).split(/SEKCJA V(?!I)/).slice(1).filter((b) => b.includes('5.1.)'));
  wynik.czesci.forEach((cz, i) => {
    if (cz.uniewaznione) { uniew++; if (ctr[cz.numer - 1]?.contractorName) uniewZWykonawca++; }
    else if (cz.rozstrzygniecie === 'umowa') umowa++;
    if (cz.wartoscSzacowanaNetto !== null) w455++;
    const nazwaCtr = ctr[cz.numer - 1]?.contractorName;
    if (cz.zwyciezca?.nazwa && nazwaCtr) {
      if (cz.zwyciezca.nazwa === dek(nazwaCtr)) zgodneWyk++;
      else { rozneWyk++; if (rozneWyk <= 5) console.log('ROZJAZD', surowe.bzpNumber, 'cz', cz.numer, '|', cz.zwyciezca.nazwa, '|', dek(nazwaCtr)); }
    }
    const s64 = /6\.4\.\)[^:]{0,90}:\s*([^]{0,60}?)(?=\s*\d+\.\d|\s*SEKCJA|$)/.exec(blokiHtml[i] ?? '');
    if (s64) { if (STARY.test(s64[1])) cenaStary++; if (cz.cenaWybrana !== null) cenaNowy++; }
  });
}

console.log('ogloszen', lista.length, '| zgodnych z procedureResult:', zgodneOgl, '| ctr.length === pr.length:', ctrDlugoscOk);
console.log('czesci', blokow, '| umowa', umowa, '| uniewaznienie', uniew, `(${Math.round((100 * uniew) / blokow)} %)`);
console.log('uniewazniona czesc z wykonawca w contractors:', uniewZWykonawca, '(musi byc 0)');
console.log('zwyciezca HTML vs contractors[nr-1]: zgodne', zgodneWyk, '| rozne', rozneWyk, '(musi byc 0)');
console.log('cena 6.4: stary regex', cenaStary, '| nowy', cenaNowy, '| odzyskane', cenaNowy - cenaStary);
console.log('wartosc szacowana: ogloszen z 4.3', szacunekOgl, '| czesci z 4.5.5', w455);
