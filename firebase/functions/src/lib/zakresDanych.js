import { ZRODLA } from './katalogPrzetargow.js';

/*
 * „Zakres danych" (P1-4) — co aplikacja realnie widzi, a czego NIE.
 *
 * Produkt zbierający ogłoszenia z trzech rejestrów bardzo łatwo czyta się jako
 * „wszystkie przetargi w Polsce". To nieprawda i nie da się tego naprawić kodem:
 * BIP-y zamawiających, platformy zakupowe bez publicznego API i zamówienia
 * prywatne nie mają feedu, z którego dałoby się je legalnie pobrać. Wykonawca,
 * który uwierzy w komplet, przegapi postępowanie i obwini aplikację — słusznie.
 *
 * Ten moduł jest czysty: dostaje surowe ślady (`_health/cykl`, checkpointy okien)
 * i zamienia je w zdanie, które można pokazać człowiekowi w obu językach.
 */

/** Po ilu godzinach bez UDANEGO pobrania źródło uznajemy za opóźnione. */
export const PROG_OPOZNIENIA_H = 30;

/**
 * Czego aplikacja NIE obejmuje automatycznie. Lista jest częścią kontraktu,
 * nie tekstem marketingowym — każdy wpis to realna, zmierzona granica.
 */
const NIEOBJETE = [
  {
    kod: 'bip',
    tytul: {
      pl: 'Biuletyny Informacji Publicznej zamawiających',
      en: 'Contracting authorities’ public information bulletins (BIP)',
    },
    opis: {
      pl: 'Każdy urząd prowadzi własny BIP w innym formacie i bez wspólnego kanału danych. Część zakupów poniżej progu ustawowego pojawia się wyłącznie tam.',
      en: 'Every authority runs its own BIP in a different format with no common data feed. Some below-threshold purchases appear only there.',
    },
  },
  {
    kod: 'platformy_bez_api',
    tytul: {
      pl: 'Platformy zakupowe bez publicznego API',
      en: 'Procurement platforms without a public API',
    },
    opis: {
      pl: 'Platforma Zakupowa, eb2b, Logintrade, SmartPZP i podobne nie udostępniają publicznego kanału danych. Pobieranie ich stron wbrew regulaminom jest wykluczone.',
      en: 'Platforma Zakupowa, eb2b, Logintrade, SmartPZP and similar expose no public data feed. Scraping their pages against their terms of use is ruled out.',
    },
  },
  {
    kod: 'prywatne',
    tytul: {
      pl: 'Zapytania prywatne i komercyjne',
      en: 'Private and commercial requests for proposals',
    },
    opis: {
      pl: 'Zamówienia firm, które nie podlegają Prawu zamówień publicznych, nie są nigdzie publikowane centralnie.',
      en: 'Purchases by companies outside public procurement law are not published in any central register.',
    },
  },
  {
    kod: 'plany_postepowan',
    tytul: {
      pl: 'Plany postępowań (art. 23 Pzp)',
      en: 'Procurement plans (art. 23 of the Polish PPL)',
    },
    opis: {
      pl: 'API Biuletynu Zamówień Publicznych przyjmuje wyłącznie ogłoszenia o zamówieniu i o wyniku — planów nie da się z niego pobrać. Radar planów widzi za to wstępne ogłoszenia informacyjne z TED (zamówienia powyżej progów unijnych).',
      en: 'The BZP API accepts contract and result notices only — plans cannot be retrieved from it. The plan radar does see prior information notices from TED (contracts above EU thresholds).',
    },
  },
];

const ZASTRZEZENIE = {
  pl: 'PrzetargAI monitoruje wymienione wyżej rejestry publiczne. Nie obejmuje wszystkich zamówień udzielanych w Polsce — poza zasięgiem zostają BIP-y zamawiających, platformy zakupowe bez publicznego kanału danych i zamówienia prywatne. Przy dużym kontrakcie sprawdź też stronę zamawiającego.',
  en: 'PrzetargAI monitors the public registers listed above. It does not cover every contract awarded in Poland — authorities’ own bulletins, procurement platforms without a public data feed and private purchases stay out of reach. For a large contract, check the authority’s own website as well.',
};

function godzinOd(znacznik, teraz) {
  if (!znacznik) return null;
  const ms = Date.parse(teraz) - Date.parse(znacznik);
  if (!Number.isFinite(ms)) return null;
  return Number((ms / 3_600_000).toFixed(1));
}

/**
 * Stan źródła. Cztery rozłączne przypadki, bo każdy znaczy co innego dla
 * użytkownika: „działa", „milczy od dawna", „padło", „nie zbieramy stąd".
 */
function ustalStan({ aktywne, sukces, bladO, godzin }) {
  if (!aktywne) return 'wylaczone';
  if (!sukces && !bladO) return 'brak_danych';
  // Błąd NOWSZY niż ostatni sukces = źródło jest w awarii TERAZ.
  if (bladO && (!sukces || bladO > sukces)) return 'awaria';
  if (godzin === null || godzin > PROG_OPOZNIENIA_H) return 'opoznione';
  return 'ok';
}

function opisStanu(stan, { godzin, blad }) {
  switch (stan) {
    case 'ok':
      return {
        pl: `Działa — ostatnie udane pobranie ${godzin} h temu.`,
        en: `Working — last successful fetch ${godzin} h ago.`,
      };
    case 'opoznione':
      return {
        pl: godzin === null
          ? 'Brak udanego pobrania w ostatnim czasie.'
          : `Bez udanego pobrania od ${godzin} h — dane mogą być nieaktualne.`,
        en: godzin === null
          ? 'No successful fetch recently.'
          : `No successful fetch for ${godzin} h — data may be stale.`,
      };
    case 'awaria':
      return {
        pl: `Awaria pobierania: ${blad ?? 'nieznany błąd'}. Nowe ogłoszenia z tego rejestru mogą nie docierać.`,
        en: `Fetch failure: ${blad ?? 'unknown error'}. New notices from this register may not be arriving.`,
      };
    case 'wylaczone':
      return {
        pl: 'Źródło jest wyłączone w tej instalacji — nie pobieramy z niego ogłoszeń.',
        en: 'This source is switched off in this deployment — no notices are fetched from it.',
      };
    default:
      return {
        pl: 'Brak śladu pobrania — źródło jeszcze nie zdążyło zadziałać albo harmonogram nie wystartował.',
        en: 'No fetch on record — the source has not run yet or the schedule never started.',
      };
  }
}

/** Nowszy z dwóch znaczników ISO (null traktujemy jak „nie było"). */
function nowszy(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Ślad źródła złożony z DWÓCH niezależnych zapisów.
 *
 * Historia per źródło (`_health/cykl.zrodla`) pochodzi z dobowego cyklu, ale
 * BZP i Baza Konkurencyjności mają WŁASNE okna co 3 h z osobnym checkpointem —
 * świeższe i niezależne od tego, czy cykl dobowy zdążył się wykonać. Produkcja
 * 2026-09-24 pokazała, do czego prowadzi patrzenie tylko na cykl: karty mówiły
 * „brak śladu pobrania", choć oba okna domknęły się czysto tej samej nocy.
 *
 * Bierzemy nowszy znacznik z obu, osobno dla sukcesu i dla błędu — który z nich
 * wygra, rozstrzyga potem `ustalStan`.
 */
function sladZrodla(zCyklu, okno) {
  const slad = {
    ostatni_sukces_o: zCyklu?.ostatni_sukces_o ?? null,
    ostatni_blad_o: zCyklu?.ostatni_blad_o ?? null,
    ostatni_blad: zCyklu?.ostatni_blad ?? null,
  };
  if (!okno?.zakonczony_o) return slad;

  if (okno.error) {
    if (nowszy(slad.ostatni_blad_o, okno.zakonczony_o) === okno.zakonczony_o) {
      slad.ostatni_blad = String(okno.error);
    }
    slad.ostatni_blad_o = nowszy(slad.ostatni_blad_o, okno.zakonczony_o);
  } else {
    slad.ostatni_sukces_o = nowszy(slad.ostatni_sukces_o, okno.zakonczony_o);
  }
  return slad;
}

/** Pokrycie okna BZP: ile dób z okna zostało jeszcze niedomkniętych. */
function pokrycieBzp(okno) {
  if (!okno?.zakonczony_o) return null;
  const niedomkniete = okno.doby_niedomkniete ?? null;
  return {
    zakonczony_o: okno.zakonczony_o,
    doby_okna: okno.doby_okna ?? null,
    doby_niedomkniete: niedomkniete,
    kompletne: niedomkniete === 0,
    opis: niedomkniete === 0
      ? {
        pl: `Okno ${okno.doby_okna ?? '?'} dób domknięte w całości.`,
        en: `Window of ${okno.doby_okna ?? '?'} days fully closed.`,
      }
      : {
        pl: `${niedomkniete} z ${okno.doby_okna ?? '?'} dób okna nie zostało jeszcze domkniętych — część ogłoszeń może czekać na pobranie.`,
        en: `${niedomkniete} of ${okno.doby_okna ?? '?'} days in the window are not closed yet — some notices may still be pending.`,
      },
  };
}

/**
 * Pokrycie Bazy Konkurencyjności. Jedyny rejestr, który przy niepełnym przejściu
 * po prostu oddaje MNIEJ, bez żadnego błędu (kolejność listy jest niestabilna),
 * więc ta liczba jest jedynym zewnętrznym sygnałem niekompletności.
 */
function pokrycieBk(okno) {
  if (!okno?.zakonczony_o) return null;
  const wZrodle = okno.aktywne_w_zrodle ?? null;
  const pobrane = okno.aktywne_pobrane ?? null;
  const kompletne = okno.pokrycie_kompletne === true;
  return {
    zakonczony_o: okno.zakonczony_o,
    aktywne_w_zrodle: wZrodle,
    aktywne_pobrane: pobrane,
    zaleglosc: okno.zaleglosc ?? null,
    kompletne,
    opis: kompletne
      ? {
        pl: `Pobrano komplet: ${pobrane} z ${wZrodle} aktywnych ogłoszeń.`,
        en: `Complete: ${pobrane} of ${wZrodle} active notices fetched.`,
      }
      : {
        pl: `Pobrano ${pobrane} z ${wZrodle} aktywnych ogłoszeń — reszta czeka na kolejne okno.`,
        en: `Fetched ${pobrane} of ${wZrodle} active notices — the rest awaits the next window.`,
      },
  };
}

/**
 * Buduje pełny opis zakresu danych.
 *
 * @param {object} wejscie
 * @param {string} wejscie.teraz znacznik ISO „teraz" (wstrzykiwany — moduł nie czyta zegara)
 * @param {Record<string, boolean>} wejscie.wlaczone które źródła są aktywne w tej instalacji
 * @param {Record<string, {ostatni_sukces_o, ostatni_blad_o, ostatni_blad}>} wejscie.zrodlaCyklu
 * @param {object|null} [wejscie.oknoBzp] ostatni przebieg okna BZP
 * @param {object|null} [wejscie.oknoBk] ostatni przebieg okna Bazy Konkurencyjności
 */
export function zbudujZakresDanych({ teraz, wlaczone = {}, zrodlaCyklu = {}, oknoBzp = null, oknoBk = null }) {
  const okna = { bzp: oknoBzp, baza_konkurencyjnosci: oknoBk };

  const zrodla = ZRODLA.map((z) => {
    const slad = sladZrodla(zrodlaCyklu?.[z.kod], okna[z.kod]);
    const sukces = slad.ostatni_sukces_o ?? null;
    const bladO = slad.ostatni_blad_o ?? null;
    const godzin = godzinOd(sukces, teraz);
    const aktywne = wlaczone[z.kod] !== false;
    const stan = ustalStan({ aktywne, sukces, bladO, godzin });

    return {
      kod: z.kod,
      etykieta: z.etykieta,
      nazwa: z.nazwa,
      zakres: z.zakres,
      rejestr: z.rejestr,
      aktywne,
      ostatni_sukces_o: sukces,
      ostatni_blad_o: bladO,
      ostatni_blad: slad.ostatni_blad ?? null,
      godzin_od_sukcesu: godzin,
      stan,
      stan_opis: opisStanu(stan, { godzin, blad: slad.ostatni_blad ?? null }),
      pokrycie: z.kod === 'bzp' ? pokrycieBzp(oknoBzp)
        : z.kod === 'baza_konkurencyjnosci' ? pokrycieBk(oknoBk)
          : null,
    };
  });

  return {
    zaktualizowano_o: teraz,
    zrodla,
    nieobjete: NIEOBJETE,
    zastrzezenie: ZASTRZEZENIE,
  };
}

/**
 * Skrót „kod źródła → kiedy ostatnio działało" do kart i szczegółów ogłoszenia.
 * Karta ma pokazać, jak świeża jest informacja, bez pobierania całego opisu.
 */
export function znacznikiSynchronizacji(zakres) {
  const mapa = {};
  for (const z of zakres?.zrodla ?? []) {
    mapa[z.kod] = {
      etykieta: z.etykieta,
      nazwa: z.nazwa,
      stan: z.stan,
      ostatni_sukces_o: z.ostatni_sukces_o,
      rejestr: z.rejestr,
    };
  }
  return mapa;
}
