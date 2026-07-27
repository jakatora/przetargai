import { wzrostCenProc } from './waloryzacjaAlarm.js';
import { normalize } from './textNorm.js';
import { isMainModule } from './ids.js';

/**
 * Generator WNIOSKU O WALORYZACJĘ wynagrodzenia (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie", podzadanie 12/12 — domknięcie).
 *
 * Czysta funkcja, bez I/O i bez sieci. Z różnicy wskaźników cen GUS (baza z chwili
 * podpisania → wskaźnik aktualny) liczy KWOTĘ waloryzacji od wartości kontraktu,
 * dobiera PODSTAWĘ PRAWNĄ i składa gotową treść pisma do eksportu (`wniosekDoPliku`).
 *
 * Świadome decyzje (spójne z warstwą alarmu, lib/waloryzacjaAlarm.js):
 *  • WZROST CEN liczymy TĄ SAMĄ funkcją `wzrostCenProc` co alarm — jedno źródło
 *    reguły, więc kwota we wniosku nigdy nie rozjedzie się z liczbą, która alarm
 *    uruchomiła (to samo zaokrąglenie do 2 miejsc, ta sama baza porównania);
 *  • PODSTAWA PRAWNA idzie po realnej wystarczalności klauzuli:
 *      – klauzula z umowy (art. 439 Pzp), gdy pokrywa całą zmianę,
 *      – klauzula do umownego LIMITU + art. 455 Pzp na NADWYŻKĘ ponad limit,
 *      – sam art. 455 ust. 1 pkt 4 Pzp, gdy umowa nie ma wystarczającej klauzuli;
 *  • KWOTY liczymy w groszach z deterministycznym zaokrągleniem, a rozbicie na
 *    część „z klauzuli" i „ponad limit" ZAWSZE sumuje się do kwoty łącznej
 *    (niezmiennik — pieniądze nie mogą zgubić ani mnożyć grosza);
 *  • KONSERWATYWNIE nie generujemy wniosku przy braku danych, spadku cen, wartości
 *    kontraktu ≤ 0 ani gdy wzrost nie przekroczył progu z umowy — fałszywa kwota
 *    o pieniądzach jest gorsza niż brak wniosku.
 */

/** Zaokrągla do grosza (2 miejsca) deterministycznie; EPSILON gasi szum float. */
function grosze(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Kwota po polsku, np. 120000 → „120 000,00 zł" (NBSP z Intl → zwykła spacja). */
function fmtKwota(v, waluta = 'PLN') {
  const liczba = new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v).replace(/[\u00A0\u202F\u2009]/g, ' '); // separatory grup Intl (NBSP/wąska NBSP) → zwykła spacja
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

/**
 * Buduje opis podstawy prawnej dla wykrytego wariantu.
 * @returns {{rodzaj: string, artykuly: string[], opis: string}}
 */
function podstawaPrawna(rodzaj, { limit, waluta, kwotaPonadLimit }) {
  if (rodzaj === 'art_455') {
    return {
      rodzaj,
      artykuly: ['art. 455 ust. 1 pkt 4 ustawy Pzp'],
      opis: 'Umowa nie zawiera wystarczającej klauzuli waloryzacyjnej, dlatego podstawą '
        + 'zmiany wynagrodzenia jest art. 455 ust. 1 pkt 4 ustawy Prawo zamówień publicznych '
        + '(dopuszczalna zmiana umowy wywołana okolicznościami, których zamawiający, działając '
        + 'z należytą starannością, nie mógł przewidzieć).',
    };
  }
  if (rodzaj === 'klauzula_i_art_455') {
    return {
      rodzaj,
      artykuly: ['art. 439 ustawy Pzp', 'art. 455 ust. 1 pkt 4 ustawy Pzp'],
      opis: `Klauzula waloryzacyjna z umowy pokrywa zmianę wynagrodzenia do umownego limitu `
        + `(${fmtProc(limit)}). Nadwyżka ponad limit (${fmtKwota(kwotaPonadLimit, waluta)}) wymaga `
        + 'zmiany umowy na podstawie art. 455 ust. 1 pkt 4 ustawy Prawo zamówień publicznych — '
        + 'sam limit z klauzuli jej nie pokrywa.',
    };
  }
  return {
    rodzaj: 'klauzula_umowna',
    artykuly: ['art. 439 ustawy Pzp'],
    opis: 'Podstawą waloryzacji jest klauzula waloryzacyjna zawarta w umowie '
      + '(art. 439 ustawy Prawo zamówień publicznych) — pokrywa ona całą wnioskowaną zmianę.',
  };
}

/** Składa treść pisma „po ludzku" z policzonych już wartości. */
function budujTresc(w, dane) {
  const {
    wskaznikBazowy, wskaznikAktualny, prog, limit, branza,
    okresBazowy, okresAktualny, numerUmowy, przedmiot,
    wykonawca, zamawiajacy, miejscowosc, dataPisma, waluta,
  } = dane;

  const naglowekUmowa = [
    numerUmowy ? `dotyczy umowy nr ${numerUmowy}` : null,
    przedmiot ? `przedmiot: ${przedmiot}` : null,
    branza ? `branża: ${branza}` : null,
  ].filter(Boolean).join(', ');

  const linie = [];
  linie.push(`${miejscowosc || '[miejscowość]'}, dnia ${dataPisma || '[data]'}`);
  linie.push('');
  linie.push(wykonawca || '[Wykonawca / nazwa firmy, adres, NIP]');
  linie.push('');
  linie.push(`Do: ${zamawiajacy || '[Zamawiający]'}`);
  linie.push('');
  linie.push('WNIOSEK O WALORYZACJĘ WYNAGRODZENIA');
  if (naglowekUmowa) linie.push(`(${naglowekUmowa})`);
  linie.push('');
  linie.push(
    `Na podstawie ${w.podstawa.artykuly.join(' oraz ')}, w związku ze zmianą wskaźnika cen `
    + 'publikowanego przez Główny Urząd Statystyczny (GUS), wnoszę o waloryzację wynagrodzenia '
    + 'należnego z tytułu ww. umowy.',
  );
  linie.push('');
  linie.push('Uzasadnienie — zmiana wskaźnika cen GUS:');
  linie.push(`  • wskaźnik w chwili podpisania umowy (baza): ${wskaznikBazowy}`
    + (okresBazowy ? ` (${okresBazowy})` : ''));
  linie.push(`  • wskaźnik aktualny: ${wskaznikAktualny}`
    + (okresAktualny ? ` (${okresAktualny})` : ''));
  linie.push(`  • wzrost cen względem bazy: ${fmtProc(w.wzrost)}`);
  if (Number.isFinite(prog) && prog > 0) linie.push(`  • próg waloryzacji z umowy: ${fmtProc(prog)}`);
  if (Number.isFinite(limit) && limit > 0) linie.push(`  • umowny limit łącznej waloryzacji: ${fmtProc(limit)}`);
  linie.push('');
  linie.push('Wyliczenie kwoty waloryzacji:');
  linie.push(`  • wartość wynagrodzenia (netto) będąca podstawą: ${fmtKwota(dane.wartoscKontraktu, waluta)}`);
  linie.push(`  • kwota waloryzacji (${fmtProc(w.wzrost)}): ${fmtKwota(w.kwota, waluta)}`);
  if (w.kwotaPonadLimit > 0 && w.podstawa.rodzaj === 'klauzula_i_art_455') {
    linie.push(`      – w granicach klauzuli (do ${fmtProc(limit)}): ${fmtKwota(w.kwotaZKlauzuli, waluta)}`);
    linie.push(`      – ponad limit (art. 455 Pzp): ${fmtKwota(w.kwotaPonadLimit, waluta)}`);
  }
  linie.push('');
  linie.push(`Podstawa prawna: ${w.podstawa.opis}`);
  linie.push('');
  linie.push(
    `W związku z powyższym wnoszę o podwyższenie wynagrodzenia o kwotę ${fmtKwota(w.kwota, waluta)} `
    + 'oraz o zawarcie stosownego aneksu do umowy.',
  );
  linie.push('');
  linie.push('.......................................');
  linie.push('(podpis Wykonawcy)');
  return linie.join('\n');
}

/**
 * Generuje wniosek o waloryzację z różnicy wskaźników GUS.
 * @param {object} dane
 * @param {number} dane.wartoscKontraktu wartość (netto) wynagrodzenia — podstawa kwoty (PLN, >0)
 * @param {number} dane.wskaznikBazowy wskaźnik GUS z chwili podpisania (baza)
 * @param {number} dane.wskaznikAktualny aktualny wskaźnik GUS
 * @param {number|null} [dane.prog] próg waloryzacji z umowy (%); wzrost ≤ próg => wniosek niepotrzebny
 * @param {number|null} [dane.limit] umowny górny limit łącznej waloryzacji (%)
 * @param {boolean} [dane.klauzulaObecna] czy w umowie jest klauzula (domyślnie: gdy jest próg lub limit)
 * @param {string} [dane.branza]
 * @param {string} [dane.okresBazowy]
 * @param {string} [dane.okresAktualny]
 * @param {string} [dane.numerUmowy]
 * @param {string} [dane.przedmiot]
 * @param {string} [dane.wykonawca]
 * @param {string} [dane.zamawiajacy]
 * @param {string} [dane.miejscowosc]
 * @param {string} [dane.dataPisma] data pisma (wstrzykiwalna — funkcja jest deterministyczna)
 * @param {string} [dane.waluta='PLN']
 * @returns {{mozliwy: boolean, powod: string, wzrost: number|null, kwota: number|null,
 *   kwotaZKlauzuli: number|null, kwotaPonadLimit: number|null, waluta: string,
 *   podstawa: {rodzaj: string, artykuly: string[], opis: string}|null,
 *   tresc: string|null, nazwaPliku: string|null}}
 */
export function generujWniosekWaloryzacyjny(dane = {}) {
  const { wartoscKontraktu, wskaznikBazowy, wskaznikAktualny, prog, limit } = dane;
  const waluta = dane.waluta || 'PLN';

  const nie = (powod) => ({
    mozliwy: false, powod, wzrost: null, kwota: null,
    kwotaZKlauzuli: null, kwotaPonadLimit: null, waluta,
    podstawa: null, tresc: null, nazwaPliku: null,
  });

  const wzrost = wzrostCenProc(wskaznikBazowy, wskaznikAktualny);
  if (wzrost === null) {
    return nie('Brak kompletnych danych o wskaźnikach cen GUS — nie można policzyć wzrostu.');
  }
  if (wzrost <= 0) {
    return nie('Ceny nie wzrosły względem bazy — nie ma podstawy do wniosku o waloryzację.');
  }
  if (!(Number.isFinite(wartoscKontraktu) && wartoscKontraktu > 0)) {
    return nie('Brak poprawnej wartości kontraktu (netto) — nie można wyliczyć kwoty waloryzacji.');
  }

  const progOk = Number.isFinite(prog) && prog > 0;
  const limitOk = Number.isFinite(limit) && limit > 0;
  const klauzulaObecna = typeof dane.klauzulaObecna === 'boolean'
    ? dane.klauzulaObecna
    : (progOk || limitOk);

  // Jest jawny próg z umowy i wzrost go NIE przekroczył — na gruncie klauzuli
  // brak podstawy, a wzrost mieści się w tym, co umowa uznała za nieuzasadniające
  // waloryzacji. Konserwatywnie: nie generujemy (spójnie z alarmem „o ponad X%").
  if (klauzulaObecna && progOk && wzrost <= prog) {
    return nie(`Wzrost cen (${fmtProc(wzrost)}) nie przekroczył progu waloryzacji z umowy (${fmtProc(prog)}).`);
  }

  const kwota = grosze(wartoscKontraktu * wzrost / 100);
  let kwotaZKlauzuli;
  let kwotaPonadLimit;
  if (limitOk) {
    const procentKlauzula = Math.min(wzrost, limit);
    kwotaZKlauzuli = grosze(wartoscKontraktu * procentKlauzula / 100);
    kwotaPonadLimit = grosze(kwota - kwotaZKlauzuli);
  } else if (klauzulaObecna) {
    kwotaZKlauzuli = kwota;
    kwotaPonadLimit = 0;
  } else {
    kwotaZKlauzuli = 0;
    kwotaPonadLimit = kwota;
  }

  let rodzaj;
  if (!klauzulaObecna) rodzaj = 'art_455';
  else if (limitOk && wzrost > limit) rodzaj = 'klauzula_i_art_455';
  else rodzaj = 'klauzula_umowna';

  const podstawa = podstawaPrawna(rodzaj, { limit, waluta, kwotaPonadLimit });

  const w = {
    mozliwy: true,
    powod: 'Wzrost cen uzasadnia wniosek o waloryzację.',
    wzrost, kwota, kwotaZKlauzuli, kwotaPonadLimit, waluta, podstawa,
    tresc: null, nazwaPliku: null,
  };
  w.tresc = budujTresc(w, { ...dane, waluta });
  w.nazwaPliku = `wniosek-o-waloryzacje-${slug(dane.numerUmowy || dane.branza || 'umowa')}.txt`;
  return w;
}

/**
 * Eksport wniosku do pliku — deskryptor pliku tekstowego (bez I/O, testowalny).
 * Transport (HTTP attachment, zapis na dysk) dokłada wywołujący.
 * @param {ReturnType<typeof generujWniosekWaloryzacyjny>} wniosek
 * @returns {{nazwa: string, typ: string, zawartosc: string}}
 * @throws gdy wniosek jest niemożliwy (nie ma czego eksportować)
 */
export function wniosekDoPliku(wniosek) {
  if (!wniosek?.mozliwy || !wniosek.tresc) {
    throw new Error('Nie można wyeksportować niemożliwego wniosku o waloryzację.');
  }
  return {
    nazwa: wniosek.nazwaPliku,
    typ: 'text/plain; charset=utf-8',
    zawartosc: wniosek.tresc,
  };
}

// Podgląd: `node src/lib/waloryzacjaWniosek.js --demo`
if (isMainModule(import.meta.url) && process.argv.includes('--demo')) {
  const demo = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 100, wskaznikAktualny: 120,
    prog: 5, limit: 10, branza: 'budownictwo', numerUmowy: 'ZP/12/2026',
    wykonawca: 'Firma Budowlana Sp. z o.o.', zamawiajacy: 'Gmina Przykładowa',
    miejscowosc: 'Warszawa', dataPisma: '2026-07-25',
  });
  console.log(JSON.stringify({
    mozliwy: demo.mozliwy, wzrost: demo.wzrost, kwota: demo.kwota,
    kwotaZKlauzuli: demo.kwotaZKlauzuli, kwotaPonadLimit: demo.kwotaPonadLimit,
    podstawa: demo.podstawa, nazwaPliku: demo.nazwaPliku,
  }, null, 2));
  console.log('\n--- treść ---\n');
  console.log(demo.tresc);
}
