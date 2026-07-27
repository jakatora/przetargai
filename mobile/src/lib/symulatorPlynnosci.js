/**
 * SYMULATOR PŁYNNOŚCI „CZY UDŹWIGNIESZ KONTRAKT" — czysta logika PREZENTACJI panelu
 * (ulepszenie „Symulator płynności: czy udźwigniesz ten kontrakt", podzadanie 5/6).
 * Bez importów z React Native ani sieci — testowalna zwykłym `node:test`.
 *
 * Ekran decyzji „startować czy nie" (krok 6/6) tylko RENDERUJE to, co tu policzone z
 * odpowiedzi backendu `rekomendujFinansowanie` (services/rekomendacjePlynnosci.js):
 *   • formatujZl / formatujMiesiace — kwota luki i długość pomostu w ludzkim zapisie PL,
 *   • opisStatusu(status) — etykieta + semantyczny `ton` koloru dla trzech statusów decyzji,
 *   • uporzadkujRuchy(ruchy) — porządkuje konkretne ruchy domknięcia luki i dokleja etykietę
 *     uwolnionej gotówki,
 *   • podsumowanieRekomendacji(rekomendacje) — jeden ZAMROŻONY obiekt gotowy dla ekranu.
 *
 * Świadome decyzje (spójnie z lib/czarnaSkrzynka.js i backendem rekomendacjePlynnosci.js):
 *  • `ton` to KLASA koloru, nie hex — ekran mapuje ją na tokeny motyw.js ('sukces'→sukces*,
 *    'ostrzezenie'→ostrzezenie*, 'danger'→danger*, 'neutral'→textMuted/neutralneTlo), więc
 *    paleta (jasny/ciemny, kontrast AA) zostaje w jednym miejscu, a ta lib jest bez kolorów.
 *  • Statusy udzwigniesz/napiete/luka_krytyczna są TE SAME co w backendzie — to ta sama
 *    decyzja „startować czy nie", nie druga skala.
 *  • PESYMISTYCZNIE dla płynności: null/NaN/ujemne kwoty formatujemy jako „0 zł", żeby braki
 *    nie udawały gotówki ani nie wywracały ekranu.
 *  • Formatowanie liczb spójne z backendem (services/rekomendacjePlynnosci.js `formatujZl`):
 *    zaokrąglenie do pełnych złotych, spacja jako separator tysięcy.
 */

/** Trzy statusy decyzji zwracane przez backend — w kolejności rosnącego ryzyka płynności. */
export const STATUSY = Object.freeze(['udzwigniesz', 'napiete', 'luka_krytyczna']);

// ─────────────────────────── pomocnicze: liczby ──────────────────────────────

/** Skończona liczba albo 0 (null/undefined/NaN → 0). */
function liczba(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Skończona liczba > 0 albo 0 (dla kwot „uwolnionej gotówki" — brak/≤0 traktujemy jak brak). */
function liczbaDodatnia(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ─────────────────────────── formatowanie kwot i czasu ───────────────────────

/**
 * Polski zapis kwoty w złotych z grupowaniem tysięcy: 180000 → „180 000 zł".
 * Zaokrągla do pełnych złotych; null/NaN/ujemne → „0 zł" (pesymistycznie).
 * @param {number} v kwota w złotych.
 */
export function formatujZl(v) {
  const zaokr = Math.round(Math.max(0, liczba(v)));
  const grupy = String(zaokr).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grupy} zł`;
}

/** Polska odmiana rzeczownika „miesiąc" dla liczby n (miesiąc / miesiące / miesięcy). */
function odmianaMiesiace(n) {
  if (n === 1) return 'miesiąc';
  const ost = n % 10;
  const ost2 = n % 100;
  if (ost >= 2 && ost <= 4 && !(ost2 >= 12 && ost2 <= 14)) return 'miesiące';
  return 'miesięcy';
}

/**
 * Liczba miesięcy pomostowych z poprawną polską odmianą: 1 → „1 miesiąc", 4 → „4 miesiące",
 * 5 → „5 miesięcy". Zaokrągla w dół do pełnych miesięcy; null/ujemne → „0 miesięcy".
 * @param {number} v liczba miesięcy.
 */
export function formatujMiesiace(v) {
  const n = Math.max(0, Math.round(liczba(v)));
  return `${n} ${odmianaMiesiace(n)}`;
}

// ─────────────────────────── status decyzji → etykieta + ton ─────────────────

/*
 * Status z backendu → etykieta + semantyczny `ton` koloru + jednozdaniowy opis. Ton to
 * KLASA koloru; token (jasny/ciemny, kontrast AA) dokłada ekran z motyw.js:
 *   sukces → sukcesAkcent/sukcesTlo, ostrzezenie → ostrzezenie*, danger → danger/dangerTlo.
 */
const STATUS_META = Object.freeze({
  udzwigniesz: Object.freeze({
    status: 'udzwigniesz',
    etykieta: 'Udźwigniesz',
    ton: 'sukces',
    opis: 'Twoja poduszka pokrywa całą lukę — kontrakt udźwigniesz z własnej gotówki.',
  }),
  napiete: Object.freeze({
    status: 'napiete',
    etykieta: 'Napięte',
    ton: 'ostrzezenie',
    opis: 'Poduszka pokrywa część luki — resztę domknij konkretnymi ruchami poniżej.',
  }),
  luka_krytyczna: Object.freeze({
    status: 'luka_krytyczna',
    etykieta: 'Luka krytyczna',
    ton: 'danger',
    opis: 'Poduszka nie starcza na pomost — bez finansowania zewnętrznego kontrakt jest ryzykowny.',
  }),
});

const STATUS_DOMYSLNY = Object.freeze({
  status: 'nieznany',
  etykieta: 'Brak oceny',
  ton: 'neutral',
  opis: 'Uzupełnij dane kontraktu (koszty, poduszka gotówki), aby ocenić płynność.',
});

/**
 * Etykieta + ton + opis statusu decyzji. Nieznany/pusty status → neutralny opis domyślny,
 * żeby ekran nigdy nie został bez etykiety.
 * @param {string} status 'udzwigniesz' | 'napiete' | 'luka_krytyczna'
 */
export function opisStatusu(status) {
  return STATUS_META[status] ?? STATUS_DOMYSLNY;
}

// ─────────────────────────── uporządkowanie ruchów ───────────────────────────

/**
 * Priorytet ruchu, gdy NIE niesie policzalnej oszczędności — malejąca skuteczność:
 * pytanie o częściowe płatności skraca pomost, faktoring (koszt odsetek) jest kołem
 * ratunkowym na końcu. Spójne z kolejnością doboru w backendzie (dobierzRuchy).
 */
const PRIORYTET_RUCHU = Object.freeze({
  zabezpieczenie_gwarancja: 1,
  wniosek_zaliczka: 2,
  platnosci_czesciowe: 3,
  faktoring: 4,
});
const PRIORYTET_DOMYSLNY = 50;

/**
 * Porządkuje ruchy domknięcia luki DLA EKRANU i dokleja etykietę uwolnionej gotówki.
 * Reguła: najpierw ruchy z policzalną oszczędnością (największa kwota wyżej — bo najmocniej
 * zbijają lukę), potem pozostałe wg priorytetu typu (faktoring zawsze ostatni). Kolejność
 * jest deterministyczna (indeks wejścia rozstrzyga remisy), więc lista nie „skacze".
 * Nie mutuje wejścia; zwraca ZAMROŻONĄ listę zamrożonych ruchów.
 *
 * @param {ReadonlyArray<{typ?:string, tytul?:string, opis?:string, oszczednoscKwota?:number|null}>} ruchy
 * @returns {ReadonlyArray<Readonly<{typ, tytul, opis, oszczednoscKwota:number|null, oszczednoscLabel:string|null}>>}
 */
export function uporzadkujRuchy(ruchy) {
  const lista = Array.isArray(ruchy) ? ruchy : [];
  const wzbogacone = lista.map((r, idx) => {
    const kwota = liczbaDodatnia(r?.oszczednoscKwota);
    return { ruch: r ?? {}, idx, kwota, priorytet: PRIORYTET_RUCHU[r?.typ] ?? PRIORYTET_DOMYSLNY };
  });

  wzbogacone.sort((a, b) => {
    const aMaKwote = a.kwota > 0 ? 0 : 1;
    const bMaKwote = b.kwota > 0 ? 0 : 1;
    if (aMaKwote !== bMaKwote) return aMaKwote - bMaKwote; // ruchy uwalniające gotówkę na górze
    if (aMaKwote === 0 && a.kwota !== b.kwota) return b.kwota - a.kwota; // większa oszczędność wyżej
    if (a.priorytet !== b.priorytet) return a.priorytet - b.priorytet; // reszta wg priorytetu typu
    return a.idx - b.idx; // stabilny remis wg kolejności wejścia
  });

  return Object.freeze(
    wzbogacone.map((w) =>
      Object.freeze({
        ...w.ruch,
        oszczednoscKwota: w.ruch.oszczednoscKwota ?? null,
        oszczednoscLabel: w.kwota > 0 ? formatujZl(w.kwota) : null,
      }),
    ),
  );
}

// ─────────────────────────── agregat dla ekranu ──────────────────────────────

/**
 * Zamienia odpowiedź backendu `rekomendujFinansowanie` w JEDEN, ZAMROŻONY obiekt gotowy do
 * wyświetlenia: status→ton+etykieta, sformatowane kwoty (luka/poduszka/brakuje/pokrycie),
 * długość pomostu i uporządkowane ruchy. Odporny na braki — puste wejście daje neutralny,
 * kompletny obiekt (ekran się nie wywraca).
 *
 * @param {object} rekomendacje wynik services/rekomendacjePlynnosci.rekomendujFinansowanie:
 *   {status, lukaFinansowania, miesiecyPomostowych, poduszkaGotowki, brakujeKwota,
 *    pokrycieProcent, ruchy, komunikat}.
 * @returns {Readonly<{status, ton, etykietaStatusu, opisStatusu, lukaLabel, poduszkaLabel,
 *   brakujeLabel, pokrycieLabel, miesiaceLabel, wymagaFinansowania, komunikat, ruchy}>}
 */
export function podsumowanieRekomendacji(rekomendacje) {
  const r = rekomendacje || {};
  const meta = opisStatusu(r.status);
  const luka = liczba(r.lukaFinansowania);

  return Object.freeze({
    status: typeof r.status === 'string' && r.status ? r.status : meta.status,
    ton: meta.ton,
    etykietaStatusu: meta.etykieta,
    opisStatusu: meta.opis,
    lukaLabel: formatujZl(r.lukaFinansowania),
    poduszkaLabel: formatujZl(r.poduszkaGotowki),
    brakujeLabel: formatujZl(r.brakujeKwota),
    pokrycieLabel: `${Math.max(0, Math.round(liczba(r.pokrycieProcent)))}%`,
    miesiaceLabel: formatujMiesiace(r.miesiecyPomostowych),
    wymagaFinansowania: luka > 0,
    komunikat: typeof r.komunikat === 'string' ? r.komunikat : '',
    ruchy: uporzadkujRuchy(r.ruchy),
  });
}
