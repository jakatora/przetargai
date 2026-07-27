import { statusZwrotu, naliczOdsetki } from './zabezpieczenieZwrot.js';
import { normalize } from './textNorm.js';
import { isMainModule } from './ids.js';

/**
 * Generator WEZWANIA DO ZWROTU ZABEZPIECZENIA należytego wykonania umowy
 * (ulepszenie „pilnuj zwrotu swoich pieniędzy po kontrakcie").
 *
 * Czysta funkcja bez I/O i bez sieci; „dzisiaj" jest wstrzykiwane, więc pismo jest
 * deterministyczne. Status wymagalności i odsetki liczy JEDNO źródło reguły
 * (`zabezpieczenieZwrot.js`) — treść pisma nigdy nie rozjedzie się z tym, co
 * uruchomiło alarm.
 *
 * Dwa warianty:
 *  • „zwykłe"          — kwota wymagalna; pismo powołuje harmonogram zwrotu z art. 453
 *                        ustawy Pzp i wzywa do zapłaty w wyznaczonym terminie,
 *  • „przeterminowane" — po terminie: pismo dokłada ostrzeżenie, że Pzp nie przewiduje
 *                        sankcji dla zamawiającego za zwłokę, nalicza odsetki ustawowe
 *                        za opóźnienie (art. 481 KC), wskazuje ścieżkę roszczenia z
 *                        bezpodstawnego wzbogacenia (art. 405 KC) i żąda kwoty z odsetkami.
 *
 * Niezmiennik pieniędzy: `kwotaZadania` = `kwota` + `odsetki` co do grosza.
 */

/** Zaokrągla do grosza (2 miejsca) deterministycznie; EPSILON gasi szum float. */
function grosze(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Kwota po polsku, np. 35000 → „35 000,00 zł" (NBSP z Intl → zwykła spacja). */
function fmtKwota(v, waluta = 'PLN') {
  const liczba = new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v).replace(/[   ]/g, ' ');
  return `${liczba} ${waluta === 'PLN' ? 'zł' : waluta}`;
}

/** Procent po polsku (kropka dziesiętna → przecinek), np. 12.5 → „12,5%". */
function fmtProc(v) {
  return `${String(v).replace('.', ',')}%`;
}

/** Slug do nazwy pliku: bez diakrytyków, tylko [a-z0-9-]. Pusty → 'umowa'. */
function slug(s) {
  const out = normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'umowa';
}

/** Składa treść pisma „po ludzku" z policzonych już wartości. */
function budujTresc(w, dane) {
  const {
    kwota, termin, numerUmowy, przedmiot, tytulTranszy,
    wykonawca, zamawiajacy, miejscowosc, dataPisma, waluta,
  } = dane;

  const naglowekUmowa = [
    numerUmowy ? `dotyczy umowy nr ${numerUmowy}` : null,
    przedmiot ? `przedmiot: ${przedmiot}` : null,
  ].filter(Boolean).join(', ');

  const linie = [];
  linie.push(`${miejscowosc || '[miejscowość]'}, dnia ${dataPisma || '[data]'}`);
  linie.push('');
  linie.push(wykonawca || '[Wykonawca / nazwa firmy, adres, NIP]');
  linie.push('');
  linie.push(`Do: ${zamawiajacy || '[Zamawiający]'}`);
  linie.push('');
  linie.push('WEZWANIE DO ZWROTU ZABEZPIECZENIA NALEŻYTEGO WYKONANIA UMOWY');
  if (naglowekUmowa) linie.push(`(${naglowekUmowa})`);
  linie.push('');

  const opisTransza = tytulTranszy ? ` (${tytulTranszy})` : '';
  linie.push(
    `Na podstawie art. 453 ustawy Prawo zamówień publicznych wzywam do zwrotu zabezpieczenia `
    + `należytego wykonania umowy${opisTransza} w kwocie ${fmtKwota(kwota, waluta)}. `
    + `Termin zwrotu zabezpieczenia upłynął / upływa z dniem ${termin || '[termin]'}.`,
  );
  linie.push('');

  if (w.wariant === 'przeterminowane') {
    linie.push(
      `Zwrot jest przeterminowany o ${w.dni} dni. Zwracam uwagę, że ustawa Prawo zamówień `
      + `publicznych nie przewiduje sankcji dla zamawiającego za nieterminowy zwrot `
      + `zabezpieczenia — nie zwalnia to jednak z obowiązku jego zwrotu.`,
    );
    linie.push('');
    linie.push('Wobec upływu terminu:');
    linie.push(`  • naliczam odsetki ustawowe za opóźnienie (art. 481 § 2 Kodeksu cywilnego) `
      + `wg stopy ${fmtProc(w.stopaRoczna)} rocznie za ${w.dni} dni zwłoki: ${fmtKwota(w.odsetki, waluta)},`);
    linie.push(`  • zatrzymanie kwoty zabezpieczenia po terminie jej zwrotu stanowi `
      + `bezpodstawne wzbogacenie zamawiającego (art. 405 Kodeksu cywilnego), które podlega zwrotowi.`);
    linie.push('');
    linie.push(`Wzywam do zapłaty łącznej kwoty ${fmtKwota(w.kwotaZadania, waluta)} `
      + `(zabezpieczenie ${fmtKwota(kwota, waluta)} + odsetki ${fmtKwota(w.odsetki, waluta)}) `
      + `w terminie 7 dni od otrzymania niniejszego wezwania.`);
  } else {
    linie.push(`Wzywam do zwrotu kwoty ${fmtKwota(kwota, waluta)} na rachunek Wykonawcy `
      + `w terminie wynikającym z art. 453 ustawy Prawo zamówień publicznych. `
      + `Brak terminowego zwrotu skutkować będzie naliczeniem odsetek ustawowych za opóźnienie `
      + `(art. 481 Kodeksu cywilnego).`);
  }

  linie.push('');
  linie.push('.......................................');
  linie.push('(podpis Wykonawcy)');
  return linie.join('\n');
}

/**
 * Generuje wezwanie do zwrotu zabezpieczenia.
 * @param {object} dane
 * @param {number} dane.kwota kwota zabezpieczenia do zwrotu (PLN, > 0)
 * @param {string} dane.termin dzień, w którym zwrot jest wymagalny (YYYY-MM-DD)
 * @param {string} [dane.dzisiaj] dzień oceny statusu (wstrzykiwany; brak → wariant „zwykłe")
 * @param {number} [dane.stopaRoczna] roczna stopa odsetek za opóźnienie (%)
 * @param {string} [dane.tytulTranszy] etykieta transzy (np. „Zwrot po odbiorze")
 * @param {string} [dane.numerUmowy]
 * @param {string} [dane.przedmiot]
 * @param {string} [dane.wykonawca]
 * @param {string} [dane.zamawiajacy]
 * @param {string} [dane.miejscowosc]
 * @param {string} [dane.dataPisma]
 * @param {string} [dane.waluta='PLN']
 * @returns {{wariant:'zwykle'|'przeterminowane', status:string, dni:number,
 *   kwota:number, odsetki:number, stopaRoczna:number, kwotaZadania:number,
 *   waluta:string, tresc:string, nazwaPliku:string}}
 */
export function generujWezwanieDoZwrotu(dane = {}) {
  const waluta = dane.waluta || 'PLN';
  const kwota = Number.isFinite(dane.kwota) && dane.kwota > 0 ? grosze(dane.kwota) : 0;

  const { status } = statusZwrotu({ termin: dane.termin, dzisiaj: dane.dzisiaj });
  const przeterminowane = status === 'przeterminowane';

  const ods = przeterminowane
    ? naliczOdsetki({ kwota, termin: dane.termin, dzisiaj: dane.dzisiaj, stopaRoczna: dane.stopaRoczna })
    : { dni: 0, stopaRoczna: null, odsetki: 0 };

  const w = {
    wariant: przeterminowane ? 'przeterminowane' : 'zwykle',
    status,
    dni: ods.dni,
    kwota,
    odsetki: ods.odsetki,
    stopaRoczna: ods.stopaRoczna,
    kwotaZadania: grosze(kwota + ods.odsetki),
    waluta,
    tresc: null,
    nazwaPliku: null,
  };
  w.tresc = budujTresc(w, { ...dane, kwota, waluta });
  w.nazwaPliku = `wezwanie-do-zwrotu-zabezpieczenia-${slug(dane.numerUmowy || dane.przedmiot || 'umowa')}.txt`;
  return w;
}

/**
 * Eksport wezwania do pliku — deskryptor pliku tekstowego (bez I/O, testowalny).
 * @param {ReturnType<typeof generujWezwanieDoZwrotu>} wezwanie
 * @returns {{nazwa:string, typ:string, zawartosc:string}}
 * @throws gdy wezwanie nie ma treści (nie ma czego eksportować)
 */
export function wezwanieDoPliku(wezwanie) {
  if (!wezwanie?.tresc) {
    throw new Error('Nie można wyeksportować pustego wezwania do zwrotu zabezpieczenia.');
  }
  return {
    nazwa: wezwanie.nazwaPliku,
    typ: 'text/plain; charset=utf-8',
    zawartosc: wezwanie.tresc,
  };
}

// Podgląd: `node src/lib/zabezpieczenieWezwanie.js --demo`
if (isMainModule(import.meta.url) && process.argv.includes('--demo')) {
  const demo = generujWezwanieDoZwrotu({
    kwota: 35_000, termin: '2027-06-30', dzisiaj: '2028-06-30', stopaRoczna: 11.25,
    numerUmowy: 'ZP/12/2026', przedmiot: 'Budowa drogi gminnej',
    wykonawca: 'Firma Budowlana Sp. z o.o.', zamawiajacy: 'Gmina Przykładowa',
    miejscowosc: 'Warszawa', dataPisma: '2028-07-01',
  });
  console.log(demo.tresc);
}
