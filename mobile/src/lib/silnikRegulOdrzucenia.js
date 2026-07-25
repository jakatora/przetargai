/**
 * Silnik reguł odrzucenia oferty zwycięzcy — podzadanie 10/13 ulepszenia
 * „Prześwietlenie oferty zwycięzcy i szansa na odwołanie".
 *
 * Spina przesłanki odrzucenia w JEDNO wywołanie: `analizuj_oferte_zwyciezcy(pola)`
 * uruchamia komplet reguł na polach z parsera oferty
 * ({@link ./wyodrebnijPolaOferty wyodrebnij_pola_z_oferty}) i AGREGUJE wykryte w
 * listę zarzutów. Reguły:
 *  - rażąco niska cena (art. 224 ust. 2 pkt 1 Pzp) — dołączona z podzadania 9/13,
 *  - zły format podpisu (art. 63 Pzp),
 *  - brak wymaganych oświadczeń (art. 125 Pzp; wezwanie do uzupełnienia — art. 128),
 *  - nieaktualne zaświadczenia (rozporządzenie ws. podmiotowych środków dowodowych),
 *  - niezgodność treści oferty z SWZ (art. 226 ust. 1 pkt 5 Pzp).
 *
 * WYŁĄCZNIE czyste funkcje: bez UI, bez modelu, bez storage. Ocena szans i decyzja
 * „walcz / odpuść" to kolejne podzadania — tu tylko wykrycie i zebranie zarzutów.
 * Każda reguła zwraca ten sam kontrakt co reguła ceny: { wykryto, opis_zarzutu, sila }.
 * Deterministyczne i defensywne — nigdy nie rzucają, przy braku danych zwracają
 * pełny kształt „nie wykryto". Bez Date.now(): datę odniesienia „dzisiaj" (do oceny
 * ważności zaświadczeń) wstrzykujemy przez kontekst.
 */

import { formatBudget } from './format.js';
import {
  KATALOG_OSWIADCZEN,
  RODZAJE_PODPISU,
  PODPIS_NIEOKRESLONY,
} from './wyodrebnijPolaOferty.js';
import { regula_razaco_niska_cena, SILA_ZARZUTU } from './regulaRazacoNiskaCena.js';

export { regula_razaco_niska_cena, SILA_ZARZUTU };

const NIE_WYKRYTO = Object.freeze({ wykryto: false, opis_zarzutu: null, sila: null });

/**
 * Oświadczenie wstępne z art. 125 ust. 1 Pzp — składane w KAŻDYM postępowaniu
 * (niepodleganie wykluczeniu + spełnianie warunków udziału). Domyślny zestaw
 * „wymaganych oświadczeń", gdy wołający nie poda listy z konkretnego SWZ.
 */
export const DEFAULT_WYMAGANE_OSWIADCZENIA = ['niepodleganie_wykluczeniu', 'spelnianie_warunkow'];

/**
 * Okna ważności zaświadczeń w MIESIĄCACH wg rozporządzenia Ministra Rozwoju, Pracy
 * i Technologii z 30.12.2020 w sprawie podmiotowych środków dowodowych: dokument
 * musi być wystawiony „nie wcześniej niż" tyle miesięcy przed dniem odniesienia.
 * KRK (niekaralność) ma 6 mies.; ZUS/US/KRS/CEIDG — 3 mies.
 */
export const WINDOWS_WAZNOSCI_ZASWIADCZEN = Object.freeze({
  ZUS: 3,
  US: 3,
  KRK: 6,
  KRS: 3,
  CEIDG: 3,
});

/** Etykieta oświadczenia po `rodzaj` z katalogu parsera; nieznane → sam rodzaj. */
function etykietaOswiadczenia(rodzaj) {
  const wpis = KATALOG_OSWIADCZEN.find((o) => o.rodzaj === rodzaj);
  return wpis ? wpis.etykieta : rodzaj;
}

/** Niepusty string (po przycięciu) albo null. */
function tekstAlboNull(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Dodatnia, skończona liczba albo null (nie zgadujemy z NaN/∞/≤0/innych typów). */
function dodatniaLiczba(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Reguła: zły format podpisu elektronicznego (art. 63 Pzp)
// ---------------------------------------------------------------------------

/**
 * Ocena formy podpisu oferty. Powyżej progów unijnych oferta pod rygorem
 * nieważności wymaga podpisu KWALIFIKOWANEGO; poniżej — kwalifikowany, zaufany albo
 * osobisty (art. 63 ust. 1 i 2 Pzp). Użycie formy spoza dopuszczalnych to podstawa
 * odrzucenia (art. 226 ust. 1 pkt 3 w zw. z art. 63).
 *
 * @param {{formatPodpisu?: string}} pola pola z parsera oferty.
 * @param {{dozwolonePodpisy?: string[]}} [kontekst] dopuszczalne formy wg reżimu
 *   postępowania; domyślnie wszystkie trzy z {@link RODZAJE_PODPISU} (wariant
 *   krajowy — nie oskarżamy poprawnej formy, gdy reżimu nie znamy).
 * @returns {{wykryto: boolean, opis_zarzutu: string|null, sila: string|null}}
 */
export function regula_zly_format_podpisu(pola, kontekst) {
  const forma = tekstAlboNull(pola && pola.formatPodpisu);
  if (!forma) return { ...NIE_WYKRYTO }; // brak danych o podpisie — nie zgadujemy

  const k = kontekst && typeof kontekst === 'object' ? kontekst : {};
  const dozwolone =
    Array.isArray(k.dozwolonePodpisy) && k.dozwolonePodpisy.length > 0
      ? k.dozwolonePodpisy
      : RODZAJE_PODPISU;

  if (forma === PODPIS_NIEOKRESLONY) {
    return {
      wykryto: true,
      opis_zarzutu:
        'Nie udało się potwierdzić formy podpisu elektronicznego oferty zwycięzcy. ' +
        'Oferta musi być podpisana kwalifikowanym podpisem elektronicznym, podpisem ' +
        'zaufanym albo osobistym (art. 63 Pzp) — brak prawidłowego podpisu skutkuje ' +
        'odrzuceniem oferty. Zweryfikuj formę podpisu w protokole i na dokumencie oferty.',
      sila: 'slaba',
    };
  }

  if (RODZAJE_PODPISU.includes(forma) && !dozwolone.includes(forma)) {
    const dozwoloneOpis = dozwolone.join(', ');
    return {
      wykryto: true,
      opis_zarzutu:
        `Oferta zwycięzcy została podpisana podpisem „${forma}", podczas gdy w tym ` +
        `postępowaniu dopuszczalny jest podpis: ${dozwoloneOpis} (art. 63 Pzp). ` +
        'Złożenie oferty w niewłaściwej formie podpisu jest podstawą jej odrzucenia ' +
        '(art. 226 ust. 1 pkt 3 Pzp w zw. z art. 63).',
      sila: 'mocna',
    };
  }

  return { ...NIE_WYKRYTO };
}

// ---------------------------------------------------------------------------
// Reguła: brak wymaganych oświadczeń (art. 125 / 128 Pzp)
// ---------------------------------------------------------------------------

/**
 * Wykrywa brak wymaganych oświadczeń w ofercie. Brak oświadczenia zwykle podlega
 * wezwaniu do uzupełnienia (art. 128 Pzp), więc to zarzut umiarkowany — realną
 * podstawą staje się dopiero, gdy zamawiający nie wezwał albo wykonawca nie uzupełnił.
 *
 * @param {{oswiadczenia?: Array<{rodzaj: string}>}} pola pola z parsera oferty.
 * @param {{wymaganeOswiadczenia?: string[]}} [kontekst] lista `rodzaj` wymaganych
 *   przez SWZ; domyślnie {@link DEFAULT_WYMAGANE_OSWIADCZENIA}.
 * @returns {{wykryto: boolean, opis_zarzutu: string|null, sila: string|null}}
 */
export function regula_brak_oswiadczen(pola, kontekst) {
  if (!pola || !Array.isArray(pola.oswiadczenia)) return { ...NIE_WYKRYTO };

  const k = kontekst && typeof kontekst === 'object' ? kontekst : {};
  const wymagane =
    Array.isArray(k.wymaganeOswiadczenia) && k.wymaganeOswiadczenia.length > 0
      ? k.wymaganeOswiadczenia
      : DEFAULT_WYMAGANE_OSWIADCZENIA;

  const obecne = new Set(
    pola.oswiadczenia.map((o) => o && o.rodzaj).filter((r) => typeof r === 'string'),
  );
  const brakujace = wymagane.filter((r) => !obecne.has(r));
  if (brakujace.length === 0) return { ...NIE_WYKRYTO };

  const lista = brakujace.map(etykietaOswiadczenia).join('; ');
  return {
    wykryto: true,
    opis_zarzutu:
      `W ofercie zwycięzcy brakuje wymaganych oświadczeń: ${lista}. Zamawiający ma ` +
      'obowiązek wezwać wykonawcę do ich uzupełnienia (art. 128 Pzp); brak wezwania ' +
      'albo nieuzupełnienie oświadczenia wstępnego (art. 125 Pzp) jest podstawą ' +
      'odrzucenia oferty i zarzutu w odwołaniu do KIO.',
    sila: 'umiarkowana',
  };
}

// ---------------------------------------------------------------------------
// Reguła: nieaktualne zaświadczenia (rozporządzenie ws. środków dowodowych)
// ---------------------------------------------------------------------------

/** Parsuje 'YYYY-MM-DD' do { rok, mies, dzien } albo null (odrzuca daty nieistniejące). */
function parsujDate(iso) {
  const m = typeof iso === 'string' && iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const rok = Number(m[1]);
  const mies = Number(m[2]);
  const dzien = Number(m[3]);
  const d = new Date(Date.UTC(rok, mies - 1, dzien));
  if (d.getUTCFullYear() !== rok || d.getUTCMonth() !== mies - 1 || d.getUTCDate() !== dzien) {
    return null; // np. 2026-02-30 — nie przepuszczamy cichej normalizacji
  }
  return { rok, mies, dzien };
}

/** Liczba dni w danym miesiącu (mies 1-12) danego roku. */
function dniWMiesiacu(rok, mies) {
  return new Date(Date.UTC(rok, mies, 0)).getUTCDate();
}

/**
 * Znacznik UTC daty przesuniętej o `n` miesięcy do przodu, z dociśnięciem dnia do
 * końca miesiąca (dodanie 3 mies. do 30.11 → 28/29.02). To ostatni dzień, w którym
 * dokument wystawiony w `data` jest jeszcze ważny („nie wcześniej niż n mies.").
 */
function granicaWaznosciMs(data, n) {
  const total = data.mies - 1 + n;
  const rok = data.rok + Math.floor(total / 12);
  const mies = (total % 12) + 1;
  const dzien = Math.min(data.dzien, dniWMiesiacu(rok, mies));
  return Date.UTC(rok, mies - 1, dzien);
}

/** Znacznik UTC północy dnia z { rok, mies, dzien }. */
function dzienMs(d) {
  return Date.UTC(d.rok, d.mies - 1, d.dzien);
}

/**
 * Wykrywa zaświadczenia wystawione poza oknem ważności względem dnia odniesienia
 * `dzisiaj`. Zaświadczenie z czytelną datą, którego okno (patrz
 * {@link WINDOWS_WAZNOSCI_ZASWIADCZEN}) minęło przed `dzisiaj`, jest nieaktualne.
 * Wpisy bez daty i o nieznanym rodzaju pomijamy (nie zgadujemy staleness).
 *
 * @param {{zaswiadczenia?: Array<{rodzaj: string, etykieta?: string, data?: string|null}>}} pola
 * @param {{dzisiaj?: string}} [kontekst] dzień odniesienia ISO `YYYY-MM-DD`
 *   (wstrzykiwany zamiast Date.now()); bez niego reguła nie ocenia.
 * @returns {{wykryto: boolean, opis_zarzutu: string|null, sila: string|null}}
 */
export function regula_nieaktualne_zaswiadczenia(pola, kontekst) {
  if (!pola || !Array.isArray(pola.zaswiadczenia)) return { ...NIE_WYKRYTO };

  const k = kontekst && typeof kontekst === 'object' ? kontekst : {};
  const dzisiaj = parsujDate(k.dzisiaj);
  if (!dzisiaj) return { ...NIE_WYKRYTO }; // bez dnia odniesienia nie oceniamy ważności
  const dzisiajMs = dzienMs(dzisiaj);

  const nieaktualne = [];
  for (const z of pola.zaswiadczenia) {
    if (!z || typeof z !== 'object') continue;
    const okno = WINDOWS_WAZNOSCI_ZASWIADCZEN[z.rodzaj];
    if (typeof okno !== 'number') continue; // nieznany rodzaj — nie znamy okna
    const data = parsujDate(z.data);
    if (!data) continue; // brak czytelnej daty — pomijamy
    if (dzisiajMs > granicaWaznosciMs(data, okno)) {
      const etykieta = tekstAlboNull(z.etykieta) || z.rodzaj;
      nieaktualne.push(`${etykieta} (wystawione ${z.data}, ważność ${okno} mies.)`);
    }
  }

  if (nieaktualne.length === 0) return { ...NIE_WYKRYTO };

  return {
    wykryto: true,
    opis_zarzutu:
      `Zaświadczenia oferty zwycięzcy są nieaktualne (wystawione poza okresem ważności ` +
      `wymaganym rozporządzeniem ws. podmiotowych środków dowodowych): ${nieaktualne.join('; ')}. ` +
      'Zamawiający powinien wezwać wykonawcę do złożenia aktualnych dokumentów ' +
      '(art. 128 Pzp); brak aktualnego zaświadczenia jest podstawą odrzucenia oferty.',
    sila: 'umiarkowana',
  };
}

// ---------------------------------------------------------------------------
// Reguła: niezgodność treści oferty z SWZ (art. 226 ust. 1 pkt 5 Pzp)
// ---------------------------------------------------------------------------

/**
 * Wykrywa niezgodność treści oferty z warunkami zamówienia na podstawie pól, jakimi
 * dysponuje aplikacja: waluta oferty vs waluta wymagana oraz przekroczenie ceny
 * maksymalnej z SWZ. Bez wymagań SWZ w kontekście reguła nie ocenia (nie zgadujemy).
 *
 * @param {{cena?: {kwota?: number|null, waluta?: string|null}}} pola pola z parsera.
 * @param {{swz?: {walutaWymagana?: string, cenaMaksymalna?: number}}} [kontekst]
 * @returns {{wykryto: boolean, opis_zarzutu: string|null, sila: string|null}}
 */
export function regula_niezgodnosc_swz(pola, kontekst) {
  const k = kontekst && typeof kontekst === 'object' ? kontekst : {};
  const swz = k.swz && typeof k.swz === 'object' ? k.swz : null;
  if (!swz) return { ...NIE_WYKRYTO };

  const cena = pola && typeof pola.cena === 'object' && pola.cena ? pola.cena : {};
  const niezgodnosci = [];

  const walutaWymagana = tekstAlboNull(swz.walutaWymagana);
  const walutaOferty = tekstAlboNull(cena.waluta);
  if (walutaWymagana && walutaOferty && walutaOferty.toUpperCase() !== walutaWymagana.toUpperCase()) {
    niezgodnosci.push(
      `oferta wyrażona w walucie ${walutaOferty}, a SWZ wymaga ${walutaWymagana}`,
    );
  }

  const cenaMax = dodatniaLiczba(swz.cenaMaksymalna);
  const kwota = dodatniaLiczba(cena.kwota);
  if (cenaMax !== null && kwota !== null && kwota > cenaMax) {
    niezgodnosci.push(
      `cena oferty (${formatBudget(kwota)}) przekracza maksimum określone w SWZ ` +
        `(${formatBudget(cenaMax)})`,
    );
  }

  if (niezgodnosci.length === 0) return { ...NIE_WYKRYTO };

  return {
    wykryto: true,
    opis_zarzutu:
      `Treść oferty zwycięzcy jest niezgodna z warunkami zamówienia (SWZ): ` +
      `${niezgodnosci.join('; ')}. Niezgodność treści oferty z warunkami zamówienia ` +
      'jest podstawą jej odrzucenia (art. 226 ust. 1 pkt 5 Pzp).',
    sila: 'mocna',
  };
}

// ---------------------------------------------------------------------------
// Silnik: uruchomienie reguł i agregacja do listy zarzutów
// ---------------------------------------------------------------------------

/**
 * Rejestr reguł w kolejności prezentacji. `uruchom(pola, kontekst)` adaptuje każdą
 * regułę do wspólnego wywołania — w tym regułę ceny z podzadania 9/13, która
 * przyjmuje (cena_zwyciezcy, oferty), a nie (pola, kontekst).
 */
const REGULY = [
  {
    rodzaj: 'razaco_niska_cena',
    tytul: 'Rażąco niska cena',
    uruchom: (pola, k) => regula_razaco_niska_cena(pola.cena, k.oferty),
  },
  {
    rodzaj: 'zly_format_podpisu',
    tytul: 'Zły format podpisu elektronicznego',
    uruchom: (pola, k) => regula_zly_format_podpisu(pola, k),
  },
  {
    rodzaj: 'brak_oswiadczen',
    tytul: 'Brak wymaganych oświadczeń',
    uruchom: (pola, k) => regula_brak_oswiadczen(pola, k),
  },
  {
    rodzaj: 'nieaktualne_zaswiadczenia',
    tytul: 'Nieaktualne zaświadczenia',
    uruchom: (pola, k) => regula_nieaktualne_zaswiadczenia(pola, k),
  },
  {
    rodzaj: 'niezgodnosc_swz',
    tytul: 'Niezgodność treści oferty z SWZ',
    uruchom: (pola, k) => regula_niezgodnosc_swz(pola, k),
  },
];

/** Pozycja siły na skali {@link SILA_ZARZUTU}; nieznana → -1 (na koniec listy). */
function indeksSily(sila) {
  return SILA_ZARZUTU.indexOf(sila);
}

/**
 * Silnik reguł odrzucenia — uruchamia komplet reguł na polach oferty zwycięzcy i
 * agreguje wykryte przesłanki w listę zarzutów posortowaną malejąco wg siły
 * (najmocniejsze podstawy na górze).
 *
 * Nazwa snake_case celowo zgodna ze specyfikacją — to kontrakt wołany przez ekran
 * analizy i kolejne podzadania (ocena szans, decyzja „walcz / odpuść").
 *
 * @param {object} pola wynik {@link ./wyodrebnijPolaOferty wyodrebnij_pola_z_oferty}
 *   (cena, formatPodpisu, oswiadczenia, zaswiadczenia). Brak pól (null/nie-obiekt)
 *   → pusty wynik (nie ma czego analizować).
 * @param {object} [kontekst] dane spoza samej oferty potrzebne regułom:
 *   `oferty` (ceny wszystkich ofert — reguła ceny), `dzisiaj` (dzień odniesienia
 *   ISO — ważność zaświadczeń), `wymaganeOswiadczenia`, `dozwolonePodpisy`, `swz`.
 * @returns {{ zarzuty: Array<{rodzaj: string, tytul: string, opis_zarzutu: string, sila: string}>,
 *   liczba: number, najwyzszaSila: string|null }}
 */
export function analizuj_oferte_zwyciezcy(pola, kontekst = {}) {
  if (!pola || typeof pola !== 'object') {
    return { zarzuty: [], liczba: 0, najwyzszaSila: null };
  }
  const k = kontekst && typeof kontekst === 'object' ? kontekst : {};

  const zarzuty = [];
  for (const regula of REGULY) {
    let wynik;
    try {
      wynik = regula.uruchom(pola, k);
    } catch {
      continue; // reguły są defensywne, ale silnik i tak nie może się wywrócić
    }
    if (wynik && wynik.wykryto) {
      zarzuty.push({
        rodzaj: regula.rodzaj,
        tytul: regula.tytul,
        opis_zarzutu: wynik.opis_zarzutu,
        sila: wynik.sila,
      });
    }
  }

  // Sort stabilny (kolejność rejestru jako remis) — malejąco wg siły.
  zarzuty.sort((a, b) => indeksSily(b.sila) - indeksSily(a.sila));

  return {
    zarzuty,
    liczba: zarzuty.length,
    najwyzszaSila: zarzuty.length > 0 ? zarzuty[0].sila : null,
  };
}
