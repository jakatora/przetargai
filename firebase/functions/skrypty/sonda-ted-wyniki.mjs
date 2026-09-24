/*
 * Sonda: jak naprawde wygladaja tablice w ogloszeniu o WYNIKU z TED.
 *
 * TED oddaje kazde pole jako osobna tablice i NIE gwarantuje, ze dwie tablice
 * maja te sama dlugosc. Zipowanie po indeksie miedzy roznymi polami przypisze
 * firmie cudzy rozmiar albo cudza cene. Sonda mierzy, ktore pola sa wyrownane
 * do liczby czesci (`result-lot-identifier`), a ktore nie.
 *
 * Read-only, publiczne API TED, bez klucza. Uzycie:
 *   node skrypty/sonda-ted-wyniki.mjs [ile]
 */
const POLA = [
  'publication-number', 'notice-type', 'procedure-identifier', 'title-proc', 'buyer-name',
  'classification-cpv', 'publication-date', 'buyer-country-sub',
  'result-lot-identifier', 'winner-name', 'winner-size', 'winner-decision-date',
  'tender-value', 'tender-value-cur', 'tender-value-lowest', 'tender-value-highest',
  'estimated-value-lot', 'estimated-value-cur-lot', 'result-value-notice',
  'received-submissions-type-code', 'received-submissions-type-val',
  'non-award-justification', 'contract-conclusion-date',
];

const ile = Number(process.argv[2] ?? 200);
const odpowiedz = await fetch('https://api.ted.europa.eu/v3/notices/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '(place-of-performance IN (POL)) AND (publication-date >= 20260901) AND (form-type = result) SORT BY publication-date DESC',
    fields: POLA,
    page: 1,
    limit: ile,
  }),
});
if (!odpowiedz.ok) {
  console.error('TED HTTP', odpowiedz.status, (await odpowiedz.text()).slice(0, 400));
  process.exit(1);
}
const dane = await odpowiedz.json();
const lista = dane.notices ?? [];
console.log('total w oknie:', dane.totalNoticeCount, '| pobrano:', lista.length);

const tab = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const wielojez = (v) => tab(v?.pol ?? (v && typeof v === 'object' ? Object.values(v)[0] : v));

const POROWNAJ = ['winner-size', 'winner-decision-date', 'tender-value', 'estimated-value-lot',
  'contract-conclusion-date', 'non-award-justification', 'tender-value-lowest', 'tender-value-highest'];
const licznik = Object.fromEntries(POROWNAJ.map((p) => [p, { rowne: 0, inne: 0, brak: 0 }]));
let winnerRowne = 0, winnerInne = 0, winnerBrak = 0;
let kodyPodzielne = 0, kodyNie = 0, kodyBrak = 0;
let parySpojne = 0, paryNie = 0;
let nutsOk = 0, nutsBrak = 0;
const przyklady = [];

for (const n of lista) {
  const czesci = tab(n['result-lot-identifier']).length;
  if (!czesci) continue;
  for (const p of POROWNAJ) {
    const d = tab(n[p]).length;
    if (d === 0) licznik[p].brak += 1;
    else if (d === czesci) licznik[p].rowne += 1;
    else { licznik[p].inne += 1; if (przyklady.length < 6) przyklady.push(`${n['publication-number']} ${p}=${d} vs czesci=${czesci}`); }
  }
  const w = wielojez(n['winner-name']).length;
  if (w === 0) winnerBrak += 1; else if (w === czesci) winnerRowne += 1; else winnerInne += 1;

  const kody = tab(n['received-submissions-type-code']).length;
  const wart = tab(n['received-submissions-type-val']).length;
  if (!kody) kodyBrak += 1;
  else if (kody % czesci === 0) kodyPodzielne += 1; else kodyNie += 1;
  if (kody === wart) parySpojne += 1; else paryNie += 1;

  const nuts = tab(n['buyer-country-sub'])[0];
  if (/^PL\d[\dA-Z]/.test(String(nuts ?? ''))) nutsOk += 1; else nutsBrak += 1;
}

console.log('--- dlugosc tablicy vs liczba czesci (result-lot-identifier)');
for (const [p, s] of Object.entries(licznik)) console.log(`  ${p}: rowne ${s.rowne} | INNE ${s.inne} | brak ${s.brak}`);
console.log(`  winner-name(pol): rowne ${winnerRowne} | INNE ${winnerInne} | brak ${winnerBrak}`);
console.log('--- oferty: received-submissions-type-*');
console.log(`  liczba kodow podzielna przez liczbe czesci: ${kodyPodzielne} | NIE: ${kodyNie} | brak: ${kodyBrak}`);
console.log(`  code.length === val.length: ${parySpojne} | NIE: ${paryNie}`);
console.log('--- region');
console.log(`  buyer-country-sub w postaci NUTS: ${nutsOk} | brak/inne: ${nutsBrak}`);
if (przyklady.length) console.log('--- przyklady rozjazdu:', przyklady.join(' ; '));
