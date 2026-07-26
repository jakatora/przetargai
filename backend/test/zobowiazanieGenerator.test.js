import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * GENERATOR DOKUMENTU „zobowiązanie podmiotu udostępniającego zasoby" (art. 118
 * ust. 3 i 4 Pzp) — podzadanie 7/12 ulepszenia „Pożycz doświadczenie: kreator
 * polegania na zasobach podmiotu trzeciego".
 *
 * Testy pilnują tego, co decyduje o wartości dokumentu: że gotowy tekst zawiera
 * WSZYSTKIE elementy wymagane orzecznictwem (cztery punkty art. 118 ust. 4 +
 * klauzula realnego udziału z art. 118 ust. 2 + przypomnienie o złożeniu wraz z
 * ofertą i podpisie podmiotu), że przy brakującym polu wymaganym NIE udaje
 * gotowego do podpisu (widoczny marker + kompletne=false), oraz że generator
 * czerpie z JEDNEGO źródła prawdy — modelu 4/12 — a nie z własnej listy pól.
 */

const {
  generujZobowiazanie,
  zobowiazanieDoPliku,
} = await import('../src/lib/zobowiazanieGenerator.js');

const {
  POLA_ZOBOWIAZANIA,
} = await import('../src/lib/zobowiazaniePodmiotu.js');

/** Kompletne zobowiązanie (jak z wypełnionego szablonu) — punkt odniesienia. */
function zobowiazaniePelne() {
  return {
    dane_podmiotu: {
      nazwa: 'Budrem Sp. z o.o.',
      identyfikator: 'NIP 5252525252',
      adres: 'ul. Budowlana 1, 00-001 Warszawa',
      reprezentant: 'Jan Kowalski, prezes zarządu',
    },
    zakres_doswiadczenia:
      'Doświadczenie w budowie oczyszczalni ścieków o przepustowości min. 5000 m³/d '
      + '(jedna zakończona realizacja o wartości 6,2 mln zł).',
    sposob_udostepnienia:
      'Udział podmiotu w realizacji zamówienia jako podwykonawca robót '
      + 'technologicznych oraz nadzór jego kadry nad tym zakresem.',
    okres_udostepnienia: 'Przez cały okres realizacji zamówienia, tj. 18 miesięcy od podpisania umowy.',
    zakres_podwykonawstwa:
      'Wykonanie części technologicznej oczyszczalni (montaż i rozruch ciągu '
      + 'technologicznego).',
  };
}

/** Meta identyfikująca postępowanie i strony (spoza modelu 4/12). */
function metaPelna() {
  return {
    wykonawca: 'Instal-Bud Nowak Sp.k.',
    zamawiajacy: 'Gmina Przykładowa',
    przedmiot_zamowienia: 'Budowa oczyszczalni ścieków w m. Przykładów',
    numer_postepowania: 'ZP/12/2026',
    miejscowosc: 'Warszawa',
    data_pisma: '2026-07-26',
  };
}

// ── kompletny dokument: wszystkie elementy wymagane orzecznictwem ─────────────

test('kompletne zobowiązanie → kompletne=true, brak braków, brak markerów UZUPEŁNIJ', () => {
  const w = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  assert.equal(w.kompletne, true);
  assert.deepEqual(w.braki, []);
  assert.equal(typeof w.tresc, 'string');
  assert.ok(!w.tresc.includes('[UZUPEŁNIJ'), 'gotowy dokument nie może zawierać markera braku');
});

test('treść zawiera tytuł i podstawę prawną (art. 118 ust. 3 i 4 Pzp)', () => {
  const { tresc } = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  assert.match(tresc, /ZOBOWIĄZANIE PODMIOTU UDOSTĘPNIAJĄCEGO ZASOBY/);
  assert.match(tresc, /art\.\s*118\s*ust\.\s*3/);
  assert.match(tresc, /art\.\s*118\s*ust\.\s*4/);
});

test('treść zawiera wszystkie cztery elementy art. 118 ust. 4 z wartościami z formularza', () => {
  const z = zobowiazaniePelne();
  const { tresc } = generujZobowiazanie(z, metaPelna());
  assert.ok(tresc.includes(z.zakres_doswiadczenia), 'brak zakresu udostępnianych zasobów');
  assert.ok(tresc.includes(z.sposob_udostepnienia), 'brak sposobu udostępnienia');
  assert.ok(tresc.includes(z.okres_udostepnienia), 'brak okresu udostępnienia');
  assert.ok(tresc.includes(z.zakres_podwykonawstwa), 'brak zakresu podwykonawstwa');
});

test('cztery elementy występują w kolejności art. 118 ust. 4 (zakres → sposób → okres → podwykonawstwo)', () => {
  const { tresc } = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  const iZakres = tresc.indexOf('Zakres udostępnianych zasobów');
  const iSposob = tresc.indexOf('Sposób udostępnienia i wykorzystania');
  const iOkres = tresc.indexOf('Okres udostępnienia zasobów');
  const iPodwyk = tresc.indexOf('udziału w realizacji zamówienia');
  assert.ok(iZakres >= 0 && iSposob >= 0 && iOkres >= 0 && iPodwyk >= 0, 'brak nagłówka któregoś elementu');
  assert.ok(iZakres < iSposob, 'zakres przed sposobem');
  assert.ok(iSposob < iOkres, 'sposób przed okresem');
  assert.ok(iOkres < iPodwyk, 'okres przed podwykonawstwem');
});

test('ZAWSZE obecna klauzula realnego udziału (art. 118 ust. 2) — filar niefikcyjności', () => {
  const { tresc } = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  assert.match(tresc, /art\.\s*118\s*ust\.\s*2/);
  assert.match(tresc, /rzeczywi/i, 'brak deklaracji rzeczywistej realizacji części zamówienia');
});

test('ZAWSZE obecne przypomnienie: złożenie wraz z ofertą i podpis podmiotu', () => {
  const { tresc } = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  assert.match(tresc, /wraz z ofertą/i);
  assert.match(tresc, /podpis/i);
});

test('treść identyfikuje podmiot, wykonawcę i zamawiającego', () => {
  const z = zobowiazaniePelne();
  const m = metaPelna();
  const { tresc } = generujZobowiazanie(z, m);
  assert.ok(tresc.includes(z.dane_podmiotu.nazwa), 'brak nazwy podmiotu');
  assert.ok(tresc.includes(z.dane_podmiotu.identyfikator), 'brak identyfikatora podmiotu');
  assert.ok(tresc.includes(m.wykonawca), 'brak nazwy wykonawcy');
  assert.ok(tresc.includes(m.zamawiajacy), 'brak zamawiającego');
});

test('reprezentant trafia do bloku podpisu', () => {
  const z = zobowiazaniePelne();
  const { tresc } = generujZobowiazanie(z, metaPelna());
  assert.ok(tresc.includes(z.dane_podmiotu.reprezentant), 'reprezentant nie trafił do podpisu');
});

// ── braki: dokument nie udaje gotowego do podpisu ────────────────────────────

test('brak pola wymaganego → kompletne=false, braki wskazują pole, widoczny marker UZUPEŁNIJ', () => {
  const z = zobowiazaniePelne();
  z.zakres_podwykonawstwa = '';
  const w = generujZobowiazanie(z, metaPelna());
  assert.equal(w.kompletne, false, 'brak pola wymaganego nie może dać kompletne=true');
  assert.ok(w.braki.some((b) => b.sciezka === 'zakres_podwykonawstwa'), 'braki nie wskazują pola');
  assert.ok(w.tresc.includes('[UZUPEŁNIJ'), 'brakujące pole musi być widoczne, nie pominięte po cichu');
});

test('brakujące pole wymagane NIE znika z dokumentu (marker zamiast pominięcia)', () => {
  const z = zobowiazaniePelne();
  z.okres_udostepnienia = '';
  const { tresc } = generujZobowiazanie(z, metaPelna());
  // nagłówek elementu wciąż jest, a pod nim marker — nie pusty przeskok
  assert.ok(tresc.includes('Okres udostępnienia zasobów'), 'nagłówek okresu zniknął');
  assert.ok(tresc.includes('[UZUPEŁNIJ'), 'brak markera dla pustego okresu');
});

test('braki i ostrzeżenia pochodzą z walidacji modelu (jedno źródło prawdy)', () => {
  const z = zobowiazaniePelne();
  z.dane_podmiotu.reprezentant = ''; // pole zalecane → ostrzeżenie, nie brak
  const w = generujZobowiazanie(z, metaPelna());
  assert.equal(w.kompletne, true, 'zalecane pole nie może blokować kompletności');
  assert.ok(w.ostrzezenia.some((o) => o.sciezka === 'dane_podmiotu.reprezentant'));
});

// ── meta: placeholdery, gdy brak danych kontekstu ────────────────────────────

test('brak meta (wykonawca/zamawiający/miejscowość/data) → placeholdery [...] w treści', () => {
  const { tresc } = generujZobowiazanie(zobowiazaniePelne(), {});
  assert.match(tresc, /\[Wykonawca\]/);
  assert.match(tresc, /\[Zamawiający\]/);
  assert.match(tresc, /\[miejscowość\]/);
  assert.match(tresc, /\[data\]/);
});

test('brakująca data NIE jest podstawiana bieżącą datą (funkcja deterministyczna)', () => {
  const { tresc } = generujZobowiazanie(zobowiazaniePelne(), { ...metaPelna(), data_pisma: '' });
  assert.match(tresc, /\[data\]/);
});

// ── determinizm, zamrożenie, plik ────────────────────────────────────────────

test('ten sam wejściowy model daje identyczną treść (determinizm)', () => {
  const a = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  const b = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  assert.equal(a.tresc, b.tresc);
  assert.equal(a.nazwaPliku, b.nazwaPliku);
});

test('wynik jest zamrożony (migawka)', () => {
  const w = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  assert.ok(Object.isFrozen(w));
  assert.ok(Object.isFrozen(w.braki));
  assert.ok(Object.isFrozen(w.ostrzezenia));
});

test('nazwaPliku to slug bez diakrytyków/spacji z rozszerzeniem .txt', () => {
  const { nazwaPliku } = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  assert.match(nazwaPliku, /\.txt$/);
  assert.match(nazwaPliku, /^[a-z0-9-]+\.txt$/, 'nazwa pliku ma niedozwolone znaki');
});

test('generator rzuca TypeError dla nie-obiektu (spójnie z modelem)', () => {
  assert.throws(() => generujZobowiazanie(null), TypeError);
  assert.throws(() => generujZobowiazanie('x'), TypeError);
  assert.throws(() => generujZobowiazanie([]), TypeError);
});

// ── eksport do pliku: nie wypuszcza dokumentu niegotowego do podpisu ──────────

test('zobowiazanieDoPliku zwraca deskryptor pliku dla kompletnego zobowiązania', () => {
  const w = generujZobowiazanie(zobowiazaniePelne(), metaPelna());
  const plik = zobowiazanieDoPliku(w);
  assert.equal(plik.nazwa, w.nazwaPliku);
  assert.match(plik.typ, /text\/plain/);
  assert.equal(plik.zawartosc, w.tresc);
});

test('zobowiazanieDoPliku ODMAWIA eksportu niekompletnego (niegotowego do podpisu)', () => {
  const z = zobowiazaniePelne();
  z.zakres_podwykonawstwa = '';
  const w = generujZobowiazanie(z, metaPelna());
  assert.throws(() => zobowiazanieDoPliku(w), /niekompletn|gotow/i);
});

// ── spójność z modelem: każde pole treściowe wymagane jest w dokumencie ───────

test('każda ścieżka pola wymaganego z modelu jest reprezentowana w treści (wartość lub marker)', () => {
  const z = zobowiazaniePelne();
  const { tresc } = generujZobowiazanie(z, metaPelna());
  // pola treściowe (poza danymi podmiotu) — ich wartości muszą się pojawić
  const trescioweWymagane = POLA_ZOBOWIAZANIA.filter(
    (p) => p.wymagane && p.sciezka.length === 1,
  );
  assert.ok(trescioweWymagane.length >= 4, 'model powinien mieć ≥4 pola treściowe wymagane');
  for (const p of trescioweWymagane) {
    const wartosc = z[p.sciezka[0]];
    assert.ok(tresc.includes(wartosc), `treść nie zawiera wartości pola ${p.id}`);
  }
});
