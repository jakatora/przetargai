/**
 * MIESIĘCZNA SYMULACJA PRZEPŁYWÓW I LUKA FINANSOWANIA (ulepszenie „Symulator płynności:
 * czy udźwigniesz ten kontrakt", podzadanie 2/6).
 *
 * Z modelu finansowego kontraktu (krok 1/6 — `services/parametryFinansowe.js`) i przyjętych
 * kosztów miesięcznych (ludzie+materiały) budujemy miesiąc-po-miesiącu obraz przepływów:
 *   • ile firma WYKŁADA z własnej kieszeni, zanim zobaczy pierwszą złotówkę od zamawiającego,
 *   • kiedy przychodzą wpływy (jedna faktura końcowa vs częściowe, po terminie zapłaty),
 *   • ile kapitału jest ZABLOKOWANE (wadium + zabezpieczenie wnoszone w gotówce przed podpisaniem).
 * Wynik: tablica miesięcy oraz `lukaFinansowania` (szczyt ujemnego salda = ile finansowania
 * pomostowego trzeba mieć), `miesiecyPomostowych` i `pierwszaWplataMiesiac`. To wchodzi w decyzję
 * „startować czy nie" obok szansy na wygraną.
 *
 * Świadome decyzje (spójnie z `parametryFinansowe.js`):
 *  • CZYSTA, DETERMINISTYCZNA logika: bez UI, bez I/O, bez sieci, bez DB, bez Date.now.
 *    Ta sama funkcja daje ten sam wynik dla tego samego wejścia (łatwo testowalna).
 *  • MODEL PESYMISTYCZNY dla płynności (nie zaniżać luki), spójny z domyślnymi z kroku 1/6:
 *     – koszty ponoszone co miesiąc przez cały czas trwania kontraktu,
 *     – kwoty blokowane wykładane w miesiącu 1 i zwracane dopiero na końcu horyzontu
 *       (zabezpieczenie zwalniane po realizacji, wadium po udzieleniu zamówienia),
 *     – zabezpieczenie liczone jako blokada GOTÓWKI tylko gdy forma nie jest „dowolna"
 *       (gdy dopuszczono gwarancję/ubezpieczenie — nie zamraża gotówki, to zresztą podpowiedź
 *       dla użytkownika, jak zmniejszyć lukę),
 *     – nieznana cena brutto (null) → brak wpływów od zamawiającego (nie obiecujemy przychodu).
 *  • Opóźnienie wpływu = termin zapłaty przeliczony na pełne miesiące: `ceil(dni/30)`.
 *
 * Moduł samowystarczalny (ZERO importów) — świadomie nie dopina się do współdzielonych plików,
 * które w drzewie roboczym mają cudzy WIP. Model z kroku 1/6 przyjmujemy jako argument.
 */

/** Dni w umownym „miesiącu" symulacji — do przeliczenia terminu zapłaty na miesiące. */
export const DNI_W_MIESIACU = 30;

// ─────────────────────────── pomocnicze: liczby ─────────────────────────────

/** Skończona liczba ≥ 0 albo wartość domyślna (null/undefined/NaN → domyślna). */
function nieujemna(v, dom) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dom;
}

/** Skończona liczba > 0 albo wartość domyślna. */
function dodatnia(v, dom) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dom;
}

/** Przycięcie do przedziału [lo, hi]. */
function przytnij(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// ─────────────────────────── funkcja publiczna ──────────────────────────────

/**
 * Buduje miesięczną symulację przepływów i wylicza lukę finansowania.
 *
 * @param {object} parametry model finansowy z `wyciagnijParametryFinansowe` (krok 1/6):
 *   {harmonogramPlatnosci:'jedna_faktura'|'czesciowe', terminZaplatyDni, zabezpieczenieProcent,
 *    zabezpieczenieForma:'nieokreslona'|'pieniadz'|'dowolna', zaliczkaProcent, wadiumKwota, cenaBrutto}.
 * @param {{kosztyMiesieczne?:number, czasTrwaniaMies?:number}} opcje koszty (ludzie+materiały)
 *   ponoszone co miesiąc i czas trwania kontraktu w miesiącach.
 * @returns {Readonly<{
 *   miesiace: ReadonlyArray<Readonly<{miesiac:number, wydatki:number, wplywy:number,
 *     saldoMiesiac:number, saldoNarastajaco:number}>>,
 *   lukaFinansowania:number, miesiecyPomostowych:number, pierwszaWplataMiesiac:number|null}>}
 *   ZAMROŻONA migawka symulacji. `lukaFinansowania` = wartość bezwzględna najgłębszego ujemnego
 *   salda narastającego (0 gdy saldo nigdy nie schodzi poniżej zera).
 */
export function symulujPlynnosc(parametry, opcje = {}) {
  const p = parametry || {};
  const o = opcje || {};

  const harmonogram = p.harmonogramPlatnosci === 'czesciowe' ? 'czesciowe' : 'jedna_faktura';
  const terminDni = dodatnia(p.terminZaplatyDni, DNI_W_MIESIACU);
  const cena = nieujemna(p.cenaBrutto, 0); // null/undefined → 0 (cena nieznana)
  const zaliczkaProc = przytnij(nieujemna(p.zaliczkaProcent, 0), 0, 100);
  const zabProc = przytnij(nieujemna(p.zabezpieczenieProcent, 0), 0, 100);

  const koszty = nieujemna(o.kosztyMiesieczne, 0);
  const N = Math.max(1, Math.floor(dodatnia(o.czasTrwaniaMies, 1)));
  const opoznienie = Math.max(0, Math.ceil(terminDni / DNI_W_MIESIACU)); // termin zapłaty w miesiącach

  const przychod = cena; // 0 gdy cena nieznana
  const saPlatnosci = przychod > 0;

  // Zabezpieczenie należytego wykonania blokuje GOTÓWKĘ tylko gdy nie dopuszczono gwarancji.
  const zabGotowka = p.zabezpieczenieForma === 'dowolna' ? 0 : (przychod * zabProc) / 100;
  const wadium = nieujemna(p.wadiumKwota, 0);
  const blokada = wadium + zabGotowka; // wyłożone na starcie, zwrócone na końcu horyzontu

  const zaliczka = (przychod * zaliczkaProc) / 100;
  const doFakturowania = przychod - zaliczka; // pozostała część ceny rozliczana fakturami

  // Horyzont: miesiące pracy + oczekiwanie na ostatni przelew (gdy w ogóle są płatności).
  const H = saPlatnosci ? N + opoznienie : N;

  // Wpływy OD ZAMAWIAJĄCEGO per miesiąc (indeksy 1..H); zwrot blokad liczony osobno.
  const wplywyZam = new Array(H + 1).fill(0);
  if (zaliczka > 0) wplywyZam[1] += zaliczka;
  if (saPlatnosci) {
    if (harmonogram === 'czesciowe') {
      const rata = doFakturowania / N; // faktura za każdy miesiąc pracy
      for (let i = 1; i <= N; i++) wplywyZam[i + opoznienie] += rata;
    } else {
      wplywyZam[N + opoznienie] += doFakturowania; // jedna faktura końcowa
    }
  }

  const miesiace = [];
  let narastajaco = 0;
  let luka = 0;
  let pierwszaWplataMiesiac = null;

  for (let m = 1; m <= H; m++) {
    let wydatki = m <= N ? koszty : 0;
    if (m === 1) wydatki += blokada; // kapitał blokowany wykładany na starcie
    const zwrot = m === H ? blokada : 0; // blokada wraca na końcu horyzontu
    const wplywy = wplywyZam[m] + zwrot;
    const saldoMiesiac = wplywy - wydatki;
    narastajaco += saldoMiesiac;
    if (narastajaco < 0 && -narastajaco > luka) luka = -narastajaco;
    if (pierwszaWplataMiesiac === null && wplywyZam[m] > 0) pierwszaWplataMiesiac = m;
    miesiace.push(Object.freeze({ miesiac: m, wydatki, wplywy, saldoMiesiac, saldoNarastajaco: narastajaco }));
  }

  const miesiecyPomostowych = miesiace.filter((x) => x.saldoNarastajaco < 0).length;

  return Object.freeze({
    miesiace: Object.freeze(miesiace),
    lukaFinansowania: luka,
    miesiecyPomostowych,
    pierwszaWplataMiesiac,
  });
}
