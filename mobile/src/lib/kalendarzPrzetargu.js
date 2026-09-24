import { tr } from './jezyk.js';

/**
 * KALENDARZ TERMINÓW (etap 5, P1-7) — czysta logika ekranu, zero React Native.
 *
 * Backend liczy DATY (reguły ustawowe, strefa Europe/Warsaw, podstawa prawna).
 * Tutaj zostaje wyłącznie prezentacja: w jakiej kolejności, jakim tonem i jakimi
 * słowami. Podział jest celowy — przepis zmienia się w jednym miejscu, a wygląd
 * w drugim.
 */

/** Grupy pilności w stałej kolejności prezentacji. */
export const GRUPY_KALENDARZA = [
  { klucz: 'poterminie', etykieta: { pl: 'Po terminie', en: 'Past due' } },
  { klucz: 'dzis', etykieta: { pl: 'Dziś i jutro', en: 'Today and tomorrow' } },
  { klucz: 'wtymtygodniu', etykieta: { pl: 'W tym tygodniu', en: 'This week' } },
  { klucz: 'pozniej', etykieta: { pl: 'Później', en: 'Later' } },
  { klucz: 'anulowane', etykieta: { pl: 'Anulowane postępowania', en: 'Cancelled procurements' } },
];

const DZIEN_MS = 86_400_000;

/**
 * Ton pozycji terminu.
 *
 * Termin MINIONY jest neutralny, nie czerwony: czerwień ma znaczyć „działaj teraz",
 * a po terminie nie ma już czego robić. Zostawienie alarmu na minionych terminach
 * zamienia ekran w ścianę czerwieni, w której nowy, realny alarm ginie.
 */
export function tonPozycji(pozycja) {
  if (!pozycja?.znany) return 'neutral';
  if (pozycja.minal) return 'neutral';
  const dni = pozycja.dniDo;
  if (!Number.isFinite(dni)) return 'neutral';
  if (dni <= 1) return 'danger';
  if (dni <= 7) return 'ostrzezenie';
  return 'neutral';
}

function grupaPozycji(pozycja) {
  if (pozycja.minal) return 'poterminie';
  const dni = pozycja.dniDo;
  if (!Number.isFinite(dni)) return 'pozniej';
  if (dni <= 1) return 'dzis';
  if (dni <= 7) return 'wtymtygodniu';
  return 'pozniej';
}

/**
 * Wszystkie terminy wszystkich zapisanych przetargów na jednej osi pilności.
 *
 * Pozycje bez znanej daty NIE trafiają na oś — data, której nie znamy, nie ma gdzie
 * stanąć w kolejności. Są jednak POLICZONE (`nieznane`), żeby ekran mógł powiedzieć
 * „3 terminów nie znamy" zamiast po cichu je zgubić.
 */
export function ulozKalendarz(kalendarze, terazMs = Date.now(), jezyk = 'pl') {
  const pozycje = [];
  const anulowane = [];
  let nieznane = 0;

  for (const k of kalendarze ?? []) {
    if (k?.anulowany) {
      anulowane.push({
        tenderId: k.tenderId,
        tytul: k.tytul,
        zrodlo: k.zrodlo,
        anulowany: true,
        ton: 'neutral',
      });
      continue;
    }
    for (const p of k?.pozycje ?? []) {
      if (!p?.znany) { nieznane += 1; continue; }
      pozycje.push({
        ...p,
        tenderId: k.tenderId,
        tytulPrzetargu: k.tytul,
        zrodlo: k.zrodlo,
        czasMs: Date.parse(p.at),
        ton: tonPozycji(p),
        grupa: grupaPozycji(p),
        etykietaRodzaju: tr(p.etykieta, jezyk),
      });
    }
  }

  pozycje.sort((a, b) => a.czasMs - b.czasMs);

  const grupy = GRUPY_KALENDARZA
    .map((g) => ({
      klucz: g.klucz,
      etykieta: tr(g.etykieta, jezyk),
      pozycje: g.klucz === 'anulowane' ? anulowane : pozycje.filter((p) => p.grupa === g.klucz),
    }))
    .filter((g) => g.pozycje.length);

  return { grupy, nieznane, razem: pozycje.length };
}

function odmianaDni(n) {
  if (n === 1) return 'dzień';
  return 'dni';
}

/**
 * Karta „następny krok" — główny element ekranu.
 *
 * Odpowiada na jedno pytanie: CO robię najbliżej i DO KIEDY. Bez niej kalendarz
 * jest listą dat, którą trzeba przeczytać; z nią jest odpowiedzią.
 */
export function kartaNastepnegoKroku(nastepny, jezyk = 'pl') {
  if (!nastepny) {
    return {
      co: tr({
        pl: 'Brak nadchodzących terminów w zapisanych przetargach.',
        en: 'No upcoming deadlines in your saved tenders.',
      }, jezyk),
      kiedy: null,
      zostalo: null,
      ton: 'neutral',
      tytulPrzetargu: null,
    };
  }

  const dni = Number.isFinite(nastepny.dniDo) ? nastepny.dniDo : null;
  const zostalo = dni === null
    ? null
    : dni <= 0
      ? tr({ pl: 'Termin upływa dziś', en: 'Due today' }, jezyk)
      : tr({ pl: `Zostało ${dni} ${odmianaDni(dni)}`, en: `${dni} day${dni === 1 ? '' : 's'} left` }, jezyk);

  return {
    co: tr(nastepny.etykieta, jezyk),
    kiedy: nastepny.lokalnie?.etykieta ?? null,
    zostalo,
    ton: tonPozycji({ znany: true, dniDo: dni, minal: false }),
    tytulPrzetargu: nastepny.tytul ?? nastepny.tytulPrzetargu ?? null,
    tenderId: nastepny.tenderId ?? null,
  };
}

/**
 * Opis pojedynczej pozycji.
 *
 * `zrodlo` MUSI ujawniać, że data jest WYLICZONA z przepisu, a nie podana przez
 * zamawiającego: wyliczona jest maksimum ustawowym, a ogłoszenie może podać termin
 * krótszy. Pokazanie jej jako „termin z ogłoszenia" byłoby fałszywym pomiarem.
 */
export function opisPozycji(pozycja, jezyk = 'pl') {
  const wyliczony = pozycja?.zrodloDaty === 'wyliczony';
  const podstawa = pozycja?.podstawa ? tr(pozycja.podstawa, jezyk) : null;

  return {
    kod: pozycja?.kod ?? null,
    co: tr(pozycja?.etykieta, jezyk),
    opis: tr(pozycja?.opis, jezyk),
    kiedy: pozycja?.znany ? (pozycja.lokalnie?.etykieta ?? null) : null,
    ton: tonPozycji(pozycja),
    zrodlo: wyliczony
      ? tr({
        pl: `Termin wyliczony z przepisu (${podstawa ?? 'Pzp'}) — to maksimum ustawowe; ogłoszenie może podawać krótszy.`,
        en: `Deadline derived from statute (${podstawa ?? 'Polish PPL'}) — this is the statutory maximum; the notice may state a shorter one.`,
      }, jezyk)
      : tr({
        pl: 'Termin podany przez zamawiającego w ogłoszeniu.',
        en: 'Deadline stated by the buyer in the notice.',
      }, jezyk),
    brak: pozycja?.znany ? null : tr(pozycja?.brak, jezyk),
  };
}
