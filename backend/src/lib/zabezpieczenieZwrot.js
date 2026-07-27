import { isMainModule } from './ids.js';

/**
 * ODZYSKIWACZ ZABEZPIECZENIA — rdzeń liczbowy (ulepszenie „pilnuj zwrotu swoich
 * pieniędzy po kontrakcie").
 *
 * Czyste, deterministyczne funkcje: bez I/O, bez sieci, bez płatnego AI i BEZ
 * Date.now — „dzisiaj" jest ZAWSZE wstrzykiwane parametrem, więc ten sam wsad daje
 * zawsze ten sam wynik (spójnie z symulatorem płynności i radarem planów).
 *
 * Reguła zwrotu zabezpieczenia należytego wykonania umowy (art. 453 Pzp):
 *  • ust. 1: zamawiający zwraca zabezpieczenie w 30 dni od uznania zamówienia za
 *    należycie wykonane (transza „po odbiorze"),
 *  • ust. 2: może zatrzymać na roszczenia z rękojmi/gwarancji kwotę ≤ 30%
 *    zabezpieczenia,
 *  • ust. 3: zatrzymaną kwotę zwraca nie później niż w 15. dniu po upływie okresu
 *    rękojmi lub gwarancji (transza „po rękojmi").
 *
 * Ostrzeżenie wpisane w produkt: za nieterminowy zwrot Pzp NIE przewiduje sankcji
 * dla zamawiającego, więc bez aktywnego upominania pieniądze potrafią leżeć latami.
 * Stąd status wymagalności (alarm w dniu, w którym można żądać zwrotu), naliczanie
 * odsetek za opóźnienie (art. 481 KC) i — przy przeterminowaniu — ścieżka roszczenia
 * z bezpodstawnego wzbogacenia (art. 405 KC), którą składa generator wezwania.
 *
 * KONSERWATYWNIE: przy niepoprawnych danych wolimy zwrócić `null`/0 niż zmyśloną
 * liczbę o pieniądzach — fałszywa kwota jest gorsza niż jej brak.
 */

/** Maksymalny procent zabezpieczenia, jaki zamawiający może zatrzymać (art. 453 ust. 2 Pzp). */
export const PROCENT_ZATRZYMANY_MAX = 30;

/** Domyślne (konserwatywne) zatrzymanie — zakładamy maksymalne, dopóki umowa nie mówi inaczej. */
export const PROCENT_ZATRZYMANY_DOMYSLNY = 30;

/** Zwrot transzy „po odbiorze" — w 30 dni od uznania za należycie wykonane (art. 453 ust. 1 Pzp). */
export const DNI_ZWROT_PO_ODBIORZE = 30;

/** Zwrot transzy „po rękojmi" — nie później niż w 15. dniu po upływie rękojmi/gwarancji (art. 453 ust. 3 Pzp). */
export const DNI_ZWROT_PO_REKOJMI = 15;

/**
 * Domyślna roczna stopa odsetek za opóźnienie (odsetki ustawowe za opóźnienie,
 * art. 481 § 2 KC). To ZAŁOŻENIE — realna stawka zmienia się wraz ze stopą
 * referencyjną NBP, więc wywołujący powinien podać aktualną (`stopaRoczna`), a
 * wynik zawsze niesie użytą stawkę, żeby nic nie było ukryte przy liczeniu pieniędzy.
 */
export const STOPA_ODSETEK_DOMYSLNA = 11.25;

/** Typowa roczna prowizja banku za gwarancję należytego wykonania (założenie, ~1–2%/rok). */
export const PROWIZJA_GWARANCJI_DOMYSLNA = 1.5;

/** Domyślny roczny koszt zamrożonego kapitału (założenie — kredyt obrotowy / utracony zwrot). */
export const KOSZT_KAPITALU_DOMYSLNY = 8;

const MS_DZIEN = 86_400_000;

/** Zaokrągla do grosza (2 miejsca) deterministycznie; EPSILON gasi szum float. */
function grosze(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Parsuje datę „YYYY-MM-DD" (lub pełne ISO) do północy UTC w milisekundach.
 * Zwraca `null` dla braku / śmieci — bez zmyślania daty.
 */
function dzienUTC(data) {
  if (typeof data !== 'string') return null;
  const m = data.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const rok = Number(m[1]);
  const mies = Number(m[2]);
  const dzien = Number(m[3]);
  if (mies < 1 || mies > 12 || dzien < 1 || dzien > 31) return null;
  const ms = Date.UTC(rok, mies - 1, dzien);
  const d = new Date(ms);
  // Odrzuć „przewijające się" daty (np. 2027-02-31 → marzec) — to nie była realna data.
  if (d.getUTCFullYear() !== rok || d.getUTCMonth() !== mies - 1 || d.getUTCDate() !== dzien) return null;
  return ms;
}

/** Formatuje milisekundy UTC z powrotem do „YYYY-MM-DD". */
function formatDzien(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Data + N dni jako „YYYY-MM-DD"; `null` gdy data nieparsowalna. */
function dodajDni(data, dni) {
  const ms = dzienUTC(data);
  return ms == null ? null : formatDzien(ms + dni * MS_DZIEN);
}

/** Procent zatrzymania przycięty do dopuszczalnego [0, 30]; nie-liczba → domyślne 30%. */
function normProcentZatrzymany(p) {
  if (typeof p !== 'number' || !Number.isFinite(p)) return PROCENT_ZATRZYMANY_DOMYSLNY;
  if (p < 0) return 0;
  if (p > PROCENT_ZATRZYMANY_MAX) return PROCENT_ZATRZYMANY_MAX;
  return p;
}

/**
 * Harmonogram zwrotu zabezpieczenia (art. 453 Pzp).
 * @param {object} d
 * @param {number} d.kwota wysokość zabezpieczenia (PLN)
 * @param {string} d.dataNalezytegoWykonania dzień uznania zamówienia za należycie wykonane (YYYY-MM-DD)
 * @param {string} d.dataUplywuRekojmi dzień upływu rękojmi/gwarancji (YYYY-MM-DD)
 * @param {number} [d.procentZatrzymany=30] ile % zamawiający zatrzymuje na rękojmię (0–30)
 * @returns {{kwota:number, procentZatrzymany:number,
 *   transze: Array<{etap:string, tytul:string, procent:number, kwota:number,
 *     termin:string|null, podstawa:string}>}}
 */
export function harmonogramZwrotu(d = {}) {
  const kwota = Number(d.kwota);
  const procentZatrzymany = normProcentZatrzymany(d.procentZatrzymany);
  const kwotaOk = Number.isFinite(kwota) && kwota > 0 ? grosze(kwota) : 0;

  const kwotaPoRekojmi = grosze(kwotaOk * procentZatrzymany / 100);
  // Reszta (100% − zatrzymane) trafia do pierwszej transzy — niezmiennik sumy: transze
  // ZAWSZE sumują się do kwoty co do grosza (pieniądze nie mogą zgubić ani mnożyć grosza).
  const kwotaPoOdbiorze = grosze(kwotaOk - kwotaPoRekojmi);

  const transze = [{
    etap: 'po_odbiorze',
    tytul: 'Zwrot po odbiorze (art. 453 ust. 1 Pzp)',
    procent: grosze(100 - procentZatrzymany),
    kwota: kwotaPoOdbiorze,
    termin: dodajDni(d.dataNalezytegoWykonania, DNI_ZWROT_PO_ODBIORZE),
    podstawa: 'art. 453 ust. 1 Pzp',
  }];

  if (procentZatrzymany > 0) {
    transze.push({
      etap: 'po_rekojmi',
      tytul: 'Zwrot po rękojmi/gwarancji (art. 453 ust. 2–3 Pzp)',
      procent: procentZatrzymany,
      kwota: kwotaPoRekojmi,
      termin: dodajDni(d.dataUplywuRekojmi, DNI_ZWROT_PO_REKOJMI),
      podstawa: 'art. 453 ust. 2–3 Pzp',
    });
  }

  return { kwota: kwotaOk, procentZatrzymany, transze };
}

/**
 * Status wymagalności transzy względem wstrzykniętego „dzisiaj".
 * @returns {{status:'oczekuje'|'wymagalne'|'przeterminowane'|'nieznany', dni:number|null}}
 *   `oczekuje` — przed terminem (dni = ile zostało); `wymagalne` — dziś (dni = 0,
 *   ALARM: można żądać zwrotu); `przeterminowane` — po terminie (dni = zwłoka).
 */
export function statusZwrotu({ termin, dzisiaj } = {}) {
  const t = dzienUTC(termin);
  const now = dzienUTC(dzisiaj);
  if (t == null || now == null) return { status: 'nieznany', dni: null };
  const dni = Math.round((now - t) / MS_DZIEN);
  if (dni < 0) return { status: 'oczekuje', dni: -dni };
  if (dni === 0) return { status: 'wymagalne', dni: 0 };
  return { status: 'przeterminowane', dni };
}

/**
 * Odsetki za opóźnienie w zwrocie (proste, art. 481 KC). Liczone od dnia PO terminie;
 * przed/w terminie → 0. Nieparsowalne daty → 0 (konserwatywnie, bez zmyślania).
 * @returns {{dni:number, stopaRoczna:number, odsetki:number}}
 */
export function naliczOdsetki({ kwota, termin, dzisiaj, stopaRoczna } = {}) {
  const stopa = Number.isFinite(stopaRoczna) && stopaRoczna >= 0 ? stopaRoczna : STOPA_ODSETEK_DOMYSLNA;
  const { status, dni } = statusZwrotu({ termin, dzisiaj });
  const kwotaOk = Number(kwota);
  if (status !== 'przeterminowane' || !(Number.isFinite(kwotaOk) && kwotaOk > 0)) {
    return { dni: 0, stopaRoczna: stopa, odsetki: 0 };
  }
  return { dni, stopaRoczna: stopa, odsetki: grosze(kwotaOk * (stopa / 100) * (dni / 365)) };
}

/**
 * Porównanie realnego kosztu dwóch form zabezpieczenia przed podpisaniem umowy:
 * zamrozić GOTÓWKĘ na `lata` lat (koszt = utracony zwrot / koszt kapitału) vs zapłacić
 * PROWIZJĘ za gwarancję bankową. Użyte stawki (założenia) są zawsze zwracane w
 * `zalozenia` — przy decyzji o pieniądzach nic nie może być ukryte.
 * @returns {{kwota:number, lata:number, zalozenia:object,
 *   gotowka:{koszt:number, opis:string}, gwarancja:{koszt:number, opis:string},
 *   tanszaOpcja:'gotowka'|'gwarancja'|'porownywalne', roznica:number}}
 */
export function porownajKoszt({ kwota, lata, prowizjaGwarancjiRocznaProc, kosztKapitaluRocznyProc } = {}) {
  const kwotaOk = Number.isFinite(kwota) && kwota > 0 ? grosze(kwota) : 0;
  const lataOk = Number.isFinite(lata) && lata > 0 ? lata : 0;
  const prowizja = Number.isFinite(prowizjaGwarancjiRocznaProc) && prowizjaGwarancjiRocznaProc >= 0
    ? prowizjaGwarancjiRocznaProc : PROWIZJA_GWARANCJI_DOMYSLNA;
  const kosztKapitalu = Number.isFinite(kosztKapitaluRocznyProc) && kosztKapitaluRocznyProc >= 0
    ? kosztKapitaluRocznyProc : KOSZT_KAPITALU_DOMYSLNY;

  const kosztGotowka = grosze(kwotaOk * (kosztKapitalu / 100) * lataOk);
  const kosztGwarancja = grosze(kwotaOk * (prowizja / 100) * lataOk);
  const roznica = grosze(Math.abs(kosztGotowka - kosztGwarancja));

  let tanszaOpcja;
  if (kosztGotowka === kosztGwarancja) tanszaOpcja = 'porownywalne';
  else tanszaOpcja = kosztGotowka < kosztGwarancja ? 'gotowka' : 'gwarancja';

  return {
    kwota: kwotaOk,
    lata: lataOk,
    zalozenia: { prowizjaGwarancjiRocznaProc: prowizja, kosztKapitaluRocznyProc: kosztKapitalu },
    gotowka: {
      koszt: kosztGotowka,
      opis: `Zamrożenie ${kwotaOk} zł gotówki na ${lataOk} lat przy koszcie kapitału ${kosztKapitalu}% rocznie.`,
    },
    gwarancja: {
      koszt: kosztGwarancja,
      opis: `Prowizja za gwarancję bankową ${prowizja}% rocznie od ${kwotaOk} zł przez ${lataOk} lat.`,
    },
    tanszaOpcja,
    roznica,
  };
}

// Podgląd: `node src/lib/zabezpieczenieZwrot.js --demo`
if (isMainModule(import.meta.url) && process.argv.includes('--demo')) {
  console.log(JSON.stringify(harmonogramZwrotu({
    kwota: 50_000, dataNalezytegoWykonania: '2027-05-31', dataUplywuRekojmi: '2032-05-31',
  }), null, 2));
  console.log(JSON.stringify(porownajKoszt({ kwota: 100_000, lata: 5 }), null, 2));
}
