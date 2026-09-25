/**
 * Kalkulator TERMINU PYTAŃ do SWZ (ulepszenie „Radar pytań i odpowiedzi do SWZ",
 * podzadanie 2/7; przepisany 2026-09-25).
 *
 * BŁĄD PRAWNY, KTÓRY NAPRAWIAMY: do 2026-09-25 liczyliśmy „koniec dnia, w którym upływa
 * POŁOWA terminu składania ofert" — to reguła UCHYLONEGO art. 38 ust. 1 Pzp z 2004 r.
 * Obowiązująca ustawa Pzp (2019) wiąże obowiązek odpowiedzi z terminem liczonym WSTECZ
 * od terminu składania ofert:
 *  • art. 135 ust. 2 pkt 1 (tryby „unijne") — zamawiający odpowiada najpóźniej na 6 dni
 *    przed terminem składania ofert, o ile wniosek wpłynął nie później niż na 14 dni przed;
 *  • art. 135 ust. 2 pkt 2 (skrócony termin z art. 138 ust. 2 pkt 2) — 4 dni / 7 dni;
 *  • art. 284 ust. 2 (tryb podstawowy) — 2 dni / 4 dni.
 * Wniosek złożony później zamawiający może zostawić bez rozpoznania (art. 135 ust. 6,
 * art. 284 ust. 5) — dlatego „termin pytań" to termin na wniosek, na który MUSI odpowiedzieć.
 *
 * Świadome decyzje:
 *  • liczenie wstecz wg UZP („Nowe Pzp w pytaniach i odpowiedziach"): oferty 1 lipca =>
 *    wniosek do 17 czerwca włącznie (14 dni wstecz, bez dnia składania ofert — ten sam
 *    dzień tygodnia). Termin upływa z KOŃCEM tego dnia (23:59:59.999);
 *  • dni kalendarzowe liczymy w CZASIE POLSKIM (Europe/Warsaw) — termin „1 lipca, 00:00"
 *    to w UTC 30 czerwca 22:00 i liczenie w UTC przesuwało wynik o dzień;
 *  • tryb nieznany (albo spoza listy) => NAJWCZEŚNIEJSZY bezpieczny termin (14 dni) z
 *    informacją, że w trybie podstawowym wystarczą 4 dni — lepiej zdążyć za wcześnie;
 *  • gdy dzień wniosku wypada w weekend, zostawiamy BEZPIECZNĄ (wcześniejszą) datę, a
 *    w `uwaga` informujemy, że wg UZP wniosek w najbliższy dzień roboczy też jest w
 *    terminie (świąt nie znamy — nie zgadujemy);
 *  • przedłużenie terminu składania ofert NIE przesuwa terminu na wniosek (art. 135
 *    ust. 4) — funkcja liczy od terminu, który dostaje; wołający powinien podać PIERWOTNY;
 *  • przy braku/niepoprawnych danych NIE zgadujemy — `terminPytan: null` z powodem;
 *  • kształt wyniku zgodny z wołającymi (routes/radarSwz.js, mobile `odliczaniePytan`):
 *    `polowaTerminu` zostaje jako `null` (reguła połowy nie obowiązuje).
 */

const DZIEN_MS = 24 * 60 * 60 * 1000;
const STREFA = 'Europe/Warsaw';

/** Reguły per tryb: ile dni przed terminem składania ofert (wniosek / odpowiedź). */
export const TRYBY_PYTAN_SWZ = Object.freeze({
  unijny: Object.freeze({ dniWniosek: 14, dniOdpowiedz: 6, podstawaPrawna: 'art. 135 ust. 2 pkt 1 Pzp' }),
  unijny_skrocony: Object.freeze({ dniWniosek: 7, dniOdpowiedz: 4, podstawaPrawna: 'art. 135 ust. 2 pkt 2 Pzp' }),
  podstawowy: Object.freeze({ dniWniosek: 4, dniOdpowiedz: 2, podstawaPrawna: 'art. 284 ust. 2 Pzp' }),
});

/** Zamienia wejście na milisekundy epoki. Przyjmuje `Date` albo string ISO 8601. */
function naMs(v) {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

const FORMAT_CZESCI = new Intl.DateTimeFormat('en-US', {
  timeZone: STREFA, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Składowe daty/czasu w czasie polskim. */
function czesciPL(ms) {
  const p = Object.fromEntries(FORMAT_CZESCI.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Przesunięcie czasu polskiego względem UTC (ms) w chwili `ms`. */
function przesunieciePL(ms) {
  const c = czesciPL(ms);
  const jakoUtc = Date.UTC(c.y, c.m - 1, c.d, c.h, c.min, c.s);
  return jakoUtc - Math.floor(ms / 1000) * 1000;
}

/** Dzień kalendarzowy (polski) jako liczba dni od epoki — do odejmowania i różnic. */
function dzienPL(ms) {
  const c = czesciPL(ms);
  return Math.round(Date.UTC(c.y, c.m - 1, c.d) / DZIEN_MS);
}

/** Koniec (23:59:59.999) polskiego dnia kalendarzowego `dzien` jako ms UTC. */
function koniecDniaPL(dzien) {
  const lokalnie = dzien * DZIEN_MS + DZIEN_MS - 1; // 23:59:59.999 „jakby UTC"
  return lokalnie - przesunieciePL(lokalnie - 3 * 60 * 60 * 1000);
}

/** Data 'YYYY-MM-DD' polskiego dnia kalendarzowego. */
function dataDnia(dzien) {
  return new Date(dzien * DZIEN_MS).toISOString().slice(0, 10);
}

/**
 * Liczy termin na wniosek o wyjaśnienie treści SWZ (na który zamawiający MUSI odpowiedzieć)
 * i ile dni na niego zostało.
 * @param {object} [arg]
 * @param {string|Date} [arg.terminSkladaniaOfert] (pierwotny) termin składania ofert
 * @param {string|Date} [arg.dataOgloszenia] opcjonalnie — tylko do kontroli spójności dat
 * @param {'unijny'|'unijny_skrocony'|'podstawowy'} [arg.tryb] tryb; brak/nieznany => bezpieczne 14 dni
 * @param {string|Date} [arg.teraz] chwila odniesienia dla `dniPozostalo`/`minelo` (domyślnie teraz)
 * @returns {{terminPytan: string|null, terminOdpowiedzi: string|null, polowaTerminu: null,
 *   dniPozostalo: number|null, minelo: boolean, powod: string,
 *   tryb: string|null, dniPrzedTerminem: number, podstawaPrawna: string, uwaga: string|null}}
 */
export function terminPytanSwz({ dataOgloszenia, terminSkladaniaOfert, teraz, tryb } = {}) {
  const trybZnany = Object.hasOwn(TRYBY_PYTAN_SWZ, tryb ?? '') ? tryb : null;
  const regula = TRYBY_PYTAN_SWZ[trybZnany ?? 'unijny'];
  const wspolne = {
    polowaTerminu: null,
    tryb: trybZnany,
    dniPrzedTerminem: regula.dniWniosek,
    podstawaPrawna: regula.podstawaPrawna,
  };
  const brak = (powod) => ({
    terminPytan: null, terminOdpowiedzi: null, dniPozostalo: null, minelo: false, powod, ...wspolne, uwaga: null,
  });

  const terminMs = naMs(terminSkladaniaOfert);
  if (terminMs === null) {
    return brak('Brak terminu składania ofert — nie można policzyć terminu na pytania do SWZ.');
  }
  const ogloszenieMs = naMs(dataOgloszenia);
  if (ogloszenieMs !== null && terminMs <= ogloszenieMs) {
    return brak('Termin składania ofert nie jest późniejszy niż data ogłoszenia — sprawdź daty postępowania.');
  }

  const dzienSkladania = dzienPL(terminMs);
  const dzienWniosku = dzienSkladania - regula.dniWniosek;
  const terminPytanMs = koniecDniaPL(dzienWniosku);
  const terminOdpowiedziMs = koniecDniaPL(dzienSkladania - regula.dniOdpowiedz);

  const terazMs = naMs(teraz) ?? Date.now();
  const dniPozostalo = dzienWniosku - dzienPL(terazMs);
  const minelo = terazMs > terminPytanMs;

  const uwagi = [];
  if (!trybZnany) {
    uwagi.push('Tryb postępowania nieznany — pokazujemy najwcześniejszy bezpieczny termin: 14 dni przed '
      + 'terminem składania ofert (art. 135 ust. 2 Pzp). W trybie podstawowym (art. 284 ust. 2 Pzp) '
      + 'wystarczy złożyć wniosek 4 dni przed terminem.');
  }
  const dzienTygodnia = new Date(dzienWniosku * DZIEN_MS).getUTCDay();
  if (dzienTygodnia === 0 || dzienTygodnia === 6) {
    uwagi.push('Ostatni dzień na wniosek wypada w weekend — wg UZP wniosek złożony w najbliższy dzień '
      + 'roboczy też jest w terminie, ale bezpieczniej złożyć go wcześniej.');
  }

  const data = dataDnia(dzienWniosku);
  const powod = minelo
    ? `Termin na wniosek o wyjaśnienie SWZ, na który zamawiający musi odpowiedzieć, minął z końcem dnia ${data} `
      + `(${regula.podstawaPrawna}). Pytanie można nadal zadać, ale zamawiający może je zostawić bez odpowiedzi.`
    : `Wniosek o wyjaśnienie SWZ złóż do końca dnia ${data} (${regula.dniWniosek} dni przed terminem składania ofert, `
      + `${regula.podstawaPrawna}) — pozostało dni: ${dniPozostalo}. Zamawiający musi odpowiedzieć najpóźniej `
      + `${regula.dniOdpowiedz} dni przed terminem składania ofert.`;

  return {
    terminPytan: new Date(terminPytanMs).toISOString(),
    terminOdpowiedzi: new Date(terminOdpowiedziMs).toISOString(),
    dniPozostalo,
    minelo,
    powod,
    ...wspolne,
    uwaga: uwagi.length ? uwagi.join(' ') : null,
  };
}
