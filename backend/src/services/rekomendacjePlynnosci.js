/**
 * REKOMENDACJE DOMKNIĘCIA LUKI + WSAD DO DECYZJI „STARTOWAĆ CZY NIE" (ulepszenie
 * „Symulator płynności: czy udźwigniesz ten kontrakt", podzadanie 3/6).
 *
 * Symulacja (krok 2/6 — `services/symulacjaPlynnosci.js`) mówi ILE finansowania pomostowego
 * kontrakt wymaga i przez ile miesięcy. Tu zestawiamy to z PODUSZKĄ GOTÓWKI firmy i modelem
 * finansowym (krok 1/6) i zamieniamy liczby w decyzję:
 *   • STATUS: udźwigniesz / napięte / luka krytyczna — wg relacji luka ↔ poduszka,
 *   • KONKRETNE RUCHY domknięcia luki, dobierane WYŁĄCZNIE z danych kontraktu:
 *      – zabezpieczenie gwarancją bankową/ubezpieczeniową zamiast gotówki (gdy wnoszone kasą),
 *      – wniosek o zaliczkę (gdy umowa ją przewiduje),
 *      – pytanie do zamawiającego o płatności częściowe (gdy jedna faktura końcowa),
 *      – faktoring wierzytelności z kontraktu publicznego (gdy jest realna wierzytelność),
 *   • jednozdaniowy KOMUNIKAT „ten kontrakt wymaga ok. X zł finansowania pomostowego przez
 *     Y mies.; twoja poduszka to Z zł" — wprost do ekranu decyzji obok szansy na wygraną.
 *
 * Świadome decyzje (spójnie z krokami 1–2/6):
 *  • CZYSTA, DETERMINISTYCZNA logika: bez UI, bez I/O, bez sieci, bez DB, bez Date.now.
 *    Ta sama funkcja daje ten sam wynik dla tego samego wejścia (łatwo testowalna).
 *  • PESYMIZM dla płynności: brak/niewiadoma poduszka → 0 (nie zawyżać zdolności udźwignięcia).
 *  • Ruchy proponujemy tylko, gdy REALNIE jest co domykać (luka > 0) i gdy dane kontraktu je
 *    uzasadniają (nie proponujemy gwarancji, gdy już dopuszczono; nie proponujemy pytania
 *    o częściowe, gdy płatności już są częściowe). Najskuteczniejsze (uwalniające gotówkę) —
 *    najpierw; faktoring (finansowanie zewnętrzne) — na końcu jako koło ratunkowe.
 *
 * Moduł samowystarczalny (ZERO importów) — świadomie nie dopina się do współdzielonych plików,
 * które w drzewie roboczym mają cudzy WIP. Wynik symulacji i model przyjmujemy jako argument.
 */

/** Poduszka pokrywa całą lukę (pokrycie ≥ 1) → firma udźwignie kontrakt z własnej gotówki. */
export const PROG_UDZWIGNIESZ = 1;

/** Poduszka pokrywa co najmniej połowę luki → napięte, ale do domknięcia ruchami. */
export const PROG_NAPIETE = 0.5;

// ─────────────────────────── pomocnicze: liczby i tekst ──────────────────────

/** Skończona liczba ≥ 0 albo 0 (null/undefined/NaN/ujemne → 0 — pesymistycznie). */
function nieujemna(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Polski zapis kwoty w złotych z grupowaniem tysięcy: 180000 → „180 000 zł". */
function formatujZl(n) {
  const zaokr = Math.round(nieujemna(n));
  const grupy = String(zaokr).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grupy} zł`;
}

// ─────────────────────────── dobór konkretnych ruchów ────────────────────────

/**
 * Buduje listę ruchów domknięcia luki zależną od modelu finansowego kontraktu.
 * Kolejność = malejąca skuteczność: najpierw ruchy uwalniające własną gotówkę,
 * na końcu faktoring (finansowanie zewnętrzne, koszt odsetek/prowizji).
 */
function dobierzRuchy(parametry) {
  const p = parametry || {};
  const cena = nieujemna(p.cenaBrutto);
  const zabProc = nieujemna(p.zabezpieczenieProcent);
  const zaliczkaProc = nieujemna(p.zaliczkaProcent);
  const ruchy = [];

  // Zabezpieczenie wnoszone gotówką (nie dopuszczono wprost gwarancji) — zamień na gwarancję.
  if (p.zabezpieczenieForma !== 'dowolna' && zabProc > 0) {
    const kwota = cena > 0 ? Math.round((cena * zabProc) / 100) : null;
    ruchy.push(
      Object.freeze({
        typ: 'zabezpieczenie_gwarancja',
        tytul: 'Zabezpieczenie gwarancją zamiast gotówki',
        opis:
          `Wnieś zabezpieczenie należytego wykonania (${zabProc}% ceny) gwarancją bankową lub ` +
          `ubezpieczeniową zamiast gotówki` +
          (kwota != null ? ` — nie zamrażasz ok. ${formatujZl(kwota)} własnych środków.` : '.'),
        oszczednoscKwota: kwota,
      }),
    );
  }

  // Umowa przewiduje zaliczkę — złóż wniosek, żeby dostać środki przed pierwszą fakturą.
  if (zaliczkaProc > 0) {
    const kwota = cena > 0 ? Math.round((cena * zaliczkaProc) / 100) : null;
    ruchy.push(
      Object.freeze({
        typ: 'wniosek_zaliczka',
        tytul: 'Wniosek o zaliczkę',
        opis:
          `Umowa przewiduje zaliczkę ${zaliczkaProc}% — złóż wniosek o jej wypłatę` +
          (kwota != null ? `, żeby dostać ok. ${formatujZl(kwota)} przed pierwszą fakturą.` : '.'),
        oszczednoscKwota: kwota,
      }),
    );
  }

  // Jedna faktura końcowa — spytaj zamawiającego o płatności częściowe PRZED terminem ofert.
  if (p.harmonogramPlatnosci === 'jedna_faktura') {
    ruchy.push(
      Object.freeze({
        typ: 'platnosci_czesciowe',
        tytul: 'Pytanie o płatności częściowe',
        opis:
          'Przed terminem składania ofert zapytaj zamawiającego o możliwość faktur/płatności ' +
          'częściowych — skróci to pomost i obniży szczyt zapotrzebowania na gotówkę.',
        oszczednoscKwota: null,
      }),
    );
  }

  // Realna wierzytelność (znana cena) — faktoring wierzytelności z kontraktu publicznego.
  if (cena > 0) {
    ruchy.push(
      Object.freeze({
        typ: 'faktoring',
        tytul: 'Faktoring wierzytelności z kontraktu publicznego',
        opis:
          'Sfinansuj lukę faktoringiem wierzytelności z kontraktu publicznego — faktor wypłaci ' +
          'należność z faktury, nie czekając na termin zapłaty zamawiającego.',
        oszczednoscKwota: null,
      }),
    );
  }

  return ruchy;
}

// ─────────────────────────── funkcja publiczna ───────────────────────────────

/**
 * Zamienia wynik symulacji + poduszkę gotówki + model finansowy w decyzję „startować czy nie":
 * status, listę konkretnych ruchów domknięcia luki i jednozdaniowy komunikat wsadowy.
 *
 * @param {object} wejscie
 * @param {number} wejscie.lukaFinansowania szczyt zapotrzebowania na finansowanie pomostowe (zł).
 * @param {number} wejscie.miesiecyPomostowych liczba miesięcy z saldem poniżej zera.
 * @param {number} [wejscie.poduszkaGotowki] własna gotówka firmy dostępna na pomost (null → 0).
 * @param {object} [wejscie.parametry] model finansowy z `wyciagnijParametryFinansowe` (krok 1/6).
 * @returns {Readonly<{
 *   status:'udzwigniesz'|'napiete'|'luka_krytyczna',
 *   lukaFinansowania:number, miesiecyPomostowych:number, poduszkaGotowki:number,
 *   brakujeKwota:number, pokrycieProcent:number,
 *   ruchy: ReadonlyArray<Readonly<{typ:string, tytul:string, opis:string, oszczednoscKwota:number|null}>>,
 *   komunikat:string}>} ZAMROŻONA migawka rekomendacji.
 */
export function rekomendujFinansowanie(wejscie = {}) {
  const luka = nieujemna(wejscie.lukaFinansowania);
  const miesiecy = Math.max(0, Math.floor(nieujemna(wejscie.miesiecyPomostowych)));
  const poduszka = nieujemna(wejscie.poduszkaGotowki);

  // Pokrycie luki poduszką (0 gdy brak luki → uznajemy za w pełni pokryte).
  const pokrycie = luka > 0 ? poduszka / luka : Infinity;
  const status =
    pokrycie >= PROG_UDZWIGNIESZ ? 'udzwigniesz' : pokrycie >= PROG_NAPIETE ? 'napiete' : 'luka_krytyczna';

  const brakujeKwota = Math.max(0, luka - poduszka);
  const pokrycieProcent = luka > 0 ? Math.round((poduszka / luka) * 100) : 100;

  // Ruchy proponujemy tylko, gdy jest co domykać.
  const ruchy = luka > 0 ? dobierzRuchy(wejscie.parametry) : [];

  const komunikat =
    luka > 0
      ? `Ten kontrakt wymaga ok. ${formatujZl(luka)} finansowania pomostowego przez ${miesiecy} mies.; ` +
        `twoja poduszka to ${formatujZl(poduszka)}.`
      : `Ten kontrakt nie wymaga finansowania pomostowego; twoja poduszka to ${formatujZl(poduszka)}.`;

  return Object.freeze({
    status,
    lukaFinansowania: luka,
    miesiecyPomostowych: miesiecy,
    poduszkaGotowki: poduszka,
    brakujeKwota,
    pokrycieProcent,
    ruchy: Object.freeze(ruchy),
    komunikat,
  });
}
