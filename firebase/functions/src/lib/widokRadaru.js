/**
 * WIDOK RADARU PLANÓW — czysta logika odpowiedzi API (bez Firestore, bez zegara).
 *
 * Skleja trzy przetestowane moduły radaru z danymi z TED:
 *   • `radarPlanow.dopasujPozycjePlanu` — ranking pozycji pod profil,
 *   • `przygotowaniaPlanu.generujPlanPrzygotowan` — co zrobić i kiedy,
 *   • `zmianyPlanu.dopasujOgloszenie` — czy plan już zamienił się w ogłoszenie.
 *
 * Dwa tryby, jak w katalogu przetargów (etap 4): „dla mnie" (ranking) i „wszystkie"
 * (rynek planów bez profilu). Pusty profil NIE daje pustego ekranu — dostaje rynek
 * i jedną konkretną podpowiedź. Tej lekcji nauczył feed dopasowań.
 */

import { dopasujPozycjePlanu } from './radarPlanow.js';
import { generujPlanPrzygotowan } from './przygotowaniaPlanu.js';
import { dopasujOgloszenie } from './zmianyPlanu.js';
import { jestAktywna } from './indeksPlanow.js';
import { kodWojewodztwa, nazwaWojewodztwa } from './wojewodztwa.js';
import { RODZAJE_PLANU, RODZAJ_NIEZNANY } from './rodzajePlanu.js';

export const LIMIT_DOMYSLNY = 30;
export const LIMIT_MAKS = 100;

function lista(x) {
  return Array.isArray(x) ? x.filter((v) => v != null && String(v).trim() !== '') : [];
}

/** Konto → wejście czystych modułów radaru. `pusty` = brak CPV i słów (sam region to za mało). */
export function profilRadaru(uzytkownik, dzisiaj) {
  const cpv = lista(uzytkownik?.cpv_codes);
  const slowaKluczowe = lista(uzytkownik?.keywords);
  return {
    cpv,
    slowaKluczowe,
    regiony: lista(uzytkownik?.regiony),
    maksymalnaWartoscKontraktu: uzytkownik?.wartosc_max ?? null,
    posiadaneDokumenty: [],
    dzisiaj,
    pusty: cpv.length === 0 && slowaKluczowe.length === 0,
  };
}

function urlPlanu(id) {
  return `https://ted.europa.eu/pl/notice/-/detail/${encodeURIComponent(id)}`;
}

function miesiaceDo(termin, dzisiaj) {
  if (!termin) return null;
  const [r1, m1] = termin.split('-').map(Number);
  const [r0, m0] = dzisiaj.split('-').map(Number);
  return (r1 - r0) * 12 + (m1 - m0);
}

/** Wspólny kształt karty pozycji na liście (oba tryby). */
function karta(wpis, dzisiaj, ocena = null) {
  const rodzaj = RODZAJE_PLANU[wpis.rodzaj] ?? RODZAJ_NIEZNANY;
  return {
    id: wpis.id,
    przedmiot: wpis.przedmiot,
    zamawiajacy: wpis.zamawiajacy ?? null,
    region: wpis.region ?? null,
    region_nazwa: nazwaWojewodztwa(wpis.region),
    cpv: wpis.cpv ?? [],
    terminWszczecia: wpis.terminWszczecia ?? null,
    miesiacyDoWszczecia: ocena?.miesiacyDoWszczecia ?? miesiaceDo(wpis.terminWszczecia, dzisiaj),
    wartosc: wpis.wartosc ?? null,
    waluta: wpis.waluta ?? null,
    rodzaj: wpis.rodzaj ?? null,
    rodzaj_opis: { pl: rodzaj.pl, en: rodzaj.en },
    skraca_termin: Boolean(wpis.skraca_termin),
    opublikowano: wpis.opublikowano ?? null,
    wynik: ocena?.wynik ?? null,
    poziom: ocena?.poziom ?? null,
    powody: ocena ? [...ocena.uzasadnienie.powody] : [],
    url: urlPlanu(wpis.id),
  };
}

/**
 * Grupa kolejności: 0 = nadchodzące (od bieżącego miesiąca), 1 = bez daty,
 * 2 = minione. Pozycja wisi w radarze 60 dni po dacie, więc bez tego podziału
 * sortowanie rosnące po terminie wynosiło na górę plany sprzed dwóch miesięcy
 * (zmierzone po imporcie 2 041 planów na produkcji).
 */
function grupaKolejnosci(karta) {
  if (karta.miesiacyDoWszczecia === null || karta.miesiacyDoWszczecia === undefined) return 1;
  return karta.miesiacyDoWszczecia >= 0 ? 0 : 2;
}

/** Stabilnie układa karty wg grupy; w grupie minionych — najświeższe najpierw. */
function ulozKarty(karty, wGrupie) {
  return karty
    .map((k, i) => ({ k, i, g: grupaKolejnosci(k) }))
    .sort((a, b) => (a.g - b.g) || wGrupie(a, b))
    .map(({ k }) => k);
}

const poTerminie = (a, b) => String(a.k.terminWszczecia ?? '').localeCompare(String(b.k.terminWszczecia ?? ''));

/**
 * Lista radaru.
 * @param {{wpisy: object[], uzytkownik: object, dzisiaj: string, tryb?: 'dla_mnie'|'wszystkie',
 *   region?: string, limit?: number}} wejscie
 */
export function zbudujRadar({ wpisy, uzytkownik, dzisiaj, tryb = 'dla_mnie', region = null, limit } = {}) {
  const ile = Math.min(LIMIT_MAKS, Math.max(1, Number.isFinite(Number(limit)) && limit ? Number(limit) : LIMIT_DOMYSLNY));
  const aktywne = (wpisy ?? []).filter((w) => jestAktywna(w, dzisiaj));
  const profil = profilRadaru(uzytkownik, dzisiaj);

  const trybFaktyczny = tryb === 'dla_mnie' && profil.pusty ? 'wszystkie' : tryb;
  let pozycje;
  let dopasowanych = null;

  if (trybFaktyczny === 'dla_mnie') {
    const trafienia = dopasujPozycjePlanu({ pozycjePlanow: aktywne, profil });
    dopasowanych = trafienia.length;
    // Radar sortuje rosnąco po terminie (przy remisie wyższy wynik) — tę kolejność
    // zachowujemy wewnątrz grup, minione odwracamy (najświeższe najpierw).
    pozycje = ulozKarty(trafienia.map((t) => karta(t.pozycja, dzisiaj, t)),
      (a, b) => (a.g === 2 ? b.i - a.i : a.i - b.i)).slice(0, ile);
  } else {
    const kodRegionu = region ? kodWojewodztwa(region) : null;
    const karty = aktywne
      .filter((w) => !kodRegionu || w.region === kodRegionu)
      .map((w) => karta(w, dzisiaj));
    pozycje = ulozKarty(karty, (a, b) => {
      if (a.g === 0) return poTerminie(a, b);
      if (a.g === 2) return poTerminie(b, a);
      return String(b.k.opublikowano ?? '').localeCompare(String(a.k.opublikowano ?? ''));
    }).slice(0, ile);
  }

  let podpowiedz = null;
  if (profil.pusty && tryb === 'dla_mnie') {
    podpowiedz = {
      kod: 'uzupelnij_profil',
      pl: 'Dodaj w profilu kody CPV albo słowa kluczowe, a radar ułoży plany pod Twoją firmę. Na razie widzisz wszystkie aktywne plany.',
      en: 'Add CPV codes or keywords to your profile and the radar will rank plans for your company. For now you see all active plans.',
    };
  } else if (trybFaktyczny === 'dla_mnie' && dopasowanych === 0) {
    podpowiedz = {
      kod: 'brak_trafien',
      pl: `Żaden z ${aktywne.length} aktywnych planów nie pasuje do Twojego profilu. Sprawdź „Wszystkie" albo poszerz kody CPV.`,
      en: `None of the ${aktywne.length} active plans matches your profile. Check „All" or widen your CPV codes.`,
    };
  }

  return {
    tryb: trybFaktyczny,
    pozycje,
    lacznie_aktywnych: aktywne.length,
    dopasowanych,
    podpowiedz,
  };
}

/** Przetarg z bazy → wejście `dopasujOgloszenie`. */
export function ogloszenieZPrzetargu(t) {
  return {
    przedmiot: t?.title ?? '',
    cpv: t?.cpv_main ?? '',
    wartosc: t?.budget ?? null,
    dataPublikacji: t?.published_at ? String(t.published_at).slice(0, 10) : null,
  };
}

/**
 * Szczegół pozycji planu: plan przygotowań, uzasadnienie dla profilu i — gdy znamy
 * NIP zamawiającego — najlepiej pasujące ogłoszenie TEGO zamawiającego opublikowane
 * PO planie.
 * @param {{pozycja: object, uzytkownik: object, dzisiaj: string, przetargi: object[]}} wejscie
 *   `przetargi` = ogłoszenia z bazy o tym samym NIP-ie (wołający je dociąga)
 */
export function zbudujSzczegolPlanu({ pozycja, uzytkownik, dzisiaj, przetargi = [] }) {
  const profil = profilRadaru(uzytkownik, dzisiaj);
  const [ocena] = profil.pusty ? [] : dopasujPozycjePlanu({ pozycjePlanow: [pozycja], profil });
  const przygotowania = generujPlanPrzygotowan({ pozycja, profil, dzisiaj });

  const ogloszenieSprawdzone = Boolean(pozycja.zamawiajacy_nip);
  let ogloszenie = null;
  if (ogloszenieSprawdzone) {
    const odDnia = pozycja.opublikowano ?? '0000-00-00';
    const kandydaci = (przetargi ?? [])
      .filter((t) => t?.published_at && String(t.published_at).slice(0, 10) >= odDnia)
      .map((t) => ({ t, wynik: dopasujOgloszenie({ pozycja, ogloszenie: ogloszenieZPrzetargu(t) }) }))
      .filter((k) => k.wynik.etykieta !== 'brak')
      .sort((a, b) => b.wynik.pewnosc - a.wynik.pewnosc);
    if (kandydaci.length) {
      const { t, wynik } = kandydaci[0];
      ogloszenie = {
        tender_id: t.id,
        tytul: t.title ?? null,
        url: t.url ?? null,
        deadline: t.deadline ?? null,
        opublikowano: t.published_at ?? null,
        pewnosc: wynik.pewnosc,
        etykieta: wynik.etykieta,
        alarm: wynik.alarm,
        powody: [...wynik.powody],
        komunikat: wynik.komunikat,
      };
    }
  }

  const ostrzezenia = [];
  if (pozycja.skraca_termin) {
    ostrzezenia.push({
      kod: 'skrocony_termin',
      pl: 'To wstępne ogłoszenie pozwala zamawiającemu SKRÓCIĆ termin składania ofert. Gdy przetarg się ukaże, czasu będzie mniej niż zwykle — przygotuj się teraz.',
      en: 'This prior notice lets the buyer SHORTEN the tender deadline. Once the tender is published you will have less time than usual — prepare now.',
    });
  }
  if (!pozycja.terminWszczecia) {
    ostrzezenia.push({
      kod: 'brak_terminu',
      pl: 'Zamawiający nie podał przewidywanej daty ogłoszenia. Wstępne ogłoszenie obowiązuje do 12 miesięcy.',
      en: 'The buyer did not state the expected notice date. A prior notice is valid for up to 12 months.',
    });
  }
  if (!ogloszenieSprawdzone) {
    ostrzezenia.push({
      kod: 'brak_nip',
      pl: 'Plan nie podaje NIP-u zamawiającego, więc nie sprawdzimy automatycznie, czy przetarg już się ukazał.',
      en: 'The plan does not state the buyer\'s tax ID, so we cannot check automatically whether the tender is out.',
    });
  }

  return {
    pozycja: {
      ...karta(pozycja, dzisiaj, ocena),
      opis: pozycja.opis ?? null,
      zamawiajacy_nip: pozycja.zamawiajacy_nip ?? null,
      url: pozycja.url ?? urlPlanu(pozycja.id),
    },
    dopasowanie: ocena ? { wynik: ocena.wynik, poziom: ocena.poziom, powody: [...ocena.uzasadnienie.powody] } : null,
    przygotowania,
    ogloszenie,
    ogloszenie_sprawdzone: ogloszenieSprawdzone,
    ostrzezenia,
  };
}
