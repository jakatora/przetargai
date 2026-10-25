/*
 * Czas polski dla raportu dnia, ciszy nocnej i harmonogramu (spec §4.1, §7).
 * Baza trzyma ISO w UTC; „dziś” i „noc” klienta liczą się w Europe/Warsaw.
 */
const STREFA = 'Europe/Warsaw';
const FORMAT_DOBY = new Intl.DateTimeFormat('en-CA', {
  timeZone: STREFA, year: 'numeric', month: '2-digit', day: '2-digit',
});
const FORMAT_GODZINY = new Intl.DateTimeFormat('en-GB', {
  timeZone: STREFA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export const CISZA_OD = 21;
export const CISZA_DO = 7;
/** Godziny przebiegów (czas polski) — muszą zgadzać się z `onSchedule` w index.js. */
export const PRZEBIEG_DZIENNY = Object.freeze(['12:00']);
export const PRZEBIEGI_STANDARD = Object.freeze([
  '02:10', '05:10', '08:10', '11:10', '12:00', '14:10', '17:10', '20:10', '23:10',
]);

const KROK_MS = 10 * 60_000;

/** 'RRRR-MM-DD' doby czasu polskiego. */
export function dobaWarszawska(iso) {
  return FORMAT_DOBY.format(new Date(iso));
}

export function godzinaMinutaWarszawska(iso) {
  const [h, m] = FORMAT_GODZINY.format(new Date(iso)).split(':').map(Number);
  return { h, m };
}

/** Między 21:00 a 7:00 czasu polskiego nie wysyłamy powiadomień. */
export function ciszaNocna(iso) {
  const { h } = godzinaMinutaWarszawska(iso);
  return h >= CISZA_OD || h < CISZA_DO;
}

/** Najbliższy przebieg ŚCIŚLE po `teraz` (wszystkie przebiegi są na pełnych 10 minutach). */
export function nastepnyPrzebieg(teraz, plan) {
  const godziny = new Set(plan === 'standard' ? PRZEBIEGI_STANDARD : PRZEBIEG_DZIENNY);
  const start = (Math.floor(Date.parse(teraz) / KROK_MS) + 1) * KROK_MS;
  for (let t = start; t <= start + 26 * 3_600_000; t += KROK_MS) {
    const { h, m } = godzinaMinutaWarszawska(new Date(t).toISOString());
    if (godziny.has(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)) {
      return new Date(t).toISOString();
    }
  }
  return null;
}

/** Chwila (UTC) polskiej północy rozpoczynającej dobę, w której jest `teraz`. */
export function poczatekDobyWarszawskiej(teraz) {
  const doba = dobaWarszawska(teraz);
  const polnocUtc = Date.parse(`${doba}T00:00:00.000Z`);
  for (const godzin of [1, 2]) {
    const kandydat = polnocUtc - godzin * 3_600_000;
    const tenSam = dobaWarszawska(new Date(kandydat).toISOString()) === doba;
    const poprzedni = dobaWarszawska(new Date(kandydat - 1).toISOString()) !== doba;
    if (tenSam && poprzedni) return new Date(kandydat).toISOString();
  }
  return new Date(polnocUtc - 3_600_000).toISOString();
}
