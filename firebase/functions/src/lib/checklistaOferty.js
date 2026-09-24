/*
 * CHECKLISTA PRZYGOTOWANIA OFERTY (etap 6) — czysta logika, zero I/O i zero AI.
 *
 * Odpowiada na pytanie, którego żaden pojedynczy moduł dotąd nie zadawał:
 * „czego BRAKUJE MI NA DZIEŃ SKŁADANIA w TYM przetargu".
 *
 * Trzy rzeczy, które trzeba złożyć, żeby ta odpowiedź powstała:
 *   • WYMAGANIA postępowania — co trzeba mieć (Radar SWZ),
 *   • STAN SEJFU — co firma ma i do kiedy jest ważne,
 *   • DZIEŃ SKŁADANIA — termin z kalendarza postępowania.
 *
 * ── 🚨 DLACZEGO TRZECI SKŁADNIK JEST KLUCZOWY ────────────────────────────────
 *
 * Dokument „ważny" dzisiaj bywa nieważny w dniu składania. Zaświadczenie z ZUS
 * ma 3 miesiące, KRK 6 miesięcy — przy terminie za 7 tygodni „mam to" potrafi
 * znaczyć „będę musiał wystąpić o to jeszcze raz, a urząd ma 7 dni". Checklista,
 * która porównuje ważność z DZISIAJ zamiast z dniem składania, mówi firmie, że
 * jest gotowa, i to jest gorsze niż brak checklisty.
 *
 * Moduł jest BEZSTANOWY: wymagania i stan sejfu przychodzą z zewnątrz. Radar SWZ
 * i Sejf mieszkają w osobnej usłudze, a ta funkcja nie ma prawa zgadywać ich
 * kształtu — normalizuje warianty nazw pól i nic poza tym.
 */

import { normalize } from './textNorm.js';

const DZIEN_MS = 86_400_000;

/** Trzy koszyki — te same, co w dopasowaniu sejfu do SWZ. */
export const KOSZYKI = {
  MASZ: 'masz',
  PRZETERMINUJE: 'przeterminuje_sie',
  BRAKUJE: 'brakuje',
};

/**
 * Ile dni przed terminem chcemy być gotowi.
 *
 * Nie jest to ostrożnościowy zapas „na wszelki wypadek": platformy zakupowe
 * padają, a podpis kwalifikowany potrafi odmówić współpracy w ostatniej chwili.
 * Dzień zapasu to różnica między „złożone" a „mieliśmy wszystko, ale się nie
 * wysłało" — tę drugą sytuację opisuje osobny moduł (czarna skrzynka).
 */
export const DNI_ZAPASU = 1;

function nazwaWymagania(w) {
  return w?.nazwa ?? w?.tytul ?? w?.opis ?? w?.wymaganie ?? null;
}

function kodWymagania(w) {
  return w?.kod ?? w?.typ ?? w?.id ?? null;
}

/*
 * Czytniki pól dokumentu z sejfu.
 *
 * 🚨 Nazwy pól MUSZĄ obejmować kształt, który naprawdę przychodzi z usługi Sejfu
 * (`typ_dokumentu`, `nazwaTypu`, `dataWaznosci`), a nie tylko ten, który wygląda
 * naturalnie w tym pliku. Gdyby czytnik chybił, dopasowanie po cichu zwróciłoby
 * zero trafień, a checklista pokazałaby „brakuje wszystkiego" firmie, która ma
 * komplet dokumentów — błąd wyglądający jak prawdziwa odpowiedź.
 */
function nazwaDokumentu(d) {
  return d?.nazwa ?? d?.nazwaTypu ?? d?.tytul ?? d?.opis ?? null;
}

function kodDokumentu(d) {
  return d?.kod ?? d?.typ ?? d?.typ_dokumentu ?? d?.rodzaj ?? null;
}

function waznyDo(d) {
  return d?.wazny_do ?? d?.waznyDo ?? d?.dataWaznosci ?? d?.data_waznosci
    ?? d?.wazne_do ?? d?.expires_at ?? null;
}

/** Porównywalna postać nazwy — bez diakrytyków, znaków i wielkości liter. */
function klucz(tekst) {
  return tekst ? normalize(String(tekst)).replace(/[^a-z0-9]/g, '') : null;
}

/**
 * Czy dokument odpowiada wymaganiu.
 *
 * Kod jest mocniejszy od nazwy (oba moduły znają ten sam słownik typów);
 * nazwa jest dopasowaniem awaryjnym, gdy któraś strona kodu nie poda.
 */
export function dokumentPasuje(wymaganie, dokument) {
  const kodW = klucz(kodWymagania(wymaganie));
  const kodD = klucz(kodDokumentu(dokument));
  if (kodW && kodD) return kodW === kodD;

  const nazwaW = klucz(nazwaWymagania(wymaganie));
  const nazwaD = klucz(nazwaDokumentu(dokument));
  if (!nazwaW || !nazwaD) return false;
  return nazwaW === nazwaD || nazwaW.includes(nazwaD) || nazwaD.includes(nazwaW);
}

/**
 * Dzień, na który dokumenty muszą być ważne.
 *
 * To termin składania minus zapas — a nie „dzisiaj". Bez terminu nie udajemy,
 * że wiemy: zwracamy null i checklista mówi to wprost.
 */
export function dzienZlozenia(tender, { dniZapasu = DNI_ZAPASU } = {}) {
  const termin = Date.parse(tender?.deadline ?? '');
  if (!Number.isFinite(termin)) return null;
  return new Date(termin - dniZapasu * DZIEN_MS).toISOString();
}

function stanDokumentu(dokument, naDzien) {
  const koniec = Date.parse(waznyDo(dokument) ?? '');
  if (!Number.isFinite(koniec)) return { koszyk: KOSZYKI.MASZ, waznyDo: null, dniZapasu: null };
  const naDzienMs = Date.parse(naDzien ?? '');
  if (!Number.isFinite(naDzienMs)) return { koszyk: KOSZYKI.MASZ, waznyDo: waznyDo(dokument), dniZapasu: null };
  const dni = Math.floor((koniec - naDzienMs) / DZIEN_MS);
  return {
    koszyk: dni >= 0 ? KOSZYKI.MASZ : KOSZYKI.PRZETERMINUJE,
    waznyDo: waznyDo(dokument),
    dniZapasu: dni,
  };
}

/**
 * Czynności, które nie są dokumentem z sejfu, ale bez nich oferta nie poleci.
 *
 * Biorą się z OGŁOSZENIA, nie ze statystyki — dlatego mają tu własne miejsce
 * i nie mieszają się z koszykami dokumentów.
 */
export function czynnosciZOgloszenia(tender) {
  const czynnosci = [];
  if (tender?.wadium_wymagane === true) {
    czynnosci.push({
      kod: 'wadium',
      nazwa: tender.wadium_kwota
        ? `Wnieś wadium ${Math.round(tender.wadium_kwota)} zł`
        : 'Wnieś wadium',
      // Wadium wniesione PO terminie składania = oferta odrzucona; to nie jest
      // formalność do odhaczenia w dniu wysyłki.
      naKiedy: 'przed terminem składania ofert',
      obowiazkowe: true,
    });
  }
  if (tender?.wadium_wymagane === null || tender?.wadium_wymagane === undefined) {
    czynnosci.push({
      kod: 'wadium_sprawdz',
      nazwa: 'Sprawdź w SWZ, czy wymagane jest wadium',
      naKiedy: 'jak najwcześniej',
      obowiazkowe: false,
    });
  }
  return czynnosci;
}

/**
 * Buduje checklistę przygotowania oferty.
 *
 * @param {{tender: object, wymagania?: object[], dokumenty?: object[],
 *   teraz?: number, dniZapasu?: number}} wejscie
 * @returns {object} koszyki, czynności, następny krok i jawny stan wiedzy
 */
export function zbudujChecklisteOferty({
  tender,
  wymagania = [],
  dokumenty = [],
  teraz = Date.now(),
  dniZapasu = DNI_ZAPASU,
} = {}) {
  const naDzien = dzienZlozenia(tender, { dniZapasu });

  const pozycje = (wymagania ?? []).map((wymaganie) => {
    const dopasowany = (dokumenty ?? []).find((d) => dokumentPasuje(wymaganie, d)) ?? null;
    const obowiazkowe = wymaganie?.obowiazkowe ?? wymaganie?.wymagany ?? true;

    if (!dopasowany) {
      return {
        kod: kodWymagania(wymaganie),
        nazwa: nazwaWymagania(wymaganie) ?? kodWymagania(wymaganie),
        obowiazkowe,
        koszyk: KOSZYKI.BRAKUJE,
        dokument: null,
        waznyDo: null,
        dniZapasu: null,
      };
    }

    const stan = stanDokumentu(dopasowany, naDzien);
    return {
      kod: kodWymagania(wymaganie),
      nazwa: nazwaWymagania(wymaganie) ?? kodWymagania(wymaganie),
      obowiazkowe,
      koszyk: stan.koszyk,
      dokument: { id: dopasowany?.id ?? null, nazwa: nazwaDokumentu(dopasowany) },
      waznyDo: stan.waznyDo,
      dniZapasu: stan.dniZapasu,
    };
  });

  const koszyki = {
    [KOSZYKI.MASZ]: pozycje.filter((p) => p.koszyk === KOSZYKI.MASZ),
    [KOSZYKI.PRZETERMINUJE]: pozycje.filter((p) => p.koszyk === KOSZYKI.PRZETERMINUJE),
    [KOSZYKI.BRAKUJE]: pozycje.filter((p) => p.koszyk === KOSZYKI.BRAKUJE),
  };

  const doZalatwienia = [...koszyki[KOSZYKI.BRAKUJE], ...koszyki[KOSZYKI.PRZETERMINUJE]];
  const obowiazkoweDoZalatwienia = doZalatwienia.filter((p) => p.obowiazkowe);
  const dniDoZlozenia = naDzien
    ? Math.floor((Date.parse(naDzien) - teraz) / DZIEN_MS)
    : null;

  return {
    tenderId: tender?.id ?? null,
    // Dzień, na KTÓRY liczymy ważność — nie „dzisiaj". To jest sedno tego modułu.
    dzienZlozenia: naDzien,
    dniDoZlozenia,
    dniZapasu,
    /*
     * Jawny stan wiedzy zamiast cichego „0 braków". Checklista bez wymagań
     * wygląda identycznie jak checklista spełniona — a znaczy coś odwrotnego.
     */
    stanWiedzy: {
      znamyWymagania: (wymagania ?? []).length > 0,
      znamySejf: (dokumenty ?? []).length > 0,
      znamyTermin: naDzien !== null,
    },
    koszyki,
    czynnosci: czynnosciZOgloszenia(tender),
    gotowe: (wymagania ?? []).length > 0 && obowiazkoweDoZalatwienia.length === 0,
    nastepnyKrok: nastepnyKrokChecklisty({ obowiazkoweDoZalatwienia, doZalatwienia, dniDoZlozenia }),
  };
}

/**
 * Jedna rzecz do zrobienia teraz.
 *
 * Kolejność nie jest estetyczna: najpierw brak dokumentu obowiązkowego (urząd
 * wydaje go tygodniami), potem dokument, który straci ważność przed złożeniem,
 * a nieobowiązkowe na końcu.
 */
export function nastepnyKrokChecklisty({ obowiazkoweDoZalatwienia, doZalatwienia, dniDoZlozenia }) {
  const kandydat = obowiazkoweDoZalatwienia[0] ?? doZalatwienia[0] ?? null;
  if (!kandydat) return null;
  return {
    kod: kandydat.kod,
    nazwa: kandydat.nazwa,
    koszyk: kandydat.koszyk,
    dniDoZlozenia,
    pilne: dniDoZlozenia !== null && dniDoZlozenia <= 7,
  };
}
