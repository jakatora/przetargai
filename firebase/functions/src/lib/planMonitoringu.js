import { createHash } from 'node:crypto';
import { pasujeDoFiltrow, normalizujFiltry } from './katalogPrzetargow.js';
import { TYPY_ISTOTNE, podsumujZmiany } from './zmianyOgloszenia.js';
import { MAKS_TRAFIEN_W_ALERCIE } from './zapisaneWyszukiwania.js';

/*
 * PLAN PRZEBIEGU MONITORINGU (etap 5) — CZYSTA logika.
 *
 * Harmonogram jako taki jest banalny: odczytaj, porównaj, wyślij. Trudne są decyzje,
 * których skutku nie widać w logach, bo objawiają się dopiero w telefonie użytkownika.
 * Wszystkie mieszkają tutaj, żeby dało się je przetestować bez bazy i bez wysyłki.
 *
 * Zero I/O, zero zegara — „teraz" jest argumentem.
 */

/**
 * Jak daleko wstecz wolno sięgnąć po historię zmian w jednym przebiegu.
 *
 * Wyszukiwanie porzucone na miesiąc (wyłączony alert, potem włączony) nie może
 * kazać przeczytać miesiąca zmian — to jeden odczyt o nieograniczonym koszcie.
 * Starsze zmiany są i tak dostępne w historii ogłoszenia na ekranie szczegółów.
 */
export const MAKS_DNI_WSTECZ = 7;

/**
 * Nowe ogłoszenia od ostatniego sprawdzenia.
 *
 * 🚨 PIERWSZY PRZEBIEG NIE POWIADAMIA. Filtr obejmujący dziesięć tysięcy otwartych
 * ogłoszeń wysłałby natychmiast powiadomienie „10 000 nowych przetargów" — po którym
 * użytkownik wyłącza push dla CAŁEJ aplikacji i traci także przypomnienia o terminach.
 * Zapisany wtedy kursor znaczy „od tej chwili obserwuję", i to jest jedyna uczciwa
 * interpretacja zapisania wyszukiwania.
 *
 * @param {{tenders: object[], kursor: {fetched_at: string}|null, teraz: string}} we
 * @returns {{pozycje: object[], nowyKursor: {fetched_at: string}, pierwszyPrzebieg: boolean}}
 */
export function noweTrafienia({ tenders = [], kursor = null, teraz }) {
  const odniesienie = kursor?.fetched_at ?? null;

  const najnowszy = tenders
    .map((t) => t?.fetched_at)
    .filter((v) => typeof v === 'string' && v)
    .sort()
    .at(-1) ?? null;

  if (!odniesienie) {
    return {
      pozycje: [],
      // Bez trafień punktem odniesienia jest chwila sprawdzenia — inaczej kolejny
      // przebieg uznałby cały zastany rynek za nowość.
      nowyKursor: { fetched_at: najnowszy ?? teraz },
      pierwszyPrzebieg: true,
    };
  }

  const pozycje = tenders
    .filter((t) => typeof t?.fetched_at === 'string' && t.fetched_at > odniesienie)
    .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));

  return {
    pozycje,
    // Brak nowości NIE cofa punktu odniesienia.
    nowyKursor: { fetched_at: pozycje.length ? pozycje[0].fetched_at : odniesienie },
    pierwszyPrzebieg: false,
  };
}

/**
 * Zmiany, o których warto powiadomić właściciela TEGO wyszukiwania.
 *
 * @param {{zmiany: object[], tenderyById: Map<string, object>, filtry: object,
 *   teraz: string, od: string|null}} we
 * @returns {Array<{zmiana: object, tender: object}>}
 */
export function zmianyDlaWyszukiwania({ zmiany = [], tenderyById, filtry, teraz, od }) {
  const trafienia = [];
  /*
   * Filtry przepuszczamy przez normalizator katalogu, mimo że były znormalizowane
   * przy zapisie. Powód jest konkretny: `pasujeDoFiltrow` rozróżnia `null` (brak
   * filtra) od `undefined`, a wpis zapisany PRZED dodaniem nowego pola filtra ma
   * tam `undefined` — i cicho odrzuciłby wszystko. Ten sam kształt dla starych
   * i nowych wpisów kosztuje jedno wywołanie na wyszukiwanie.
   */
  const pelne = normalizujFiltry(filtry ?? {});

  for (const zmiana of zmiany) {
    if (!TYPY_ISTOTNE.has(zmiana?.typ)) continue;
    if (od && !(zmiana.wykryto_o > od)) continue;

    const tender = tenderyById?.get(zmiana.tenderId);
    // Zmiana ogłoszenia, którego nie mamy w bazie — nie ma czego pokazać.
    if (!tender) continue;

    /*
     * `pasujeDoFiltrow` odrzuca ogłoszenia ANULOWANE i to jest poprawne dla katalogu:
     * nie ma sensu pokazywać na liście czegoś, w czym nie da się wystartować. Ale alert
     * o anulowaniu to DOKŁADNIE ta informacja, po którą użytkownik przyszedł — bez niej
     * dowiedziałby się o unieważnieniu dopiero przygotowując ofertę. Dlatego anulowanie
     * przechodzi obok filtra.
     */
    const przechodzi = zmiana.typ === 'anulowanie'
      ? pasujeDoFiltrow({ ...tender, anulowany: false }, pelne, teraz)
      : pasujeDoFiltrow(tender, pelne, teraz);
    if (!przechodzi) continue;

    trafienia.push({ zmiana, tender });
  }

  return trafienia;
}

/** Deterministyczny klucz alertu — to ON, a nie ostrożność joba, daje idempotencję. */
function klucz(typ, wyszukiwanieId, skladniki) {
  const odcisk = createHash('sha1')
    // Sortujemy: klucz nie może zależeć od kolejności, w jakiej rejestr oddał dane.
    .update([...skladniki].sort().join('\u0000'))
    .digest('base64url')
    .slice(0, 16);
  return `${typ}:${wyszukiwanieId}:${odcisk}`;
}

function odmienPrzetargi(n) {
  const setki = n % 100;
  if (setki >= 12 && setki <= 14) return 'przetargów';
  const jednosci = n % 10;
  if (n === 1) return 'przetarg';
  if (jednosci >= 2 && jednosci <= 4) return 'przetargi';
  return 'przetargów';
}

/** Skrót pozycji do zapisania w alercie — pełnej treści ogłoszenia tu nie duplikujemy. */
function skrot(t) {
  return {
    tender_id: t.id,
    tytul: t.title ?? null,
    organizacja: t.organization ?? null,
    deadline: t.deadline ?? null,
    zrodlo: t.source ?? 'bzp',
  };
}

export function zbudujAlertNowych({ wyszukiwanie, pozycje }) {
  const ile = pozycje.length;
  return {
    klucz: klucz('nowe', wyszukiwanie.id, pozycje.map((t) => t.id)),
    typ: 'nowe_trafienia',
    wyszukiwanie_id: wyszukiwanie.id,
    ton: 'neutral',
    tytul: {
      pl: `${wyszukiwanie.nazwa}: ${ile} ${odmienPrzetargi(ile)}`,
      en: `${wyszukiwanie.nazwa}: ${ile} new tender${ile === 1 ? '' : 's'}`,
    },
    tresc: {
      pl: `W obserwowanym wyszukiwaniu pojawiło się ${ile} ${odmienPrzetargi(ile)}.`,
      en: `${ile} new tender${ile === 1 ? '' : 's'} appeared in your saved search.`,
    },
    // Wymieniamy kilka, ale LICZBA jest pełna — inaczej „5 nowych" przy dwunastu
    // byłoby fałszywym pomiarem rynku.
    liczba: ile,
    pozycje: pozycje.slice(0, MAKS_TRAFIEN_W_ALERCIE).map(skrot),
  };
}

/** Ton alertu = ton NAJPOWAŻNIEJSZEJ zmiany w partii. */
const WAGA_TONU = { danger: 3, ostrzezenie: 2, neutral: 1 };

export function zbudujAlertZmian({ wyszukiwanie, trafienia }) {
  const zmiany = trafienia.map((t) => t.zmiana);
  const ton = zmiany.reduce(
    (naj, z) => ((WAGA_TONU[z.ton] ?? 1) > (WAGA_TONU[naj] ?? 1) ? z.ton : naj),
    'neutral',
  );
  const podsumowanie = podsumujZmiany(zmiany);
  const ile = trafienia.length;

  return {
    klucz: klucz('zmiany', wyszukiwanie.id, zmiany.map((z) => z.id)),
    typ: 'zmiany',
    wyszukiwanie_id: wyszukiwanie.id,
    ton,
    tytul: {
      pl: `${wyszukiwanie.nazwa}: ${podsumowanie.pl}`,
      en: `${wyszukiwanie.nazwa}: ${podsumowanie.en}`,
    },
    tresc: {
      pl: `Zmiany w ${ile} obserwowanym ${ile === 1 ? 'ogłoszeniu' : 'ogłoszeniach'}.`,
      en: `Changes in ${ile} watched notice${ile === 1 ? '' : 's'}.`,
    },
    liczba: ile,
    pozycje: trafienia.slice(0, MAKS_TRAFIEN_W_ALERCIE).map(({ zmiana, tender }) => ({
      ...skrot(tender),
      zmiana_id: zmiana.id,
      zmiana_typ: zmiana.typ,
      zmiana_opis: zmiana.opis ?? null,
    })),
  };
}

/**
 * Treść powiadomienia push.
 *
 * `data` niesie komplet potrzebny aplikacji do nawigacji BEZ dodatkowego zapytania:
 * typ ekranu, wyszukiwanie i klucz alertu (po nim aplikacja odnajdzie wpis w centrum,
 * gdy użytkownik dotknie powiadomienia po godzinach).
 */
export function trescPush(alert, jezyk = 'pl') {
  const wybierz = (para) => para?.[jezyk] ?? para?.pl ?? '';
  return {
    title: wybierz(alert.tytul),
    body: wybierz(alert.tresc),
    data: {
      type: alert.typ,
      wyszukiwanie_id: alert.wyszukiwanie_id ?? '',
      klucz: alert.klucz,
    },
  };
}

/**
 * Od kiedy czytać historię zmian w tym przebiegu.
 *
 * Jeden odczyt dla CAŁEJ partii, a nie per wyszukiwanie: zmiany są wspólne dla
 * wszystkich obserwacji, więc czytanie ich osobno dla każdej z nich mnożyłoby
 * koszt przez liczbę użytkowników bez żadnego zysku.
 *
 * @returns {string|null} null = w tej partii same pierwsze przebiegi, historia niepotrzebna
 */
export function oknoOdczytuZmian(wpisy = [], teraz) {
  const znaczniki = wpisy
    .map((w) => w?.ostatnio_sprawdzone_o)
    .filter((v) => typeof v === 'string' && Number.isFinite(Date.parse(v)));
  if (!znaczniki.length) return null;

  const najstarszy = znaczniki.sort()[0];
  const granica = new Date(Date.parse(teraz) - MAKS_DNI_WSTECZ * 86_400_000).toISOString();
  return najstarszy < granica ? granica : najstarszy;
}
