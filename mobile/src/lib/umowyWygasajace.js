/*
 * Radar wygasających umów (2026-10-31) — czysta prezentacja pozycji z
 * `GET /wygrywalnosc/umowy-wygasajace` (Functions `lib/umowyWygasajace.js`). Bez zegara: dni do
 * końca liczy serwer w chwili odczytu.
 */

/** Jak pilne: do 45 dni zamawiający zwykle już przygotowuje albo ogłasza przetarg. */
export function tonTerminu(dni) {
  if (!Number.isFinite(dni)) return 'neutralne';
  if (dni <= 45) return 'pilne';
  if (dni <= 120) return 'wkrotce';
  return 'neutralne';
}

/** „kończy się dziś”, „za 20 dni”, „za ok. 4 mies.” — krótko, do odznaki. */
export function opisTerminu(dni, t) {
  if (!Number.isFinite(dni) || dni < 0) return t('termin nieznany', 'unknown end');
  if (dni === 0) return t('kończy się dziś', 'ends today');
  if (dni === 1) return t('za 1 dzień', 'in 1 day');
  if (dni <= 60) return t(`za ${dni} dni`, `in ${dni} days`);
  const mies = Math.round(dni / 30.4);
  return t(`za ok. ${mies} mies.`, `in about ${mies} months`);
}

function dataPL(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Druga linia karty: region · wartość umowy · okres z ogłoszenia · od kiedy. */
export function opisUmowy(u, t, kwota) {
  return [
    u?.region_nazwa ?? null,
    u?.wartosc ? kwota(u.wartosc, t) : null,
    u?.okres ? t(`okres: ${u.okres}`, `term: ${u.okres}`) : null,
    dataPL(u?.data_umowy) ? t(`umowa z ${dataPL(u.data_umowy)}`, `signed ${dataPL(u.data_umowy)}`) : null,
  ].filter(Boolean).join(' · ');
}

export const dataKonca = (u) => dataPL(u?.koniec);
