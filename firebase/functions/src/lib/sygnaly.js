/*
 * Sygnały klienta (spec §5.1): zapis, odrzucenie z przyczyną, przywrócenie z listy
 * odrzuconych. Trzymane jako tablica na dokumencie użytkownika (≤50) — przebieg i tak
 * czyta ten dokument, więc uczenie nie dokłada odczytów z bazy.
 */
export const MAKS_SYGNALOW = 50;
export const MAKS_PRZYKLADOW = 5;
const DOBA_MS = 86_400_000;

export function zbudujSygnal({ typ, tenderId, tytul, wojewodztwo = null, wartosc = null, termin = null,
  przyczyna = null, komentarz = null, teraz }) {
  const t = Date.parse(termin ?? '');
  return {
    typ,
    tender_id: String(tenderId),
    tytul: String(tytul ?? '').slice(0, 300),
    przyczyna: przyczyna ?? null,
    komentarz: komentarz ? String(komentarz).slice(0, 140) : null,
    wojewodztwo: wojewodztwo ?? null,
    wartosc: typeof wartosc === 'number' && Number.isFinite(wartosc) ? wartosc : null,
    dni_do_terminu: Number.isFinite(t) ? Math.max(0, Math.floor((t - Date.parse(teraz)) / DOBA_MS)) : null,
    o: teraz,
  };
}

export function dodajSygnal(lista, sygnal) {
  const reszta = (Array.isArray(lista) ? lista : [])
    .filter((s) => !(s.tender_id === sygnal.tender_id && s.typ === sygnal.typ));
  return [sygnal, ...reszta].slice(0, MAKS_SYGNALOW);
}

export function przykladyDlaAi(lista) {
  const l = Array.isArray(lista) ? lista : [];
  return {
    zapisane: l.filter((s) => s.typ === 'zapis' || s.typ === 'przywrocenie').slice(0, MAKS_PRZYKLADOW).map((s) => s.tytul),
    odrzucone: l.filter((s) => s.typ === 'odrzucenie').slice(0, MAKS_PRZYKLADOW)
      .map((s) => ({ tytul: s.tytul, przyczyna: s.przyczyna ?? 'inne' })),
  };
}
