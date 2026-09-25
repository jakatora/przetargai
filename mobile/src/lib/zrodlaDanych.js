/**
 * Źródło pierwotne ogłoszenia i świeżość danych (P1-3) — czysta logika.
 *
 * Bez czasu ostatniej synchronizacji „brak nowych przetargów" jest nieodróżnialne
 * od „pobieranie padło trzy dni temu". To są przeciwne decyzje: w pierwszym
 * przypadku czekasz, w drugim idziesz sprawdzić rejestr na własną rękę. Karta
 * musi więc mówić OBIE rzeczy naraz: skąd to jest i jak świeże.
 *
 * Ton („ok" / „uwaga" / „blad" / „neutralny") jest nazwą semantyczną, nie kolorem.
 * Kolory należą do motywu (lib/motyw.js) i tylko ekran je przypisuje.
 */

/**
 * Nazwy rejestrów. Kod = wartość pola `source` z backendu. `rejestr` = strona
 * główna rejestru, ta sama co w backendzie (functions/src/lib/katalogPrzetargow.js
 * ZRODLA) — wyjście awaryjne przycisku „Otwórz oryginał", gdy nie ma linku do
 * konkretnego ogłoszenia.
 */
const NAZWY = {
  bzp: {
    etykieta: { pl: 'BZP', en: 'BZP' },
    pelna: { pl: 'Biuletyn Zamówień Publicznych', en: 'Polish Public Procurement Bulletin' },
    rejestr: 'https://ezamowienia.gov.pl',
  },
  ted: {
    etykieta: { pl: 'TED', en: 'TED' },
    pelna: { pl: 'Dziennik Urzędowy UE (TED)', en: 'EU Official Journal (TED)' },
    rejestr: 'https://ted.europa.eu',
  },
  baza_konkurencyjnosci: {
    etykieta: { pl: 'Baza Konkurencyjności', en: 'Baza Konkurencyjności' },
    pelna: { pl: 'Baza Konkurencyjności (fundusze UE)', en: 'Baza Konkurencyjności (EU funds)' },
    rejestr: 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl',
  },
};

/**
 * Metryczka źródła z SAMEGO kodu — w kształcie, jaki katalog dostaje z backendu
 * (`serialize.metryczkaZrodla`), ale bez znacznika synchronizacji, którego ekran
 * spoza katalogu nie zna. Kalendarz i alerty podają tylko kod (`'ted'`), a ekran
 * ogłoszenia czyta `zrodlo.kod` — bez tej zamiany TED pokazywał się jako „BZP"
 * (2026-09-25). Brak kodu → null (nie zgadujemy rejestru).
 */
export function metryczkaZrodla(kod) {
  if (typeof kod !== 'string' || !kod) return null;
  const opis = NAZWY[kod] ?? null;
  return {
    kod,
    etykieta: opis?.etykieta ?? { pl: kod, en: kod },
    nazwa: opis?.pelna ?? { pl: kod, en: kod },
    rejestr: opis?.rejestr ?? null,
    stan: null,
    zsynchronizowano_o: null,
  };
}

/**
 * Po tylu dobach od ostatniej synchronizacji ostrzegamy, a po tylu alarmujemy.
 * Okna pobierania chodzą co 3 h, więc doba ciszy to już wyraźna anomalia —
 * ale jeden nieudany cykl nie musi znaczyć awarii, stąd próg na dwóch dobach.
 */
const PROG_UWAGI_MS = 2 * 24 * 3_600_000;
const PROG_BLEDU_MS = 7 * 24 * 3_600_000;

const BRAK_ZNACZNIKA = {
  tekst: {
    pl: 'nie wiadomo, kiedy ostatnio pobierano',
    en: 'last sync time unknown',
  },
  ton: 'neutralny',
};

/**
 * Etykieta rejestru. Nieznany kod pokazujemy JAKI JEST — przemianowanie go na
 * „BZP" byłoby przypisaniem ogłoszenia do rejestru, w którym go nie ma.
 * Brak pola to co innego: dane sprzed wprowadzenia wielu źródeł są z BZP.
 */
export function etykietaZrodla(kod) {
  if (!kod) return NAZWY.bzp.etykieta;
  return NAZWY[kod]?.etykieta ?? { pl: kod, en: kod };
}

/** Pełna nazwa rejestru — do szczegółów i ekranu „Zakres danych". */
export function pelnaNazwaZrodla(kod) {
  if (!kod) return NAZWY.bzp.pelna;
  return NAZWY[kod]?.pelna ?? { pl: kod, en: kod };
}

function odmienPl(n, jeden, kilka, wiele) {
  const setki = n % 100;
  if (setki >= 12 && setki <= 14) return wiele;
  const jednosci = n % 10;
  if (n === 1) return jeden;
  if (jednosci >= 2 && jednosci <= 4) return kilka;
  return wiele;
}

/**
 * Zamienia znacznik ISO w „2 godziny temu" i w ton.
 * @param {string|null} znacznik
 * @param {number} teraz milisekundy (wstrzykiwane — moduł nie czyta zegara)
 */
export function opisSynchronizacji(znacznik, teraz = Date.now()) {
  if (!znacznik) return BRAK_ZNACZNIKA;
  const czas = Date.parse(znacznik);
  if (!Number.isFinite(czas)) return BRAK_ZNACZNIKA;

  const wiek = Math.max(0, teraz - czas);
  const ton = wiek >= PROG_BLEDU_MS ? 'blad' : wiek >= PROG_UWAGI_MS ? 'uwaga' : 'ok';

  const minuty = Math.floor(wiek / 60_000);
  if (minuty < 1) return { tekst: { pl: 'przed chwilą', en: 'just now' }, ton };
  if (minuty < 60) {
    return {
      tekst: {
        pl: `${minuty} ${odmienPl(minuty, 'minutę', 'minuty', 'minut')} temu`,
        en: `${minuty} min ago`,
      },
      ton,
    };
  }

  const godziny = Math.floor(minuty / 60);
  if (godziny < 24) {
    return {
      tekst: {
        pl: godziny === 1 ? 'godzinę temu' : `${godziny} ${odmienPl(godziny, 'godzinę', 'godziny', 'godzin')} temu`,
        en: `${godziny} h ago`,
      },
      ton,
    };
  }

  const dni = Math.floor(godziny / 24);
  return {
    tekst: {
      pl: dni === 1 ? 'wczoraj' : `${dni} ${odmienPl(dni, 'dzień', 'dni', 'dni')} temu`,
      en: dni === 1 ? 'yesterday' : `${dni} days ago`,
    },
    ton,
  };
}

/** Stan źródła z backendu → ton semantyczny ekranu. */
export function tonStanu(stan) {
  switch (stan) {
    case 'ok': return 'ok';
    case 'opoznione': return 'uwaga';
    case 'awaria': return 'blad';
    default: return 'neutralny';
  }
}

/**
 * Jedna linijka pod tytułem karty: „BZP · 2 godziny temu".
 * Gdy metryczki nie ma (starsza odpowiedź backendu), podpis nadal ma sens.
 */
export function podpisZrodla(zrodlo, teraz = Date.now()) {
  const etykieta = etykietaZrodla(zrodlo?.kod);
  const sync = opisSynchronizacji(zrodlo?.zsynchronizowano_o ?? null, teraz);
  return {
    tekst: {
      pl: `${etykieta.pl} · ${sync.tekst.pl}`,
      en: `${etykieta.en} · ${sync.tekst.en}`,
    },
    ton: sync.ton,
  };
}

/**
 * Adres oryginału. Priorytet ma link do KONKRETNEGO ogłoszenia; adres rejestru
 * to wyjście awaryjne, gdy rejestr nie dał linku bezpośredniego.
 */
export function linkDoOryginalu(tender) {
  return tender?.url ?? tender?.zrodlo?.rejestr ?? null;
}

/** Etykieta przycisku — nazywa rejestr, żeby było wiadomo, co się otworzy. */
export function etykietaOtwarcia(zrodlo) {
  const e = etykietaZrodla(zrodlo?.kod);
  return { pl: `Otwórz oryginał w ${e.pl}`, en: `Open the original in ${e.en}` };
}

/**
 * Etykieta przycisku dla CAŁEGO ogłoszenia. Ogłoszenie oznaczone jako
 * `zrodloNieznane` (lib/skrotOgloszenia — np. z radaru planów, gdzie backend nie
 * podaje rejestru) dostaje neutralny napis: „Otwórz oryginał w BZP" przy
 * ogłoszeniu z TED byłoby fałszywą atrybucją (2026-09-25).
 */
export function etykietaOtwarciaOgloszenia(tender) {
  if (tender?.zrodloNieznane) return { pl: 'Otwórz oryginał ogłoszenia', en: 'Open the original notice' };
  return etykietaOtwarcia(tender?.zrodlo);
}

/**
 * Ostrzeżenie o stanie źródła — pokazujemy TYLKO wtedy, gdy jest o czym mówić.
 * Plakietka „wszystko działa" przy każdym ogłoszeniu byłaby szumem, który
 * uczy ignorować to miejsce dokładnie wtedy, gdy zacznie mieć znaczenie.
 */
export function ostrzezenieZrodla(zrodlo) {
  const ton = tonStanu(zrodlo?.stan);
  if (ton === 'ok' || ton === 'neutralny') return null;
  const etykieta = zrodlo?.etykieta ?? etykietaZrodla(zrodlo?.kod);
  return {
    ton,
    tekst: ton === 'blad'
      ? {
        pl: `Pobieranie z ${etykieta.pl} zgłasza awarię — nowe ogłoszenia stąd mogą nie docierać.`,
        en: `Fetching from ${etykieta.en} reports a failure — new notices from here may not be arriving.`,
      }
      : {
        pl: `${etykieta.pl} nie odpowiedziało od dłuższego czasu — dane mogą być nieaktualne.`,
        en: `${etykieta.en} has not responded for a while — data may be stale.`,
      },
  };
}
