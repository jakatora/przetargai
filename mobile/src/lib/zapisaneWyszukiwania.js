import { tr } from './jezyk.js';
import { normalizujFiltry } from './katalogPrzetargow.js';

/**
 * ZAPISANE WYSZUKIWANIA (etap 5) — czysta logika ekranu, zero importów z React Native.
 *
 * Ekran ma tylko renderować wynik. Wszystko, co da się rozstrzygnąć bez Reacta —
 * stan formularza, walidacja, opis „co się dzieje z tą obserwacją" — mieszka tutaj
 * i ma test bez renderera.
 *
 * Kolory są SEMANTYCZNE (`ton`): ekran mapuje je na tokeny z motyw.js, żeby cała
 * wiedza o kontraście i o trybie ciemnym została w jednym miejscu.
 */

export const MAKS_DLUGOSC_NAZWY = 60;
export const CZESTOTLIWOSC_DOMYSLNA = 'dzienna';

/**
 * Etykiety na wypadek, gdy słownik z backendu nie dojechał (offline, pierwsze
 * uruchomienie). Ekran bez nich pokazywałby surowy kod częstotliwości — czyli
 * „dzienna" albo, gorzej, nic.
 */
export const CZESTOTLIWOSCI_ZAPASOWE = [
  { kod: 'godzinowa', etykieta: { pl: 'Na bieżąco', en: 'As it happens' } },
  { kod: 'dzienna', etykieta: { pl: 'Raz dziennie', en: 'Once a day' } },
  { kod: 'tygodniowa', etykieta: { pl: 'Raz w tygodniu', en: 'Once a week' } },
];

const GODZINA_MS = 3_600_000;

/**
 * Stan formularza: z ZAPISANEGO wpisu (edycja) albo z bieżących filtrów katalogu
 * (nowa obserwacja). Propozycja nazwy przychodzi z backendu — aplikacja jej nie
 * wymyśla, żeby obie strony nazywały te same filtry tak samo.
 */
export function stanFormularza({ wpis = null, filtry = null, propozycja = null, jezyk = 'pl' } = {}) {
  if (wpis) {
    return {
      nazwa: wpis.nazwa ?? '',
      filtry: normalizujFiltry(wpis.filtry),
      alert_wlaczony: wpis.alert_wlaczony !== false,
      czestotliwosc: wpis.czestotliwosc ?? CZESTOTLIWOSC_DOMYSLNA,
    };
  }
  return {
    nazwa: propozycja ? tr(propozycja, jezyk) : '',
    filtry: normalizujFiltry(filtry),
    alert_wlaczony: true,
    czestotliwosc: CZESTOTLIWOSC_DOMYSLNA,
  };
}

/**
 * Walidacja przed wysłaniem.
 *
 * Za długą nazwę PRZYCINAMY zamiast odrzucać: użytkownik wpisał tekst, którego
 * nie da się zapisać w całości, a odmowa z komunikatem „za długie" kazałaby mu
 * liczyć znaki. Pusta nazwa to jedyny twardy błąd — backend też jej nie przyjmie.
 */
export function walidujFormularz({ nazwa } = {}) {
  const czysta = String(nazwa ?? '').replace(/\s+/g, ' ').trim().slice(0, MAKS_DLUGOSC_NAZWY);
  if (!czysta) {
    return {
      ok: false,
      blad: {
        pl: 'Nadaj wyszukiwaniu nazwę — po niej poznasz je na liście i w powiadomieniu.',
        en: 'Give the search a name — it is how you will recognise it in the list and in notifications.',
      },
    };
  }
  return { ok: true, nazwa: czysta };
}

/** Nazwa częstotliwości: najpierw słownik z backendu, potem zapasowy, nigdy surowy kod. */
export function opisCzestotliwosci(kod, slownik, jezyk = 'pl') {
  const zrodlo = Array.isArray(slownik) && slownik.length ? slownik : CZESTOTLIWOSCI_ZAPASOWE;
  const wpis = zrodlo.find((c) => c.kod === kod)
    ?? zrodlo.find((c) => c.kod === CZESTOTLIWOSC_DOMYSLNA)
    ?? CZESTOTLIWOSCI_ZAPASOWE[1];
  return tr(wpis.etykieta, jezyk);
}

function odmianaGodzin(n) {
  if (n === 1) return 'godzinę';
  const jednosci = n % 10;
  const setki = n % 100;
  if (jednosci >= 2 && jednosci <= 4 && !(setki >= 12 && setki <= 14)) return 'godziny';
  return 'godzin';
}

function odmianaDni(n) {
  if (n === 1) return 'dzień';
  return 'dni';
}

/** „za 2 godziny" / „za 3 dni" — albo null, gdy nie ma czego opisać. */
export function etykietaNastepnego(iso, jezyk = 'pl', terazMs = Date.now()) {
  const czas = Date.parse(iso ?? '');
  if (!Number.isFinite(czas)) return null;

  const zaMs = czas - terazMs;
  if (zaMs <= 0) return tr({ pl: 'przy najbliższym przebiegu', en: 'at the next run' }, jezyk);

  const godziny = Math.round(zaMs / GODZINA_MS);
  if (godziny < 24) {
    return tr({
      pl: `za ${Math.max(1, godziny)} ${odmianaGodzin(Math.max(1, godziny))}`,
      en: `in ${Math.max(1, godziny)} h`,
    }, jezyk);
  }
  const dni = Math.round(godziny / 24);
  return tr({ pl: `za ${dni} ${odmianaDni(dni)}`, en: `in ${dni} day${dni === 1 ? '' : 's'}` }, jezyk);
}

/**
 * Stan JEDNEJ obserwacji w słowach: czy pilnuje, kiedy ostatnio patrzyła, co znalazła.
 *
 * Wyłączony alert MUSI wyglądać jak wyłączony, a nie jak „nic nie znalazł" —
 * to dwie zupełnie różne informacje, a wizualnie łatwo je skleić w jedną szarą linię.
 */
export function opisObserwacji(wpis, jezyk = 'pl', terazMs = Date.now(), slownik = null) {
  if (!wpis || wpis.alert_wlaczony === false) {
    return {
      stan: tr({ pl: 'Alert wyłączony — obserwacja zapisana, ale nie powiadamiamy.', en: 'Alert off — saved, but we will not notify you.' }, jezyk),
      ostatnio: tr({ pl: 'Włącz alert, żeby dostawać powiadomienia.', en: 'Turn the alert on to receive notifications.' }, jezyk),
      ton: 'neutral',
    };
  }

  const stan = opisCzestotliwosci(wpis.czestotliwosc, slownik, jezyk);
  const sprawdzone = Date.parse(wpis.ostatnio_sprawdzone_o ?? '');

  if (!Number.isFinite(sprawdzone)) {
    return {
      stan,
      ostatnio: tr({
        pl: 'Jeszcze nie sprawdzaliśmy — pierwszy przebieg ustawi punkt odniesienia i nie zaleje Cię zastanym rynkiem.',
        en: 'Not checked yet — the first run sets a reference point instead of flooding you with the existing market.',
      }, jezyk),
      ton: 'neutral',
    };
  }

  const godzin = Math.floor((terazMs - sprawdzone) / GODZINA_MS);
  const kiedy = godzin < 1
    ? tr({ pl: 'przed chwilą', en: 'just now' }, jezyk)
    : godzin < 24
      ? tr({ pl: `${godzin} ${odmianaGodzin(godzin)} temu`, en: `${godzin} h ago` }, jezyk)
      : tr({ pl: `${Math.floor(godzin / 24)} ${odmianaDni(Math.floor(godzin / 24))} temu`, en: `${Math.floor(godzin / 24)} d ago` }, jezyk);

  const trafien = wpis.ostatnio_trafien ?? 0;
  return {
    stan,
    ostatnio: trafien > 0
      ? tr({ pl: `Sprawdzone ${kiedy} — ${trafien} nowych trafień.`, en: `Checked ${kiedy} — ${trafien} new hits.` }, jezyk)
      : tr({ pl: `Sprawdzone ${kiedy} — bez nowości.`, en: `Checked ${kiedy} — nothing new.` }, jezyk),
    // „Sukces" znaczy tu: obserwacja żyje i coś przyniosła.
    ton: trafien > 0 ? 'sukces' : 'neutral',
  };
}

/**
 * Nagłówek listy. Pokazuje WYKORZYSTANIE limitu, a nie samą liczbę — limit,
 * o którym użytkownik dowiaduje się dopiero przy odmowie zapisu, jest zasadzką.
 */
export function podsumowanieListy(odpowiedz, jezyk = 'pl') {
  const lista = odpowiedz?.wyszukiwania ?? [];
  const limity = odpowiedz?.limity ?? {};
  const zAlertem = lista.filter((w) => w?.alert_wlaczony === true).length;

  return tr({
    pl: `${lista.length} z ${limity.wyszukiwan ?? 20} zapisanych wyszukiwań · ${zAlertem} z ${limity.alertow ?? 10} z alertem`,
    en: `${lista.length} of ${limity.wyszukiwan ?? 20} saved searches · ${zAlertem} of ${limity.alertow ?? 10} with alerts`,
  }, jezyk);
}
