/**
 * RADAR PLANÓW — czysta logika ekranu (zero React Native, zero sieci, zero hexów).
 *
 * Backend (`GET /radar-planow`) oddaje pozycje planów z TED z rankingiem pod profil
 * i planem przygotowań. Ten moduł zamienia liczby na zdania po polsku/angielsku
 * z poprawną odmianą i daje ekranowi `ton` (klasę koloru), który ekran mapuje
 * na tokeny `motyw.js` — jak Sejf, Czarna skrzynka i karta „Czy warto".
 */

import { tr } from './jezyk.js';

export const TRYBY_RADARU = Object.freeze([
  { wartosc: 'dla_mnie', etykieta: { pl: 'Dla mnie', en: 'For me' } },
  { wartosc: 'wszystkie', etykieta: { pl: 'Wszystkie', en: 'All' } },
]);

const MIESIACE = {
  pl: ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/** Polska odmiana: 1 → forma1, 2–4 (poza 12–14) → forma2, reszta → forma5. */
function odmiana(n, forma1, forma2, forma5) {
  const a = Math.abs(n);
  if (a === 1) return forma1;
  const d = a % 10;
  const s = a % 100;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return forma2;
  return forma5;
}

function miesiacRok(iso, jezyk) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return null;
  const lista = MIESIACE[jezyk === 'en' ? 'en' : 'pl'];
  return `${lista[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Kiedy spodziewać się ogłoszenia. Bieżący miesiąc i przeterminowane są pilne
 * (`ostrzezenie`) — przetarg mógł już wyjść i trzeba to sprawdzić.
 * @returns {{tekst: string, ton: 'ostrzezenie'|'neutral'}}
 */
export function etykietaTerminu(pozycja, jezyk = 'pl') {
  const termin = pozycja?.terminWszczecia ?? null;
  const n = pozycja?.miesiacyDoWszczecia;
  if (!termin || n === null || n === undefined) {
    return {
      tekst: tr({ pl: 'Zamawiający nie podał przewidywanej daty', en: 'The buyer did not state an expected date' }, jezyk),
      ton: 'neutral',
    };
  }
  const kiedy = miesiacRok(termin, jezyk);
  if (n < 0) {
    return {
      tekst: tr({
        pl: `Przewidywany termin minął (${kiedy}) — sprawdź, czy przetarg już ogłoszono`,
        en: `The expected date has passed (${kiedy}) — check whether the tender is out`,
      }, jezyk),
      ton: 'ostrzezenie',
    };
  }
  if (n === 0) {
    return {
      tekst: tr({ pl: `Ogłoszenie spodziewane w tym miesiącu (${kiedy})`, en: `Notice expected this month (${kiedy})` }, jezyk),
      ton: 'ostrzezenie',
    };
  }
  return {
    tekst: tr({
      pl: `Ogłoszenie za ok. ${n} ${odmiana(n, 'miesiąc', 'miesiące', 'miesięcy')} (${kiedy})`,
      en: `Notice in about ${n} month${n === 1 ? '' : 's'} (${kiedy})`,
    }, jezyk),
    ton: n <= 1 ? 'ostrzezenie' : 'neutral',
  };
}

/** Poziom dopasowania → klasa koloru. Brak rankingu (tryb „Wszystkie") nie udaje sukcesu. */
export function tonPoziomu(poziom) {
  if (poziom === 'MOCNE') return 'sukces';
  if (poziom === 'SLABE') return 'ostrzezenie';
  return 'neutral';
}

export function opisPoziomu(poziom, jezyk = 'pl') {
  if (poziom === 'MOCNE') return tr({ pl: 'Mocne dopasowanie', en: 'Strong match' }, jezyk);
  if (poziom === 'SLABE') return tr({ pl: 'Słabe dopasowanie', en: 'Weak match' }, jezyk);
  return null;
}

/**
 * Kamień milowy planu przygotowań → „kiedy" + ton. Minione — `danger`
 * (spóźnione przygotowanie), tydzień i mniej — `ostrzezenie`.
 */
export function opisKamienia(kamien, jezyk = 'pl') {
  const dni = kamien?.dniOdDzis;
  const data = kamien?.data ?? null;
  if (!data || dni === null || dni === undefined) {
    const przed = kamien?.dniPrzed ?? 0;
    return {
      tytul: kamien?.tytul ?? '',
      kiedy: tr({ pl: `${przed} dni przed ogłoszeniem`, en: `${przed} days before the notice` }, jezyk),
      ton: 'neutral',
    };
  }
  let kiedy;
  if (dni < 0) {
    const n = -dni;
    kiedy = tr({ pl: `${n} ${odmiana(n, 'dzień', 'dni', 'dni')} po terminie · ${data}`, en: `${n} day${n === 1 ? '' : 's'} overdue · ${data}` }, jezyk);
  } else if (dni === 0) {
    kiedy = tr({ pl: `dziś · ${data}`, en: `today · ${data}` }, jezyk);
  } else {
    kiedy = tr({ pl: `za ${dni} ${odmiana(dni, 'dzień', 'dni', 'dni')} · ${data}`, en: `in ${dni} day${dni === 1 ? '' : 's'} · ${data}` }, jezyk);
  }
  let ton = 'neutral';
  if (kamien?.minelo || dni < 0) ton = 'danger';
  else if (dni <= 7) ton = 'ostrzezenie';
  return { tytul: kamien?.tytul ?? '', kiedy, ton };
}

/** Ogłoszenie powiązane z planem → nagłówek karty i ton; null, gdy nic nie znaleziono. */
export function opisOgloszenia(ogloszenie, jezyk = 'pl') {
  if (!ogloszenie) return null;
  const pewnosc = tr({ pl: `Pewność dopasowania: ${ogloszenie.pewnosc}%`, en: `Match confidence: ${ogloszenie.pewnosc}%` }, jezyk);
  if (ogloszenie.alarm) {
    return {
      naglowek: tr({ pl: 'To jest to, na co czekałeś — przetarg już ogłoszono', en: 'This is the one you were waiting for — the tender is out' }, jezyk),
      ton: 'sukces',
      pewnosc,
    };
  }
  return {
    naglowek: tr({ pl: 'Możliwe, że przetarg już ogłoszono — sprawdź', en: 'The tender may already be out — check it' }, jezyk),
    ton: 'ostrzezenie',
    pewnosc,
  };
}

export function formatujWartoscPlanu(wartosc, waluta, jezyk = 'pl') {
  if (wartosc === null || wartosc === undefined || !Number.isFinite(Number(wartosc))) {
    return tr({ pl: 'Wartości nie podano', en: 'Value not stated' }, jezyk);
  }
  const grupy = String(Math.round(Number(wartosc))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grupy} ${waluta || 'PLN'}`;
}

/** Jedno zdanie nad listą: ile planów pasuje i z ilu wybrano. */
export function podsumowanieRadaru(dane, jezyk = 'pl') {
  if (!dane) return '';
  const lacznie = dane.lacznie_aktywnych ?? 0;
  if (dane.tryb === 'dla_mnie' && dane.dopasowanych !== null && dane.dopasowanych !== undefined) {
    return tr({
      pl: `${dane.dopasowanych} z ${lacznie} aktywnych planów pasuje do Twojego profilu`,
      en: `${dane.dopasowanych} of ${lacznie} active plans match your profile`,
    }, jezyk);
  }
  return tr({
    pl: `${lacznie} ${odmiana(lacznie, 'aktywny plan', 'aktywne plany', 'aktywnych planów')} zamówień`,
    en: `${lacznie} active procurement plan${lacznie === 1 ? '' : 's'}`,
  }, jezyk);
}
