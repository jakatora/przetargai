/*
 * BRAMKA PRZEDWYSYŁKOWA OFERTY + mapowanie zmian SWZ na sekcje oferty (ulepszenie
 * „Radar pytań i odpowiedzi do SWZ", podzadanie 6/7).
 *
 * Zamawiający aż do terminu składania publikuje odpowiedzi i zmiany treści SWZ.
 * Zanim wykonawca wyśle ofertę, musi POTWIERDZIĆ, że każdą taką zmianę uwzględnił
 * (przeliczył harmonogram/cenę, poprawił parametry). Ten moduł to CZYSTA logika:
 *
 *   • `mapujNaSekcjeOferty` — z opisu skutku (a gdy go brak — z diffu) wnioskuje,
 *     których SEKCJI oferty dotyczy zmiana (harmonogram / cena / parametry),
 *     heurystyką słów kluczowych. Wynik zapisuje silnik różnic w `elementy_oferty`,
 *   • `zbudujCheckliste` — z listy wpisów `zmiany_swz` składa checklistę: pozycje do
 *     odznaczenia + status każdej sekcji („wymaga aktualizacji", gdy jest ≥1
 *     nieuwzględniona zmiana jej dotycząca) + sygnał gotowości do wysyłki,
 *   • `ocenBramke` — decyzja bramki przy wysyłce: dopuść (wszystko uwzględnione),
 *     zablokuj (są nieodznaczone pozycje) albo — na wyraźne `wymus` — przepuść
 *     z ostrzeżeniem.
 *
 * Bez DB i bez AI — sama reguła. Persystencję (kolumna `uwzglednione`, odczyt zmian)
 * dokłada warstwa repos, a wywołanie — router radaru SWZ.
 */

/** Kanoniczne sekcje przygotowanej oferty, na które mapujemy zmiany SWZ. */
export const SEKCJE_OFERTY = Object.freeze(['harmonogram', 'cena', 'parametry']);

/*
 * Heurystyka słów kluczowych: skutek zmiany → sekcja oferty. Świadomie inkluzywna
 * (lepiej oflagować sekcję do przejrzenia niż przegapić przeliczenie). Wzorce bez
 * `\b` wokół polskich znaków — `\b` w JS jest ASCII-owe i gubiłoby „ę/ł/ó".
 */
const WZORCE_SEKCJI = Object.freeze([
  ['harmonogram', /termin|harmonogram|realizacj|etap[^r]|kamie[nń]|okres|dni\b|tygodn|miesi[aąeę]c|czas\b|wykonani/i],
  ['cena', /cen[aąeęoy]|warto[śs][ćc]|wynagrodz|koszt|p[łl]atno|waloryzac|stawk|zaliczk|bud[żz]et|kwot|op[łl]at|rat[ay]\b/i],
  ['parametry', /parametr|wym[oó]g|wymog|wymagan|specyfikac|materia[łl]|norm[aęy]|r[óo]wnowa[żz]|techniczn|przedmiar|klas[aęy]|wymiar|jako[śs][ćc]/i],
]);

/**
 * Wnioskuje sekcje oferty, których dotyczy zmiana SWZ. Analizuje przede wszystkim
 * `opisSkutku` (zwięzłe zdanie o skutku), a gdy go brak — surowy `diff`. Zwraca
 * podzbiór `SEKCJE_OFERTY` w ich stałej kolejności, każdą sekcję raz.
 *
 * @param {{opisSkutku?: string, diff?: string}} wejscie
 * @returns {string[]}
 */
export function mapujNaSekcjeOferty({ opisSkutku = '', diff = '' } = {}) {
  const tekst = String(opisSkutku ?? '').trim() || String(diff ?? '').trim();
  if (!tekst) return [];
  return SEKCJE_OFERTY.filter((sekcja) => {
    const wzorzec = WZORCE_SEKCJI.find(([nazwa]) => nazwa === sekcja)[1];
    return wzorzec.test(tekst);
  });
}

/** Znormalizowane elementy oferty wpisu zmiany: zapisane, a w razie braku — wywnioskowane. */
function elementyZmiany(zmiana) {
  const zapisane = Array.isArray(zmiana?.elementy_oferty) ? zmiana.elementy_oferty : [];
  if (zapisane.length) return zapisane;
  return mapujNaSekcjeOferty({ opisSkutku: zmiana?.opis_skutku, diff: zmiana?.diff });
}

/**
 * Buduje checklistę przedwysyłkową z listy wpisów `zmiany_swz`. Każda opublikowana
 * zmiana/odpowiedź to pozycja do odznaczenia; sekcja oferty „wymaga aktualizacji",
 * dopóki jest ≥1 nieuwzględniona zmiana jej dotycząca.
 *
 * Brak zmian => checklista pusta i GOTOWA — nie ma czego uwzględniać (odmiennie od
 * pre-flightu podpisu/kompletności, gdzie pusto = brak weryfikacji = brak zgody).
 *
 * @param {Array<{id: string, data_publikacji?: string, opis_skutku?: string,
 *   diff?: string, elementy_oferty?: string[], uwzglednione?: boolean|number}>} zmiany
 * @returns {{pozycje: object[], sekcje: Array<{sekcja: string, wymaga_aktualizacji: boolean}>,
 *   do_odznaczenia: number, wszystkie_uwzglednione: boolean, gotowa_do_wyslania: boolean}}
 */
export function zbudujCheckliste(zmiany = []) {
  const lista = Array.isArray(zmiany) ? zmiany : [];

  const pozycje = lista.map((z) => {
    const uwzglednione = Boolean(z?.uwzglednione);
    return {
      id: z?.id ?? null,
      data_publikacji: z?.data_publikacji ?? null,
      opis_skutku: z?.opis_skutku ?? null,
      elementy_oferty: elementyZmiany(z),
      uwzglednione,
      wymaga_aktualizacji: !uwzglednione,
    };
  });

  // Sekcja wymaga aktualizacji, gdy dotyczy jej ≥1 NIEuwzględniona zmiana.
  const sekcjeZywe = new Set();
  for (const p of pozycje) {
    if (p.uwzglednione) continue;
    for (const s of p.elementy_oferty) sekcjeZywe.add(s);
  }
  // Kanoniczne trzy zawsze raportujemy; ewentualne nietypowe sekcje dopisujemy na końcu.
  const wszystkieSekcje = [...SEKCJE_OFERTY];
  for (const s of sekcjeZywe) if (!wszystkieSekcje.includes(s)) wszystkieSekcje.push(s);
  const sekcje = wszystkieSekcje.map((sekcja) => ({
    sekcja,
    wymaga_aktualizacji: sekcjeZywe.has(sekcja),
  }));

  const doOdznaczenia = pozycje.filter((p) => !p.uwzglednione).length;
  const wszystkieUwzglednione = doOdznaczenia === 0;

  return {
    pozycje,
    sekcje,
    do_odznaczenia: doOdznaczenia,
    wszystkie_uwzglednione: wszystkieUwzglednione,
    gotowa_do_wyslania: wszystkieUwzglednione,
  };
}

/**
 * Decyzja bramki przy wysyłce oferty na podstawie checklisty:
 *   • gotowa            → { dopuszczona: true,  poziom: 'ok' },
 *   • nieodznaczone     → { dopuszczona: false, poziom: 'blokada' } (domyślnie blokuje),
 *   • nieodznaczone + wymus → { dopuszczona: true, poziom: 'ostrzezenie' } (przepuść mimo).
 *
 * @param {{gotowa_do_wyslania: boolean, do_odznaczenia: number}} checklista
 * @param {{wymus?: boolean}} [opcje]
 * @returns {{dopuszczona: boolean, poziom: 'ok'|'blokada'|'ostrzezenie', komunikat: string, do_odznaczenia: number}}
 */
export function ocenBramke(checklista, { wymus = false } = {}) {
  const doOdznaczenia = checklista?.do_odznaczenia ?? 0;
  if (checklista?.gotowa_do_wyslania) {
    return {
      dopuszczona: true,
      poziom: 'ok',
      komunikat: 'Wszystkie opublikowane odpowiedzi i zmiany SWZ zostały uwzględnione.',
      do_odznaczenia: 0,
    };
  }
  if (wymus) {
    return {
      dopuszczona: true,
      poziom: 'ostrzezenie',
      komunikat: `Wysyłasz ofertę mimo ${doOdznaczenia} nieuwzględnionych zmian/odpowiedzi SWZ.`,
      do_odznaczenia: doOdznaczenia,
    };
  }
  return {
    dopuszczona: false,
    poziom: 'blokada',
    komunikat: `Nie można wysłać: ${doOdznaczenia} nieuwzględnionych zmian/odpowiedzi SWZ. Odznacz je albo wyślij z wymuszeniem.`,
    do_odznaczenia: doOdznaczenia,
  };
}
