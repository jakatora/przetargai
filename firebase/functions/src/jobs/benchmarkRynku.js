import { logger } from '../lib/logger.js';
import { benchmarkZamawiajacych, benchmarkDzialowCpv } from '../lib/benchmark.js';
import { rozstrzygniecia, benchmarkRynku as repoBenchmark } from '../db/repos.js';

/*
 * Przeliczenie BENCHMARKU rynku z zapisanych rozstrzygnięć (etap 6).
 *
 * Czyta kolekcję `rozstrzygniecia` stronami i buduje dwa zestawy kubełków:
 *   • per ZAMAWIAJĄCY (po NIP-ie) — „ilu startuje u tego konkretnego urzędu",
 *   • per DZIAŁ CPV w województwie i w kraju — „ile się płaci za taką robotę".
 *
 * Nie dotyka rejestrów zewnętrznych i nie woła AI: to przeliczenie tego, co już
 * mamy. Dzięki temu benchmark da się odświeżyć po każdej poprawce parsera bez
 * ponownego mielenia BZP (~390 s samego ruchu sieciowego).
 *
 * 🚨 Pamięć: trzymamy wyłącznie AKUMULATORY kubełków, nigdy całej kolekcji.
 * Rozstrzygnięcia strony są odrzucane zaraz po doliczeniu — inaczej 30 dni
 * rynku (dziesiątki tysięcy części) nie zmieściłoby się w 512 MiB instancji.
 */

/** Z ilu dni wstecz liczymy benchmark. Rok to kompromis: świeżość vs próbka. */
export const DNI_BENCHMARKU = 365;

/** Rozmiar strony odczytu — 500 dokumentów to jeden bezpieczny round-trip. */
const STRONA = 500;

/**
 * Twardy sufit liczby odczytanych rozstrzygnięć.
 *
 * Firestore liczy KAŻDY odczytany dokument. Rok rynku to docelowo ponad sto tysięcy
 * rozstrzygnięć, więc codzienne przemielenie całego okna rosłoby liniowo, aż
 * przekroczyłoby limit odczytów — i to bez żadnego ostrzeżenia, bo job nadal
 * kończyłby się sukcesem. Sufit zatrzymuje odczyt świadomie i ZGŁASZA ucięcie
 * (`ucietySufit`), żeby dało się je zobaczyć, zamiast domyślać się z rachunku.
 * Czytamy od najnowszych, więc ucięcie traci najstarsze obserwacje.
 */
export const MAKS_ROZSTRZYGNIEC = 30_000;

/**
 * Ile czasu wolno zużyć na czytanie kolekcji, zanim przejdziemy do zapisu.
 *
 * 🚨 Ta sama lekcja, co w `aggregateResults`: praca ucięta przez timeout platformy
 * ginie CAŁA i po cichu. Lepiej policzyć benchmark z części okna i zapisać, niż
 * stracić wszystko — a `probka` w każdym kubełku i tak mówi, z czego powstał.
 */
const BUDZET_ODCZYTU_MS = 900_000;

/**
 * @param {{dni?: number, budzetMs?: number, teraz?: number, strona?: number}} [opts]
 */
export async function runBenchmarkRynku({
  dni = DNI_BENCHMARKU,
  budzetMs = BUDZET_ODCZYTU_MS,
  teraz = Date.now(),
  strona = STRONA,
} = {}) {
  const start = Date.now();
  const od = new Date(teraz - dni * 86_400_000).toISOString().slice(0, 10);

  const partie = [];
  let kursor = null;
  let przeczytane = 0;
  let stronPrzeczytanych = 0;
  let budzetWyczerpany = false;
  let ucietySufit = false;

  // Czytamy stronami i od razu odkładamy do pamięci TYLKO to, co potrzebne
  // agregacji (rozstrzygnięcie bez `raw`), a strony odrzucamy.
  for (;;) {
    if (Date.now() - start > budzetMs) {
      budzetWyczerpany = true;
      logger.warn({ przeczytane }, 'benchmark: budżet odczytu wyczerpany — liczę z tego, co mam');
      break;
    }
    const { pozycje, kursor: nastepny, koniec } = await rozstrzygniecia.strona({ od, limit: strona, kursor });
    stronPrzeczytanych += 1;
    przeczytane += pozycje.length;
    for (const pozycja of pozycje) {
      partie.push({
        zrodlo: pozycja.zrodlo,
        zamawiajacy: pozycja.zamawiajacy,
        zamawiajacyNip: pozycja.zamawiajacyNip ?? pozycja.zamawiajacy_nip ?? null,
        cpv: pozycja.cpv,
        wojewodztwo: pozycja.wojewodztwo,
        opublikowano: pozycja.opublikowano,
        czesci: pozycja.czesci ?? [],
      });
    }
    kursor = nastepny;
    if (przeczytane >= MAKS_ROZSTRZYGNIEC) {
      ucietySufit = true;
      logger.warn({ przeczytane }, 'benchmark: sufit odczytów osiągnięty — liczę z najnowszych');
      break;
    }
    if (koniec || !nastepny) break;
  }

  const kubelki = {
    ...benchmarkZamawiajacych(partie),
    ...benchmarkDzialowCpv(partie),
  };

  /*
   * 🚨 UTRWALAMY WYŁĄCZNIE KUBEŁKI Z WNIOSKIEM. Zmierzone na żywej próbce BZP:
   * 200 ogłoszeń jednego dnia to 178 RÓŻNYCH zamawiających, więc w rocznym oknie
   * uzbiera się ich dziesiątki tysięcy — a typowy urząd prowadzi kilka postępowań
   * rocznie, czyli nigdy nie przekroczy progu próbki. Zapisywanie ich wszystkich
   * co dobę przekraczałoby darmowy limit zapisów Firestore samym tym zadaniem,
   * nie zmieniając ani jednej odpowiedzi: `wybierzBenchmark` i tak pomija kubełki
   * bez wniosku. Kubełek bez próbki = BRAK dokumentu, a karta mówi wtedy „za mało
   * danych" — ta sama treść, zero kosztu.
   */
  const zWnioskiem = Object.fromEntries(
    Object.entries(kubelki).filter(([, k]) => k.wystarczajacaProbka),
  );
  const zapisane = await repoBenchmark.zapisz(zWnioskiem);

  const wynik = {
    ok: true,
    od,
    rozstrzygniec: przeczytane,
    stron: stronPrzeczytanych,
    kubelkow: zapisane,
    // Ile kubełków policzono, a ile pominięto jako zbyt małą próbkę — bez tej
    // liczby „mało kubełków" wygląda identycznie jak „mało danych w rejestrze".
    kubelkow_policzonych: Object.keys(kubelki).length,
    kubelkow_bez_wniosku: Object.keys(kubelki).length - zapisane,
    budzet_wyczerpany: budzetWyczerpany,
    uciety_sufit: ucietySufit,
    durationMs: Date.now() - start,
    zakonczony_o: new Date().toISOString(),
  };
  logger.info(wynik, 'benchmarkRynku: zakończono');
  return wynik;
}
