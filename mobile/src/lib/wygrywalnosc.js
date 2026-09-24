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
 * Zdanie o gotowości. Rozróżnia „wszystko masz" od „nie wiemy, czego trzeba" —
 * obie sytuacje dają zero braków, a znaczą coś przeciwnego.
 */
export function opisGotowosci(checklista, jezyk = 'pl') {
  if (!checklista) return null;
  const stan = checklista.stanWiedzy ?? {};

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
  if (!stan.znamySejf) {
    return {
      ton: 'ostrzezenie',
      tekst: jezyk === 'en'
        ? 'Your document safe is empty — everything shows as missing.'
        : 'Twój sejf dokumentów jest pusty — wszystko pokazuje się jako brakujące.',
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
