import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PoprzetargowaKontrola,
  STATUSY_KONTROLI,
  STATUS_KONTROLI_DOMYSLNY,
  KATEGORIE_DOKUMENTOW,
  zapiszKontrole,
  wczytajKontrole,
  utworzKontrolePoPrzegranej,
  dolaczPozostalyCzas,
  oznaczWniosekWyslany,
  zapiszDokumenty,
  zapiszAnalize,
} from '../src/lib/poprzetargowaKontrola.js';

/*
 * Model poprzetargowej kontroli oferty zwycięzcy (podzadanie 1/13). Tu tylko
 * definicja + zapis/odczyt — bez logiki wyliczania terminu KIO czy analizy.
 * Magazyn wstrzykujemy jako atrapa (Map), bo prawdziwy `storage.js` ciągnie
 * react-native i nie ładuje się w node:test.
 */

function atrapaMagazynu() {
  const m = new Map();
  return {
    m,
    async getItem(k) { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, v); },
  };
}

test('konstruktor: pełne dane zachowane, status z listy', () => {
  const k = new PoprzetargowaKontrola({
    postepowanieId: 'BZP-123',
    daneZamawiajacego: 'Gmina Kowalewo, ul. Rynek 1',
    dataOtwarciaOfert: '2026-07-10T09:00:00Z',
    dataOgloszeniaWyniku: '2026-07-20T12:00:00Z',
    terminOdwolaniaKio: '2026-07-30T23:59:59Z',
    status: 'wniosek_wyslany',
  });
  assert.equal(k.postepowanieId, 'BZP-123');
  assert.equal(k.daneZamawiajacego, 'Gmina Kowalewo, ul. Rynek 1');
  assert.equal(k.dataOtwarciaOfert, '2026-07-10T09:00:00Z');
  assert.equal(k.dataOgloszeniaWyniku, '2026-07-20T12:00:00Z');
  assert.equal(k.terminOdwolaniaKio, '2026-07-30T23:59:59Z');
  assert.equal(k.status, 'wniosek_wyslany');
});

test('konstruktor: braki → null, status domyślny „nowa"', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X' });
  assert.equal(k.daneZamawiajacego, null);
  assert.equal(k.dataOtwarciaOfert, null);
  assert.equal(k.dataOgloszeniaWyniku, null);
  assert.equal(k.terminOdwolaniaKio, null);
  assert.equal(k.status, STATUS_KONTROLI_DOMYSLNY);
  assert.equal(k.status, 'nowa');
});

test('konstruktor: nieznany status → fallback na domyślny', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X', status: 'kosmiczny' });
  assert.equal(k.status, 'nowa');
});

test('konstruktor: numeryczne id postępowania sprowadzone do stringa', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 42 });
  assert.equal(k.postepowanieId, '42');
});

test('enum ma dokładnie 4 etapy w ustalonej kolejności', () => {
  assert.deepEqual(
    STATUSY_KONTROLI.map((s) => s.wartosc),
    ['nowa', 'wniosek_wyslany', 'dokumenty_otrzymane', 'analiza_gotowa'],
  );
});

test('toJSON/fromJSON: pełny round-trip zachowuje pola', () => {
  const oryginal = new PoprzetargowaKontrola({
    postepowanieId: 'TED-9',
    daneZamawiajacego: 'Zamawiający Sp. z o.o.',
    dataOtwarciaOfert: '2026-06-01T08:00:00Z',
    dataOgloszeniaWyniku: '2026-06-15T08:00:00Z',
    terminOdwolaniaKio: '2026-06-25T08:00:00Z',
    status: 'analiza_gotowa',
  });
  const odtworzona = PoprzetargowaKontrola.fromJSON(JSON.parse(JSON.stringify(oryginal)));
  assert.ok(odtworzona instanceof PoprzetargowaKontrola);
  assert.deepEqual(odtworzona.toJSON(), oryginal.toJSON());
});

test('zapisz + wczytaj: model wraca z magazynu', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, {
    postepowanieId: 'BZP-777',
    daneZamawiajacego: 'Powiat Testowy',
    status: 'dokumenty_otrzymane',
  });
  const wczytana = await wczytajKontrole(magazyn, 'BZP-777');
  assert.ok(wczytana instanceof PoprzetargowaKontrola);
  assert.equal(wczytana.postepowanieId, 'BZP-777');
  assert.equal(wczytana.daneZamawiajacego, 'Powiat Testowy');
  assert.equal(wczytana.status, 'dokumenty_otrzymane');
});

test('zapisz: klucz w magazynie jest namespaceowany per postępowanie', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'ABC' });
  assert.ok(magazyn.m.has('kontrola:ABC'));
});

test('zapisz akceptuje instancję i zwraca znormalizowany model', async () => {
  const magazyn = atrapaMagazynu();
  const zwrocona = await zapiszKontrole(magazyn, new PoprzetargowaKontrola({ postepowanieId: 'INST' }));
  assert.ok(zwrocona instanceof PoprzetargowaKontrola);
  assert.equal(zwrocona.status, 'nowa');
});

test('zapisz bez postepowanieId → rzuca (nie ma jak powiązać)', async () => {
  const magazyn = atrapaMagazynu();
  await assert.rejects(() => zapiszKontrole(magazyn, { daneZamawiajacego: 'X' }), /postepowanieId/);
});

test('wczytaj: brak wpisu → null', async () => {
  const magazyn = atrapaMagazynu();
  assert.equal(await wczytajKontrole(magazyn, 'NIE-MA'), null);
});

test('wczytaj: brak id → null (bez odpytywania magazynu)', async () => {
  const magazyn = atrapaMagazynu();
  assert.equal(await wczytajKontrole(magazyn, null), null);
});

test('wczytaj: uszkodzony JSON → null (traktujemy jak brak)', async () => {
  const magazyn = atrapaMagazynu();
  await magazyn.setItem('kontrola:BAD', '{nie-json');
  assert.equal(await wczytajKontrole(magazyn, 'BAD'), null);
});

/* --- Podzadanie 2/13: wykrycie przegranej → założenie kontroli --- */

// Kształt jak tender w aplikacji (MatchDetailScreen: tender.id / organization / deadline).
function tenderPrzegrany() {
  return {
    id: 'BZP-2026/1',
    organization: 'Gmina Kowalewo',
    deadline: '2026-07-10T09:00:00Z',
    title: 'Dostawa sprzętu',
  };
}

test('przegrana: zakłada kontrolę „nowa" z przepisanymi datami', async () => {
  const magazyn = atrapaMagazynu();
  const k = await utworzKontrolePoPrzegranej(magazyn, tenderPrzegrany());
  assert.ok(k instanceof PoprzetargowaKontrola);
  assert.equal(k.postepowanieId, 'BZP-2026/1');
  assert.equal(k.status, 'nowa');
  assert.equal(k.daneZamawiajacego, 'Gmina Kowalewo');
  // deadline (termin składania) przepisany na datę otwarcia ofert.
  assert.equal(k.dataOtwarciaOfert, '2026-07-10T09:00:00Z');
  assert.equal(k.dataOgloszeniaWyniku, null);
});

test('przegrana: kontrola trafia do magazynu pod kluczem postępowania', async () => {
  const magazyn = atrapaMagazynu();
  await utworzKontrolePoPrzegranej(magazyn, tenderPrzegrany());
  assert.ok(magazyn.m.has('kontrola:BZP-2026/1'));
  const wczytana = await wczytajKontrole(magazyn, 'BZP-2026/1');
  assert.equal(wczytana.status, 'nowa');
  assert.equal(wczytana.dataOtwarciaOfert, '2026-07-10T09:00:00Z');
});

test('przegrana: idempotentna — nie nadpisuje istniejącej kontroli', async () => {
  const magazyn = atrapaMagazynu();
  // Analiza już ruszyła — status inny niż „nowa".
  await zapiszKontrole(magazyn, {
    postepowanieId: 'BZP-2026/1',
    status: 'analiza_gotowa',
    daneZamawiajacego: 'Coś już wpisanego',
  });
  const k = await utworzKontrolePoPrzegranej(magazyn, tenderPrzegrany());
  assert.equal(k.status, 'analiza_gotowa'); // zachowany postęp
  assert.equal(k.daneZamawiajacego, 'Coś już wpisanego');
});

test('przegrana: obsługuje obiekt z zagnieżdżonym tender (match)', async () => {
  const magazyn = atrapaMagazynu();
  const match = { tender: tenderPrzegrany() };
  const k = await utworzKontrolePoPrzegranej(magazyn, match);
  assert.equal(k.postepowanieId, 'BZP-2026/1');
  assert.equal(k.daneZamawiajacego, 'Gmina Kowalewo');
  assert.equal(k.dataOtwarciaOfert, '2026-07-10T09:00:00Z');
});

test('przegrana: numeryczne id postępowania sprowadzone do stringa', async () => {
  const magazyn = atrapaMagazynu();
  const k = await utworzKontrolePoPrzegranej(magazyn, { id: 42, organization: 'X' });
  assert.equal(k.postepowanieId, '42');
  assert.ok(magazyn.m.has('kontrola:42'));
});

test('przegrana: brak id → null i nic nie zapisano', async () => {
  const magazyn = atrapaMagazynu();
  const k = await utworzKontrolePoPrzegranej(magazyn, { organization: 'Bez id' });
  assert.equal(k, null);
  assert.equal(magazyn.m.size, 0);
});

test('przegrana: brak postępowania (undefined) → null, bez wyjątku', async () => {
  const magazyn = atrapaMagazynu();
  assert.equal(await utworzKontrolePoPrzegranej(magazyn, undefined), null);
});

test('przegrana: dataOgloszeniaWyniku przepisana, gdy postępowanie ją niesie', async () => {
  const magazyn = atrapaMagazynu();
  const k = await utworzKontrolePoPrzegranej(magazyn, {
    ...tenderPrzegrany(),
    dataOgloszeniaWyniku: '2026-07-20T12:00:00Z',
  });
  assert.equal(k.dataOgloszeniaWyniku, '2026-07-20T12:00:00Z');
});

// --- Pole pomocnicze: odliczanie do terminu KIO (podzadanie 4/13) ---

test('dolaczPozostalyCzas: dolicza pole pomocnicze z terminOdwolaniaKio', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 1, terminOdwolaniaKio: '2026-08-10' });
  dolaczPozostalyCzas(k, Date.UTC(2026, 7, 5, 0, 0, 0)); // 6 dni przed
  assert.equal(k.pozostalyCzas.poTerminie, false);
  assert.equal(k.pozostalyCzas.dni, 6);
});

test('dolaczPozostalyCzas: pole POMOCNICZE nie trafia do toJSON (countdown się starzeje)', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 1, terminOdwolaniaKio: '2026-08-10' });
  dolaczPozostalyCzas(k, Date.UTC(2026, 7, 5));
  assert.equal('pozostalyCzas' in k.toJSON(), false);
});

test('dolaczPozostalyCzas: brak wyliczonego terminu → pozostalyCzas null', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 1 }); // terminOdwolaniaKio == null
  dolaczPozostalyCzas(k, Date.UTC(2026, 7, 5));
  assert.equal(k.pozostalyCzas, null);
});

test('dolaczPozostalyCzas: null przepuszczamy bez wyjątku', () => {
  assert.equal(dolaczPozostalyCzas(null), null);
});

/* --- Podzadanie 6/13: przycisk „Wygeneruj wniosek" → status wniosek_wyslany --- */

test('oznaczWniosekWyslany: „nowa" → „wniosek_wyslany" i zapis w magazynie', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-9', status: 'nowa' });
  const k = await oznaczWniosekWyslany(magazyn, 'BZP-9');
  assert.ok(k instanceof PoprzetargowaKontrola);
  assert.equal(k.status, 'wniosek_wyslany');
  // Utrwalone, nie tylko na zwróconym obiekcie.
  const wczytana = await wczytajKontrole(magazyn, 'BZP-9');
  assert.equal(wczytana.status, 'wniosek_wyslany');
});

test('oznaczWniosekWyslany: brak kontroli w magazynie → tworzy ją ze statusem wniosek_wyslany', async () => {
  // Hook zakładający kontrolę po przegranej jest best-effort — mógł nie zdążyć.
  const magazyn = atrapaMagazynu();
  const k = await oznaczWniosekWyslany(magazyn, 'BZP-NOWY');
  assert.ok(k instanceof PoprzetargowaKontrola);
  assert.equal(k.postepowanieId, 'BZP-NOWY');
  assert.equal(k.status, 'wniosek_wyslany');
  assert.ok(magazyn.m.has('kontrola:BZP-NOWY'));
});

test('oznaczWniosekWyslany: nie cofa dalszego etapu (dokumenty_otrzymane zostaje)', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-DALEJ', status: 'dokumenty_otrzymane' });
  const k = await oznaczWniosekWyslany(magazyn, 'BZP-DALEJ');
  assert.equal(k.status, 'dokumenty_otrzymane'); // brak regresji postępu
});

test('oznaczWniosekWyslany: numeryczne id sprowadzone do stringa', async () => {
  const magazyn = atrapaMagazynu();
  const k = await oznaczWniosekWyslany(magazyn, 7);
  assert.equal(k.postepowanieId, '7');
  assert.ok(magazyn.m.has('kontrola:7'));
});

test('oznaczWniosekWyslany: brak id → null i nic nie zapisano', async () => {
  const magazyn = atrapaMagazynu();
  const k = await oznaczWniosekWyslany(magazyn, null);
  assert.equal(k, null);
  assert.equal(magazyn.m.size, 0);
});

/* --- Podzadanie 7/13: upload dokumentów → status dokumenty_otrzymane --- */

// Kształt referencji pliku z expo-document-picker (SDK 54): asset {uri,name,size,mimeType}.
function plikOferty() {
  return { uri: 'file:///cache/oferta.pdf', name: 'oferta-zwyciezcy.pdf', size: 12345, mimeType: 'application/pdf' };
}
function plikProtokolu() {
  return { uri: 'file:///cache/protokol.pdf', name: 'protokol.pdf', size: 6789, mimeType: 'application/pdf' };
}

test('model: domyślnie dokumenty to puste kategorie oferta+protokół', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X' });
  assert.deepEqual(k.dokumenty, { ofertaZwyciezcy: [], protokol: [] });
  assert.deepEqual(k.toJSON().dokumenty, { ofertaZwyciezcy: [], protokol: [] });
});

test('KATEGORIE_DOKUMENTOW: dwie kategorie w ustalonej kolejności', () => {
  assert.deepEqual(KATEGORIE_DOKUMENTOW, ['ofertaZwyciezcy', 'protokol']);
});

test('zapiszDokumenty: zapisuje ofertę i protokół, status → dokumenty_otrzymane', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-7', status: 'wniosek_wyslany' });
  const k = await zapiszDokumenty(magazyn, 'BZP-7', {
    ofertaZwyciezcy: [plikOferty()],
    protokol: [plikProtokolu()],
  });
  assert.ok(k instanceof PoprzetargowaKontrola);
  assert.equal(k.status, 'dokumenty_otrzymane');
  assert.equal(k.dokumenty.ofertaZwyciezcy.length, 1);
  assert.equal(k.dokumenty.protokol.length, 1);
  // Utrwalone w magazynie, nie tylko na zwróconym obiekcie.
  const wczytana = await wczytajKontrole(magazyn, 'BZP-7');
  assert.equal(wczytana.status, 'dokumenty_otrzymane');
  assert.equal(wczytana.dokumenty.ofertaZwyciezcy[0].uri, 'file:///cache/oferta.pdf');
});

test('zapiszDokumenty: normalizuje referencję z pickera na {nazwa,uri,rozmiar,typMime}', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszDokumenty(magazyn, 'BZP-N', { ofertaZwyciezcy: [plikOferty()] });
  assert.deepEqual(k.dokumenty.ofertaZwyciezcy[0], {
    nazwa: 'oferta-zwyciezcy.pdf',
    uri: 'file:///cache/oferta.pdf',
    rozmiar: 12345,
    typMime: 'application/pdf',
  });
});

test('zapiszDokumenty: pomija wpisy bez uri (referencja bezużyteczna)', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszDokumenty(magazyn, 'BZP-U', {
    protokol: [{ name: 'bez-uri.pdf' }, plikProtokolu()],
  });
  assert.equal(k.dokumenty.protokol.length, 1);
  assert.equal(k.dokumenty.protokol[0].uri, 'file:///cache/protokol.pdf');
});

test('zapiszDokumenty: load-or-create — brak kontroli → zakłada ją z dokumentami', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszDokumenty(magazyn, 'BZP-NOWY', { protokol: [plikProtokolu()] });
  assert.ok(k instanceof PoprzetargowaKontrola);
  assert.equal(k.postepowanieId, 'BZP-NOWY');
  assert.equal(k.status, 'dokumenty_otrzymane');
  assert.ok(magazyn.m.has('kontrola:BZP-NOWY'));
});

test('zapiszDokumenty: kategorie per-kategoria — dogranie protokołu nie kasuje oferty', async () => {
  const magazyn = atrapaMagazynu();
  // Oferta jawna od otwarcia, załączniki dochodzą do 3 dni później → dwie tury.
  await zapiszDokumenty(magazyn, 'BZP-2TURY', { ofertaZwyciezcy: [plikOferty()] });
  const k = await zapiszDokumenty(magazyn, 'BZP-2TURY', { protokol: [plikProtokolu()] });
  assert.equal(k.dokumenty.ofertaZwyciezcy.length, 1); // oferta z pierwszej tury zostaje
  assert.equal(k.dokumenty.protokol.length, 1);
});

test('zapiszDokumenty: ponowny upload tej samej kategorii nadpisuje (poprawka błędnego pliku)', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszDokumenty(magazyn, 'BZP-FIX', { ofertaZwyciezcy: [{ uri: 'file:///zly.pdf', name: 'zly.pdf' }] });
  const k = await zapiszDokumenty(magazyn, 'BZP-FIX', { ofertaZwyciezcy: [plikOferty()] });
  assert.equal(k.dokumenty.ofertaZwyciezcy.length, 1);
  assert.equal(k.dokumenty.ofertaZwyciezcy[0].uri, 'file:///cache/oferta.pdf');
});

test('zapiszDokumenty: puste wywołanie bez żadnych plików nie udaje otrzymania dokumentów', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-PUSTE', status: 'wniosek_wyslany' });
  const k = await zapiszDokumenty(magazyn, 'BZP-PUSTE', {});
  assert.equal(k.status, 'wniosek_wyslany'); // status się nie przesuwa
});

test('zapiszDokumenty: monotonicznie — nie cofa z analiza_gotowa', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-DALEJ', status: 'analiza_gotowa' });
  const k = await zapiszDokumenty(magazyn, 'BZP-DALEJ', { protokol: [plikProtokolu()] });
  assert.equal(k.status, 'analiza_gotowa'); // brak regresji, ale plik dopisany
  assert.equal(k.dokumenty.protokol.length, 1);
});

test('zapiszDokumenty: ignoruje nieznane kategorie', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszDokumenty(magazyn, 'BZP-KAT', {
    kosmiczne: [plikOferty()],
    protokol: [plikProtokolu()],
  });
  assert.equal(k.dokumenty.protokol.length, 1);
  assert.equal('kosmiczne' in k.dokumenty, false);
});

test('zapiszDokumenty: numeryczne id sprowadzone do stringa, klucz namespaceowany', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszDokumenty(magazyn, 7, { protokol: [plikProtokolu()] });
  assert.equal(k.postepowanieId, '7');
  assert.ok(magazyn.m.has('kontrola:7'));
});

test('zapiszDokumenty: brak id → null i nic nie zapisano', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszDokumenty(magazyn, null, { protokol: [plikProtokolu()] });
  assert.equal(k, null);
  assert.equal(magazyn.m.size, 0);
});

test('zapiszDokumenty: brak argumentu dokumenty → nie wywraca się', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-BEZ', status: 'nowa' });
  const k = await zapiszDokumenty(magazyn, 'BZP-BEZ');
  assert.equal(k.status, 'nowa'); // brak plików → status bez zmian
  assert.deepEqual(k.dokumenty, { ofertaZwyciezcy: [], protokol: [] });
});

test('zapiszDokumenty: rozmiar spoza liczby → null (metadane best-effort)', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszDokumenty(magazyn, 'BZP-META', {
    protokol: [{ uri: 'file:///p.pdf', name: 'p.pdf', size: 'duzo' }],
  });
  assert.equal(k.dokumenty.protokol[0].rozmiar, null);
});

test('zapiszDokumenty: dokumenty przetrwają round-trip przez magazyn (JSON)', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszDokumenty(magazyn, 'BZP-RT', {
    ofertaZwyciezcy: [plikOferty()],
    protokol: [plikProtokolu()],
  });
  const wczytana = await wczytajKontrole(magazyn, 'BZP-RT');
  assert.equal(wczytana.dokumenty.ofertaZwyciezcy[0].nazwa, 'oferta-zwyciezcy.pdf');
  assert.equal(wczytana.dokumenty.protokol[0].typMime, 'application/pdf');
});

/* --- Podzadanie 11/13: zapis wyniku analizy → status analiza_gotowa --- */

// Wynik w kształcie z ocen_szanse_i_rekomendacja (podzadanie 11/13).
function wynikAnalizy() {
  return {
    zarzuty: [{ rodzaj: 'zly_format_podpisu', tytul: 'Zły format podpisu', opis_zarzutu: '…', sila: 'mocna' }],
    liczbaZarzutow: 1,
    ocenaSzans: 'wysoka',
    rekomendacja: { wartosc: 'walcz', etykieta: 'jest podstawa, walcz' },
    kompletDokumentow: true,
    uzasadnienie: 'Wykryto 1 przesłankę…',
  };
}

test('model: domyślnie analiza to null (jeszcze nieprzeprowadzona)', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X' });
  assert.equal(k.analiza, null);
  assert.equal(k.toJSON().analiza, null);
});

test('model: analiza (obiekt) zachowana i przez round-trip JSON', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X', analiza: wynikAnalizy() });
  const odtworzona = PoprzetargowaKontrola.fromJSON(JSON.parse(JSON.stringify(k)));
  assert.deepEqual(odtworzona.analiza, wynikAnalizy());
});

test('model: analiza nie-obiekt (np. string) → null (nie zgadujemy)', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X', analiza: 'gotowe' });
  assert.equal(k.analiza, null);
});

test('zapiszAnalize: zapisuje wynik i przesuwa status → analiza_gotowa', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-11', status: 'dokumenty_otrzymane' });
  const k = await zapiszAnalize(magazyn, 'BZP-11', wynikAnalizy());
  assert.ok(k instanceof PoprzetargowaKontrola);
  assert.equal(k.status, 'analiza_gotowa');
  assert.equal(k.analiza.rekomendacja.wartosc, 'walcz');
  // Utrwalone w magazynie, nie tylko na zwróconym obiekcie.
  const wczytana = await wczytajKontrole(magazyn, 'BZP-11');
  assert.equal(wczytana.status, 'analiza_gotowa');
  assert.equal(wczytana.analiza.ocenaSzans, 'wysoka');
});

test('zapiszAnalize: load-or-create — brak kontroli → zakłada ją z analizą', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszAnalize(magazyn, 'BZP-NOWY', wynikAnalizy());
  assert.ok(k instanceof PoprzetargowaKontrola);
  assert.equal(k.postepowanieId, 'BZP-NOWY');
  assert.equal(k.status, 'analiza_gotowa');
  assert.ok(magazyn.m.has('kontrola:BZP-NOWY'));
});

test('zapiszAnalize: bez wyniku (null) → nie udaje gotowej analizy (status bez zmian)', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'BZP-PUSTE', status: 'dokumenty_otrzymane' });
  const k = await zapiszAnalize(magazyn, 'BZP-PUSTE', null);
  assert.equal(k.status, 'dokumenty_otrzymane'); // status się nie przesuwa
  assert.equal(k.analiza, null);
});

test('zapiszAnalize: ponowna analiza aktualizuje wynik, status zostaje analiza_gotowa', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszAnalize(magazyn, 'BZP-RE', wynikAnalizy());
  const drugi = { ...wynikAnalizy(), ocenaSzans: 'niska', rekomendacja: { wartosc: 'odpusc', etykieta: 'odpuść' } };
  const k = await zapiszAnalize(magazyn, 'BZP-RE', drugi);
  assert.equal(k.status, 'analiza_gotowa');
  assert.equal(k.analiza.ocenaSzans, 'niska'); // najnowszy wynik
  assert.equal(k.analiza.rekomendacja.wartosc, 'odpusc');
});

test('zapiszAnalize: numeryczne id sprowadzone do stringa, klucz namespaceowany', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszAnalize(magazyn, 11, wynikAnalizy());
  assert.equal(k.postepowanieId, '11');
  assert.ok(magazyn.m.has('kontrola:11'));
});

test('zapiszAnalize: brak id → null i nic nie zapisano', async () => {
  const magazyn = atrapaMagazynu();
  const k = await zapiszAnalize(magazyn, null, wynikAnalizy());
  assert.equal(k, null);
  assert.equal(magazyn.m.size, 0);
});

test('zapiszAnalize: analiza przetrwa round-trip przez magazyn (JSON)', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszAnalize(magazyn, 'BZP-RT2', wynikAnalizy());
  const wczytana = await wczytajKontrole(magazyn, 'BZP-RT2');
  assert.equal(wczytana.analiza.liczbaZarzutow, 1);
  assert.equal(wczytana.analiza.zarzuty[0].sila, 'mocna');
});
