import { czynnikIleDac } from './benchmarkOtwarcia.js';

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
  // Udział jednej firmy w częściach z umową u zamawiającego (2026-10-31).
  stalyWykonawca: 50,
  czestyWykonawca: 30,
  stalyWykonawcaMinWygranych: 3,
  // Różne ogłoszenia z wygraną: czerwony od 3, żółty od 2 (jeden przetarg wieloczęściowy to nie „stały wykonawca”).
  stalyWykonawcaMinOgloszen: 3,
  czestyWykonawcaMinOgloszen: 2,
  stalyWykonawcaMinCzesci: 5,
};

const KRYTERIUM_TYLKO_CENA = /(^|[^a-ząćęłńóśźż])cena\s*[-–:]?\s*100|wy[łl]ącznie cena|tylko cena|cena\s*=?\s*100\s*%/i;

const DZIEN_W_POLSCE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' });
const dzienPL = (ms) => Date.parse(`${DZIEN_W_POLSCE.format(ms)}T00:00:00Z`);

/**
 * Dni do terminu — dni KALENDARZOWE w Polsce, tak samo jak karta przetargu w aplikacji
 * (mobile/src/lib/termin.js). Pełne doby (floor) dawały „8 dni" przy „9 dniach" na
 * szczegółach tego samego ogłoszenia, a termin jutro rano — „mija dzisiaj" (E2E 2026-10-03).
 * Termin, który już upłynął, jest ujemny także wtedy, gdy przypada na dziś.
 */
function dniDo(termin, teraz) {
  if (!termin) return null;
  const koniec = Date.parse(termin);
  if (!Number.isFinite(koniec)) return null;
  if (koniec <= teraz) return Math.min(-1, Math.floor((koniec - teraz) / 86_400_000));
  return Math.round((dzienPL(koniec) - dzienPL(teraz)) / 86_400_000);
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

/*
 * Stały wykonawca u zamawiającego (2026-10-31, z analizy konkurencji: „kto wygrywa”). Fakt z rozstrzygnięć
 * tego zamawiającego — ile części z umową wziął najczęstszy zwycięzca — a nie prognoza. Tylko kubełek
 * ZAMAWIAJĄCEGO (w dziale CPV „stały wykonawca” nic nie znaczy). Bez danych o zwycięzcach czynnika nie ma.
 */
function czynnikStalegoWykonawcy(kubelek) {
  const top = kubelek?.najczestsiZwyciezcy?.[0];
  if (kubelek?.wymiar !== 'zamawiajacy' || !top?.nazwa) return null;
  const zUmowa = (kubelek.probka?.czesci ?? 0) - (kubelek.uniewaznienia?.czesci ?? 0);
  if (zUmowa < PROGI.stalyWykonawcaMinCzesci) return null;
  const procent = Math.round((100 * top.wygrane) / zUmowa);
  // Starsze kubełki (przed 31.10) nie mają `ogloszen` — wtedy decydują same części.
  const ogloszen = Number.isFinite(top.ogloszen) ? top.ogloszen : top.wygrane;
  const ton = procent >= PROGI.stalyWykonawca && top.wygrane >= PROGI.stalyWykonawcaMinWygranych && ogloszen >= PROGI.stalyWykonawcaMinOgloszen ? TON.CZERWONY
    : procent >= PROGI.czestyWykonawca && ogloszen >= PROGI.czestyWykonawcaMinOgloszen ? TON.ZOLTY : TON.ZIELONY;
  const ile = `${top.wygrane} z ${zUmowa} części`;
  return {
    kod: 'staly_wykonawca', ton,
    naglowek: ton === TON.CZERWONY ? `Stały wykonawca: ${top.nazwa} wygrał ${ile}`
      : ton === TON.ZOLTY ? `${top.nazwa} wygrywa tu często (${ile})`
        : `Wygrywają różne firmy (najczęściej ${top.nazwa}: ${ile})`,
    szczegol: ton === TON.CZERWONY
      ? 'Zamawiający zwykle wybiera tę samą firmę — sprawdź, czy warunki nie są pisane pod nią, i zadaj pytania do SWZ.'
      : ton === TON.ZOLTY ? 'Jest firma, z którą przegrywa się tu najczęściej — zobacz, co jeszcze wygrywa.'
        : 'Nie widać firmy, która bierze tu wszystko.',
    wartosc: procent,
    probka: zUmowa,
    wykonawca: { nazwa: top.nazwa, nip: top.nip ?? null },
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
/*
 * 🚨 Baza trzyma w `kryterium_oceny` KODY z ingestii (`tylko_cena` / `cena_i_jakosc`, Functions
 * `lib/ogloszenieMeta.js`), a nie tekst ogłoszenia. Regex z podkreśleniem nie trafiał, więc do
 * 31.10.2026 przetarg „tylko cena” dostawał tu „Liczy się nie tylko cena”, a szczegół pokazywał
 * kod („Kryteria z ogłoszenia: tylko_cena.”). Testy karmiły kartę tekstem, nie kodem — stąd cisza.
 */
function czyTylkoCena(kryterium) {
  if (!kryterium) return null;
  if (kryterium === 'tylko_cena') return true;
  if (kryterium === 'cena_i_jakosc') return false;
  return KRYTERIUM_TYLKO_CENA.test(String(kryterium));
}

/** „Cena 60%, Okres gwarancji 40%” z listy kryteriów (2026-10-31); bez listy — tekst albo nic. */
function opisKryteriow(tender) {
  const lista = Array.isArray(tender?.kryteria) ? tender.kryteria.filter((k) => k && typeof k.nazwa === 'string' && k.nazwa) : [];
  if (lista.length) {
    return lista.slice(0, 6)
      .map((k) => (typeof k.udzial === 'number' ? `${k.nazwa} ${String(k.udzial).replace('.', ',')}%` : k.nazwa))
      .join(', ');
  }
  const k = tender?.kryterium_oceny ?? null;
  return k && k !== 'tylko_cena' && k !== 'cena_i_jakosc' ? String(k) : null;
}

/*
 * Kryteria, które wykonawca bierze samą deklaracją w formularzu (gwarancja, termin, płatność,
 * czas reakcji, warunki umowy, świadczenia dodatkowe). Gdy poza ceną są tylko one, większość
 * ofert deklaruje maksimum z SWZ i różnicę robi cena — „cena i jakość” tylko z nazwy.
 */
const KRYTERIA_DEKLARATYWNE = new Set(['gwarancja', 'termin', 'platnosc', 'reakcja', 'umowa', 'dodatkowe']);

/**
 * O ile droższa może być oferta z kompletem punktów pozacenowych `k` (udział %) od najtańszej bez
 * nich, przy JEDNYM kryterium ceny z udziałem `c` i typowym wzorze najniższa/badana: c·Cmin/C = c − k
 * → C/Cmin − 1 = k / (c − k). null, gdy wzór się nie stosuje.
 */
function przewagaCenowaPunktow(lista) {
  const ceny = lista.filter((k) => k.rodzaj === 'cena');
  if (ceny.length !== 1 || typeof ceny[0].udzial !== 'number') return null;
  const c = ceny[0].udzial;
  const k = lista.filter((x) => x.rodzaj !== 'cena' && !KRYTERIA_DEKLARATYWNE.has(x.rodzaj) && typeof x.udzial === 'number')
    .reduce((s, x) => s + x.udzial, 0);
  if (k <= 0 || c <= k) return null;
  return Math.round((k / (c - k)) * 100);
}

function czynnikCoDecyduje(kubelek, tender) {
  const kryterium = tender?.kryterium_oceny ?? null;
  const tylkoCena = czyTylkoCena(kryterium);
  const pozycja = kubelek?.pozycjaCeny?.mediana ?? null;

  if (tylkoCena === true) {
    return {
      kod: 'co_decyduje', ton: TON.ZOLTY,
      naglowek: 'Decyduje wyłącznie cena',
      szczegol: 'Żadne doświadczenie ani jakość nie nadrobią droższej oferty.',
      probka: null,
    };
  }
  const lista = Array.isArray(tender?.kryteria) ? tender.kryteria.filter((k) => k && typeof k.nazwa === 'string' && k.nazwa) : [];
  const poza = lista.filter((k) => k.rodzaj !== 'cena');
  if (tylkoCena === false && poza.length && poza.every((k) => KRYTERIA_DEKLARATYWNE.has(k.rodzaj)) && !tender?.kryteria_rozne_czesci) {
    return {
      kod: 'co_decyduje', ton: TON.ZOLTY,
      naglowek: 'Poza ceną same deklaracje — w praktyce decyduje cena',
      szczegol: `Kryteria z ogłoszenia: ${opisKryteriow(tender)}. Większość wykonawców wpisuje maksimum punktowane w SWZ, więc różnicę robi cena.`,
      probka: null,
    };
  }
  if (tylkoCena === false) {
    const przewaga = przewagaCenowaPunktow(lista);
    const opis = opisKryteriow(tender);
    let szczegol = opis ? `Kryteria z ogłoszenia: ${opis}.` : 'Ogłoszenie przewiduje obok ceny kryteria jakościowe.';
    if (przewaga !== null) {
      szczegol += ` Oferta z kompletem punktów za doświadczenie, jakość czy certyfikaty może być nawet o ${przewaga}% droższa od najtańszej i wygrać.`;
    }
    return {
      kod: 'co_decyduje', ton: TON.ZIELONY,
      naglowek: 'Liczy się nie tylko cena',
      szczegol,
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
/**
 * Poprzednia edycja (2026-10-31): kto wykonuje obecną umowę tego zamawiającego na to samo
 * i za ile wygrał (`lib/poprzedniaEdycja.js`). Żółty = „sprawdź”, nie liczy się do werdyktu.
 */
function czynnikPoprzedniejEdycji(p) {
  if (!p?.wykonawcy?.length) return null;
  const kto = p.wykonawcy.map((w) => w.nazwa).join(', ');
  const kwota = Number.isFinite(p.kwota) ? ` za ${Math.round(p.kwota).toLocaleString('pl-PL')} zł` : '';
  const koniec = p.koniec_umowy ? `, umowa do ${p.koniec_umowy.split('-').reverse().join('.')}` : '';
  const oferty = Number.isFinite(p.liczba_ofert) ? ` (ofert: ${p.liczba_ofert})` : '';
  // Prawie ten sam tytuł = ta sama umowa sprzed roku; mniej = podobna robota u tego zamawiającego.
  const taSama = Number(p.podobienstwo) >= 0.7;
  return {
    kod: 'poprzednia_edycja', ton: TON.ZOLTY,
    naglowek: taSama ? `Poprzednio wygrał ${kto}${kwota}` : `Podobne zamówienie tu wygrał ${kto}${kwota}`,
    szczegol: taSama
      ? `${p.tytul ?? 'Poprzednia edycja'}${koniec}${oferty}. Cena poprzedniej edycji to dobry punkt odniesienia — sprawdź, czy zakres i ilości są te same.`
      : `${p.tytul ?? 'Podobne zamówienie'}${koniec}${oferty}. To inne zamówienie tego zamawiającego, ale pokazuje, z kim i za ile tu się wygrywa.`,
    probka: null,
    wykonawca: p.wykonawcy[0].nazwa ? { nazwa: p.wykonawcy[0].nazwa, nip: p.wykonawcy[0].nip ?? null } : undefined,
  };
}

export function kartaStartu({ tender, benchmarki, profil = null, teraz = Date.now(), poprzednia = null, otwarcie = null } = {}) {
  const { zrodlo, kubelek } = wybierzBenchmark(benchmarki);

  const czynniki = [
    czynnikCzasu(tender, teraz),
    czynnikKonkurencji(kubelek),
    czynnikCoDecyduje(kubelek, tender),
    czynnikCeny(kubelek, profil),
    czynnikMalychFirm(kubelek),
    czynnikUniewaznien(kubelek),
    czynnikWadium(tender),
    czynnikStalegoWykonawcy(benchmarki?.zamawiajacy),
    czynnikPoprzedniejEdycji(poprzednia),
    // „Ile dać” (2026-11-01, `lib/benchmarkOtwarcia.js`): najniższa oferta / budżet z informacji z otwarcia.
    czynnikIleDac(otwarcie, tender),
  ].filter(Boolean);

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
    // Branża z tytułu (PZ/ePP nie podają CPV) — mówimy wprost, z czego są liczby.
    zastrzezenie: !tender?.cpv_main && tender?.cpv_dzial_z_tytulu
      ? `${ZASTRZEZENIE} Branżę (dział CPV) wywnioskowaliśmy z tytułu — ta platforma nie podaje kodów CPV.`
      : ZASTRZEZENIE,
  };
}
