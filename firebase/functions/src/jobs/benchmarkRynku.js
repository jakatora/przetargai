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
    if (koniec || !nastepny) break;
  }

  const kubelki = {
    ...benchmarkZamawiajacych(partie),
    ...benchmarkDzialowCpv(partie),
  };
  const zapisane = await repoBenchmark.zapisz(kubelki);

  const wynik = {
    ok: true,
    od,
    rozstrzygniec: przeczytane,
    stron: stronPrzeczytanych,
    kubelkow: zapisane,
    kubelkow_z_wnioskiem: Object.values(kubelki).filter((k) => k.wystarczajacaProbka).length,
    budzet_wyczerpany: budzetWyczerpany,
    durationMs: Date.now() - start,
    zakonczony_o: new Date().toISOString(),
  };
  logger.info(wynik, 'benchmarkRynku: zakończono');
  return wynik;
}
