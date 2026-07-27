/**
 * Katalog typów dokumentów sejfu (ulepszenie „Sejf podmiotowych środków
 * dowodowych z licznikiem świeżości", podzadanie 1/7).
 *
 * Źródło prawdy dla typów dokumentów przechowywanych w tabeli `sejf_dokumenty`
 * (`typ_dokumentu` trzyma `id` stąd). Dla każdego typu wiemy:
 *  • `okresWaznosciDniDomyslny` — ile dni dokument jest „świeży" (domyślnie; per
 *    rekord użytkownik może nadpisać, bo np. polisa OC bywa półroczna). NULL =
 *    dokument bezterminowy (wykaz robót, część uprawnień) — licznik świeżości go
 *    nie przeterminuje.
 *  • `czasOczekiwaniaUrzadDni` — REALNY, ostrożny (najgorszy) czas wyrobienia w
 *    urzędzie. To on decyduje, JAK WCZEŚNIE alertować o kończącej się ważności:
 *    KRK pocztą potrafi iść tygodniami, więc alert idzie odpowiednio wcześniej niż
 *    dla zaświadczenia wydawanego od ręki (kalkulator `dzienAlertu` w podzadaniu 2).
 *  • `wymagaDokumentuElektronicznego` — czy w zamówieniach publicznych trzeba
 *    trzymać ORYGINAŁ elektroniczny (XML / podpisany PDF), a nie skan papieru
 *    (detekcja i ostrzeżenie w podzadaniu 3).
 *  • `online` — gdzie wyrobić dokument przez internet (e-KRK / PUE ZUS /
 *    e-Urząd Skarbowy / eKRS / CEIDG); NULL, gdy nie ma centralnej e-usługi
 *    (polisa u ubezpieczyciela, dokumenty własne wykonawcy).
 *
 * Liczby ważności są zgodne z praktyką postępowań (KRK 6 miesięcy = 180 dni,
 * niezaleganie US/ZUS ~3 miesiące = 90 dni). To KONFIGURACJA, a nie zaszyte w
 * logice liczby — świeżość i alerty (podzadania 2, 3, 6) czytają z tego katalogu.
 */

/** Dozwolone formaty oryginalnego pliku (spójne z CHECK-iem w `sejf_dokumenty`). */
export const PLIK_FORMATY = Object.freeze(['xml', 'pdf']);

/**
 * Definicje typów. Kolejność = domyślna kolejność prezentacji w sejfie
 * (najpierw dokumenty „urzędowe" o krótkiej ważności, które trzeba pilnować).
 * @typedef {Object} TypDokumentu
 * @property {string}      id                            stabilny klucz (zapisywany w bazie)
 * @property {string}      nazwa                         etykieta PL
 * @property {string}      opis                          krótka podstawa ważności (kontekst UI)
 * @property {number|null} okresWaznosciDniDomyslny      domyślna ważność w dniach; NULL = bezterminowy
 * @property {number}      czasOczekiwaniaUrzadDni       realny (najgorszy) czas wyrobienia w urzędzie
 * @property {boolean}     wymagaDokumentuElektronicznego czy wymaga oryginału elektronicznego (XML/podpisany PDF)
 * @property {{nazwa: string, url: string}|null} online  e-usługa, gdzie wyrobić; NULL gdy brak
 */

/** @type {ReadonlyArray<TypDokumentu>} */
export const TYPY_DOKUMENTOW = Object.freeze([
  {
    id: 'krk',
    nazwa: 'Zaświadczenie o niekaralności (KRK)',
    opis: 'Ważne, gdy wystawione nie wcześniej niż 6 miesięcy przed dniem złożenia oferty.',
    okresWaznosciDniDomyslny: 180,   // 6 miesięcy przed złożeniem
    czasOczekiwaniaUrzadDni: 21,     // e-KRK bywa szybko, ale pocztą/tradycyjnie potrafi iść ~3 tygodnie
    wymagaDokumentuElektronicznego: true,
    online: { nazwa: 'e-KRK', url: 'https://ekrk.ms.gov.pl' },
  },
  {
    id: 'us',
    nazwa: 'Zaświadczenie o niezaleganiu w podatkach (US)',
    opis: 'Niezaleganie w podatkach z urzędu skarbowego — ważne zwykle 3 miesiące.',
    okresWaznosciDniDomyslny: 90,    // ~3 miesiące
    czasOczekiwaniaUrzadDni: 7,      // ustawowo do 7 dni; e-US bywa od ręki
    wymagaDokumentuElektronicznego: true,
    online: { nazwa: 'e-Urząd Skarbowy', url: 'https://www.podatki.gov.pl/e-urzad-skarbowy/' },
  },
  {
    id: 'zus',
    nazwa: 'Zaświadczenie o niezaleganiu w składkach (ZUS)',
    opis: 'Niezaleganie w składkach ZUS — ważne zwykle 3 miesiące.',
    okresWaznosciDniDomyslny: 90,    // ~3 miesiące
    czasOczekiwaniaUrzadDni: 7,      // PUE ZUS wydaje elektronicznie od ręki; papierowo do 7 dni
    wymagaDokumentuElektronicznego: true,
    online: { nazwa: 'PUE ZUS', url: 'https://www.zus.pl/portal' },
  },
  {
    id: 'polisa_oc',
    nazwa: 'Polisa OC (ubezpieczenie odpowiedzialności cywilnej)',
    opis: 'Ważna do końca okresu ubezpieczenia (zwykle 12 miesięcy) — termin bierz z polisy.',
    okresWaznosciDniDomyslny: 365,   // typowa polisa roczna; per rekord z realnego okresu ubezpieczenia
    czasOczekiwaniaUrzadDni: 3,      // od ubezpieczyciela, nie z urzędu
    wymagaDokumentuElektronicznego: false,
    online: null,                    // ubezpieczyciel — brak centralnej e-usługi
  },
  {
    id: 'wpis_rejestr',
    nazwa: 'Odpis z rejestru (KRS / CEIDG)',
    opis: 'Odpis z KRS (spółki) lub wpis CEIDG (JDG) — pobierany elektronicznie na bieżąco.',
    okresWaznosciDniDomyslny: 90,    // w praktyce „nie starszy niż 3 miesiące" / pobierany na bieżąco
    czasOczekiwaniaUrzadDni: 1,      // odpis elektroniczny od ręki
    wymagaDokumentuElektronicznego: true,
    online: { nazwa: 'eKRS / CEIDG', url: 'https://www.biznes.gov.pl' },
  },
  {
    id: 'wykaz_robot_uslugi',
    nazwa: 'Wykaz wykonanych robót / usług',
    opis: 'Dokument własny wykonawcy (doświadczenie) — bezterminowy, aktualizowany.',
    okresWaznosciDniDomyslny: null,  // bezterminowy — licznik świeżości go nie przeterminowuje
    czasOczekiwaniaUrzadDni: 0,      // dokument własny, brak urzędu
    wymagaDokumentuElektronicznego: false,
    online: null,
  },
  {
    id: 'uprawnienia_pracownikow',
    nazwa: 'Uprawnienia pracowników',
    opis: 'Uprawnienia budowlane / certyfikaty — ważność zależna od rodzaju (część bezterminowa).',
    okresWaznosciDniDomyslny: null,  // domyślnie bezterminowe; okresowe (np. SEP) ustaw per rekord
    czasOczekiwaniaUrzadDni: 0,      // posiadane; odnowienie zależne od izby zawodowej
    wymagaDokumentuElektronicznego: false,
    online: null,
  },
]);

/** Zbiór dozwolonych `id` typów — szybka walidacja `typ_dokumentu`. */
export const ID_TYPOW_DOKUMENTOW = Object.freeze(TYPY_DOKUMENTOW.map((t) => t.id));

const PO_ID = new Map(TYPY_DOKUMENTOW.map((t) => [t.id, t]));

/**
 * Zwraca definicję typu dokumentu po `id` (albo `undefined`, gdy nieznany).
 * @param {string} id
 * @returns {TypDokumentu|undefined}
 */
export function typDokumentu(id) {
  return PO_ID.get(id);
}

/** Czy `id` jest znanym typem dokumentu sejfu. */
export function jestZnanymTypem(id) {
  return PO_ID.has(id);
}
