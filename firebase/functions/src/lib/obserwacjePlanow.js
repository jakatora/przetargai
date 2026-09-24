/**
 * OBSERWACJA POZYCJI PLANU — czysta logika (bez Firestore, bez zegara).
 *
 * Radar planów bez powiadomienia wymaga, żeby użytkownik sam co kilka dni sprawdzał,
 * czy przetarg z planu już się ukazał — czyli traci połowę przewagi, którą plan daje.
 * Obserwacja zamyka tę pętlę: przebieg monitoringu (co 2 h) bierze ogłoszenia TEGO
 * zamawiającego (po NIP-ie), opublikowane PO planie, i alarmuje dopiero przy
 * dopasowaniu „pewne" (`zmianyPlanu.dopasujOgloszenie`, próg 70, nieosiągalny bez
 * zgodnego CPV) — fałszywy alarm „to jest to" kosztuje zaufanie do całego radaru.
 */

import { dopasujOgloszenie } from './zmianyPlanu.js';
import { wygasaO } from './indeksPlanow.js';
import { ogloszenieZPrzetargu } from './widokRadaru.js';

/** Ile planów jedno konto może obserwować — sufit kosztu przebiegu (1 zapytanie na plan). */
export const LIMIT_OBSERWOWANYCH = 50;

/** Zwarty wpis obserwacji — tylko to, czego potrzebuje sprawdzenie w monitoringu. */
export function wpisObserwacji(pozycja, teraz) {
  return {
    plan_id: pozycja.id,
    przedmiot: pozycja.przedmiot,
    zamawiajacy: pozycja.zamawiajacy ?? null,
    zamawiajacy_nip: pozycja.zamawiajacy_nip ?? null,
    cpv: pozycja.cpv ?? [],
    terminWszczecia: pozycja.terminWszczecia ?? null,
    wartosc: pozycja.wartosc ?? null,
    opublikowano: pozycja.opublikowano ?? null,
    wygasa_o: pozycja.wygasa_o ?? wygasaO(pozycja),
    aktywna: true,
    znalezione: null,
    zakonczenie: null,
    utworzone_o: teraz,
    ostatnio_sprawdzone_o: null,
  };
}

/** Alert do centrum alertów + push. Klucz deterministyczny = idempotencja przy ponowieniu. */
export function zbudujAlertPlanu({ obserwacja, znalezione }) {
  const planId = String(obserwacja.plan_id).replace(/[/\s]/g, '_');
  const tenderId = String(znalezione.tender_id).replace(/[/\s]/g, '_');
  return {
    klucz: `plan_${planId}_${tenderId}`,
    typ: 'plan_ogloszony',
    tender_id: znalezione.tender_id,
    ton: 'sukces',
    tytul: {
      pl: `To jest to, na co czekałeś: ${obserwacja.przedmiot}`,
      en: `This is the one you were waiting for: ${obserwacja.przedmiot}`,
    },
    tresc: {
      pl: `${obserwacja.zamawiajacy ?? 'Zamawiający'} ogłosił przetarg z obserwowanego planu (pewność ${znalezione.pewnosc}%).`,
      en: `${obserwacja.zamawiajacy ?? 'The buyer'} published the tender from the plan you follow (confidence ${znalezione.pewnosc}%).`,
    },
    pozycje: [{
      tender_id: znalezione.tender_id,
      tytul: znalezione.tytul ?? null,
      organizacja: obserwacja.zamawiajacy ?? null,
      deadline: znalezione.deadline ?? null,
      zrodlo: znalezione.zrodlo ?? null,
    }],
  };
}

/**
 * Jeden przebieg dla jednej obserwacji.
 * @param {{obserwacja: object, przetargi: object[], teraz: string}} wejscie
 *   `przetargi` = ogłoszenia z bazy o NIP-ie zamawiającego (dociąga job)
 * @returns {{aktywna: boolean, zakonczenie: string|null, znalezione: object|null, alert: object|null}}
 */
export function sprawdzObserwacje({ obserwacja, przetargi = [], teraz }) {
  const dzisiaj = String(teraz).slice(0, 10);
  const odDnia = obserwacja.opublikowano ?? '0000-00-00';
  const pozycja = {
    przedmiot: obserwacja.przedmiot,
    cpv: obserwacja.cpv,
    wartosc: obserwacja.wartosc,
    terminWszczecia: obserwacja.terminWszczecia,
  };

  if (obserwacja.zamawiajacy_nip) {
    const najlepszy = (przetargi ?? [])
      .filter((t) => t?.published_at && String(t.published_at).slice(0, 10) >= odDnia)
      .map((t) => ({ t, wynik: dopasujOgloszenie({ pozycja, ogloszenie: ogloszenieZPrzetargu(t) }) }))
      .filter((k) => k.wynik.alarm)
      .sort((a, b) => b.wynik.pewnosc - a.wynik.pewnosc)[0];

    if (najlepszy) {
      const znalezione = {
        tender_id: najlepszy.t.id,
        tytul: najlepszy.t.title ?? null,
        deadline: najlepszy.t.deadline ?? null,
        zrodlo: najlepszy.t.source ?? null,
        pewnosc: najlepszy.wynik.pewnosc,
        znaleziono_o: teraz,
      };
      return {
        aktywna: false,
        zakonczenie: 'ogloszono',
        znalezione,
        alert: zbudujAlertPlanu({ obserwacja, znalezione }),
      };
    }
  }

  if (obserwacja.wygasa_o && obserwacja.wygasa_o < dzisiaj) {
    return { aktywna: false, zakonczenie: 'wygasla', znalezione: null, alert: null };
  }
  return { aktywna: true, zakonczenie: null, znalezione: null, alert: null };
}
