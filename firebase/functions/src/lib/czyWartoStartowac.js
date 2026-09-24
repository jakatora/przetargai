/*
 * Karta „Czy warto startować?" — czysta logika, zero I/O i zero AI.
 *
 * Zamienia benchmark rynku (lib/benchmark.js) i dane ogłoszenia w listę
 * CZYNNIKÓW z tonem zielony / żółty / czerwony, każdy z liczbą, z której
 * powstał, i z wielkością próbki.
 *
 * ── 🚨 CZEGO TA FUNKCJA NIE ROBI I ROBIĆ NIE BĘDZIE ──────────────────────────
 *
 * Nie podaje „prawdopodobieństwa wygranej". Rozstrzygnięcia mówią, co stało się
 * na rynku — ilu startowało, ile płacono, jak często unieważniano. NIE mówią,
 * jak wypadnie TWOJA oferta, bo o tym decyduje treść oferty, której nie znamy.
 * Liczba udająca to drugie byłaby fałszywym pomiarem: wykonawca odpuściłby
 * przetarg, który mógł wygrać, albo włożył tydzień w taki, w którym nie miał
 * szans — i w obu przypadkach z naszą liczbą jako uzasadnieniem.
 *
 * Werdykt jest więc KATEGORIĄ („sprawdź", „uważaj", „trudny rynek", „za mało
 * danych"), a nie procentem. Każdy czynnik niesie `probka`, żeby dało się
 * zobaczyć, na ilu postępowaniach stoi.
 */

/** Tony czynnika. `nieznany` = nie mamy danych, a nie „źle". */
export const TON = {
  ZIELONY: 'zielony',
  ZOLTY: 'zolty',
  CZERWONY: 'czerwony',
  NIEZNANY: 'nieznany',
};

/**
 * Progi. Wypisane jawnie, bo to decyzje produktowe, nie prawdy objawione —
 * ktoś musi móc je zakwestionować, nie czytając całego pliku.
 */
export const PROGI = {
  // Liczba ofert: tyle firm zwykle staje do części.
  konkurencjaMala: 3,
  konkurencjaDuza: 8,
  // Odsetek części unieważnionych u tego zamawiającego / w tym dziale.
  uniewaznieniaCzeste: 30,
  uniewaznieniaZauwazalne: 10,
  // Odsetek części wygranych przez małe i mikro firmy.
  maliCzesto: 50,
  maliRzadko: 25,
  // Dni do terminu składania ofert.
  dniKomfortowe: 14,
  dniNapiete: 7,
  // Mediana pozycji ceny w widełkach: poniżej = decyduje cena.
  pozycjaDecydujeCena: 0.2,
};

const KRYTERIUM_TYLKO_CENA = /(^|[^a-ząćęłńóśźż])cena\s*[-–:]?\s*100|wy[łl]ącznie cena|tylko cena|cena\s*=?\s*100\s*%/i;

function dniDo(termin, teraz) {
  if (!termin) return null;
  const koniec = Date.parse(termin);
  if (!Number.isFinite(koniec)) return null;
  return Math.floor((koniec - teraz) / 86_400_000);
}

/**
 * Który benchmark opisuje ten przetarg najlepiej.
 *
 * Kolejność nie jest dowolna: zamawiający > dział w regionie > dział w kraju.
 * Im węższy kubełek, tym trafniejszy, ale tym łatwiej mu o zbyt małą próbkę —
 * dlatego schodzimy niżej dopiero wtedy, gdy węższy nie ma z czego mówić.
 */
export function wybierzBenchmark({ zamawiajacy, dzialRegion, dzialKraj } = {}) {
  for (const [zrodlo, kubelek] of [
    ['zamawiajacy', zamawiajacy],
    ['dzial_region', dzialRegion],
    ['dzial_kraj', dzialKraj],
  ]) {
    if (kubelek?.wystarczajacaProbka) return { zrodlo, kubelek };
  }
  return { zrodlo: null, kubelek: null };
}

function czynnikKonkurencji(kubelek) {
  const oferty = kubelek?.oferty;
  if (!oferty) {
    return {
      kod: 'konkurencja', ton: TON.NIEZNANY,
      naglowek: 'Nie wiemy, ilu tu startuje',
      szczegol: 'Za mało rozstrzygniętych postępowań, żeby podać typową liczbę ofert.',
      probka: null,
    };
  }
  const m = oferty.mediana;
  const ton = m <= PROGI.konkurencjaMala ? TON.ZIELONY
    : m >= PROGI.konkurencjaDuza ? TON.CZERWONY : TON.ZOLTY;
  return {
    kod: 'konkurencja', ton,
    naglowek: `Zwykle startuje ${m} ${m === 1 ? 'firma' : 'firm'}`,
    szczegol: `W tej grupie postępowań liczba ofert wahała się od ${oferty.min} do ${oferty.max}.`,
    wartosc: m,
    probka: oferty.n,
  };
}

function czynnikUniewaznien(kubelek) {
  const procent = kubelek?.uniewaznienia?.procent ?? null;
  if (procent === null) {
    return {
      kod: 'uniewaznienia', ton: TON.NIEZNANY,
      naglowek: 'Nie wiemy, jak często tu unieważniają',
      szczegol: 'Brak rozstrzygnięć, z których dałoby się to policzyć.',
      probka: null,
    };
  }
  const ton = procent >= PROGI.uniewaznieniaCzeste ? TON.CZERWONY
    : procent >= PROGI.uniewaznieniaZauwazalne ? TON.ZOLTY : TON.ZIELONY;
  return {
    kod: 'uniewaznienia', ton,
    naglowek: `${procent}% części kończy się unieważnieniem`,
    szczegol: procent >= PROGI.uniewaznieniaCzeste
      ? 'Praca nad ofertą bywa tu marnowana nie z Twojej winy — licz się z tym w planie.'
      : 'Postępowania z tej grupy zwykle dochodzą do umowy.',
    wartosc: procent,
    probka: kubelek.probka?.czesci ?? null,
  };
}

function czynnikMalychFirm(kubelek) {
  const mali = kubelek?.maliWygrywaja;
  if (!mali) {
    return {
      kod: 'mali_wygrywaja', ton: TON.NIEZNANY,
      naglowek: 'Nie wiemy, kto tu wygrywa',
      szczegol: 'Ogłoszenia z tej grupy nie podały wielkości wykonawcy.',
      probka: null,
    };
  }
  const ton = mali.procent >= PROGI.maliCzesto ? TON.ZIELONY
    : mali.procent >= PROGI.maliRzadko ? TON.ZOLTY : TON.CZERWONY;
  return {
    kod: 'mali_wygrywaja', ton,
    naglowek: `${mali.procent}% wygrywają mali i mikro przedsiębiorcy`,
    szczegol: mali.procent < PROGI.maliRzadko
      ? 'Tu zwykle wygrywają duże firmy — sprawdź warunki udziału, zanim zaczniesz liczyć.'
      : 'Mała firma ma tu realnie wygrane postępowania.',
    wartosc: mali.procent,
    probka: mali.n,
  };
}

function czynnikCeny(kubelek, profil) {
  const cena = kubelek?.cena;
  if (!cena) {
    return {
      kod: 'cena_rynkowa', ton: TON.NIEZNANY,
      naglowek: 'Nie wiemy, jakie ceny tu wygrywają',
      szczegol: 'Za mało cen wybranych ofert w tej grupie.',
      probka: null,
    };
  }
  const pulap = Number.isFinite(profil?.wartosc_max) ? profil.wartosc_max : null;
  const zaDuze = pulap !== null && cena.mediana > pulap;
  return {
    kod: 'cena_rynkowa',
    ton: pulap === null ? TON.ZOLTY : (zaDuze ? TON.CZERWONY : TON.ZIELONY),
    naglowek: `Typowa cena zwycięzcy: ${Math.round(cena.mediana)} zł`,
    szczegol: pulap === null
      ? `Rozstrzygnięcia z tej grupy mieściły się między ${Math.round(cena.min)} a ${Math.round(cena.max)} zł.`
      : (zaDuze
        ? 'To powyżej maksymalnej wartości kontraktu z Twojego profilu — sprawdź, czy udźwigniesz.'
        : 'Mieści się w maksymalnej wartości kontraktu z Twojego profilu.'),
    wartosc: cena.mediana,
    probka: cena.n,
  };
}

/**
 * Co tu naprawdę decyduje: cena czy coś jeszcze.
 *
 * Dwa niezależne sygnały: KRYTERIUM z ogłoszenia (deklaracja zamawiającego)
 * i POZYCJA ceny zwycięzcy w widełkach konkursu (co się faktycznie działo).
 * Kryterium jest mocniejsze — jest wiążące; pozycja tylko je potwierdza
 * albo podważa.
 */
function czynnikCoDecyduje(kubelek, tender) {
  const kryterium = tender?.kryterium_oceny ?? null;
  const tylkoCena = kryterium ? KRYTERIUM_TYLKO_CENA.test(String(kryterium)) : null;
  const pozycja = kubelek?.pozycjaCeny?.mediana ?? null;

  if (tylkoCena === true) {
    return {
      kod: 'co_decyduje', ton: TON.ZOLTY,
      naglowek: 'Decyduje wyłącznie cena',
      szczegol: 'Żadne doświadczenie ani jakość nie nadrobią droższej oferty.',
      probka: null,
    };
  }
  if (tylkoCena === false) {
    return {
      kod: 'co_decyduje', ton: TON.ZIELONY,
      naglowek: 'Liczy się nie tylko cena',
      szczegol: `Kryteria z ogłoszenia: ${kryterium}.`,
      probka: null,
    };
  }
  if (pozycja !== null) {
    const decydujeCena = pozycja <= PROGI.pozycjaDecydujeCena;
    return {
      kod: 'co_decyduje', ton: decydujeCena ? TON.ZOLTY : TON.ZIELONY,
      naglowek: decydujeCena ? 'W praktyce wygrywa najtańszy' : 'Najtańsza oferta nie zawsze wygrywa',
      szczegol: 'Ogłoszenie nie podaje kryteriów — to wniosek z rozstrzygnięć tej grupy.',
      wartosc: pozycja,
      probka: kubelek.pozycjaCeny.n,
    };
  }
  return {
    kod: 'co_decyduje', ton: TON.NIEZNANY,
    naglowek: 'Nie wiemy, co tu decyduje',
    szczegol: 'Ogłoszenie nie podaje kryteriów, a rozstrzygnięcia nie dają widełek ofert.',
    probka: null,
  };
}

function czynnikCzasu(tender, teraz) {
  const dni = dniDo(tender?.deadline, teraz);
  if (dni === null) {
    return {
      kod: 'czas', ton: TON.NIEZNANY,
      naglowek: 'Termin składania nieznany',
      szczegol: 'Ogłoszenie nie podaje terminu — sprawdź w rejestrze źródłowym.',
      probka: null,
    };
  }
  if (dni < 0) {
    return {
      kod: 'czas', ton: TON.CZERWONY,
      naglowek: 'Termin składania już minął',
      szczegol: 'Tego postępowania nie da się już złożyć.',
      wartosc: dni,
      probka: null,
    };
  }
  const ton = dni >= PROGI.dniKomfortowe ? TON.ZIELONY : dni >= PROGI.dniNapiete ? TON.ZOLTY : TON.CZERWONY;
  return {
    kod: 'czas', ton,
    naglowek: dni === 0 ? 'Termin mija dzisiaj' : `Zostało ${dni} ${dni === 1 ? 'dzień' : 'dni'}`,
    szczegol: ton === TON.CZERWONY
      ? 'Na skompletowanie dokumentów i wycenę zostało bardzo mało czasu.'
      : 'Jest czas na skompletowanie dokumentów.',
    wartosc: dni,
    probka: null,
  };
}

function czynnikWadium(tender) {
  if (tender?.wadium_wymagane === false) {
    return {
      kod: 'wadium', ton: TON.ZIELONY,
      naglowek: 'Bez wadium',
      szczegol: 'Start nie wymaga zamrożenia gotówki ani gwarancji.',
      probka: null,
    };
  }
  if (tender?.wadium_wymagane === true) {
    const kwota = Number.isFinite(tender.wadium_kwota) ? tender.wadium_kwota : null;
    return {
      kod: 'wadium', ton: TON.ZOLTY,
      naglowek: kwota ? `Wadium ${Math.round(kwota)} zł` : 'Wadium wymagane',
      szczegol: 'Musisz je wnieść PRZED upływem terminu składania ofert.',
      wartosc: kwota,
      probka: null,
    };
  }
  return {
    kod: 'wadium', ton: TON.NIEZNANY,
    naglowek: 'Nie wiemy, czy jest wadium',
    szczegol: 'Ogłoszenie o tym nie mówi — sprawdź w SWZ.',
    probka: null,
  };
}

/**
 * Werdykt z tonów czynników. Kategoria, nigdy liczba.
 *
 * Po terminie to osobny stan, a nie „trudny rynek": nie ma czego rozważać.
 */
export function werdyktZCzynnikow(czynniki) {
  if (czynniki.some((c) => c.kod === 'czas' && c.wartosc !== undefined && c.wartosc < 0)) {
    return 'po_terminie';
  }
  const zBenchmarku = czynniki.filter(
    (c) => ['konkurencja', 'uniewaznienia', 'mali_wygrywaja', 'cena_rynkowa'].includes(c.kod),
  );
  if (zBenchmarku.every((c) => c.ton === TON.NIEZNANY)) return 'brak_danych';

  const czerwone = czynniki.filter((c) => c.ton === TON.CZERWONY).length;
  const zielone = czynniki.filter((c) => c.ton === TON.ZIELONY).length;
  if (czerwone >= 2) return 'trudny';
  if (czerwone === 1) return 'uwazaj';
  return zielone >= 2 ? 'sprawdz' : 'uwazaj';
}

const NAGLOWKI = {
  sprawdz: 'Warto się temu przyjrzeć',
  uwazaj: 'Da się, ale są haczyki',
  trudny: 'Trudny rynek — policz dwa razy',
  brak_danych: 'Za mało danych, żeby cokolwiek powiedzieć',
  po_terminie: 'Termin składania już minął',
};

/** Zdanie, które ZAWSZE towarzyszy karcie. Bez niego liczby kłamią o swoim znaczeniu. */
export const ZASTRZEZENIE =
  'To opis tego, co działo się na rynku w podobnych postępowaniach — nie prognoza Twojej oferty. '
  + 'O wyniku decyduje treść oferty, której nie znamy.';

/**
 * Buduje kartę „Czy warto startować?".
 *
 * @param {{tender: object, benchmarki: object, profil?: object, teraz?: number}} wejscie
 * @returns {{werdykt: string, naglowek: string, zrodloBenchmarku: string|null,
 *   probka: object|null, czynniki: object[], zastrzezenie: string}}
 */
export function kartaStartu({ tender, benchmarki, profil = null, teraz = Date.now() } = {}) {
  const { zrodlo, kubelek } = wybierzBenchmark(benchmarki);

  const czynniki = [
    czynnikCzasu(tender, teraz),
    czynnikKonkurencji(kubelek),
    czynnikCoDecyduje(kubelek, tender),
    czynnikCeny(kubelek, profil),
    czynnikMalychFirm(kubelek),
    czynnikUniewaznien(kubelek),
    czynnikWadium(tender),
  ];

  const werdykt = werdyktZCzynnikow(czynniki);
  return {
    werdykt,
    naglowek: NAGLOWKI[werdykt],
    // Z którego kubełka policzono i na ilu postępowaniach stoi — bez tego
    // użytkownik nie odróżni wniosku z 400 rozstrzygnięć od wniosku z sześciu.
    zrodloBenchmarku: zrodlo,
    probka: kubelek
      ? { ...kubelek.probka, zrodla: kubelek.zrodla ?? [], etykieta: kubelek.etykieta ?? null }
      : null,
    czynniki,
    zastrzezenie: ZASTRZEZENIE,
  };
}
