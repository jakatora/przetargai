/*
 * Sonda dymna: czy adapter TED naprawde mapuje ZYWE rozstrzygniecia.
 *
 * Testy kontraktowe stoja na trzech utrwalonych ogloszeniach — to sprawdza,
 * czy regula „zipuj tylko tablice wyrownane do liczby czesci" nie wycina
 * przypadkiem calych danych na szerokiej probce.
 *
 * Uzycie (z katalogu firebase/functions):
 *   node skrypty/sonda-ted-ingest.mjs
 *
 * Pomiar 2026-09-24 (okno od 2026-09-18, 2 strony po 250):
 *   wynikow zmapowanych 500 / odrzuconych 0, czesci 1929
 *   z cena 922 | uniewaznione 143 (7,4 %) | ze zwyciezca 895 | z liczba ofert 1070
 *   z wielkoscia firmy 326  <- reszta odcieta przez straz wyrownania tablic (to jest CEL)
 *   z rodzajem w slowniku BZP 1918/1929  <- bez tego TED i BZP wpadlyby do roznych kubelkow
 *   wojewodztwo TERYT 500/500 | procedure-identifier 500/500
 *   modyfikacji umow 39, wszystkie ze wskazaniem ogloszenia pierwotnego
 *
 * Read-only, publiczne API TED, bez klucza i bez platnego AI.
 */
process.env.NODE_ENV='test';
process.env.JWT_SECRET='smoke-test-sekret-dlugi';
const { pobierzWynikiTed, pobierzModyfikacjeTed } = await import('../src/services/tedWyniki.js');
const licznik = { zapytania: 0, surowe: 0, odrzucone: 0 };
const wyniki = await pobierzWynikiTed({ odDnia: '2026-09-18', maksStron: 2, licznik });
console.log('wynikow zmapowanych:', wyniki.length, '| zapytania:', licznik.zapytania, '| surowe:', licznik.surowe, '| odrzucone:', licznik.odrzucone);
const czesci = wyniki.flatMap(w => w.czesci);
console.log('czesci:', czesci.length);
console.log('  z cena:', czesci.filter(c=>c.cenaWybrana!==null).length);
console.log('  uniewaznione:', czesci.filter(c=>c.uniewaznione).length);
console.log('  ze zwyciezca:', czesci.filter(c=>c.zwyciezca).length);
console.log('  z liczba ofert:', czesci.filter(c=>c.liczbaOfert!==null).length);
console.log('  z wielkoscia firmy:', czesci.filter(c=>c.wielkoscWykonawcy).length);
console.log('  z rodzajem BZP:', czesci.filter(c=>c.rodzaj).length);
console.log('ogloszen z wojewodztwem TERYT:', wyniki.filter(w=>w.wojewodztwo).length, '/', wyniki.length);
console.log('ogloszen z tenderId:', wyniki.filter(w=>w.tenderId).length, '/', wyniki.length);
const mod = await pobierzModyfikacjeTed({ odDnia: '2026-09-18', maksStron: 1 });
console.log('modyfikacji umow:', mod.length, '| z ogloszeniem pierwotnym:', mod.filter(m=>m.ogloszeniePierwotne).length);
