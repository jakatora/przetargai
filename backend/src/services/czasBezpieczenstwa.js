/**
 * LICZNIK CZASU BEZPIECZEŃSTWA składania oferty (ulepszenie „Czarna skrzynka
 * składania oferty — dowody na awarię platformy", podzadanie 6/7).
 *
 * Aplikacja standardowo namawia na złożenie oferty 24 h PRZED terminem i pokazuje,
 * ile „czasu bezpieczeństwa" zostało — bo po upływie terminu składania czynności nie
 * da się powtórzyć, a platforma potrafi zawieść w ostatniej godzinie. Ten moduł liczy:
 *   • `czasDoTerminu(termin, teraz)` — ile czasu (ze znakiem) zostało do samego terminu
 *     składania + rozbicie na dni/godz/min/s do wyświetlenia,
 *   • `marginesBezpieczenstwa(termin, teraz)` — ZAPAS do rekomendowanego złożenia
 *     (termin − 24 h) i status: bezpiecznie / ostrzeżenie / krytycznie / po_terminie,
 *     wprost do zwrotu przez router „ile czasu bezpieczeństwa zostało".
 *
 * Świadome decyzje (spójnie z `services/pismoOPrzedluzenie.js`):
 *  • CZYSTA logika: bez UI, bez I/O, bez sieci, bez DB. `teraz` jest WSTRZYKIWANE —
 *    funkcje są deterministyczne; domyślnie (gdy router nie poda) czyta zegar systemowy,
 *    tak jak `zegar` w `czarnaSkrzynka.js`.
 *  • STREFA CZASOWA: porównujemy ABSOLUTNE momenty (instanty). ISO 8601 z offsetem
 *    (`Z`/`+02:00`), `Date` i epoch ms są jednoznaczne — offset jest honorowany. String
 *    BEZ offsetu jest wieloznaczny (zależny od strefy hosta), więc go ODRZUCAMY, zamiast
 *    po cichu zgadywać — licznik terminu nie może się mylić o 1–2 h.
 *  • Wynik jest ZAMROŻONY — migawka na moment odczytu.
 *
 * Moduł samowystarczalny (zero importów) — świadomie nie dopina się do współdzielonych
 * plików, które w drzewie roboczym mają cudzy WIP.
 */

const H = 3600 * 1000;
const MIN = 60 * 1000;
const DZIEN = 24 * H;

/** Rekomendacja: złóż ofertę tyle godzin PRZED terminem składania. */
export const REKOMENDACJA_GODZIN = 24;

/** Poniżej tylu godzin do terminu sytuacja jest KRYTYCZNA („kilka godzin"). */
export const PROG_KRYTYCZNY_GODZIN = 3;

/** Polskie etykiety statusów marginesu (kod maszynowy → napis do UI). */
const ETYKIETY_STATUSU = {
  bezpiecznie: 'Bezpiecznie',
  ostrzezenie: 'Ostrzeżenie',
  krytycznie: 'Krytycznie',
  po_terminie: 'Po terminie',
};

// ─────────────────────────── Parsowanie momentu (instant) ───────────────────

/** ISO 8601 z jednoznaczną strefą: kończy się na `Z` albo `±HH:MM` / `±HHMM`. */
function maStrefe(s) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(s.trim());
}

/**
 * Zamienia wejście na absolutny moment (ms epoch). Akceptuje `Date`, epoch ms oraz
 * ISO 8601 Z OFFSETEM. Odrzuca wartości wieloznaczne/niepoprawne, żeby licznik terminu
 * nie pomylił się o strefę.
 * @param {string|number|Date} v
 * @param {string} etykieta nazwa pola do komunikatu błędu (np. 'termin', 'teraz')
 * @returns {number} epoch ms
 */
function naMoment(v, etykieta) {
  if (v instanceof Date) {
    const t = v.getTime();
    if (Number.isNaN(t)) throw new TypeError(`Niepoprawna data (${etykieta}): nieprawidłowy obiekt Date`);
    return t;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`Niepoprawna data (${etykieta}): epoch ms musi być liczbą skończoną`);
    return v;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    if (!maStrefe(v)) {
      throw new TypeError(
        `Niepoprawna data (${etykieta}): podaj ISO 8601 ze strefą (Z lub ±HH:MM), np. 2026-07-27T12:00:00+02:00`,
      );
    }
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw new TypeError(`Niepoprawna data (${etykieta}): nie udało się sparsować „${v}"`);
    return t;
  }
  throw new TypeError(`Niepoprawna data (${etykieta}): oczekiwano ISO 8601 ze strefą, epoch ms albo Date`);
}

/** Domyślne „teraz" — zegar systemowy jako moment (używane tylko gdy router nie poda). */
function terazDomyslne() {
  return new Date().getTime();
}

// ─────────────────────────── czasDoTerminu ──────────────────────────────────

/**
 * Ile czasu zostało do terminu składania ofert. Znak dodatni = przed terminem,
 * ujemny = po terminie. Rozbicie `skladowe` pokazuje WARTOŚĆ BEZWZGLĘDNĄ (do wyświetlenia
 * „za 1 dz 2 godz" albo „minęło 5 min temu").
 * @param {string|number|Date} termin termin składania (ISO ze strefą / epoch ms / Date).
 * @param {string|number|Date} [teraz] moment odniesienia; domyślnie zegar systemowy.
 * @returns {{ms:number, poTerminie:boolean, skladowe:{dni:number,godziny:number,minuty:number,sekundy:number},
 *            dniRazem:number, godzinyRazem:number, minutyRazem:number}} obiekt ZAMROŻONY.
 * @throws {TypeError} gdy któraś data jest wieloznaczna lub niepoprawna.
 */
export function czasDoTerminu(termin, teraz = terazDomyslne()) {
  const terminMs = naMoment(termin, 'termin');
  const terazMs = naMoment(teraz, 'teraz');
  const ms = terminMs - terazMs;

  const abs = Math.abs(ms);
  const skladowe = Object.freeze({
    dni: Math.floor(abs / DZIEN),
    godziny: Math.floor((abs % DZIEN) / H),
    minuty: Math.floor((abs % H) / MIN),
    sekundy: Math.floor((abs % MIN) / 1000),
  });

  return Object.freeze({
    ms,
    poTerminie: ms <= 0, // dokładnie w terminie => okno zamknięte
    skladowe,
    dniRazem: ms / DZIEN,
    godzinyRazem: ms / H,
    minutyRazem: ms / MIN,
  });
}

// ─────────────────────────── marginesBezpieczenstwa ─────────────────────────

/** Kod statusu marginesu na podstawie ms do terminu i progów. */
function statusZMs(ms) {
  if (ms <= 0) return 'po_terminie';
  if (ms < PROG_KRYTYCZNY_GODZIN * H) return 'krytycznie';
  if (ms < REKOMENDACJA_GODZIN * H) return 'ostrzezenie';
  return 'bezpiecznie';
}

/** Ludzki komunikat do UI dla danego statusu i pozostałego zapasu. */
function komunikatStatusu(status, czas) {
  const s = czas.skladowe;
  switch (status) {
    case 'po_terminie':
      return `Termin składania minął ${s.dni ? `${s.dni} dz ` : ''}${s.godziny} godz ${s.minuty} min temu — czynności nie da się już powtórzyć.`;
    case 'krytycznie':
      return `Zostało tylko ${s.godziny} godz ${s.minuty} min do terminu. Złóż ofertę TERAZ — nie zostawiaj tego na ostatnią chwilę.`;
    case 'ostrzezenie':
      return `Rekomendowany moment złożenia (24 h przed terminem) już minął. Zostało ${s.dni ? `${s.dni} dz ` : ''}${s.godziny} godz ${s.minuty} min — złóż ofertę bez zwłoki.`;
    default:
      return `Masz jeszcze bezpieczny zapas czasu. Zaplanuj złożenie oferty najpóźniej 24 h przed terminem.`;
  }
}

/**
 * Margines bezpieczeństwa: ile czasu zostało do REKOMENDOWANEGO złożenia (termin − 24 h)
 * oraz status całości. To wynik, który router zwraca jako „ile czasu bezpieczeństwa
 * zostało". Rekomendacja 24 h przed terminem chroni przed awarią platformy w ostatniej
 * godzinie — po terminie odwołania do KIO nie uratują możliwości złożenia oferty.
 * @param {string|number|Date} termin termin składania (ISO ze strefą / epoch ms / Date).
 * @param {string|number|Date} [teraz] moment odniesienia; domyślnie zegar systemowy.
 * @param {{rekomendacjaGodzin?:number}} [opts] pozwala nadpisać rekomendację (domyślnie 24 h).
 * @returns {object} ZAMROŻONY: status, etykieta, poTerminie, rekomendacjaGodzin,
 *   terminRekomendowany (ISO), zapasDoRekomendacjiMs (ze znakiem), czas (czasDoTerminu),
 *   komunikat.
 * @throws {TypeError} gdy `termin`/`teraz` są wieloznaczne lub niepoprawne.
 */
export function marginesBezpieczenstwa(termin, teraz = terazDomyslne(), opts = {}) {
  const rekomendacjaGodzin = Number.isFinite(opts.rekomendacjaGodzin) && opts.rekomendacjaGodzin > 0
    ? opts.rekomendacjaGodzin
    : REKOMENDACJA_GODZIN;

  const terminMs = naMoment(termin, 'termin');
  const terazMs = naMoment(teraz, 'teraz');
  const czas = czasDoTerminu(terminMs, terazMs);

  const terminRekomendowanyMs = terminMs - rekomendacjaGodzin * H;
  const zapasDoRekomendacjiMs = terminRekomendowanyMs - terazMs;
  const status = statusZMs(czas.ms);

  return Object.freeze({
    status,
    etykieta: ETYKIETY_STATUSU[status],
    poTerminie: czas.poTerminie,
    rekomendacjaGodzin,
    terminRekomendowany: new Date(terminRekomendowanyMs).toISOString(),
    zapasDoRekomendacjiMs,
    czas,
    komunikat: komunikatStatusu(status, czas),
  });
}
