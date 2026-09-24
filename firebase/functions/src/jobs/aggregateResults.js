import { logger } from '../lib/logger.js';
import { parsujWynik } from '../lib/wynikiParser.js';
import { agregujWyniki } from '../lib/wynikiAgregacja.js';
import { pobierzSuroweWynikiDnia } from '../services/bzp.js';
import { wynikiStats, rozstrzygniecia } from '../db/repos.js';
import { dniWZakresie } from '../services/bzp.js';

/**
 * Cykl agregacji wyników postępowań (runda 16).
 *
 * Statystyki cen/konkurencji zmieniają się wolno — liczymy je z SZERSZEGO okna
 * (domyślnie 30 dni) na osobnym, rzadszym harmonogramie niż dzienny matching.
 *
 * Kluczowa oszczędność pamięci: parsujemy dzień po dniu i TRZYMAMY tylko małe wyniki
 * (kilka pól/część), NIE surowe `htmlBody` (~27 KB × tysiące = dziesiątki MB). Surowe
 * ogłoszenia dnia są odrzucane zaraz po sparsowaniu.
 *
 * @param {{dni?: number, pobierzDzien?: Function, teraz?: number}} [opts]
 *   `pobierzDzien`/`teraz` wstrzykiwane w testach.
 */
/**
 * Ile ms wolno zużyć na pobieranie, zanim przejdziemy do agregacji.
 *
 * 🚨 Bez tego 30 dni × pobranie dnia (do ~17 zapytań na dobę na suficie) potrafi
 * przekroczyć timeout funkcji (540 s) i platforma ZABIJA ją PRZED zapisem — cała
 * praca w kosz, po cichu (audyt R18). Lepiej zagregować 20 dni z 30 niż stracić
 * wszystko. Zostawiamy zapas na agregację + batch zapis.
 */
const BUDZET_POBIERANIA_MS = 420_000;

/**
 * Ile rozstrzygnięć musi być już w bazie, żeby liczyć z niej zamiast z rejestru.
 *
 * Od etapu 6 okno `wynikiOknoFetch` zapisuje rozstrzygnięcia do kolekcji, więc
 * ponowne ciągnięcie 30 dni z BZP jest zdublowaną pracą (~390 s ruchu). Próg
 * chroni przed regresją pierwszego dnia: dopóki kolekcja jest pusta albo prawie
 * pusta, statystyki liczą się po staremu, a `/matches/:id/wyniki` nie gaśnie.
 */
export const MIN_ROZSTRZYGNIEC_Z_BAZY = 50;

/** Czyta rozstrzygnięcia z bazy stronami. Zwraca null, gdy jest ich za mało. */
async function zBazy(od, { strona = 500 } = {}) {
  const zebrane = [];
  let kursor = null;
  for (;;) {
    const wynik = await rozstrzygniecia.strona({ od, limit: strona, kursor });
    zebrane.push(...wynik.pozycje);
    kursor = wynik.kursor;
    if (wynik.koniec || !kursor) break;
  }
  return zebrane.length >= MIN_ROZSTRZYGNIEC_Z_BAZY ? zebrane : null;
}

export async function runWynikiAggregation({
  dni = 30,
  pobierzDzien = pobierzSuroweWynikiDnia,
  teraz = Date.now(),
  budzetMs = BUDZET_POBIERANIA_MS,
  zrodloBazy = zBazy,
} = {}) {
  const start = Date.now();
  const od = new Date(teraz - (dni - 1) * 86_400_000).toISOString().slice(0, 10);
  const do_ = new Date(teraz).toISOString().slice(0, 10);
  const listaDni = dniWZakresie(od, do_);

  /*
   * Ścieżka preferowana: kolekcja `rozstrzygniecia`. Nie dotyka rejestru, więc
   * nie ma tu ani limitu czasu, ani ryzyka dławienia po stronie BZP.
   */
  const zapisane = await zrodloBazy(od).catch((err) => {
    logger.error({ err: err.message }, 'Agregacja wyników: odczyt z bazy nieudany — wracam do rejestru');
    return null;
  });
  if (zapisane) {
    const bucketyZBazy = agregujWyniki(zapisane);
    const zapisanychBucketow = await wynikiStats.zapisz(bucketyZBazy);
    const wynikZBazy = {
      ok: true, zrodlo: 'baza', dni: listaDni.length, bledneDni: 0, pominietychDni: 0,
      ogloszen: zapisane.length, bucketow: zapisanychBucketow, durationMs: Date.now() - start,
    };
    logger.info(wynikZBazy, 'runWynikiAggregation: zakończono (z zapisanych rozstrzygnięć)');
    return wynikZBazy;
  }

  const sparsowane = [];
  let bledneDni = 0;
  let pominietychDni = 0;
  // Od NAJNOWSZYCH dni — jeśli zabraknie czasu, tracimy najstarsze (najmniej istotne).
  for (const dzien of [...listaDni].reverse()) {
    if (Date.now() - start > budzetMs) {
      // `dzien` i wszystkie starsze nietknięte = indeksy 0..indexOf w oryginalnej liście.
      pominietychDni = listaDni.indexOf(dzien) + 1;
      logger.warn({ pominietychDni }, 'Agregacja wyników: budżet czasu wyczerpany — agreguję to, co zebrane');
      break;
    }
    try {
      const surowe = await pobierzDzien(dzien);
      for (const s of surowe) {
        const w = parsujWynik(s);
        if (w) sparsowane.push(w); // tylko małe pola — surowe htmlBody odrzucone
      }
    } catch (err) {
      bledneDni++;
      logger.error({ err: err.message, dzien }, 'Agregacja wyników: dzień pominięty');
    }
  }

  const buckety = agregujWyniki(sparsowane);
  const zapisaneBuckety = await wynikiStats.zapisz(buckety);

  const wynik = {
    ok: true, zrodlo: 'rejestr', dni: listaDni.length, bledneDni, pominietychDni,
    ogloszen: sparsowane.length, bucketow: zapisaneBuckety, durationMs: Date.now() - start,
  };
  logger.info(wynik, 'runWynikiAggregation: zakończono');
  return wynik;
}
