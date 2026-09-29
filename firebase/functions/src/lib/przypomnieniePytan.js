/*
 * PRZYPOMNIENIE O TERMINIE PYTAŃ DO SWZ (funkcja A, 2026-09-29) — czysta logika.
 *
 * Termin pytań przepada najczęściej, bo wypada kilka dni PRZED składaniem ofert,
 * a wykonawca pilnuje tylko tamtej daty. Tutaj NIE liczymy go od nowa: bierzemy
 * pozycję „pytania" z lib/kalendarzPrzetargu.js — tę samą regułę, którą pokazuje
 * kalendarz terminów (BZP: art. 284 ust. 2, TED: art. 135 ust. 2 Pzp). Rejestr bez
 * reguły ustawowej (Baza Konkurencyjności) albo brak terminu składania = brak
 * terminu pytań, więc i brak przypomnienia — niczego nie zmyślamy.
 *
 * Zero I/O, zero `Date.now()` — „teraz" jest argumentem.
 */
import { zbudujKalendarz } from './kalendarzPrzetargu.js';

/** Przypominamy w ostatniej dobie przed terminem pytań. */
export const OKNO_PRZYPOMNIENIA_PYTAN_MS = 24 * 60 * 60_000;

/** Typ pushu — aplikacja kieruje go do kalendarza terminów (lib/nawigacjaPush.js). */
export const TYP_PUSH_PYTANIA = 'swz_questions_reminder';

/**
 * Pozycja „pytania" z kalendarza przetargu albo null, gdy terminu nie da się ustalić.
 * @param {{id: string, source?: string, deadline?: string|null, anulowany?: boolean}} tender
 * @param {string} teraz ISO
 */
export function terminPytan(tender, teraz) {
  const kalendarz = zbudujKalendarz(tender, { teraz });
  if (kalendarz.anulowany) return null;
  const pozycja = kalendarz.pozycje.find((p) => p.kod === 'pytania');
  return pozycja?.znany ? pozycja : null;
}

/** Czy teraz jest ostatnia doba przed terminem pytań (termin jeszcze nie minął). */
export function wOknie(pozycja, teraz) {
  if (!pozycja?.znany || pozycja.minal) return false;
  const doTerminu = Date.parse(pozycja.at) - Date.parse(teraz);
  return doTerminu > 0 && doTerminu <= OKNO_PRZYPOMNIENIA_PYTAN_MS;
}

/**
 * Treść pushu. Godzina w czasie warszawskim (`lokalnie` z kalendarza) — pokazanie UTC
 * przesunęłoby ją o 1–2 h. Opis skutku jest ten sam co w kalendarzu terminów.
 */
export function trescPrzypomnieniaPytan({ tenderId, tytul, pozycja }) {
  const podstawa = pozycja.podstawa?.pl ? ` (${pozycja.podstawa.pl})` : '';
  return {
    title: 'Ostatnia doba na pytania do SWZ',
    body: `${tytul || 'Zapisany przetarg'}: wniosek o wyjaśnienie treści SWZ złóż najpóźniej `
      + `${pozycja.lokalnie.etykieta}${podstawa} — później nie masz gwarancji odpowiedzi zamawiającego.`,
    data: { type: TYP_PUSH_PYTANIA, tender_id: String(tenderId), termin: pozycja.at },
  };
}
