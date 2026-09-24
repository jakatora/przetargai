import { createHash } from 'node:crypto';
import { normalize } from './textNorm.js';
import { parseCpvCodes } from './cpv.js';
import { kodWojewodztwa } from './wojewodztwa.js';

/*
 * Katalog „Wszystkie przetargi" (P1-1) — CZYSTA logika filtrowania i stronicowania.
 *
 * Dlaczego osobno od dopasowań: feed „Dla mnie" pokazuje to, co silnik uznał za
 * pasujące do profilu, i jest z definicji przycięty (limit dzienny planu Free,
 * pula, próg dopasowania). Tryb „Wszystkie" ma pokazywać RYNEK — więc nie wolno
 * mu przejść przez ani jeden z tych filtrów. To jest tu jedyna nienegocjowalna
 * własność: żadna funkcja w tym pliku nie dotyka profilu ani dopasowań.
 *
 * Podział pracy między Firestore a pamięcią jest świadomy:
 *
 *  • Firestore dostaje tylko to, co potrafi zrobić TANIO i BEZ eksplozji indeksów:
 *    równość na `source` oraz zakres na polu, po którym i tak sortujemy.
 *  • Reszta (region, CPV, tekst, kwota, daty) liczy się w pamięci na pobranej
 *    stronie. Powód nie jest wygodą: `wojewodztwo` trzymamy w formacie, jaki dał
 *    rejestr — „PL12" z BZP i „małopolskie" z BK — więc równość na tym polu
 *    CHOWAŁABY całe źródło. CPV to sklejony łańcuch wielu kodów, a Firestore nie
 *    ma wyszukiwania pełnotekstowego ani filtra po prefiksie.
 *
 * Skanowanie w pamięci NIE gubi rekordów: kursor wskazuje pozycję w porządku
 * Firestore (wartość pola sortowania + identyfikator dokumentu), więc kolejna
 * strona rusza dokładnie tam, gdzie skończyła poprzednia — nawet gdy przebieg
 * przerwał sufit skanu.
 */

/** Rejestry, z których realnie pobieramy ogłoszenia. Kod = wartość pola `source`. */
export const ZRODLA = [
  {
    kod: 'bzp',
    etykieta: { pl: 'BZP', en: 'BZP' },
    nazwa: {
      pl: 'Biuletyn Zamówień Publicznych',
      en: 'Polish Public Procurement Bulletin (BZP)',
    },
    rejestr: 'https://ezamowienia.gov.pl',
    zakres: {
      pl: 'Krajowe postępowania powyżej progu ustawowego, publikowane przez zamawiających w BZP.',
      en: 'Domestic procurement above the statutory threshold, published by contracting authorities in BZP.',
    },
  },
  {
    kod: 'ted',
    etykieta: { pl: 'TED', en: 'TED' },
    nazwa: {
      pl: 'Tenders Electronic Daily (Dziennik Urzędowy UE)',
      en: 'Tenders Electronic Daily (EU Official Journal)',
    },
    rejestr: 'https://ted.europa.eu',
    zakres: {
      pl: 'Postępowania powyżej progów unijnych — polskie ogłoszenia z Dziennika Urzędowego UE.',
      en: 'Procurement above EU thresholds — Polish notices from the EU Official Journal.',
    },
  },
  {
    kod: 'baza_konkurencyjnosci',
    etykieta: { pl: 'Baza Konkurencyjności', en: 'Baza Konkurencyjności' },
    nazwa: {
      pl: 'Baza Konkurencyjności (projekty współfinansowane z UE)',
      en: 'Baza Konkurencyjności (EU-cofunded projects)',
    },
    rejestr: 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl',
    zakres: {
      pl: 'Zapytania ofertowe beneficjentów funduszy unijnych — także takie, których nie ma w BZP.',
      en: 'Requests for proposals from EU fund beneficiaries — including ones absent from BZP.',
    },
  },
];

const KODY_ZRODEL = new Set(ZRODLA.map((z) => z.kod));

/** Sortowania katalogu. Pole MUSI istnieć na każdym dokumencie, inaczej znika z listy. */
export const SORTOWANIA = {
  // `fetched_at` jest ustawiane przy każdym zapisie, więc nie gubi żadnego ogłoszenia.
  najnowsze: { pole: 'fetched_at', kierunek: 'desc' },
  // `deadline` bywa puste (TED, część BK) — patrz komentarz przy planZapytania.
  termin: { pole: 'deadline', kierunek: 'asc' },
};

export const SORT_DOMYSLNY = 'najnowsze';

/** Stan terminu składania ofert. Domyślnie chowamy zamknięte — nie da się w nich startować. */
export const STATUSY_TERMINU = ['aktywne', 'poterminie', 'wszystkie'];
export const STATUS_TERMINU_DOMYSLNY = 'aktywne';

export const LIMIT_DOMYSLNY = 20;
export const LIMIT_MAKS = 50;
export const MAKS_DLUGOSC_TEKSTU = 120;

/** Ile dokumentów pobieramy z Firestore w jednym kroku skanu. */
export const SKAN_STRONA = 300;
/**
 * Sufit dokumentów przeczytanych na JEDNO żądanie. To bezpiecznik kosztu odczytów,
 * nie granica wyników: po jego osiągnięciu oddajemy kursor i klient dociąga dalej.
 */
export const SKAN_MAKS = 1200;

/** Kursor niesie 3 krótkie pola — dłuższe wejście to na pewno nie nasz kursor. */
const MAKS_DLUGOSC_KURSORA = 512;

function liczbaLubNull(wartosc) {
  if (wartosc === null || wartosc === undefined || wartosc === '') return null;
  const n = Number(wartosc);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Data brzegowa filtra. „2026-09-01" znaczy CAŁĄ dobę, więc granica górna to jej
 * koniec — inaczej filtr „do 30 września" gubiłby wszystko opublikowane tego dnia.
 */
function granicaDaty(wartosc, koniecDoby) {
  if (!wartosc) return null;
  const tekst = String(wartosc).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(tekst)) {
    return koniecDoby ? `${tekst}T23:59:59.999Z` : `${tekst}T00:00:00.000Z`;
  }
  const czas = Date.parse(tekst);
  return Number.isFinite(czas) ? new Date(czas).toISOString() : null;
}

/**
 * Sprowadza parametry zapytania do zamrożonego, bezpiecznego zestawu filtrów.
 * Nierozpoznane wartości są ODRZUCANE (null), nie przepuszczane — filtr, którego
 * nie rozumiemy, nie może po cichu zawęzić rynku.
 */
export function normalizujFiltry(query = {}) {
  const q = query ?? {};
  const sort = Object.hasOwn(SORTOWANIA, q.sort) ? q.sort : SORT_DOMYSLNY;
  const termin = STATUSY_TERMINU.includes(q.termin) ? q.termin : STATUS_TERMINU_DOMYSLNY;

  const limitSurowy = Number(q.limit);
  const limit = Number.isFinite(limitSurowy)
    ? Math.min(Math.max(Math.trunc(limitSurowy), 1), LIMIT_MAKS)
    : LIMIT_DOMYSLNY;

  const cpv = q.cpv ? String(q.cpv).replace(/\D/g, '').slice(0, 8) : '';
  const tekst = q.q ? String(q.q).trim().slice(0, MAKS_DLUGOSC_TEKSTU) : '';

  return {
    zrodlo: KODY_ZRODEL.has(q.zrodlo) ? q.zrodlo : null,
    region: kodWojewodztwa(q.region),
    sort,
    termin,
    cpv: cpv || null,
    q: tekst || null,
    opublikowano_od: granicaDaty(q.opublikowano_od, false),
    opublikowano_do: granicaDaty(q.opublikowano_do, true),
    termin_od: granicaDaty(q.termin_od, false),
    termin_do: granicaDaty(q.termin_do, true),
    wartosc_min: liczbaLubNull(q.wartosc_min),
    wartosc_max: liczbaLubNull(q.wartosc_max),
    limit,
  };
}

/** Pola, które definiują ZESTAW wyników (bez limitu i kursora — te nie zmieniają zbioru). */
const POLA_ODCISKU = [
  'zrodlo', 'region', 'sort', 'termin', 'cpv', 'q',
  'opublikowano_od', 'opublikowano_do', 'termin_od', 'termin_do',
  'wartosc_min', 'wartosc_max',
];

/**
 * Odcisk zestawu filtrów. Wędruje w kursorze, żeby strona z JEDNEGO zestawu nie
 * dała się doczepić do innego — to jedyny sposób, w jaki kursor mógłby zwrócić
 * rekordy „z poprzedniego pytania" i wyglądać jak losowa dziura w wynikach.
 */
export function odciskFiltrow(filtry) {
  const klucz = JSON.stringify(POLA_ODCISKU.map((p) => filtry?.[p] ?? null));
  return createHash('sha256').update(klucz).digest('base64url').slice(0, 12);
}

export function kodujKursor({ wartosc, id, odcisk }) {
  return Buffer.from(JSON.stringify({ w: wartosc ?? null, i: id, o: odcisk })).toString('base64url');
}

/** @returns {{wartosc: *, id: string, odcisk: string}|null} null = to nie jest nasz kursor */
export function dekodujKursor(kursor) {
  if (typeof kursor !== 'string' || !kursor || kursor.length > MAKS_DLUGOSC_KURSORA) return null;
  try {
    const dane = JSON.parse(Buffer.from(kursor, 'base64url').toString('utf8'));
    if (!dane || typeof dane.i !== 'string' || typeof dane.o !== 'string') return null;
    return { wartosc: dane.w ?? null, id: dane.i, odcisk: dane.o };
  } catch {
    return null;
  }
}

/**
 * Data ogłoszenia. Rejestry bywają milczące co do publikacji (TED i BK często
 * nie podają jej wprost), a wtedy jedyną znaną datą jest ta, w której ogłoszenie
 * u nas wylądowało. Podmiana jest ujawniona w `opisFiltrow`, nie ukryta.
 */
function dataOgloszenia(t) {
  return t?.published_at ?? t?.fetched_at ?? null;
}

function pasujeTekst(t, fraza) {
  const siano = normalize(`${t?.title ?? ''} ${t?.organization ?? ''} ${t?.numer ?? ''}`);
  return normalize(fraza).split(' ').filter(Boolean).every((slowo) => siano.includes(slowo));
}

/**
 * Czy ogłoszenie przechodzi KOMPLET filtrów.
 *
 * Predykat celowo sprawdza także to, co spycha na Firestore `planZapytania` —
 * pushdown jest optymalizacją, a nie źródłem prawdy. Dzięki temu zmiana planu
 * zapytania nie może po cichu rozszczelnić filtrowania.
 */
export function pasujeDoFiltrow(tender, filtry, terazIso) {
  if (!tender) return false;
  // Anulowane postępowanie ma wciąż otwarty termin, ale już nie istnieje.
  if (tender.anulowany === true) return false;

  if (filtry.zrodlo && (tender.source ?? 'bzp') !== filtry.zrodlo) return false;
  if (filtry.region && kodWojewodztwa(tender.wojewodztwo) !== filtry.region) return false;

  const deadline = tender.deadline ?? null;
  if (filtry.termin === 'aktywne' && !(deadline && deadline >= terazIso)) return false;
  if (filtry.termin === 'poterminie' && !(deadline && deadline < terazIso)) return false;
  if (filtry.termin_od && !(deadline && deadline >= filtry.termin_od)) return false;
  if (filtry.termin_do && !(deadline && deadline <= filtry.termin_do)) return false;
  // Sortowanie po terminie nie ma gdzie postawić ogłoszenia bez terminu.
  if (filtry.sort === 'termin' && !deadline) return false;

  if (filtry.cpv) {
    const kody = parseCpvCodes(tender.cpv_main);
    if (!kody.some((kod) => kod.startsWith(filtry.cpv))) return false;
  }

  if (filtry.opublikowano_od || filtry.opublikowano_do) {
    const data = dataOgloszenia(tender);
    if (!data) return false;
    if (filtry.opublikowano_od && data < filtry.opublikowano_od) return false;
    if (filtry.opublikowano_do && data > filtry.opublikowano_do) return false;
  }

  if (filtry.wartosc_min !== null || filtry.wartosc_max !== null) {
    const kwota = typeof tender.budget === 'number' ? tender.budget : null;
    if (kwota === null) return false;
    if (filtry.wartosc_min !== null && kwota < filtry.wartosc_min) return false;
    if (filtry.wartosc_max !== null && kwota > filtry.wartosc_max) return false;
  }

  if (filtry.q && !pasujeTekst(tender, filtry.q)) return false;

  return true;
}

/**
 * Co idzie do Firestore, a co zostaje na pamięć.
 *
 * Zakres trafia do zapytania WYŁĄCZNIE wtedy, gdy dotyczy pola sortowania —
 * Firestore wymaga, by pierwsze `orderBy` było na polu nierówności, a zakres na
 * innym polu wymusiłby zmianę porządku wyników (czyli inny kursor niż obiecany).
 */
export function planZapytania(filtry, terazIso) {
  const sort = SORTOWANIA[filtry.sort] ?? SORTOWANIA[SORT_DOMYSLNY];
  const rowne = filtry.zrodlo ? [['source', filtry.zrodlo]] : [];
  const zakres = [];

  if (sort.pole === 'deadline') {
    if (filtry.termin === 'aktywne') zakres.push(['deadline', '>=', terazIso]);
    else if (filtry.termin === 'poterminie') zakres.push(['deadline', '<', terazIso]);
    if (filtry.termin_od) zakres.push(['deadline', '>=', filtry.termin_od]);
    if (filtry.termin_do) zakres.push(['deadline', '<=', filtry.termin_do]);
    /*
     * Bez dolnej granicy `orderBy('deadline')` zaczyna od wartości NULL (Firestore
     * sortuje null przed stringiem), więc pierwsza strona byłaby zbiorem ogłoszeń
     * BEZ terminu. Pusty string jest mniejszy od każdej daty ISO i większy od null.
     */
    if (!zakres.some(([, op]) => op === '>=' || op === '>')) zakres.push(['deadline', '>', '']);
  }

  return { rowne, zakres, sort };
}

/**
 * Indeksy złożone, bez których zapytanie katalogu rzuca FAILED_PRECONDITION na
 * produkcji. **Emulator Firestore ich NIE egzekwuje**, więc jedynym strażnikiem
 * jest test porównujący tę listę z firestore.indexes.json.
 *
 * `__name__` jest w kolejności tego samego kierunku co pole sortowania, bo tak
 * właśnie sortuje zapytanie (jawny `orderBy(documentId(), kierunek)` daje kursor
 * rozstrzygający remisy — bez niego dwa dokumenty z tym samym `fetched_at`
 * potrafiłyby się powtórzyć albo zniknąć między stronami).
 */
export function indeksyWymagane() {
  const kierunek = (k) => (k === 'desc' ? 'DESCENDING' : 'ASCENDING');
  return Object.values(SORTOWANIA).map((s) => ({
    collectionGroup: 'tenders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source', order: 'ASCENDING' },
      { fieldPath: s.pole, order: kierunek(s.kierunek) },
      { fieldPath: '__name__', order: kierunek(s.kierunek) },
    ],
  }));
}

/**
 * Opis filtrów do odpowiedzi API — razem z UCZCIWYMI zastrzeżeniami.
 *
 * Każde zawężenie, które usuwa ogłoszenia z powodu BRAKU danych (a nie z powodu
 * niezgodności), musi to powiedzieć wprost. Inaczej pusty wynik wygląda jak
 * „nie ma takich przetargów", choć znaczy „rejestr tego nie podaje".
 */
export function opisFiltrow(filtry) {
  return {
    zrodlo: filtry.zrodlo,
    region: filtry.region,
    sort: filtry.sort,
    termin: filtry.termin,
    cpv: filtry.cpv,
    q: filtry.q,
    opublikowano: {
      od: filtry.opublikowano_od,
      do: filtry.opublikowano_do,
      uwaga: {
        pl: 'Gdy rejestr nie podaje daty publikacji (częste w TED i Bazie Konkurencyjności), liczy się data pobrania ogłoszenia przez PrzetargAI.',
        en: 'When the register does not provide a publication date (common in TED and Baza Konkurencyjności), the date PrzetargAI fetched the notice is used instead.',
      },
    },
    wartosc: {
      min: filtry.wartosc_min,
      max: filtry.wartosc_max,
      uwaga: {
        pl: 'Widełki kwoty pomijają ogłoszenia bez podanej wartości zamówienia — BZP podaje ją rzadko, a Baza Konkurencyjności w ok. 80% przypadków zostawia puste pole.',
        en: 'The value range skips notices with no contract value — BZP rarely publishes it and Baza Konkurencyjności leaves it empty in about 80% of cases.',
      },
    },
    termin_zakres: { od: filtry.termin_od, do: filtry.termin_do },
    uwaga_sortowania: filtry.sort === 'termin'
      ? {
        pl: 'Sortowanie po terminie pomija ogłoszenia bez podanego terminu składania ofert. Aby je zobaczyć, wybierz sortowanie „Najnowsze".',
        en: 'Sorting by deadline omits notices with no stated deadline. Switch to “Newest” to see them.',
      }
      : null,
  };
}
