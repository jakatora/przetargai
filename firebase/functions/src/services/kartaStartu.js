import { kartaStartu } from '../lib/czyWartoStartowac.js';
import { dzialCpv, normWojewodztwo } from '../lib/wynikiAgregacja.js';
import { benchmarkRynku, rozstrzygniecia } from '../db/repos.js';

/*
 * Spięcie karty „Czy warto startować?" z bazą (etap 6).
 *
 * Cała logika decyzji siedzi w `lib/czyWartoStartowac.js` (czysta, testowalna
 * bez bazy). Tu jest wyłącznie: z przetargu → klucze kubełków → JEDEN odczyt
 * wsadowy → karta.
 *
 * Koszt odczytu jest tu istotny: karta ma się otwierać przy KAŻDYM ogłoszeniu,
 * tak jak katalog, więc nie wolno jej liczyć zapytaniem po rozstrzygnięciach.
 * Trzy kubełki jednym `getAll` to jeden round-trip, nie trzy.
 */

/**
 * Klucze kubełków benchmarku dla przetargu.
 *
 * Zwraca też `null`-e — wołający i tak je odfiltruje, a jawny brak klucza
 * mówi, DLACZEGO kubełka nie było (np. ogłoszenie bez CPV).
 */
export function kluczeBenchmarku(tender) {
  const dzial = dzialCpv(tender?.cpv_main ?? tender?.cpv);
  const woj = normWojewodztwo(tender?.wojewodztwo);
  const nip = tender?.zamawiajacy_nip ?? null;
  return {
    zamawiajacy: nip ? `nip:${nip}` : null,
    dzialRegion: dzial && woj ? `cpv:${dzial}|${woj}` : null,
    dzialKraj: dzial ? `cpv:${dzial}` : null,
  };
}

/**
 * Buduje kartę dla przetargu.
 *
 * @param {{tender: object, profil?: object, teraz?: number}} wejscie
 */
export async function zbudujKarteStartu({ tender, profil = null, teraz = Date.now() }) {
  const klucze = kluczeBenchmarku(tender);
  const kubelki = await benchmarkRynku.pobierzWiele(Object.values(klucze));

  const karta = kartaStartu({
    tender,
    benchmarki: {
      zamawiajacy: klucze.zamawiajacy ? kubelki[klucze.zamawiajacy] ?? null : null,
      dzialRegion: klucze.dzialRegion ? kubelki[klucze.dzialRegion] ?? null : null,
      dzialKraj: klucze.dzialKraj ? kubelki[klucze.dzialKraj] ?? null : null,
    },
    profil,
    teraz,
  });

  return { ...karta, klucze };
}

/**
 * Rozstrzygnięcie TEGO postępowania, jeśli już jest.
 *
 * Przetarg, który się rozstrzygnął, przestaje być decyzją „czy startować" —
 * i lepiej powiedzieć to wprost, niż pokazywać kartę z czynnikami.
 */
export async function rozstrzygniecieTegoPostepowania(tender) {
  return rozstrzygniecia.poPostepowaniu(tender?.postepowanie_id ?? null);
}
