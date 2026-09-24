import { logger } from '../lib/logger.js';
import { pobierzPlanyTed } from '../services/tedPlany.js';
import { planyPostepowan, oknoPlanow as repoOkna } from '../db/repos.js';

/*
 * OKNO PLANÓW — import wstępnych ogłoszeń informacyjnych z TED do Radaru planów.
 *
 * Bez dopasowań i bez AI: koszt to jedno–dwa zapytania do publicznego API TED
 * i kilkadziesiąt zapisów dziennie (208 ogłoszeń / 30 dni). Okno 3 dni przy
 * przebiegu codziennym daje potrójne pokrycie każdej publikacji — awaria jednego
 * przebiegu niczego nie gubi, a nadpisanie tego samego numeru jest nieszkodliwe.
 *
 * Pierwsze zasilenie (roczne WOI) robi operator przez `POST /admin/okno-planow`
 * z `dni: 365` — harmonogram nie musi o tym wiedzieć.
 *
 * Błąd pobrania NIE kasuje indeksu: radar pokazuje wczorajszy stan, a ślad
 * przebiegu mówi o awarii (`/health.plany_okno.error`).
 */

export const DNI_OKNA_PLANOW = 3;

function yyyymmdd(ms) {
  return new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
}

export async function runOknoPlanow({
  dni = DNI_OKNA_PLANOW,
  teraz = Date.now(),
  pobierz = pobierzPlanyTed,
} = {}) {
  const start = Date.now();
  const dzisiaj = new Date(teraz).toISOString().slice(0, 10);
  const licznik = { zapytania: 0, surowe: 0, odrzucone: 0 };
  const wynik = {
    ok: false, zakonczony_o: null, dni, pobrane: 0, zapisane: 0,
    aktywnych_w_indeksie: null, czesci_indeksu: null, licznik, error: null, czas_ms: 0,
  };

  try {
    const pozycje = await pobierz({ odDnia: yyyymmdd(teraz - (dni - 1) * 86_400_000), licznik });
    wynik.pobrane = pozycje.length;
    wynik.zapisane = await planyPostepowan.zapiszWiele(pozycje);
  } catch (err) {
    wynik.error = String(err?.message ?? err).slice(0, 500);
    logger.error({ err: wynik.error }, 'okno planów: pobranie z TED nie powiodło się');
  }

  // Indeks przebudowujemy ZAWSZE — nawet po błędzie pobrania wygasłe pozycje
  // muszą z niego zejść, a zapisane wcześniej zostają.
  try {
    const indeks = await planyPostepowan.przebudujIndeks({ dzisiaj });
    wynik.aktywnych_w_indeksie = indeks.aktywnych;
    wynik.czesci_indeksu = indeks.czesci;
  } catch (err) {
    wynik.error = wynik.error ?? `indeks: ${String(err?.message ?? err).slice(0, 400)}`;
    logger.error({ err: err?.message }, 'okno planów: przebudowa indeksu nie powiodła się');
  }

  wynik.ok = wynik.error === null;
  wynik.zakonczony_o = new Date().toISOString();
  wynik.czas_ms = Date.now() - start;
  await repoOkna.zapiszPrzebieg(wynik).catch((err) =>
    logger.error({ err: err.message }, 'okno planów: nie udało się zapisać śladu'));
  return wynik;
}
