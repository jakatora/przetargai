/**
 * Generator NOTATEK ROBOCZYCH pod odwołanie do KIO — podzadanie 12/13 ulepszenia
 * „Prześwietlenie oferty zwycięzcy i szansa na odwołanie".
 *
 * Bliźniak {@link ./wniosekProtokol wygeneruj_wniosek_o_protokol}: czysta funkcja,
 * która bierze poprzetargową kontrolę z GOTOWYM wynikiem analizy (podzadanie 11/13:
 * lista zarzutów, ocena szans, rekomendacja „walcz / odpuść", uzasadnienie) oraz
 * wyliczonym terminem KIO i składa gotowy do pobrania dokument .txt, którym
 * użytkownik może się posłużyć, pisząc odwołanie.
 *
 * WYŁĄCZNIE formatowanie ISTNIEJĄCYCH danych — zero nowych reguł ani decyzji. Siły
 * zarzutów, ocenę szans i rekomendację wyznaczyły wcześniejsze podzadania (silnik
 * reguł 10/13, ocena szans 11/13), termin — kalkulator 3/13. Tu tylko przenosimy je
 * do czytelnego pisma roboczego.
 *
 * Determinizm jak w {@link ./wniosekProtokol} / {@link ./terminKio}: bez `Date.now()`
 * w środku — czas odniesienia do odliczania („ile zostało") wstrzykuje wołający przez
 * `opcje.teraz`. Braki danych NIGDY nie wywracają generatora: pomijamy nieznane
 * wiersze albo wstawiamy czytelny placeholder, zamiast wypisywać „undefined"/„null".
 */

import { pozostaly_czas_do } from './terminKio.js';

export const TYTUL_NOTATEK = 'Notatki robocze pod odwołanie do KIO';

/** Etykiety oceny szans do pisma (klucze jak w ocenaSzans.OCENA_SZANS). */
const ETYKIETA_SZANS = { niska: 'niska', srednia: 'średnia', wysoka: 'wysoka' };

/** Etykiety siły zarzutu do pisma (klucze jak w regulaRazacoNiskaCena.SILA_ZARZUTU). */
const ETYKIETA_SILY = { slaba: 'słaba', umiarkowana: 'umiarkowana', mocna: 'mocna' };

/**
 * Pierwsza wartość z listy, która nie jest null/undefined (zachowuje 0/false).
 * Ten sam wzorzec priorytetu źródeł pól co w {@link ./poprzetargowaKontrola}.
 */
function pierwsze(...wartosci) {
  for (const w of wartosci) if (w !== undefined && w !== null) return w;
  return null;
}

/** Niepusty, przycięty tekst albo null. Liczby (np. tender.id) sprowadzamy do stringa. */
function tekstAlboNull(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Formatuje datę do polskiego zapisu `DD.MM.RRRR`. Dla stringa ISO bierzemy
 * pierwsze 10 znaków (YYYY-MM-DD), deterministycznie i bez przesuwania dnia przez
 * strefę czasową — spójnie z {@link ./wniosekProtokol}. Nierozpoznaną datę
 * pokazujemy jak jest (best-effort), a pustą → null.
 */
function formatujDatePL(wartosc) {
  const tekst = tekstAlboNull(wartosc);
  if (tekst === null) return null;
  const m = tekst.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return tekst;
}

/** Bezpieczny fragment nazwy pliku: litery/cyfry/kropka/myślnik; reszta → myślnik. */
function slugId(id) {
  return String(id)
    .trim()
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Wyłuskuje wynik analizy z wejścia. Akceptujemy zarówno model kontroli (wynik pod
 * `analiza`), jak i samą analizę podaną wprost — ekran ma jedno i drugie pod ręką.
 * Rozpoznajemy analizę po znamionach kształtu z `ocen_szanse_i_rekomendacja`.
 */
function wyciagnijAnalize(zrodlo) {
  if (!zrodlo || typeof zrodlo !== 'object') return null;
  const kandydat = zrodlo.analiza ?? zrodlo;
  if (!kandydat || typeof kandydat !== 'object' || Array.isArray(kandydat)) return null;
  const maZnamiona =
    Array.isArray(kandydat.zarzuty) || 'rekomendacja' in kandydat || 'ocenaSzans' in kandydat;
  return maZnamiona ? kandydat : null;
}

/**
 * Pola identyfikujące postępowanie — z kontroli (już znormalizowane), z zagnieżdżonego
 * tendera albo z opcji. Analiza NIE niesie tych pól, więc dla samej analizy zostają null.
 */
function wyciagnijDane(zrodlo, opcje) {
  const src = zrodlo && typeof zrodlo === 'object' ? zrodlo : {};
  const tender = src.tender ?? {};
  const o = opcje && typeof opcje === 'object' ? opcje : {};
  return {
    id: tekstAlboNull(pierwsze(src.postepowanieId, src.id, tender.id)),
    zamawiajacy: tekstAlboNull(pierwsze(src.daneZamawiajacego, src.organization, tender.organization)),
    nazwa: tekstAlboNull(pierwsze(o.nazwaPostepowania, src.nazwa, src.title, tender.title)),
    terminKio: tekstAlboNull(pierwsze(src.terminOdwolaniaKio, o.terminOdwolaniaKio)),
    dataOgloszeniaWyniku: tekstAlboNull(pierwsze(src.dataOgloszeniaWyniku, tender.dataOgloszeniaWyniku)),
  };
}

/**
 * Jednozdaniowy opis odliczania do terminu — tylko gdy wstrzyknięto `teraz`
 * (determinizm; bez `Date.now()`). Po terminie mówi to wprost. Brak/niepewny termin
 * → null (wołający pokazał już samą datę graniczną / placeholder).
 */
function opisOdliczania(terminKio, teraz) {
  if (typeof teraz !== 'number' || !Number.isFinite(teraz)) return null;
  const czas = pozostaly_czas_do(terminKio, teraz);
  if (!czas) return null;
  if (czas.poTerminie) {
    return 'UWAGA: termin na wniesienie odwołania do KIO już UPŁYNĄŁ.';
  }
  return `Pozostało: ${czas.dni} dni ${czas.godziny} godz. na wniesienie odwołania.`;
}

/** Sekcja terminu KIO: data graniczna (albo „nieustalona") + ewentualne odliczanie. */
function sekcjaTerminu(dane, teraz) {
  const wiersze = ['TERMIN NA WNIESIENIE ODWOŁANIA DO KIO'];
  const data = formatujDatePL(dane.terminKio);
  if (data) {
    wiersze.push(`- data graniczna (ostatni dzień): ${data}`);
    const odliczanie = opisOdliczania(dane.terminKio, teraz);
    if (odliczanie) wiersze.push(`- ${odliczanie}`);
  } else {
    wiersze.push(
      '- data graniczna: nieustalona — uzupełnij po ustaleniu daty przekazania',
      '  informacji o wyborze najkorzystniejszej oferty (termin liczy się od niej).',
    );
  }
  return wiersze.join('\n');
}

/** Sekcja listy zarzutów: numerowana, z siłą i opisem; brak zarzutów → informacja. */
function sekcjaZarzutow(zarzuty) {
  const lista = Array.isArray(zarzuty) ? zarzuty.filter((z) => z && typeof z === 'object') : [];
  if (lista.length === 0) {
    return [
      'POTENCJALNE ZARZUTY',
      'Nie wykryto przesłanek odrzucenia oferty zwycięzcy dających realną podstawę',
      'do odwołania.',
    ].join('\n');
  }

  const wiersze = [`POTENCJALNE ZARZUTY (wykryto: ${lista.length})`, ''];
  lista.forEach((z, i) => {
    const tytul = tekstAlboNull(z.tytul) ?? 'Zarzut';
    const sila = ETYKIETA_SILY[z.sila] ?? tekstAlboNull(z.sila);
    const naglowek = sila ? `${i + 1}. ${tytul} [siła: ${sila}]` : `${i + 1}. ${tytul}`;
    wiersze.push(naglowek);
    const opis = tekstAlboNull(z.opis_zarzutu);
    if (opis) wiersze.push(`   ${opis}`);
    wiersze.push('');
  });
  return wiersze.join('\n').trimEnd();
}

/** Sekcja decyzji: wyróżniona rekomendacja + ocena szans. */
function sekcjaDecyzji(analiza) {
  const rek = analiza.rekomendacja && typeof analiza.rekomendacja === 'object' ? analiza.rekomendacja : {};
  const etykietaDecyzji = tekstAlboNull(rek.etykieta) ?? tekstAlboNull(rek.wartosc) ?? 'brak rekomendacji';
  const szanse = ETYKIETA_SZANS[analiza.ocenaSzans] ?? tekstAlboNull(analiza.ocenaSzans) ?? 'nieokreślona';
  return [
    `DECYZJA: ${etykietaDecyzji.toUpperCase()}`,
    `Ocena szans powodzenia odwołania: ${szanse}`,
  ].join('\n');
}

const ZASTRZEZENIE = [
  'To NOTATKI ROBOCZE wygenerowane automatycznie przez aplikację na podstawie',
  'kontroli oferty zwycięzcy. Nie stanowią pisma procesowego ani porady prawnej.',
  'Odwołanie do Krajowej Izby Odwoławczej (KIO) wnosi się z zachowaniem wymogów',
  'formalnych i w terminie ustawowym (art. 515 i art. 516 Pzp), wraz z wpisem.',
  'Przed wniesieniem zweryfikuj ustalenia w protokole i dokumentach postępowania.',
].join('\n');

/** Nagłówek z identyfikacją postępowania — tylko wiersze, które faktycznie znamy. */
function naglowek(dane) {
  const wiersze = [TYTUL_NOTATEK.toUpperCase(), ''];
  if (dane.nazwa) wiersze.push(`Dotyczy postępowania: ${dane.nazwa}`);
  if (dane.id) wiersze.push(`Znak/nr postępowania: ${dane.id}`);
  if (dane.zamawiajacy) wiersze.push(`Zamawiający: ${dane.zamawiajacy}`);
  const dataWyniku = formatujDatePL(dane.dataOgloszeniaWyniku);
  if (dataWyniku) wiersze.push(`Informacja o wyniku z dnia: ${dataWyniku}`);
  return wiersze.join('\n');
}

/**
 * Generuje notatki robocze pod odwołanie do KIO.
 *
 * @param {object|null|undefined} kontrola model
 *   {@link ./poprzetargowaKontrola PoprzetargowaKontrola} z wynikiem analizy pod
 *   `analiza` (albo sama analiza z {@link ./ocenaSzans ocen_szanse_i_rekomendacja}).
 *   Braki → pominięte wiersze / placeholdery (best-effort — nie rzuca).
 * @param {{ teraz?: number, nazwaPostepowania?: string, terminOdwolaniaKio?: string }} [opcje]
 *   `teraz` — czas odniesienia (ms) do odliczania; bez niego pomijamy „ile zostało".
 *   `nazwaPostepowania` — tytuł postępowania (kontrola go nie trzyma; podaje ekran z tendera).
 * @returns {{ tytul: string, nazwaPliku: string, typMime: string, tresc: string }}
 *   dokument gotowy do pobrania.
 */
export function wygeneruj_notatki_odwolanie(kontrola, opcje) {
  const dane = wyciagnijDane(kontrola, opcje);
  const analiza = wyciagnijAnalize(kontrola);
  const teraz = opcje && typeof opcje === 'object' ? opcje.teraz : undefined;

  const bloki = [naglowek(dane)];

  if (analiza) {
    bloki.push(sekcjaDecyzji(analiza));
    bloki.push(sekcjaTerminu(dane, teraz));
    bloki.push(sekcjaZarzutow(analiza.zarzuty));
    const uzasadnienie = tekstAlboNull(analiza.uzasadnienie);
    if (uzasadnienie) bloki.push(['UZASADNIENIE OCENY', uzasadnienie].join('\n'));
  } else {
    bloki.push(
      [
        'Nie przeprowadzono jeszcze analizy oferty zwycięzcy (brak analizy).',
        'Wgraj ofertę zwycięzcy i protokół postępowania, aby aplikacja sprawdziła',
        'przesłanki odrzucenia i przygotowała notatki pod odwołanie.',
      ].join('\n'),
    );
    // Termin bywa już policzony, choć analizy nie ma — pokaż go, jeśli znany.
    if (dane.terminKio) bloki.push(sekcjaTerminu(dane, teraz));
  }

  bloki.push(ZASTRZEZENIE);

  const nazwaPliku = dane.id ? `notatki-odwolanie-${slugId(dane.id)}.txt` : 'notatki-odwolanie.txt';

  return {
    tytul: TYTUL_NOTATEK,
    nazwaPliku,
    typMime: 'text/plain; charset=utf-8',
    tresc: bloki.join('\n\n'),
  };
}
