/**
 * Kalkulator TERMINU PYTAŃ do SWZ (ulepszenie „Radar pytań i odpowiedzi do SWZ",
 * podzadanie 2/7).
 *
 * Czysta funkcja, bez I/O: z daty ogłoszenia i terminu składania ofert wyznacza
 * „koniec dnia, w którym upływa POŁOWA terminu składania ofert" — mało znany, ale
 * twardy próg, po którym zamawiający może zignorować pytania do treści SWZ — oraz
 * liczbę dni pozostałych do tej daty (dla odliczania w UI i alertów). Pobranie dat
 * z bazy i wysyłka alertów to osobne, „brudne" warstwy (repos / jobs).
 *
 * Świadome decyzje:
 *  • POŁOWĘ liczymy jako punkt środkowy okna w milisekundach:
 *    ogłoszenie + (termin − ogłoszenie) / 2. Dzięki temu honorujemy godzinę
 *    zegarową terminu (oferty bywają „do 10:00") i konsekwentnie obsługujemy okna
 *    o parzystej (połowa o północy) i nieparzystej (połowa w południe) liczbie dni;
 *  • „koniec dnia, w którym upływa połowa" = 23:59:59.999 dnia KALENDARZOWEGO, na
 *    który przypada punkt połowy — bo pytanie złożone o dowolnej porze tego dnia
 *    jest jeszcze na czas. Dzień liczymy w UTC, spójnie z tym, jak baza trzyma daty
 *    (ISO 8601, sufiks Z); dopracowanie do czasu lokalnego PL to sprawa późniejszej
 *    warstwy prezentacji;
 *  • sam `terminPytan` jest w PEŁNI deterministyczny (zależy tylko od dwóch dat);
 *    tylko `dniPozostalo` i `minelo` zależą od chwili odniesienia `teraz`
 *    (parametr — domyślnie „teraz", ale testy podają go jawnie, więc funkcja
 *    pozostaje testowalna);
 *  • `dniPozostalo` = różnica PEŁNYCH dni kalendarzowych między dniem `teraz`
 *    a dniem terminu pytań: w dniu granicznym daje 0 (jeszcze można), nazajutrz −1
 *    (już po). Granica jest inkluzywna — do 23:59:59.999 `minelo` jest false;
 *  • przy każdej niejednoznaczności (brak/niepoprawna data, termin nie późniejszy
 *    niż ogłoszenie) NIE zgadujemy — zwracamy `terminPytan: null` z czytelnym
 *    powodem, żeby UI nie pokazało wymyślonej daty.
 */

const DZIEN_MS = 24 * 60 * 60 * 1000;

/**
 * Zamienia wejście na milisekundy epoki. Przyjmuje `Date` albo string ISO 8601.
 * @returns {number|null} ms albo null, gdy wartość jest pusta/niepoprawna
 */
function naMs(v) {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** Milisekundy północy (00:00:00.000 UTC) dnia, w którym leży `ms`. */
function poczatekDniaUTC(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Milisekundy końca dnia (23:59:59.999 UTC) dnia, w którym leży `ms`. */
function koniecDniaUTC(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
}

/** Data w formacie YYYY-MM-DD (UTC) — do zwięzłego opisu „po ludzku". */
function dataPL(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Liczy termin składania pytań do SWZ i ile dni na nie zostało.
 * @param {object} [arg]
 * @param {string|Date} [arg.dataOgloszenia] data ogłoszenia (początek okna)
 * @param {string|Date} [arg.terminSkladaniaOfert] termin składania ofert (koniec okna)
 * @param {string|Date} [arg.teraz] chwila odniesienia dla `dniPozostalo`/`minelo`
 *   (domyślnie „teraz"); testy podają jawnie, by wynik był deterministyczny
 * @returns {{terminPytan: string|null, polowaTerminu: string|null,
 *   dniPozostalo: number|null, minelo: boolean, powod: string}}
 *   `terminPytan` — ISO 8601 końca dnia połowy (null przy braku/niepoprawnych danych);
 *   `polowaTerminu` — ISO 8601 dokładnego punktu połowy okna; `dniPozostalo` — pełne
 *   dni kalendarzowe od `teraz` do dnia terminu (ujemne, gdy po terminie); `minelo` —
 *   czy termin już minął; `powod` — krótkie zdanie do UI/alertu.
 */
export function terminPytanSwz({ dataOgloszenia, terminSkladaniaOfert, teraz } = {}) {
  const brak = (powod) => ({
    terminPytan: null, polowaTerminu: null, dniPozostalo: null, minelo: false, powod,
  });

  const ogloszenieMs = naMs(dataOgloszenia);
  const terminMs = naMs(terminSkladaniaOfert);
  if (ogloszenieMs === null || terminMs === null) {
    return brak('Brak kompletnych dat (ogłoszenie / termin składania ofert) — nie można policzyć terminu pytań.');
  }
  if (terminMs <= ogloszenieMs) {
    return brak('Termin składania ofert nie jest późniejszy niż data ogłoszenia — nie można policzyć połowy terminu.');
  }

  const polowaMs = ogloszenieMs + (terminMs - ogloszenieMs) / 2;
  const terminPytanMs = koniecDniaUTC(polowaMs);

  const terazMs = naMs(teraz) ?? Date.now();
  const dniPozostalo = Math.round((poczatekDniaUTC(terminPytanMs) - poczatekDniaUTC(terazMs)) / DZIEN_MS);
  const minelo = terazMs > terminPytanMs;

  const data = dataPL(terminPytanMs);
  const powod = minelo
    ? `Termin na pytania do SWZ minął — upływał z końcem dnia ${data}.`
    : `Pytania do SWZ można składać do końca dnia ${data} — pozostało dni: ${dniPozostalo}.`;

  return {
    terminPytan: new Date(terminPytanMs).toISOString(),
    polowaTerminu: new Date(polowaMs).toISOString(),
    dniPozostalo,
    minelo,
    powod,
  };
}
