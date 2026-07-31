/**
 * Grupowanie dopasowań po DNIU DODANIA do aplikacji (`created_at`) + wykrywanie
 * „nowych" od ostatniej wizyty. Czyste, testowalne bez renderera — feed tylko
 * renderuje sekcje, a całą regułę „która data → jaki nagłówek / co jest nowe"
 * trzymamy tu.
 *
 * Dzień liczymy w LOKALNEJ strefie urządzenia (użytkownicy z PL), bo „Dziś/Wczoraj"
 * ma się zgadzać z tym, co widzi człowiek, a nie z UTC. Czas bieżący (`terazMs`)
 * wstrzykujemy, żeby testy były deterministyczne.
 */

const MIESIACE_PL = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

/** Klucz dnia „YYYY-MM-DD" w czasie LOKALNYM z daty. */
function kluczDnia(data) {
  const r = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${r}-${m}-${d}`;
}

/** Etykieta nagłówka sekcji: Dziś / Wczoraj / „29 lipca" / „29 lipca 2025". */
export function etykietaDnia(dataDnia, teraz) {
  const kd = kluczDnia(dataDnia);
  const dzis = kluczDnia(teraz);
  const wczorajData = new Date(teraz.getFullYear(), teraz.getMonth(), teraz.getDate() - 1);
  if (kd === dzis) return 'Dziś';
  if (kd === kluczDnia(wczorajData)) return 'Wczoraj';
  const dzien = dataDnia.getDate();
  const miesiac = MIESIACE_PL[dataDnia.getMonth()];
  return dataDnia.getFullYear() === teraz.getFullYear()
    ? `${dzien} ${miesiac}`
    : `${dzien} ${miesiac} ${dataDnia.getFullYear()}`;
}

/** Czy dopasowanie jest „nowe" — dodane po ostatniej wizycie. */
export function czyNowe(match, ostatniaWizytaMs) {
  if (!ostatniaWizytaMs) return false; // pierwszy raz — nic nie oznaczamy jako nowe
  const t = Date.parse(match?.created_at ?? '');
  return Number.isFinite(t) && t > ostatniaWizytaMs;
}

/** Ile dopasowań jest nowych od ostatniej wizyty. */
export function policzNowe(matches, ostatniaWizytaMs) {
  if (!Array.isArray(matches) || !ostatniaWizytaMs) return 0;
  return matches.reduce((n, m) => (czyNowe(m, ostatniaWizytaMs) ? n + 1 : n), 0);
}

/**
 * Grupuje dopasowania w sekcje po dniu dodania, sekcje od NAJNOWSZEGO dnia.
 * KOLEJNOŚĆ w obrębie dnia jest ZACHOWANA z wejścia — dzięki temu współgra z
 * wybranym sortowaniem/filtrami feedu (pipeline sortuje, my tylko grupujemy).
 * Rekordy bez daty trafiają do sekcji „Wcześniej" na końcu.
 *
 * @param {Array} matches lista dopasowań (już po filtrach/sorcie)
 * @param {number} terazMs bieżący czas (ms) — do etykiet Dziś/Wczoraj
 * @param {number} [ostatniaWizytaMs] do policzenia `nowe` w sekcji
 * @returns {Array<{klucz:string, tytul:string, dzienMs:number, nowe:number, data:Array}>}
 */
export function grupujPoDniach(matches, terazMs, ostatniaWizytaMs = 0) {
  const teraz = new Date(terazMs);
  const sekcje = new Map(); // klucz dnia → sekcja
  let bezDaty = null;

  for (const m of Array.isArray(matches) ? matches : []) {
    const t = Date.parse(m?.created_at ?? '');
    if (!Number.isFinite(t)) {
      if (!bezDaty) bezDaty = { klucz: 'brak', tytul: 'Wcześniej', dzienMs: -1, nowe: 0, data: [] };
      bezDaty.data.push(m);
      continue;
    }
    const data = new Date(t);
    const kd = kluczDnia(data);
    if (!sekcje.has(kd)) {
      // Północ lokalna tego dnia — stabilny klucz sortowania sekcji.
      const polnoc = new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();
      sekcje.set(kd, { klucz: kd, tytul: etykietaDnia(data, teraz), dzienMs: polnoc, nowe: 0, data: [] });
    }
    const sek = sekcje.get(kd);
    sek.data.push(m);
    if (czyNowe(m, ostatniaWizytaMs)) sek.nowe += 1;
  }

  const wynik = [...sekcje.values()].sort((a, b) => b.dzienMs - a.dzienMs);
  if (bezDaty) wynik.push(bezDaty);
  return wynik;
}
