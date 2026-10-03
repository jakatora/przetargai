import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KROKI, zbudujSciezke, nastepnyKrok, parametryNarzedzia,
} from '../src/lib/sciezkaDoOferty.js';

/*
 * KONTEKST NAWIGACJI ZE ŚCIEŻKI (2026-10-03).
 *
 * Ścieżka przekazywała każdemu narzędziu wyłącznie `{ nazwa }`. Checklista i „czy warto"
 * adresują dane identyfikatorem przetargu, więc ze ścieżki nie dało się do nich wejść,
 * a Radar SWZ kazał przepisywać nazwę i daty, które ogłoszenie już zna. Tu pilnujemy
 * trzech sytuacji: kontekst pełny, niepełny i żaden.
 */

/** Dopasowanie w kształcie `publicTender` (firebase/functions/src/lib/serialize.js). */
const PELNE = {
  id: 'm-1',
  tender_id: 'bzp:2026-BZP-00123456',
  tender: {
    id: 'bzp:2026-BZP-00123456',
    title: 'Remont drogi gminnej w Nowej Wsi',
    deadline: '2026-10-20T08:00:00.000Z',
    published_at: '2026-10-01T10:15:00.000Z',
  },
};

// ── Kontekst pełny ───────────────────────────────────────────────────────────

test('checklista: z pełnego kontekstu dostaje identyfikator przetargu i tytuł', () => {
  assert.deepEqual(parametryNarzedzia('ChecklistaOferty', PELNE), {
    tenderId: 'bzp:2026-BZP-00123456', tytul: 'Remont drogi gminnej w Nowej Wsi',
  });
});

test('„czy warto": dostaje matchId, tenderId i tytuł — tak jak z ekranu szczegółów', () => {
  assert.deepEqual(parametryNarzedzia('CzyWarto', PELNE), {
    matchId: 'm-1', tenderId: 'bzp:2026-BZP-00123456', tytul: 'Remont drogi gminnej w Nowej Wsi',
  });
});

test('Radar SWZ: dostaje identyfikator przetargu (do powiązania), nazwę i obie daty z ogłoszenia', () => {
  assert.deepEqual(parametryNarzedzia('RadarSwz', PELNE), {
    tenderId: 'bzp:2026-BZP-00123456',
    nazwa: 'Remont drogi gminnej w Nowej Wsi',
    termin: '2026-10-20T08:00:00.000Z',
    dataOgloszenia: '2026-10-01T10:15:00.000Z',
  });
});

test('rejestrator oferty: kształt parametrów jak przed zmianą', () => {
  assert.deepEqual(parametryNarzedzia('RejestratorOferty', PELNE), {
    termin: '2026-10-20T08:00:00.000Z', postepowanieId: 'm-1', nazwa: 'Remont drogi gminnej w Nowej Wsi',
  });
});

test('pozostałe narzędzia: nadal wyłącznie { nazwa }', () => {
  for (const ekran of ['Sejf', 'BankReferencji', 'SymulatorPlynnosci', 'KalkulatorTerminow']) {
    assert.deepEqual(parametryNarzedzia(ekran, PELNE), { nazwa: 'Remont drogi gminnej w Nowej Wsi' });
  }
});

// ── Kontekst niepełny ────────────────────────────────────────────────────────

test('identyfikator przetargu z `tender_id`, gdy ogłoszenie nie niesie własnego `id`', () => {
  const match = { id: 'm-2', tender_id: 'ted:515302-2026', tender: { title: 'Dostawa sprzętu' } };
  assert.deepEqual(parametryNarzedzia('ChecklistaOferty', match), { tenderId: 'ted:515302-2026', tytul: 'Dostawa sprzętu' });
  assert.deepEqual(parametryNarzedzia('CzyWarto', match), { matchId: 'm-2', tenderId: 'ted:515302-2026', tytul: 'Dostawa sprzętu' });
});

test('brak tytułu: identyfikatory przechodzą, a pola `tytul`/`nazwa` nie powstają', () => {
  const match = { id: 'm-3', tender: { id: 't-3', title: '   ' } };
  assert.deepEqual(parametryNarzedzia('ChecklistaOferty', match), { tenderId: 't-3' });
  assert.deepEqual(parametryNarzedzia('CzyWarto', match), { matchId: 'm-3', tenderId: 't-3' });
  assert.deepEqual(parametryNarzedzia('RadarSwz', match), { tenderId: 't-3' });
  assert.deepEqual(parametryNarzedzia('Sejf', match), {});
});

test('„czy warto" działa z samym identyfikatorem dopasowania', () => {
  const match = { id: 'm-4', tender: { title: 'Usługi sprzątania' } };
  assert.deepEqual(parametryNarzedzia('CzyWarto', match), { matchId: 'm-4', tenderId: null, tytul: 'Usługi sprzątania' });
  // Checklista jest adresowana przetargiem — sam identyfikator dopasowania jej nie wystarczy.
  assert.equal(parametryNarzedzia('ChecklistaOferty', match), null);
});

test('Radar SWZ: przekazuje tylko te daty, które ogłoszenie podaje', () => {
  const match = { id: 'm-5', tender: { id: 't-5', title: 'Budowa chodnika', deadline: '2026-11-03T09:00:00.000Z' } };
  assert.deepEqual(parametryNarzedzia('RadarSwz', match), {
    tenderId: 't-5', nazwa: 'Budowa chodnika', termin: '2026-11-03T09:00:00.000Z',
  });
  // Bez identyfikatora przetargu Radar nie dostaje `tenderId` — nie będzie czego wiązać.
  assert.deepEqual(parametryNarzedzia('RadarSwz', { id: 'm-6', tender: { title: 'Budowa chodnika' } }), { nazwa: 'Budowa chodnika' });
});

test('śmieciowe identyfikatory (pusty napis, NaN, obiekt) nie udają kontekstu', () => {
  for (const zly of ['', '   ', Number.NaN, {}, [], true]) {
    const match = { id: zly, tender_id: zly, tender: { id: zly, title: 'X' } };
    assert.equal(parametryNarzedzia('ChecklistaOferty', match), null, `tenderId=${JSON.stringify(zly)}`);
    assert.equal(parametryNarzedzia('CzyWarto', match), null, `id=${JSON.stringify(zly)}`);
  }
});

// ── Kontekst brakujący ───────────────────────────────────────────────────────

test('bez kontekstu: ekrany wymagające identyfikatora zwracają null, reszta pusty obiekt', () => {
  for (const brak of [undefined, null, {}, { tender: null }, 'napis', 7]) {
    assert.equal(parametryNarzedzia('ChecklistaOferty', brak), null);
    assert.equal(parametryNarzedzia('CzyWarto', brak), null);
    assert.deepEqual(parametryNarzedzia('RadarSwz', brak), {});
    assert.deepEqual(parametryNarzedzia('Sejf', brak), {});
  }
});

// ── Następny krok ────────────────────────────────────────────────────────────

const WYMAGANE = KROKI.filter((k) => !k.opcjonalny);

test('pusta ścieżka: następnym krokiem jest pierwszy krok wymagany', () => {
  assert.equal(nastepnyKrok(new Set()).klucz, WYMAGANE[0].klucz);
  assert.equal(nastepnyKrok(undefined).klucz, WYMAGANE[0].klucz, 'śmieciowe wejście = nic nie odhaczono');
  assert.equal(zbudujSciezke([]).nastepny.klucz, WYMAGANE[0].klucz);
});

test('następny krok to PIERWSZY nieodhaczony wymagany — także gdy odhaczono dalsze', () => {
  const [pierwszy, drugi, trzeci] = WYMAGANE;
  assert.equal(nastepnyKrok([pierwszy.klucz]).klucz, drugi.klucz);
  // Dziura w środku: odhaczony pierwszy i trzeci → wracamy do drugiego, nie skaczemy dalej.
  assert.equal(nastepnyKrok([pierwszy.klucz, trzeci.klucz]).klucz, drugi.klucz);
});

test('kroki opcjonalne nie są następnym działaniem i ich odhaczenie niczego nie przesuwa', () => {
  const opcjonalne = KROKI.filter((k) => k.opcjonalny).map((k) => k.klucz);
  assert.ok(opcjonalne.length > 0);
  assert.equal(nastepnyKrok(opcjonalne).klucz, WYMAGANE[0].klucz);

  // Wszystko wymagane PRZED pierwszym opcjonalnym odhaczone → następny jest kolejny wymagany.
  const indeksOpcjonalnego = KROKI.findIndex((k) => k.opcjonalny);
  const przed = KROKI.slice(0, indeksOpcjonalnego).map((k) => k.klucz);
  const oczekiwany = KROKI.slice(indeksOpcjonalnego).find((k) => !k.opcjonalny);
  assert.equal(nastepnyKrok(przed).klucz, oczekiwany.klucz);
});

test('wszystkie wymagane odhaczone → brak następnego kroku (bez udawania kompletnej oferty)', () => {
  const komplet = WYMAGANE.map((k) => k.klucz);
  assert.equal(nastepnyKrok(komplet), null);
  const { nastepny, postep } = zbudujSciezke(komplet);
  assert.equal(nastepny, null);
  assert.equal(postep.wszystkieWymaganeGotowe, true);
  // Jeden brakujący wymagany → znów jest co robić.
  assert.equal(nastepnyKrok(komplet.slice(1)).klucz, WYMAGANE[0].klucz);
});

test('następny krok jest spójny z postępem ścieżki dla każdego prefiksu kroków', () => {
  for (let n = 0; n <= WYMAGANE.length; n += 1) {
    const { nastepny, postep } = zbudujSciezke(WYMAGANE.slice(0, n).map((k) => k.klucz));
    assert.equal(postep.zrobione, n);
    assert.equal(nastepny?.klucz ?? null, WYMAGANE[n]?.klucz ?? null);
  }
});

// ── Spójność z nawigatorem i z ekranami ──────────────────────────────────────

const KATALOG = path.dirname(fileURLToPath(import.meta.url));
const zrodlo = (wzgledna) => fs.readFileSync(path.resolve(KATALOG, wzgledna), 'utf8');

test('dodatkowe wejścia kroków prowadzą do ekranów zarejestrowanych w nawigatorze', () => {
  const zarejestrowane = new Set(
    [...zrodlo('../src/navigation/RootNavigator.js').matchAll(/name="(\w+)"/g)].map((m) => m[1]),
  );
  const dodatkowe = KROKI.flatMap((k) => k.dodatkowe ?? []);
  assert.deepEqual(dodatkowe.map((d) => d.ekran).sort(), ['ChecklistaOferty', 'CzyWarto']);
  for (const d of dodatkowe) {
    assert.ok(d.etykieta && d.etykieta.trim(), `wejście ${d.ekran} bez etykiety`);
    assert.ok(zarejestrowane.has(d.ekran), `„${d.ekran}" nie istnieje w RootNavigator`);
    assert.notEqual(parametryNarzedzia(d.ekran, PELNE), null, `${d.ekran} nie otwiera się z pełnego kontekstu`);
  }
});

test('zmiana nie ruszyła kroków: te same klucze w tej samej kolejności', () => {
  assert.deepEqual(KROKI.map((k) => k.klucz), [
    'swz', 'kwalifikacja', 'oplacalnosc', 'punkty', 'wadium', 'dokumenty', 'konsorcjum',
    'oferta', 'tajemnica', 'wizja', 'termin', 'rejestrator', 'zwiazanie', 'wezwania', 'wynik',
  ]);
});

test('ekrany czytają dokładnie te parametry, które wysyła ścieżka', () => {
  // Ścieżka i szczegóły liczą parametry tą samą czystą funkcją — nie składają ich ręcznie.
  assert.match(zrodlo('../src/screens/SciezkaDoOfertyScreen.js'), /parametryNarzedzia\(ekran, match\)/);
  assert.match(zrodlo('../src/screens/MatchDetailScreen.js'), /parametryNarzedzia\('ChecklistaOferty', match\)/);
  // Odbiorcy: nazwy pól w `route.params` muszą się zgadzać z tym, co funkcja zwraca.
  assert.match(zrodlo('../src/screens/ChecklistaOfertyScreen.js'), /const \{ tenderId, tytul \} = route\.params/);
  assert.match(zrodlo('../src/screens/CzyWartoScreen.js'), /const \{ tenderId, matchId, tytul \} = route\.params/);
  assert.match(zrodlo('../src/screens/RadarSwzScreen.js'), /wstepneDaneRadaru\(route\?\.params\)/);
});

test('ścieżka nie ogłasza kompletności oferty', () => {
  const ekran = zrodlo('../src/screens/SciezkaDoOfertyScreen.js');
  assert.doesNotMatch(ekran, /Komplet kroków odhaczony/);
  assert.match(ekran, /nie sprawdza treści ani kompletności oferty/);
});
