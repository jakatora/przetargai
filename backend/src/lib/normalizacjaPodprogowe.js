/**
 * NORMALIZACJA ogłoszeń podprogowych (ulepszenie „Radar zamówień podprogowych —
 * poniżej 170 tys. zł", podzadanie 2/7).
 *
 * Czysta funkcja, bez I/O: bierze SUROWE ogłoszenie z dowolnego źródła (Baza
 * Konkurencyjności, platformazakupowa.pl, eZamawiający, e-propublico, BIP,
 * postępowania wyłączone z Pzp) + konfigurację progu i preferencji użytkownika, a
 * zwraca:
 *   • `rekord`        — znormalizowany wpis w kształcie kolumn tabeli
 *     `zamowienia_podprogowe` (migracja 009) z policzonym `hash_dedup`, obiektem
 *     `flagi` i booleanowym `latwiejszy_start`;
 *   • `dopasowanie`   — czy ogłoszenie pasuje do branży/regionu z preferencji;
 *   • `kwalifikujeSie`— czy przechodzi regułę progu dla swojego źródła;
 *   • `powod`         — krótkie zdanie „po ludzku" (dlaczego (nie) kwalifikuje).
 *
 * Pobranie ogłoszeń (adaptery), zapis/upsert i naliczanie AI to osobne, „brudne"
 * warstwy (kolejne podzadania). Tu — tylko deterministyczna transformacja.
 *
 * Świadome decyzje:
 *  • PRÓG: domyślnie ogłoszenie kwalifikuje się, gdy `wartosc_netto < prog_netto`
 *    (domyślnie 170 000 zł netto — stan od 1.01.2026). Granica jest WYŁĄCZAJĄCA:
 *    dokładnie 170 000 to już zamówienie „nadprogowe" (pełna procedura Pzp).
 *  • BAZA KONKURENCYJNOŚCI: dochodzi DOLNA granica — zasada konkurencyjności
 *    obowiązuje „od 80 000 zł" (włączająco). Poniżej 80k ogłoszenie jest poza
 *    zakresem tego feedu (rozeznanie rynku, nie konkurencyjność). Górny próg
 *    (170k) obowiązuje BK tak samo — radar dotyczy zamówień podprogowych.
 *  • `hash_dedup`: sha256 z kanonicznego klucza. Najpewniejszy jest
 *    (źródło + id_zewnetrzny); gdy brak id — (źródło + link); gdy brak i linku —
 *    (źródło + znormalizowana treść). Dzięki temu to samo ogłoszenie pobrane
 *    ponownie/z innego mirrora dedupuje się, a różne ogłoszenia się rozróżniają.
 *  • `latwiejszy_start` = bez_wadium ∧ bez_kio ∧ prosta_procedura. Flagi liczymy
 *    KONSERWATYWNIE z sygnałów w treści: domyślnie „łatwo" (podprogowe zwykle bez
 *    wadium/KIO i z prostą procedurą), ale twarde sygnały utrudnień (kwota wadium,
 *    wzmianka o KIO, tryb Pzp) opuszczają odpowiednią flagę.
 *  • Przy brakach/śmieciowych danych NIE rzucamy i NIE zgadujemy — pola idą jako
 *    `null`, a `kwalifikujeSie=false` z czytelnym `powod`, żeby monitor nie wpuścił
 *    ogłoszenia, którego nie umiemy ocenić.
 */

import { createHash } from 'node:crypto';

/** Źródła dozwolone przez CHECK w migracji 009 (spójność z bazą). */
const ZRODLA = new Set([
  'bzp_wylaczone', 'platformazakupowa', 'ezamawiajacy', 'epropublico',
  'baza_konkurencyjnosci', 'bip',
]);

const PROG_DOMYSLNY = 170000;          // górny próg podprogowy (netto, PLN)
const PROG_KONKURENCYJNOSCI = 80000;   // dolna granica zasady konkurencyjności (BK)

/** Pierwsza nie-pusta wartość spośród podanych kluczy obiektu. */
function pierwsza(obj, ...klucze) {
  for (const k of klucze) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/** Trim + zwinięcie białych znaków; null dla pustych. */
function tekst(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

/**
 * Normalizacja do porównań/dedupu: małe litery, bez diakrytyków (w tym „ł"),
 * zwinięte białe znaki. `Date.parse` nie dotykamy — to tylko tekst.
 */
function znorm(v) {
  if (v === undefined || v === null) return '';
  return String(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // zdejmij znaki łączące (diakrytyki)
    .replace(/ł/gi, 'l')                              // „ł" nie jest znakiem łączącym
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Parsowanie kwoty. Przyjmuje liczbę albo string w formacie PL („169 000,00 zł").
 * @returns {number|null}
 */
function parseKwota(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, ''); // zostaw cyfry i separatory
  if (s === '' || s === '-') return null;
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.'); // „169.000,00" → „169000.00"
  } else if (s.includes(',')) {
    s = s.replace(',', '.');                     // „169000,00" → „169000.00"
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Czy `igla` (preferencja) pasuje do treści; pusta igła = brak zawężenia.
 * Najpierw szuka dokładnego wystąpienia (fraza), a gdy go brak — dopasowuje po
 * RDZENIU słowa, żeby honorować polską fleksję („sprzątanie" ~ „sprzątania",
 * „mazowieckie" ~ „woj. mazowieckim"). Krótkie słowa (<4 znaki) wymagają
 * dokładnego dopasowania, by uniknąć fałszywych trafień.
 */
function pasujeDo(igla, ...zrodla) {
  const i = znorm(igla);
  if (i === '') return true; // użytkownik nie zawęził tego wymiaru
  const stogSiana = znorm(zrodla.filter((x) => x !== undefined && x !== null).join(' '));
  if (stogSiana === '') return false;
  if (stogSiana.includes(i)) return true; // dokładna fraza/wystąpienie

  const MIN = 4;
  const rdzen = (w) => w.slice(0, Math.max(MIN, w.length - 2));
  const slowaStogu = stogSiana.split(/[^a-z0-9]+/).filter(Boolean);
  const slowaIgly = i.split(/[^a-z0-9]+/).filter(Boolean);
  return slowaIgly.every((iw) => {
    if (iw.length < MIN) return slowaStogu.includes(iw);
    const rIgly = rdzen(iw);
    return slowaStogu.some((sw) =>
      sw.startsWith(rIgly) || (sw.length >= MIN && iw.startsWith(rdzen(sw))));
  });
}

/** Heurystyka: czy ogłoszenie jest „bez wadium". */
function bezWadium(wadiumPole, opis) {
  const kwota = parseKwota(wadiumPole);
  if (kwota !== null) return kwota <= 0;         // jawne pole wadium rozstrzyga
  const t = znorm(opis);
  if (!t.includes('wadium')) return true;        // nie wspomniano → domyślnie brak
  // Wzmianka o wadium z jawną negacją → brak wadium…
  if (/(bez|brak)\s+wadium|nie\s+\w+\s+wadium|wadium\s+nie\b/.test(t)) return true;
  return false;                                  // …w innym razie wadium jest wymagane
}

/** Heurystyka: brak drogi odwoławczej do KIO (typowe dla podprogowych). */
function bezKio(opis) {
  const t = znorm(opis);
  return !/\bkio\b|krajowej izby|izby odwolawczej|odwolanie do krajowej/.test(t);
}

/** Heurystyka: prosta (nie-Pzp) procedura, o ile treść nie mówi inaczej. */
function prostaProcedura(opis) {
  // Rdzenie + \w* tolerują polską fleksję („przetargu nieograniczonego").
  // Świadomie NIE łapiemy samego „pzp": „postępowanie wyłączone z Pzp" to właśnie
  // sygnał PROSTEJ procedury, nie formalnej.
  const t = znorm(opis);
  return !/przetarg\w*\s+(nie)?ograniczon\w*|tryb\w*\s+podstawow\w*|dialog\w*\s+konkurencyjn\w*|negocjacj\w*\s+z\s+ogloszeni\w*|zgodnie z (ustaw\w* )?pzp|ustaw\w* pzp/.test(t);
}

/**
 * Normalizuje surowe ogłoszenie podprogowe do rekordu bazy + metadanych decyzji.
 * @param {object} surowe surowe ogłoszenie (dowolny zestaw kluczy — mapujemy warianty)
 * @param {object} [konfig] { prog_netto, prog_konkurencyjnosci, branza, region }
 * @returns {{rekord: object, dopasowanie: {branza: boolean, region: boolean, pasuje: boolean},
 *   kwalifikujeSie: boolean, powod: string}}
 */
export function normalizujPodprogowe(surowe, konfig) {
  const s = surowe && typeof surowe === 'object' ? surowe : {};
  const c = konfig && typeof konfig === 'object' ? konfig : {};

  const prog = Number.isFinite(c.prog_netto) ? c.prog_netto : PROG_DOMYSLNY;
  const progBK = Number.isFinite(c.prog_konkurencyjnosci) ? c.prog_konkurencyjnosci : PROG_KONKURENCYJNOSCI;

  // ── Mapowanie surowych pól (akceptujemy warianty nazw ze źródeł) ──────────
  const zrodloRaw = tekst(pierwsza(s, 'zrodlo', 'source'));
  const zrodlo = zrodloRaw ? zrodloRaw.toLowerCase() : null;
  const idZewnetrzny = tekst(pierwsza(s, 'id_zewnetrzny', 'idZewnetrzny', 'id', 'numer', 'ogloszenieId'));
  const tytul = tekst(pierwsza(s, 'tytul', 'tytuł', 'title', 'nazwa', 'przedmiot'));
  const zamawiajacy = tekst(pierwsza(s, 'zamawiajacy', 'zamawiający', 'buyer', 'instytucja', 'nazwaZamawiajacego'));
  const wartoscNetto = parseKwota(pierwsza(s, 'wartosc_netto', 'wartoscNetto', 'wartosc', 'kwota', 'budzet', 'value'));
  const walutaRaw = tekst(pierwsza(s, 'waluta', 'currency'));
  const waluta = walutaRaw ? walutaRaw.toUpperCase() : 'PLN';
  const terminSkladania = tekst(pierwsza(s, 'termin_skladania', 'terminSkladania', 'terminSkladaniaOfert', 'deadline'));
  const link = tekst(pierwsza(s, 'link', 'url', 'adres'));
  const regulaminUrl = tekst(pierwsza(s, 'regulamin_url', 'regulaminUrl'));
  const dataPublikacji = tekst(pierwsza(s, 'data_publikacji', 'dataPublikacji', 'opublikowano', 'published'));
  const opis = [pierwsza(s, 'opis', 'tresc', 'treść', 'description', 'szczegoly'), tytul].filter(Boolean).join(' ');
  const branzaRaw = tekst(pierwsza(s, 'branza', 'branża', 'kategoria', 'cpv'));
  const regionRaw = tekst(pierwsza(s, 'region', 'wojewodztwo', 'województwo', 'miejscowosc'));

  // ── Dopasowanie do preferencji (puste preferencje = brak zawężenia) ───────
  const dopBranza = pasujeDo(c.branza, branzaRaw, tytul, opis);
  const dopRegion = pasujeDo(c.region, regionRaw, zamawiajacy, opis);
  const dopasowanie = { branza: dopBranza, region: dopRegion, pasuje: dopBranza && dopRegion };

  // ── Flagi „łatwiejszego startu" ───────────────────────────────────────────
  const flagi = {
    bez_wadium: bezWadium(pierwsza(s, 'wadium'), opis),
    bez_kio: bezKio(opis),
    prosta_procedura: prostaProcedura(opis),
  };
  const latwiejszyStart = flagi.bez_wadium && flagi.bez_kio && flagi.prosta_procedura;

  // ── hash_dedup: kanoniczny klucz zależny od dostępnych identyfikatorów ────
  let klucz;
  if (idZewnetrzny) klucz = `${znorm(zrodlo)}|id:${znorm(idZewnetrzny)}`;
  else if (link) klucz = `${znorm(zrodlo)}|link:${znorm(link).replace(/\/+$/, '')}`;
  else klucz = `${znorm(zrodlo)}|t:${znorm(tytul)}|z:${znorm(zamawiajacy)}|w:${wartoscNetto ?? ''}|d:${znorm(terminSkladania)}`;
  const hashDedup = createHash('sha256').update(klucz).digest('hex');

  // ── Reguła progu (kwalifikacja) ───────────────────────────────────────────
  let kwalifikujeSie = false;
  let powod;
  if (!ZRODLA.has(zrodlo)) {
    powod = `Nieznane/niedozwolone źródło „${zrodlo ?? '—'}" — poza radarem podprogowym.`;
  } else if (waluta !== 'PLN') {
    powod = `Wartość w walucie ${waluta} — próg podprogowy dotyczy PLN, nie oceniam.`;
  } else if (wartoscNetto === null) {
    powod = 'Brak wartości netto — nie można ocenić progu podprogowego.';
  } else if (zrodlo === 'baza_konkurencyjnosci' && wartoscNetto < progBK) {
    powod = `Wartość ${wartoscNetto} zł poniżej progu zasady konkurencyjności (${progBK} zł) — poza Bazą Konkurencyjności.`;
  } else if (wartoscNetto >= prog) {
    powod = `Wartość ${wartoscNetto} zł nie jest poniżej progu ${prog} zł — to zamówienie nadprogowe.`;
  } else {
    kwalifikujeSie = true;
    powod = `Wartość ${wartoscNetto} zł mieści się w radarze podprogowym (< ${prog} zł).`;
  }

  // Rekord w kształcie kolumn tabeli `zamowienia_podprogowe` (migracja 009).
  // `branza`/`region` tagujemy preferencją użytkownika (schema: „dopasowana
  // branża użytkownika"); gdy preferencji nie podano — bierzemy wartość ze źródła.
  const rekord = {
    zrodlo,
    id_zewnetrzny: idZewnetrzny,
    tytul,
    zamawiajacy,
    branza: tekst(c.branza) ?? branzaRaw,
    region: tekst(c.region) ?? regionRaw,
    wartosc_netto: wartoscNetto,
    waluta,
    termin_skladania: terminSkladania,
    link,
    regulamin_url: regulaminUrl,
    regulamin_streszczenie: null, // uzupełni warstwa AI (kolejne podzadanie)
    latwiejszy_start: latwiejszyStart,
    flagi,
    data_publikacji: dataPublikacji,
    hash_dedup: hashDedup,
  };

  return { rekord, dopasowanie, kwalifikujeSie, powod };
}
