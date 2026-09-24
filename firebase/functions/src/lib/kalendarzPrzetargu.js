/*
 * KALENDARZ PRZETARGU (etap 5, P1-7) — CZYSTA logika.
 *
 * Zapisany przetarg to nie jedna data, tylko trzy, a wykonawca przegapia zwykle
 * pierwszą i ostatnią:
 *
 *  • PYTANIA — po pewnym dniu zamawiający NIE MA obowiązku odpowiedzieć. Kto
 *    zorientuje się w przeddzień składania, że SWZ jest niejasna, nie ma już czym
 *    tego naprawić.
 *  • OFERTY — jedyna data, której NIE liczymy: podaje ją rejestr.
 *  • ZWIĄZANIE OFERTĄ — po jego upływie oferta podlega odrzuceniu (art. 226 ust. 1
 *    pkt 4), a wadium musi pokrywać cały ten okres.
 *
 * NAJWAŻNIEJSZE ROZSTRZYGNIĘCIE TEGO PLIKU: skąd wiemy, które terminy ustawowe
 * stosować. Zależą od tego, czy postępowanie jest powyżej progów unijnych — a tej
 * wartości rejestry podają szczątkowo (BZP rzadko, BK w ~20% przypadków). Zgadywanie
 * z `budget` dawałoby błędny termin tam, gdzie kwoty brakuje, czyli w większości
 * ogłoszeń. Bierzemy więc sygnał, który jest PEWNY: postępowania od progów unijnych
 * publikuje się w Dzienniku Urzędowym UE (TED), a poniżej — w BZP. Rejestr jest
 * znany dla każdego ogłoszenia bez wyjątku.
 *
 * Baza Konkurencyjności NIE podlega Pzp (zasada konkurencyjności dla beneficjentów
 * funduszy UE), więc nie ma tam ustawowych terminów pytań ani związania. Mówimy to
 * wprost zamiast podstawiać przepis, który nie obowiązuje.
 *
 * Zero I/O, zero `Date.now()` — „teraz" jest argumentem.
 */

export const STREFA = 'Europe/Warsaw';

const DZIEN_MS = 86_400_000;

/** Rodzaje terminów w stałej kolejności chronologicznej. */
export const RODZAJE_TERMINOW = [
  {
    kod: 'pytania',
    etykieta: { pl: 'Pytania do SWZ', en: 'Questions about the tender documents' },
    opis: {
      pl: 'Ostatni dzień, w którym wniosek o wyjaśnienie treści SWZ gwarantuje odpowiedź zamawiającego.',
      en: 'The last day a request to clarify the tender documents still guarantees an answer from the buyer.',
    },
  },
  {
    kod: 'oferty',
    etykieta: { pl: 'Składanie ofert', en: 'Bid submission' },
    opis: {
      pl: 'Termin złożenia oferty podany przez zamawiającego w ogłoszeniu.',
      en: 'The submission deadline stated by the buyer in the notice.',
    },
  },
  {
    kod: 'zwiazanie',
    etykieta: { pl: 'Koniec związania ofertą', en: 'End of bid validity' },
    opis: {
      pl: 'Do tego dnia oferta wiąże wykonawcę, a wadium musi ją zabezpieczać.',
      en: 'Until this day the bid binds the contractor and the bid bond must cover it.',
    },
  },
];

/**
 * Reguły ustawowe wyprowadzone z REJESTRU (uzasadnienie w nagłówku pliku).
 *
 *  • BZP  — poniżej progów unijnych: wniosek o wyjaśnienie SWZ nie później niż na
 *    4 dni przed terminem składania (art. 284 ust. 2 Pzp), związanie do 30 dni
 *    (art. 220 ust. 1 pkt 1).
 *  • TED  — od progów unijnych: wniosek nie później niż na 14 dni przed terminem
 *    (art. 135 ust. 2 Pzp), związanie do 90 dni (art. 220 ust. 1 pkt 2).
 *
 * Obie liczby to MAKSIMA ustawowe: ogłoszenie może podać termin krótszy i wtedy
 * obowiązuje ogłoszenie. Dlatego pozycje wyliczone są jawnie oznaczone.
 */
const REGULY = {
  bzp: {
    dniPytania: 4,
    dniZwiazania: 30,
    podstawaPytania: { pl: 'art. 284 ust. 2 Pzp', en: 'Art. 284(2) of the Polish PPL' },
    podstawaZwiazania: { pl: 'art. 220 ust. 1 pkt 1 Pzp', en: 'Art. 220(1)(1) of the Polish PPL' },
    uwaga: null,
  },
  ted: {
    dniPytania: 14,
    dniZwiazania: 90,
    podstawaPytania: { pl: 'art. 135 ust. 2 Pzp', en: 'Art. 135(2) of the Polish PPL' },
    podstawaZwiazania: { pl: 'art. 220 ust. 1 pkt 2 Pzp', en: 'Art. 220(1)(2) of the Polish PPL' },
    uwaga: null,
  },
};

const BEZ_REGULY = {
  dniPytania: null,
  dniZwiazania: null,
  podstawaPytania: null,
  podstawaZwiazania: null,
  uwaga: {
    pl: 'To postępowanie nie jest prowadzone na podstawie Prawa zamówień publicznych, więc nie ma dla niego ustawowego terminu pytań ani związania ofertą. Obowiązuje wyłącznie to, co napisano w ogłoszeniu.',
    en: 'This procurement is not run under the Polish Public Procurement Law, so no statutory question or bid-validity deadline applies. Only what the notice itself states is binding.',
  },
};

/** @returns reguły ustawowe dla rejestru; nieznany rejestr NIE dostaje zmyślonej reguły */
export function reguluZrodla(source) {
  return REGULY[source] ?? BEZ_REGULY;
}

const FORMAT_DATY = new Intl.DateTimeFormat('pl-PL', {
  timeZone: STREFA, day: 'numeric', month: 'long', year: 'numeric',
});
const FORMAT_CZESCI = new Intl.DateTimeFormat('en-CA', {
  timeZone: STREFA, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

/**
 * Znacznik UTC → data i godzina w strefie, w której realnie upływa termin.
 *
 * Terminy w polskich postępowaniach są podane czasem lokalnym („do 10:00"), a baza
 * trzyma je w UTC. Pokazanie UTC przesunęłoby godzinę o 1–2 h — akurat tyle, żeby
 * wykonawca uznał, że ma jeszcze czas.
 */
export function wCzasieWarszawskim(iso) {
  const czas = Date.parse(iso ?? '');
  if (!Number.isFinite(czas)) return { data: null, godzina: null, etykieta: null };

  const d = new Date(czas);
  const czesci = Object.fromEntries(FORMAT_CZESCI.formatToParts(d).map((p) => [p.type, p.value]));
  const godzina = `${czesci.hour}:${czesci.minute}`;

  return {
    data: `${czesci.year}-${czesci.month}-${czesci.day}`,
    godzina,
    etykieta: `${FORMAT_DATY.format(d)}, ${godzina}`,
  };
}

function przesun(iso, dni) {
  const czas = Date.parse(iso ?? '');
  if (!Number.isFinite(czas) || dni === null || dni === undefined) return null;
  return new Date(czas + dni * DZIEN_MS).toISOString();
}

function pozycja({ kod, at, zrodloDaty, podstawa, brak, teraz }) {
  const rodzaj = RODZAJE_TERMINOW.find((r) => r.kod === kod);
  const czas = Date.parse(at ?? '');
  const znany = Number.isFinite(czas);
  const terazMs = Date.parse(teraz ?? '');

  return {
    kod,
    etykieta: rodzaj.etykieta,
    opis: rodzaj.opis,
    at: znany ? new Date(czas).toISOString() : null,
    znany,
    // „Wyliczony" vs „z ogłoszenia" to nie kosmetyka: wyliczony jest maksimum
    // ustawowym, a ogłoszenie może podać termin krótszy.
    zrodloDaty: znany ? zrodloDaty : null,
    podstawa: znany ? podstawa : null,
    lokalnie: wCzasieWarszawskim(znany ? new Date(czas).toISOString() : null),
    minal: znany && Number.isFinite(terazMs) ? czas <= terazMs : false,
    // PEŁNE doby, celowo w dół: „zostały 2 dni" przy 2 dniach i 8 godzinach jest
    // uczciwe, a „3 dni" dawałoby wykonawcy dobę, której nie ma.
    dniDo: znany && Number.isFinite(terazMs) ? Math.floor((czas - terazMs) / DZIEN_MS) : null,
    brak: znany ? null : brak,
  };
}

const BRAK_TERMINU = {
  pl: 'Rejestr nie podał terminu składania ofert dla tego ogłoszenia, więc nie da się wyliczyć pozostałych dat. Sprawdź termin bezpośrednio w ogłoszeniu.',
  en: 'The register did not state a submission deadline for this notice, so the remaining dates cannot be derived. Check the deadline in the notice itself.',
};

/**
 * Trzy daty jednego przetargu + wskazanie następnego kroku.
 *
 * @param {object} tender dokument przetargu (potrzebne: id, source, title, deadline, anulowany)
 * @param {{teraz: string}} opcje „teraz" jako ISO — wstrzykiwane, żeby wynik był deterministyczny
 */
export function zbudujKalendarz(tender, { teraz } = {}) {
  const source = tender?.source ?? 'bzp';
  const regula = reguluZrodla(source);
  const deadline = tender?.deadline ?? null;
  const maTermin = Number.isFinite(Date.parse(deadline ?? ''));

  const brakUstawowy = regula.uwaga ?? BRAK_TERMINU;

  const pozycje = [
    pozycja({
      kod: 'pytania',
      at: regula.dniPytania === null ? null : przesun(deadline, -regula.dniPytania),
      zrodloDaty: 'wyliczony',
      podstawa: regula.podstawaPytania,
      brak: maTermin ? brakUstawowy : BRAK_TERMINU,
      teraz,
    }),
    pozycja({
      kod: 'oferty',
      at: deadline,
      zrodloDaty: 'ogloszenie',
      podstawa: null,
      brak: BRAK_TERMINU,
      teraz,
    }),
    pozycja({
      kod: 'zwiazanie',
      at: regula.dniZwiazania === null ? null : przesun(deadline, regula.dniZwiazania),
      zrodloDaty: 'wyliczony',
      podstawa: regula.podstawaZwiazania,
      brak: maTermin ? brakUstawowy : BRAK_TERMINU,
      teraz,
    }),
  ];

  const anulowany = tender?.anulowany === true;

  return {
    tenderId: tender?.id ?? null,
    tytul: tender?.title ?? null,
    zrodlo: source,
    anulowany,
    pozycje,
    // Anulowane postępowanie nie ma następnego kroku — jedyną czynnością jest
    // wykreślenie go z planu, a nie przygotowanie czegokolwiek na termin.
    nastepny: anulowany ? null : nastepnyKrok(pozycje, teraz),
    brakTerminu: maTermin ? null : BRAK_TERMINU,
    uwaga_zrodla: regula.uwaga,
  };
}

/**
 * Najbliższa PRZYSZŁA pozycja — po niej nazywa się karta „następny krok" na ekranie.
 * @returns {{kod: string, at: string, dniDo: number}|null}
 */
export function nastepnyKrok(pozycje, teraz) {
  const terazMs = Date.parse(teraz ?? '');
  if (!Number.isFinite(terazMs)) return null;

  const przyszle = (pozycje ?? [])
    .filter((p) => p?.znany && Date.parse(p.at) > terazMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (!przyszle.length) return null;
  const p = przyszle[0];
  return { ...p, dniDo: Math.floor((Date.parse(p.at) - terazMs) / DZIEN_MS) };
}

/* ============================ eksport ICS ============================ */

/** RFC 5545: przecinek, średnik, odwrotny ukośnik i nowa linia muszą być poprzedzone ukośnikiem. */
function escIcs(tekst) {
  return String(tekst ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');
}

function znacznikIcs(iso) {
  return new Date(Date.parse(iso)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Kalendarze przetargów → jeden plik ICS.
 *
 * DLACZEGO UID JEST STABILNY: powtórny import tego samego pliku ma AKTUALIZOWAĆ
 * zdarzenie, a nie dokładać jego kopię. UID zbudowany z identyfikatora przetargu
 * i kodu terminu spełnia to bez żadnego stanu po naszej stronie.
 *
 * Zdarzenia są chwilowe (DTSTART = DTEND), bo termin to moment, nie przedział.
 * VALARM daje przypomnienie 24 h wcześniej — po to człowiek wrzuca terminy do
 * swojego kalendarza.
 */
export function doIcs(kalendarze, { teraz, domena = 'przetargai.pl' } = {}) {
  const linie = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PrzetargAI//Kalendarz terminow//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escIcs('PrzetargAI — terminy')}`,
    `X-WR-TIMEZONE:${STREFA}`,
  ];

  const stempel = Number.isFinite(Date.parse(teraz ?? '')) ? znacznikIcs(teraz) : znacznikIcs(new Date(0).toISOString());

  for (const k of kalendarze ?? []) {
    for (const p of k?.pozycje ?? []) {
      if (!p.znany) continue;
      const tytul = `${p.etykieta.pl}: ${k.tytul ?? 'przetarg'}`;
      linie.push(
        'BEGIN:VEVENT',
        `UID:${k.tenderId}-${p.kod}@${domena}`,
        `DTSTAMP:${stempel}`,
        `DTSTART:${znacznikIcs(p.at)}`,
        `DTEND:${znacznikIcs(p.at)}`,
        `SUMMARY:${escIcs(tytul)}`,
        `DESCRIPTION:${escIcs(p.opis.pl)}`,
        'BEGIN:VALARM',
        'TRIGGER:-PT24H',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escIcs(tytul)}`,
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }

  linie.push('END:VCALENDAR');
  // Zakończenie KAŻDEJ linii przez CRLF jest wymagane przez RFC 5545 — część
  // klientów kalendarza odrzuca plik z samym LF bez żadnego komunikatu.
  return `${linie.join('\r\n')}\r\n`;
}
