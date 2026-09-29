/**
 * Prezentacja karty „Czy warto startować?" i checklisty oferty (etap 6).
 *
 * Czysta logika: zero importów z React Native, zero sieci, zero kolorów w hexie.
 * Ekran dostaje `ton` (klasa koloru) i mapuje go na tokeny `motyw.js` — tak samo
 * jak Sejf i Czarna skrzynka.
 *
 * ── 🚨 GRANICA, KTÓREJ TEN PLIK NIE PRZEKRACZA ───────────────────────────────
 *
 * Nie zamienia czynników na „procent szans" ani na żadną pojedynczą liczbę
 * „jak dobrze ci pójdzie". Backend celowo takiej liczby nie oddaje, bo
 * rozstrzygnięcia mówią, co stało się na rynku, a nie jak wypadnie TA oferta.
 * Gdyby warstwa prezentacji policzyła sobie taki wskaźnik z tonów, obeszłaby
 * decyzję, która zapadła po stronie danych — i firma podjęłaby decyzję
 * biznesową na podstawie liczby, która nic nie mierzy.
 */

/** Klasy koloru. Ekran tłumaczy je na tokeny motywu (sukces/ostrzezenie/danger/neutral). */
export const TONY = Object.freeze({
  zielony: 'sukces',
  zolty: 'ostrzezenie',
  czerwony: 'danger',
  nieznany: 'neutral',
});

/** Ton czynnika → klasa koloru dla ekranu. Nieznany ton nie udaje sukcesu. */
export function tonCzynnika(ton) {
  return TONY[ton] ?? 'neutral';
}

/** Werdykty karty — etykieta, ton i zdanie, które użytkownik czyta najpierw. */
export const WERDYKTY = Object.freeze({
  sprawdz: {
    etykieta: { pl: 'Warto się przyjrzeć', en: 'Worth a closer look' },
    ton: 'sukces',
  },
  uwazaj: {
    etykieta: { pl: 'Da się, ale są haczyki', en: 'Doable, with caveats' },
    ton: 'ostrzezenie',
  },
  trudny: {
    etykieta: { pl: 'Trudny rynek', en: 'Tough market' },
    ton: 'danger',
  },
  brak_danych: {
    etykieta: { pl: 'Za mało danych', en: 'Not enough data' },
    ton: 'neutral',
  },
  po_terminie: {
    etykieta: { pl: 'Termin minął', en: 'Deadline passed' },
    ton: 'danger',
  },
});

export function opisWerdyktu(werdykt, jezyk = 'pl') {
  const wpis = WERDYKTY[werdykt] ?? WERDYKTY.brak_danych;
  return { etykieta: wpis.etykieta[jezyk] ?? wpis.etykieta.pl, ton: wpis.ton };
}

/** Skąd policzono benchmark — po ludzku, bo „cpv:45|14" nic nie mówi. */
export const ZRODLA_BENCHMARKU = Object.freeze({
  zamawiajacy: { pl: 'u tego zamawiającego', en: 'at this buyer' },
  dzial_region: { pl: 'w tej branży w Twoim województwie', en: 'in this sector in your region' },
  dzial_kraj: { pl: 'w tej branży w całej Polsce', en: 'in this sector across Poland' },
});

/**
 * Metryczka: na czym stoi wniosek.
 *
 * Bez niej wniosek z sześciu postępowań wygląda identycznie jak wniosek
 * z czterystu — a to jest cała różnica między statystyką a anegdotą.
 * `null`, gdy nie ma próbki: ekran ma wtedy nie rysować metryczki, a nie
 * pisać „na podstawie 0 postępowań".
 */
export function metryczkaProbki(karta, jezyk = 'pl') {
  const probka = karta?.probka;
  if (!probka || !probka.czesci) return null;

  const gdzie = ZRODLA_BENCHMARKU[karta.zrodloBenchmarku]?.[jezyk]
    ?? ZRODLA_BENCHMARKU[karta.zrodloBenchmarku]?.pl
    ?? null;
  const zakres = probka.od && probka.do ? `${probka.od} – ${probka.do}` : null;
  const rejestry = (probka.zrodla ?? []).map((z) => z.toUpperCase()).join(' + ') || null;

  const czesci = probka.czesci;
  // Po polsku liczebnik zmienia CAŁĄ frazę, nie tylko końcówkę rzeczownika
  // („1 rozstrzygniętej części" vs „7 rozstrzygniętych części"), więc odmieniamy
  // frazę, a nie doklejamy „s" jak w angielskim.
  const fraza = czesci === 1 ? 'jednej rozstrzygniętej części' : `${czesci} rozstrzygniętych części`;

  return {
    tekst: jezyk === 'en'
      ? `Based on ${czesci} settled ${czesci === 1 ? 'part' : 'parts'}${gdzie ? ` ${gdzie}` : ''}.`
      : `Na podstawie ${fraza}${gdzie ? ` ${gdzie}` : ''}.`,
    zakres,
    rejestry,
  };
}

/** Odmiana „dzień/dni". */
export function odmianaDni(n) {
  return Math.abs(Number(n) || 0) === 1 ? 'dzień' : 'dni';
}

/**
 * Czynniki w kolejności do wyświetlenia: najpierw to, co blokuje.
 *
 * Czerwone przed żółtymi, żółte przed zielonymi, nieznane na końcu.
 * Użytkownik czyta od góry i ma zobaczyć powód odpuszczenia, zanim zobaczy
 * powody do optymizmu — odwrotna kolejność sprzedawałaby przetarg.
 */
const WAGA_TONU = { czerwony: 0, zolty: 1, zielony: 2, nieznany: 3 };

export function uporzadkujCzynniki(czynniki) {
  return [...(czynniki ?? [])].sort(
    (a, b) => (WAGA_TONU[a?.ton] ?? 3) - (WAGA_TONU[b?.ton] ?? 3),
  );
}

/** Ile czynników w każdym tonie — do paska podsumowania. */
export function policzTony(czynniki) {
  const wynik = { zielony: 0, zolty: 0, czerwony: 0, nieznany: 0 };
  for (const c of czynniki ?? []) {
    if (wynik[c?.ton] !== undefined) wynik[c.ton] += 1;
  }
  return wynik;
}

// ── Checklista oferty ────────────────────────────────────────────────────────

/** Koszyki checklisty — etykieta, ton i kolejność wyświetlania. */
export const KOSZYKI_CHECKLISTY = Object.freeze([
  {
    kod: 'brakuje',
    etykieta: { pl: 'Brakuje', en: 'Missing' },
    ton: 'danger',
    opis: {
      pl: 'Nie masz tego w sejfie — zamów albo wgraj.',
      en: 'Not in your document safe — order or upload it.',
    },
  },
  {
    kod: 'przeterminuje_sie',
    etykieta: { pl: 'Straci ważność przed złożeniem', en: 'Expires before submission' },
    ton: 'ostrzezenie',
    opis: {
      pl: 'Masz to dzisiaj, ale w dniu składania będzie już nieważne.',
      en: 'You have it today, but it will be expired on submission day.',
    },
  },
  {
    kod: 'masz',
    etykieta: { pl: 'Masz', en: 'Ready' },
    ton: 'sukces',
    opis: {
      pl: 'Ważne w dniu składania oferty.',
      en: 'Valid on the submission day.',
    },
  },
]);

/**
 * Odpowiedź dopasowania sejf↔SWZ (Railway `POST /api/przetarg/sejf/dopasowanie/:id`)
 * → wymagania dla checklisty (audyt 2026-09-29).
 *
 * Prawdziwe pole to `wymagane_typy` — identyfikatory typów z katalogu sejfu, wykryte
 * deterministycznie (bez płatnego AI) w SWZ zapisanej w Radarze. Wcześniej ekran brał
 * `checklista` z Radaru SWZ, czyli listę ZMIAN SWZ do odhaczenia — inny obiekt.
 * Wszystko, co nie jest listą niepustych napisów, to `nieznany_format`: lepiej
 * powiedzieć „nie wiemy", niż zbudować z tego checklistę, która kłamie.
 *
 * @param {object|null} odpowiedz ciało odpowiedzi dopasowania
 * @param {Array<{id: string, nazwa: string}>} katalogTypow katalog sejfu (nazwy do wyświetlenia)
 * @returns {{stan: 'znane'|'brak_wymagan'|'nieznany_format',
 *   wymagania: Array<{kod: string, nazwa: string, obowiazkowe: true}>}}
 */
export function wymaganiaZDopasowania(odpowiedz, katalogTypow = []) {
  const typy = odpowiedz?.wymagane_typy;
  if (!Array.isArray(typy) || !typy.every((t) => typeof t === 'string' && t.trim())) {
    return { stan: 'nieznany_format', wymagania: [] };
  }
  const kody = [...new Set(typy.map((t) => t.trim()))];
  if (!kody.length) return { stan: 'brak_wymagan', wymagania: [] };
  const nazwy = new Map((Array.isArray(katalogTypow) ? katalogTypow : []).map((t) => [t?.id, t?.nazwa]));
  return {
    stan: 'znane',
    wymagania: kody.map((kod) => ({ kod, nazwa: nazwy.get(kod) || kod, obowiazkowe: true })),
  };
}

/** Komunikaty „gotowość nieustalona" — skąd wymagania NIE przyszły. */
const NIEUSTALONE_WYMAGANIA = {
  brak_powiazania: {
    pl: 'Nie wiemy jeszcze, czego wymaga to postępowanie — połącz ten przetarg z analizą SWZ z Radaru.',
    en: 'We do not know what this tender requires yet — link it to a tender-document analysis from the radar.',
  },
  blad: {
    pl: 'Nie udało się pobrać wymagań z analizy SWZ — gotowość nieustalona. Spróbuj odświeżyć.',
    en: 'Could not load requirements from the tender-document analysis — readiness unknown. Try refreshing.',
  },
  nieznany_format: {
    pl: 'Analiza SWZ zwróciła wymagania w nieznanym formacie — gotowość nieustalona.',
    en: 'The tender-document analysis returned requirements in an unknown format — readiness unknown.',
  },
  brak_wymagan: {
    pl: 'Analiza SWZ nie wskazała wymaganych dokumentów — sprawdź SWZ ręcznie; gotowość nieustalona.',
    en: 'The tender-document analysis found no required documents — check the documents manually; readiness unknown.',
  },
};

/**
 * Zdanie o gotowości. Rozróżnia „wszystko masz" od „nie wiemy, czego trzeba" —
 * obie sytuacje dają zero braków, a znaczą coś przeciwnego.
 *
 * `zrodla` (opcjonalne) mówi, skąd ekran wziął dane: bez znanych wymagań
 * (`wymagania !== 'znane'`) albo przy błędzie odczytu sejfu gotowość jest
 * NIEUSTALONA — nigdy „gotowe", nawet gdyby backend tak policzył.
 *
 * `wymagania: 'znane'` to lista z parsera FRAZ SWZ (Railway `wykryjWymaganeTypy`) —
 * HEURYSTYKA, nie komplet (review 2026-09-29: SWZ wymagająca KRS, US i ZUS innymi
 * słowami dawała tylko KRS, a ekran mówił „Wszystkie obowiązkowe dokumenty są
 * ważne"). Na takich danych nie ma tonu sukcesu ani twierdzenia o komplecie:
 * mówimy, ile wykryto, co brakuje/wygasa i że resztę SWZ trzeba sprawdzić.
 *
 * @param {{wymagania?: 'znane'|'brak_powiazania'|'blad'|'nieznany_format'|'brak_wymagan',
 *   sejf?: 'ok'|'blad', wykryte?: number}} [zrodla]
 */
export function opisGotowosci(checklista, jezyk = 'pl', zrodla = {}) {
  if (!checklista) return null;
  const stan = checklista.stanWiedzy ?? {};

  const nieustalone = NIEUSTALONE_WYMAGANIA[zrodla.wymagania];
  if (nieustalone) {
    return { ton: zrodla.wymagania === 'brak_powiazania' ? 'neutral' : 'ostrzezenie', tekst: nieustalone[jezyk] ?? nieustalone.pl };
  }
  if (zrodla.sejf === 'blad') {
    return {
      ton: 'ostrzezenie',
      tekst: jezyk === 'en'
        ? 'Could not read your document safe — readiness unknown. Try refreshing.'
        : 'Nie udało się odczytać sejfu dokumentów — gotowość nieustalona. Spróbuj odświeżyć.',
    };
  }

  if (!stan.znamyWymagania) {
    return {
      ton: 'neutral',
      tekst: jezyk === 'en'
        ? 'We do not know what this tender requires yet — run the tender-document radar first.'
        : 'Nie wiemy jeszcze, czego wymaga to postępowanie — przepuść SWZ przez Radar.',
    };
  }
  if (!stan.znamyTermin) {
    return {
      ton: 'ostrzezenie',
      tekst: jezyk === 'en'
        ? 'The notice gives no submission deadline, so we cannot check document validity for that day.'
        : 'Ogłoszenie nie podaje terminu składania, więc nie sprawdzimy ważności dokumentów na ten dzień.',
    };
  }
  const heurystyczne = zrodla.wymagania === 'znane';
  const wykryte = Number.isFinite(zrodla.wykryte) ? zrodla.wykryte
    : ['masz', 'przeterminuje_sie', 'brakuje'].reduce((n, k) => n + (checklista.koszyki?.[k] ?? []).length, 0);
  const uwagaHeurystyki = jezyk === 'en'
    ? ' The list may be incomplete — check the remaining tender-document requirements.'
    : ' Lista może być niepełna — sprawdź pozostałe wymagania SWZ.';

  if (!stan.znamySejf) {
    return {
      ton: 'ostrzezenie',
      tekst: (jezyk === 'en'
        ? 'Your document safe is empty — everything shows as missing.'
        : 'Twój sejf dokumentów jest pusty — wszystko pokazuje się jako brakujące.')
        + (heurystyczne ? uwagaHeurystyki : ''),
    };
  }
  if (heurystyczne) {
    const braki = (checklista.koszyki?.brakuje ?? []).length
      + (checklista.koszyki?.przeterminuje_sie ?? []).length;
    if (!braki) {
      return {
        ton: 'ostrzezenie',
        tekst: jezyk === 'en'
          ? `Documents detected automatically (${wykryte}) are valid on the submission day. This is a help, not a completeness check — check the remaining tender-document requirements.`
          : `Dokumenty wykryte automatycznie (${wykryte}) są ważne w dniu składania. To pomoc, nie potwierdzenie kompletności — sprawdź pozostałe wymagania SWZ.`,
      };
    }
    return {
      ton: 'danger',
      tekst: (jezyk === 'en'
        ? `${braki} item(s) to sort out out of ${wykryte} detected automatically.`
        : `${braki} ${braki === 1 ? 'rzecz' : 'rzeczy'} do załatwienia spośród ${wykryte} wykrytych automatycznie.`)
        + uwagaHeurystyki,
    };
  }
  if (checklista.gotowe) {
    return {
      ton: 'sukces',
      tekst: jezyk === 'en'
        ? 'All mandatory documents are valid on the submission day.'
        : 'Wszystkie obowiązkowe dokumenty są ważne w dniu składania.',
    };
  }
  const braki = (checklista.koszyki?.brakuje ?? []).length
    + (checklista.koszyki?.przeterminuje_sie ?? []).length;
  return {
    ton: 'danger',
    tekst: jezyk === 'en'
      ? `${braki} item(s) to sort out before the submission day.`
      : `${braki} ${braki === 1 ? 'rzecz' : 'rzeczy'} do załatwienia przed dniem składania.`,
  };
}

/** Licznik dni do dnia składania — z zapasem, który liczy backend. */
export function opisDniDoZlozenia(checklista, jezyk = 'pl') {
  const dni = checklista?.dniDoZlozenia;
  if (!Number.isFinite(dni)) return null;
  if (dni < 0) return jezyk === 'en' ? 'Submission day has passed' : 'Dzień złożenia już minął';
  if (dni === 0) return jezyk === 'en' ? 'Submission day is today' : 'Dzień złożenia to dzisiaj';
  return jezyk === 'en'
    ? `${dni} day(s) until the planned submission`
    : `${dni} ${odmianaDni(dni)} do planowanego złożenia`;
}
