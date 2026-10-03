/**
 * Prezentacja panelu „RADAR SWZ" — czysta logika bez importów z React Native,
 * więc testowalna zwykłym `node:test` (ulepszenie „Radar pytań i odpowiedzi do
 * SWZ", podzadanie 7/7).
 *
 * Ekran RadarSwz tylko RENDERUJE to, co policzył backend (termin pytań, pytania,
 * timeline zmian, checklista, werdykt bramki). Tu żyją reguły „liczba → słowo":
 * jak nazwać odliczanie do terminu pytań, jak pokolorować linie diffu, jakie
 * etykiety mają statusy pytań / sekcje oferty / poziomy bramki. Trzymamy je przy
 * sobie i pod testem, żeby ekran ich nie wymyślał na nowo (i żeby dark mode/kolory
 * dokładał już tylko sam ekran przez useTheme()).
 */

import { chwilaUplywuTerminu, dzienPL, naDzienUTC } from './dataUtc.js';

// ── Wstępne dane formularza (wejście z przetargu) ────────────────────────────

/** Limit nazwy postępowania po stronie backendu (`utworzSchema` w routes/radarSwz.js). */
export const MAKS_NAZWA_POSTEPOWANIA = 300;

/**
 * Data z ogłoszenia → zapis `RRRR-MM-DD`, jakiego oczekuje formularz Radaru. Dla chwili
 * (ISO z godziną) bierzemy dzień kalendarzowy W POLSCE — termin o 23:30 UTC to już
 * następny dzień u zamawiającego. Nieznany zapis → pusty napis: lepiej zostawić pole
 * puste, niż wstawić przesuniętą datę, od której liczy się termin pytań.
 */
function dzienDoFormularza(wartosc) {
  const chwila = chwilaUplywuTerminu(wartosc);
  if (!chwila) return '';
  const dzienMs = chwila.zGodzina ? dzienPL(chwila.ms) : naDzienUTC(wartosc);
  return dzienMs === null ? '' : new Date(dzienMs).toISOString().slice(0, 10);
}

/**
 * Wstępne wypełnienie formularza „Weź postępowanie pod radar" z parametrów trasy.
 *
 * Radar otwierany z katalogu narzędzi nie dostaje parametrów — formularz jest wtedy pusty
 * jak dotąd. Otwierany z przetargu dostaje nazwę i daty z ogłoszenia; każde pole przechodzi
 * przez walidację i przy wątpliwości zostaje PUSTE. Niczego tu nie zapisujemy: użytkownik
 * widzi dane, może je poprawić i sam naciska „Dodaj do radaru".
 *
 * `tenderId` (identyfikator przetargu) służy wyłącznie do powiązania nowej analizy z tym
 * przetargiem po jej utworzeniu; `null`, gdy Radar otwarto bez przetargu.
 *
 * @param {object|null|undefined} params `route.params` ekranu RadarSwz
 * @returns {{nazwa: string, dataOgloszenia: string, termin: string, zPrzetargu: boolean,
 *   tenderId: string|number|null}}
 */
export function wstepneDaneRadaru(params) {
  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const nazwa = typeof p.nazwa === 'string' ? p.nazwa.trim().slice(0, MAKS_NAZWA_POSTEPOWANIA) : '';
  const dataOgloszenia = dzienDoFormularza(p.dataOgloszenia);
  const termin = dzienDoFormularza(p.termin);
  const tenderId = (typeof p.tenderId === 'string' && p.tenderId.trim())
    || (typeof p.tenderId === 'number' && Number.isFinite(p.tenderId))
    ? p.tenderId : null;
  return {
    nazwa, dataOgloszenia, termin, tenderId,
    zPrzetargu: Boolean(nazwa || dataOgloszenia || termin || tenderId !== null),
  };
}

/**
 * Parametry Radaru otwieranego Z CHECKLISTY przetargu. Checklista zna identyfikator
 * i tytuł, a termin składania bierze z kalendarza postępowania (pozycja `oferty` — data
 * wprost z ogłoszenia, nie wyliczona). Bez znanego terminu pole zostaje puste.
 *
 * @param {{tenderId: string|number, tytul?: string|null,
 *   kalendarz?: {pozycje?: Array<{kod?: string, znany?: boolean, at?: string|null}>}|null}} wejscie
 * @returns {{tenderId: string|number, nazwa?: string, termin?: string}}
 */
export function parametryRadaruZChecklisty({ tenderId, tytul, kalendarz } = {}) {
  const params = { tenderId };
  if (typeof tytul === 'string' && tytul.trim()) params.nazwa = tytul;
  const oferty = (Array.isArray(kalendarz?.pozycje) ? kalendarz.pozycje : [])
    .find((p) => p?.kod === 'oferty' && p.znany === true && typeof p.at === 'string' && p.at);
  if (oferty) params.termin = oferty.at;
  return params;
}

// ── Powiązanie analizy z przetargiem ─────────────────────────────────────────

/** Stany powiązania analizy SWZ z przetargiem, z którego otwarto Radar. */
export const STAN_POWIAZANIA = Object.freeze({
  BRAK: 'brak',   // jeszcze nie próbowaliśmy (np. otwarto istniejącą analizę)
  TRWA: 'trwa',
  OK: 'ok',
  BLAD: 'blad',
});

/**
 * Czy odpowiedź serwera (`PUT`/`GET …/tender/:id/swz`) POTWIERDZA powiązanie przetargu
 * właśnie z tą analizą. Sam brak wyjątku to za mało: odpowiedź bez rekordu albo z inną
 * analizą nie jest sukcesem.
 * @param {{powiazanie?: {postepowanie_id?: string}|null}|null|undefined} odpowiedz
 * @param {string|null|undefined} postepowanieId
 */
export function potwierdzonePowiazanie(odpowiedz, postepowanieId) {
  const zapisane = odpowiedz?.powiazanie?.postepowanie_id;
  return typeof zapisane === 'string' && zapisane.length > 0
    && typeof postepowanieId === 'string' && zapisane === postepowanieId;
}

/** Co wiemy z ODCZYTU powiązania po próbie, której wyniku serwer nie potwierdził. */
export const ODCZYT_POWIAZANIA = Object.freeze({
  TA: 'ta',               // serwer oddał powiązanie z TĄ analizą
  INNA: 'inna',           // serwer oddał powiązanie z inną analizą
  BRAK: 'brak',           // serwer odpowiedział, że przetarg nie ma powiązanej analizy
  NIEZNANY: 'nieznany',   // odczyt się nie udał albo odpowiedź była nieczytelna
});

/**
 * Co mówi odpowiedź `GET …/tender/:id/swz` o powiązaniu przetargu z TĄ analizą.
 * Odpowiedź bez pola `powiazanie` (albo o innym kształcie) to „nie wiemy", a nie „brak" —
 * tylko jawne `powiazanie: null` znaczy, że serwer potwierdził brak powiązania.
 * @param {*} odpowiedz ciało odpowiedzi
 * @param {string|null|undefined} postepowanieId
 * @returns {'ta'|'inna'|'brak'|'nieznany'}
 */
export function odczytanePowiazanie(odpowiedz, postepowanieId) {
  if (!odpowiedz || typeof odpowiedz !== 'object' || !('powiazanie' in odpowiedz)) return ODCZYT_POWIAZANIA.NIEZNANY;
  const rekord = odpowiedz.powiazanie;
  if (rekord === null) return ODCZYT_POWIAZANIA.BRAK;
  const zapisane = rekord?.postepowanie_id;
  if (typeof zapisane !== 'string' || !zapisane) return ODCZYT_POWIAZANIA.NIEZNANY;
  return zapisane === postepowanieId ? ODCZYT_POWIAZANIA.TA : ODCZYT_POWIAZANIA.INNA;
}

/**
 * Odczytuje stan powiązania z serwera. `OK` wyłącznie, gdy serwer oddał TĘ analizę;
 * w każdym innym przypadku `BLAD` z informacją, co (i czy cokolwiek) udało się ustalić.
 *
 * @param {{odczytaj: (tenderId: any) => Promise<any>, tenderId: any, postepowanieId: string,
 *   komunikat?: string|null}} wejscie `komunikat` = powód wcześniejszej nieudanej próby
 * @returns {Promise<{stan: 'ok'|'blad', postepowanieId: string, komunikat: string|null,
 *   odczyt: 'inna'|'brak'|'nieznany'|null}>}
 */
export async function sprawdzPowiazanie({ odczytaj, tenderId, postepowanieId, komunikat = null }) {
  let odczyt = ODCZYT_POWIAZANIA.NIEZNANY;
  let powod = komunikat;
  try {
    odczyt = odczytanePowiazanie(await odczytaj(tenderId), postepowanieId);
  } catch (err) {
    powod = powod ?? err?.message ?? null;
  }
  if (odczyt === ODCZYT_POWIAZANIA.TA) {
    return { stan: STAN_POWIAZANIA.OK, postepowanieId, komunikat: null, odczyt: null };
  }
  return { stan: STAN_POWIAZANIA.BLAD, postepowanieId, komunikat: powod, odczyt };
}

/**
 * Wiąże analizę z przetargiem i POTWIERDZA wynik.
 *
 * Błąd żądania nie znaczy, że nic się nie zapisało: odpowiedź mogła zaginąć PO zapisie
 * (zerwane połączenie, timeout mostu). Dlatego po każdej próbie bez potwierdzenia —
 * wyjątku albo odpowiedzi, która nie oddaje tej analizy — pytamy serwer o stan faktyczny.
 * Dopiero odczyt rozstrzyga: `OK`, „powiązana inna", „brak powiązania" albo „nie wiemy".
 *
 * @param {{powiaz: (tenderId: any, postepowanieId: string) => Promise<any>,
 *   odczytaj: (tenderId: any) => Promise<any>, tenderId: any, postepowanieId: string}} wejscie
 * @returns {ReturnType<typeof sprawdzPowiazanie>}
 */
export async function powiazIPotwierdz({ powiaz, odczytaj, tenderId, postepowanieId }) {
  let powod;
  try {
    const odpowiedz = await powiaz(tenderId, postepowanieId);
    if (potwierdzonePowiazanie(odpowiedz, postepowanieId)) {
      return { stan: STAN_POWIAZANIA.OK, postepowanieId, komunikat: null, odczyt: null };
    }
    powod = 'serwer nie potwierdził zapisu';
  } catch (err) {
    powod = err?.message || 'żądanie nie powiodło się';
  }
  return sprawdzPowiazanie({ odczytaj, tenderId, postepowanieId, komunikat: powod });
}

/**
 * Co pokazać o powiązaniu TEJ analizy z przetargiem. Sukces ogłaszamy wyłącznie po
 * potwierdzeniu z serwera (`stan: 'ok'` dla tego samego postępowania). Przy błędzie
 * mówimy DOKŁADNIE tyle, ile wiemy z odczytu:
 *   • `odczyt: 'nieznany'` — nie mamy potwierdzenia; powiązanie mogło się zapisać,
 *   • `odczyt: 'brak'`     — serwer potwierdził, że przetarg nie ma powiązanej analizy,
 *   • `odczyt: 'inna'`     — serwer potwierdził, że powiązana jest inna analiza.
 * Zawsze jest odczyt stanu i ponowienie. Bez przetargu w kontekście (Radar z katalogu
 * narzędzi) karty nie ma w ogóle.
 *
 * @param {{tenderId: string|number|null, postepowanieId: string|null,
 *   powiazanie: {stan?: string, postepowanieId?: string|null, komunikat?: string|null,
 *     odczyt?: string|null}|null}} wejscie
 * @returns {null|{ton: 'sukces'|'danger'|'ostrzezenie'|'neutral', tekst: string,
 *   akcje: Array<'checklista'|'sprawdz'|'ponow'|'powiaz'>, wToku: boolean}}
 */
export function opisPowiazania({ tenderId, postepowanieId, powiazanie } = {}) {
  if (tenderId === null || tenderId === undefined || !postepowanieId) return null;
  const dotyczyTej = powiazanie?.postepowanieId === postepowanieId;
  const stan = dotyczyTej ? powiazanie.stan : STAN_POWIAZANIA.BRAK;

  if (stan === STAN_POWIAZANIA.OK) {
    return {
      ton: 'sukces', akcje: ['checklista'], wToku: false,
      tekst: 'Ta analiza jest powiązana z wybranym przetargiem — checklista dokumentów weźmie z niej wymagania.',
    };
  }
  if (stan === STAN_POWIAZANIA.TRWA) {
    return { ton: 'neutral', akcje: [], wToku: true, tekst: 'Zapisujemy i potwierdzamy powiązanie z przetargiem…' };
  }
  if (stan === STAN_POWIAZANIA.BLAD) {
    const powod = typeof powiazanie.komunikat === 'string' && powiazanie.komunikat.trim()
      ? ` (${powiazanie.komunikat.trim()})` : '';
    if (powiazanie.odczyt === ODCZYT_POWIAZANIA.BRAK) {
      return {
        ton: 'danger', akcje: ['ponow', 'sprawdz'], wToku: false,
        tekst: `Powiązanie się nie zapisało${powod}: serwer potwierdza, że ten przetarg nie ma jeszcze powiązanej analizy. Analiza jest zapisana w Radarze — ponów powiązanie.`,
      };
    }
    if (powiazanie.odczyt === ODCZYT_POWIAZANIA.INNA) {
      return {
        ton: 'ostrzezenie', akcje: ['ponow', 'sprawdz'], wToku: false,
        tekst: `Z tym przetargiem jest teraz powiązana inna analiza${powod}. Ponów powiązanie, jeśli checklista ma korzystać z tej.`,
      };
    }
    return {
      ton: 'danger', akcje: ['sprawdz', 'ponow'], wToku: false,
      tekst: `Nie mamy potwierdzenia, że ta analiza jest powiązana z przetargiem${powod}. Powiązanie mogło się zapisać mimo błędu — sprawdź je albo ponów. Analiza jest zapisana w Radarze.`,
    };
  }
  return {
    ton: 'neutral', akcje: ['powiaz'], wToku: false,
    // Bez twierdzenia o stanie na serwerze — wiemy tylko, że TA analiza nie została
    // tu potwierdzona jako powiązana.
    tekst: 'Powiąż tę analizę z przetargiem, z którego otwarto Radar — checklista dokumentów weźmie wtedy wymagania z niej.',
  };
}

// ── Treść SWZ do sprawdzania dokumentów ──────────────────────────────────────

/**
 * Zdanie o tym, czy i skąd Radar ma treść SWZ do dopasowania dokumentów — z pola
 * `tresc_swz` panelu. Starszy backend tego pola nie oddaje: wtedy `null`, bo nie wiemy
 * i niczego nie obiecujemy.
 *
 * @param {{zrodlo?: string, zapisana_at?: string|null}|null|undefined} trescSwz
 * @returns {null|{ton: 'sukces'|'neutral', tekst: string, zapamietujemyPierwsza: boolean}}
 */
export function opisTresciSwz(trescSwz) {
  if (!trescSwz || typeof trescSwz !== 'object') return null;
  if (trescSwz.zrodlo === 'wklejona') {
    return {
      ton: 'sukces', zapamietujemyPierwsza: true,
      tekst: 'Treść SWZ jest zapisana (wklejona przez Ciebie). Na jej podstawie sprawdzamy dokumenty w sejfie — także wtedy, gdy analiza AI się nie uda.',
    };
  }
  if (trescSwz.zrodlo === 'wersja') {
    return {
      ton: 'sukces', zapamietujemyPierwsza: true,
      tekst: 'Do sprawdzania dokumentów używamy najnowszej wersji SWZ podanej w „Sprawdź publikacje zamawiającego".',
    };
  }
  if (trescSwz.zrodlo === 'brak') {
    return {
      ton: 'neutral', zapamietujemyPierwsza: true,
      tekst: 'Radar nie ma jeszcze treści SWZ tego postępowania. Wklej ją poniżej — pierwszą wklejoną treść zapamiętamy do sprawdzania dokumentów.',
    };
  }
  return null;
}

/**
 * Podpowiedź, gdy dopasowanie sejfu nie zwróciło żadnego wymaganego dokumentu. Dwie
 * RÓŻNE sytuacje wyglądają tak samo (pusta lista), a wymagają innego ruchu:
 *   • Radar nie ma treści SWZ          → trzeba ją wkleić,
 *   • treść jest, parser nic nie znalazł → trzeba sprawdzić SWZ ręcznie (parser zna
 *     tylko kilka typowych dokumentów; pusty wynik NIE znaczy „nic nie trzeba").
 * Bez pola `zrodlo_swz` (starszy backend) nie zgadujemy, która to z nich.
 *
 * @param {string|null|undefined} zrodloSwz pole `zrodlo_swz` odpowiedzi dopasowania
 * @returns {string}
 */
export function podpowiedzPustegoDopasowania(zrodloSwz) {
  if (zrodloSwz === 'brak') {
    return 'Radar nie ma jeszcze treści SWZ tego postępowania. Wklej ją w „Wygeneruj pytania" powyżej i sprawdź ponownie.';
  }
  if (zrodloSwz === 'wklejona' || zrodloSwz === 'wersja' || zrodloSwz === 'zadanie') {
    return 'W zapisanej treści SWZ nie rozpoznaliśmy żadnego z typowych dokumentów. To nie znaczy, że SWZ ich nie wymaga — '
      + 'rozpoznajemy tylko kilka najczęstszych (m.in. KRK, zaświadczenia US i ZUS, polisę OC, odpis z rejestru, wykazy). '
      + 'Sprawdź w SWZ rozdział o podmiotowych środkach dowodowych.';
  }
  return 'Nie wykryliśmy w SWZ konkretnych wymaganych dokumentów. Jeśli Radar nie dostał jeszcze treści SWZ, '
    + 'wklej ją w „Sprawdź publikacje zamawiającego" powyżej i sprawdź ponownie. Pusty wynik nie znaczy, że SWZ niczego nie wymaga.';
}

// ── Odliczanie do terminu pytań ──────────────────────────────────────────────

/** Polska odmiana „dzień/dni" (1 dzień, 2 dni, 5 dni). */
function slowoDni(n) {
  return Math.abs(n) === 1 ? 'dzień' : 'dni';
}

/**
 * Opis odliczania do terminu składania pytań do SWZ na podstawie obiektu
 * `termin_pytania` z backendu (`{ terminPytan, dniPozostalo, minelo }`).
 * Backend liczy datę i pozostałe dni; tu tylko nazywamy stan dla banera.
 *
 * @param {{terminPytan: string|null, dniPozostalo: number|null, minelo: boolean}|null|undefined} t
 * @returns {{stan: 'brak'|'minelo'|'dzis'|'pilne'|'ok', etykieta: string, pilny: boolean}}
 */
export function odliczaniePytan(t) {
  if (!t || !t.terminPytan) {
    return { stan: 'brak', etykieta: 'Termin pytań nieznany — uzupełnij daty postępowania', pilny: false };
  }
  if (t.minelo) {
    return { stan: 'minelo', etykieta: 'Termin na pytania do SWZ minął', pilny: false };
  }
  const dni = Number.isFinite(t.dniPozostalo) ? t.dniPozostalo : null;
  if (dni === null) {
    return { stan: 'ok', etykieta: 'Pytania do SWZ można jeszcze składać', pilny: false };
  }
  if (dni <= 0) {
    return { stan: 'dzis', etykieta: 'Ostatni dzień na pytania do SWZ — składasz jeszcze tylko dziś', pilny: true };
  }
  return {
    stan: dni <= 3 ? 'pilne' : 'ok',
    etykieta: `Na pytania do SWZ zostało ${dni} ${slowoDni(dni)}`,
    pilny: dni <= 3,
  };
}

// ── Pytania ──────────────────────────────────────────────────────────────────

/** Ludzka etykieta statusu pytania (cykl: szkic → wysłane → odpowiedziane). */
export const ETYKIETA_STATUSU_PYTANIA = Object.freeze({
  szkic: 'Szkic',
  wyslane: 'Wysłane',
  odpowiedziane: 'Odpowiedziane',
});

/** Etykieta statusu pytania z fallbackiem na surową wartość. */
export function statusPytaniaEtykieta(status) {
  return ETYKIETA_STATUSU_PYTANIA[status] ?? (status || 'Szkic');
}

// ── Timeline zmian: diff ─────────────────────────────────────────────────────

/**
 * Rozbija tekstowy diff (silnik różnic SWZ) na linie z typem do pokolorowania:
 *   • `+ …`  => 'dodane'   (nowa treść),
 *   • `- …`  => 'usuniete' (stara treść),
 *   • `…`    => 'zwiniete' (odległy, pominięty fragment),
 *   • reszta => 'kontekst'.
 * Wiodący znacznik `+`/`-`/spacja jest ścinany — do wyświetlenia zostaje sama treść.
 *
 * @param {string|null|undefined} diff
 * @returns {Array<{typ: 'dodane'|'usuniete'|'kontekst'|'zwiniete', tekst: string}>}
 */
export function parsujDiff(diff) {
  if (!diff || !String(diff).trim()) return [];
  return String(diff).split('\n').map((linia) => {
    if (linia === '…' || linia === '...') return { typ: 'zwiniete', tekst: '…' };
    const znak = linia[0];
    if (znak === '+') return { typ: 'dodane', tekst: linia.slice(1) };
    if (znak === '-') return { typ: 'usuniete', tekst: linia.slice(1) };
    if (znak === ' ') return { typ: 'kontekst', tekst: linia.slice(1) };
    return { typ: 'kontekst', tekst: linia };
  });
}

// ── Sekcje oferty i bramka ───────────────────────────────────────────────────

/** Ludzkie nazwy kanonicznych sekcji oferty (mapowanie zmian SWZ). */
export const ETYKIETA_SEKCJI = Object.freeze({
  harmonogram: 'Harmonogram',
  cena: 'Cena',
  parametry: 'Parametry',
});

/** Etykieta sekcji oferty z fallbackiem (pierwsza litera wielka). */
export function etykietaSekcji(sekcja) {
  if (ETYKIETA_SEKCJI[sekcja]) return ETYKIETA_SEKCJI[sekcja];
  const s = String(sekcja ?? '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Nagłówek banera bramki wg jej poziomu. */
export const ETYKIETA_POZIOMU_BRAMKI = Object.freeze({
  ok: 'Gotowe do wysłania',
  blokada: 'Wysyłka zablokowana',
  ostrzezenie: 'Wysłano mimo nieuwzględnionych zmian',
});

/** Etykieta poziomu bramki z fallbackiem. */
export function etykietaPoziomuBramki(poziom) {
  return ETYKIETA_POZIOMU_BRAMKI[poziom] ?? 'Stan wysyłki';
}
