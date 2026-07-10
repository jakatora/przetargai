/**
 * Ściąga kodów CPV — wbudowany katalog dla ludzi, którzy kodów nie znają.
 *
 * Pełny słownik CPV (rozporządzenie WE 213/2008) ma 9 454 pozycje — dla JDG
 * to szum. Trzymamy WSZYSTKIE 45 działów (żeby żadna branża nie trafiła
 * w pustkę) + ręcznie dobrane, najczęstsze w BZP klasy dla typowych
 * wykonawców. Nazwy są UPROSZCZONE względem urzędowych — liczy się kod.
 *
 * Silnik dopasowań (functions/src/lib/cpv.js) traktuje kody firmy jako
 * prefiksy: zera końcowe to deklaracja szerokości ('45000000' = cała
 * budowlanka), a cyfrę kontrolną odcina. Dlatego katalog podaje gołe
 * 8-cyfrowe kody i może mieszać działy z węższymi klasami — im węższy
 * kod, tym pewniejsze (wyżej punktowane) dopasowanie.
 */

export const KATALOG_CPV = [
  {
    kod: '45000000',
    nazwa: 'Roboty budowlane — wszystkie',
    dzieci: [
      { kod: '45110000', nazwa: 'Rozbiórki i roboty ziemne' },
      { kod: '45210000', nazwa: 'Budowa budynków' },
      { kod: '45230000', nazwa: 'Drogi, rurociągi, sieci — budowa' },
      { kod: '45233140', nazwa: 'Roboty drogowe' },
      { kod: '45260000', nazwa: 'Dachy — pokrycia i konstrukcje' },
      { kod: '45300000', nazwa: 'Instalacje budowlane — wszystkie' },
      { kod: '45310000', nazwa: 'Instalacje elektryczne' },
      { kod: '45330000', nazwa: 'Instalacje wodno-kanalizacyjne i sanitarne' },
      { kod: '45331000', nazwa: 'Ogrzewanie, wentylacja, klimatyzacja' },
      { kod: '45400000', nazwa: 'Wykończenia budynków — wszystkie' },
      { kod: '45410000', nazwa: 'Tynkowanie' },
      { kod: '45420000', nazwa: 'Stolarka budowlana (okna, drzwi), ciesielstwo' },
      { kod: '45430000', nazwa: 'Podłogi i okładziny ścian' },
      { kod: '45440000', nazwa: 'Roboty malarskie i szklarskie' },
      { kod: '45450000', nazwa: 'Pozostałe wykończenia i remonty' },
      { kod: '45500000', nazwa: 'Wynajem maszyn budowlanych z operatorem' },
    ],
  },
  {
    kod: '50000000',
    nazwa: 'Naprawy i konserwacja — wszystkie',
    dzieci: [
      { kod: '50700000', nazwa: 'Konserwacja instalacji w budynkach' },
      { kod: '50110000', nazwa: 'Naprawy pojazdów (warsztat)' },
      { kod: '50800000', nazwa: 'Różne usługi naprawcze' },
    ],
  },
  {
    kod: '90000000',
    nazwa: 'Sprzątanie, odpady, ekologia',
    dzieci: [
      { kod: '90910000', nazwa: 'Usługi sprzątania' },
      { kod: '90911200', nazwa: 'Sprzątanie budynków' },
      { kod: '90620000', nazwa: 'Odśnieżanie' },
      { kod: '90500000', nazwa: 'Wywóz i zagospodarowanie odpadów' },
    ],
  },
  {
    kod: '77000000',
    nazwa: 'Ogrodnictwo, rolnictwo, leśnictwo — usługi',
    dzieci: [
      { kod: '77310000', nazwa: 'Zieleń — sadzenie i utrzymanie' },
      { kod: '77340000', nazwa: 'Przycinanie drzew i żywopłotów' },
      { kod: '77200000', nazwa: 'Usługi leśne' },
    ],
  },
  {
    kod: '60000000',
    nazwa: 'Transport — usługi',
    dzieci: [
      { kod: '60100000', nazwa: 'Transport drogowy' },
      { kod: '60130000', nazwa: 'Przewóz osób (np. dowóz dzieci do szkół)' },
    ],
  },
  {
    kod: '55000000',
    nazwa: 'Gastronomia i hotele — usługi',
    dzieci: [
      { kod: '55300000', nazwa: 'Usługi restauracyjne' },
      { kod: '55520000', nazwa: 'Catering (dostarczanie posiłków)' },
    ],
  },
  {
    kod: '72000000',
    nazwa: 'Usługi informatyczne',
    dzieci: [
      { kod: '72200000', nazwa: 'Programowanie i doradztwo IT' },
      { kod: '72400000', nazwa: 'Usługi internetowe' },
      { kod: '72700000', nazwa: 'Sieci komputerowe' },
    ],
  },
  {
    kod: '71000000',
    nazwa: 'Architektura i inżynieria — usługi',
    dzieci: [
      { kod: '71220000', nazwa: 'Projektowanie architektoniczne' },
      { kod: '71320000', nazwa: 'Projektowanie inżynieryjne' },
      { kod: '71247000', nazwa: 'Nadzór nad robotami budowlanymi' },
      { kod: '71355000', nazwa: 'Usługi geodezyjne' },
    ],
  },
  {
    kod: '79000000',
    nazwa: 'Usługi dla biznesu (prawo, marketing, biuro)',
    dzieci: [
      { kod: '79100000', nazwa: 'Usługi prawnicze' },
      { kod: '79340000', nazwa: 'Reklama i marketing' },
      { kod: '79710000', nazwa: 'Ochrona osób i mienia' },
      { kod: '79800000', nazwa: 'Usługi drukowania' },
      { kod: '79530000', nazwa: 'Tłumaczenia pisemne' },
    ],
  },
  {
    kod: '80000000',
    nazwa: 'Edukacja i szkolenia',
    dzieci: [
      { kod: '80500000', nazwa: 'Usługi szkoleniowe' },
      { kod: '80530000', nazwa: 'Szkolenia zawodowe' },
    ],
  },
  {
    kod: '85000000',
    nazwa: 'Zdrowie i opieka społeczna',
    dzieci: [
      { kod: '85100000', nazwa: 'Usługi ochrony zdrowia' },
      { kod: '85300000', nazwa: 'Opieka społeczna' },
    ],
  },
  {
    kod: '39000000',
    nazwa: 'Meble i wyposażenie — dostawa',
    dzieci: [
      { kod: '39100000', nazwa: 'Meble' },
      { kod: '39130000', nazwa: 'Meble biurowe' },
      { kod: '39160000', nazwa: 'Meble szkolne' },
    ],
  },
  {
    kod: '30000000',
    nazwa: 'Komputery i sprzęt biurowy — dostawa',
    dzieci: [
      { kod: '30200000', nazwa: 'Komputery i urządzenia komputerowe' },
      { kod: '30190000', nazwa: 'Artykuły biurowe' },
    ],
  },
  {
    kod: '15000000',
    nazwa: 'Żywność i napoje — dostawa',
    dzieci: [
      { kod: '15800000', nazwa: 'Różne produkty spożywcze' },
      { kod: '15500000', nazwa: 'Nabiał' },
      { kod: '15810000', nazwa: 'Pieczywo' },
    ],
  },
  {
    kod: '09000000',
    nazwa: 'Paliwa i energia — dostawa',
    dzieci: [
      { kod: '09300000', nazwa: 'Energia elektryczna i cieplna' },
      { kod: '09130000', nazwa: 'Paliwa (benzyna, olej napędowy)' },
    ],
  },
  {
    kod: '34000000',
    nazwa: 'Pojazdy i sprzęt transportowy — dostawa',
    dzieci: [
      { kod: '34110000', nazwa: 'Samochody osobowe' },
      { kod: '34300000', nazwa: 'Części do pojazdów' },
    ],
  },
  {
    kod: '18000000',
    nazwa: 'Odzież i obuwie — dostawa',
    dzieci: [
      { kod: '18100000', nazwa: 'Odzież robocza i BHP' },
    ],
  },
  {
    kod: '33000000',
    nazwa: 'Sprzęt medyczny i leki — dostawa',
    dzieci: [
      { kod: '33600000', nazwa: 'Produkty farmaceutyczne' },
      { kod: '33100000', nazwa: 'Urządzenia medyczne' },
    ],
  },
  {
    kod: '44000000',
    nazwa: 'Materiały budowlane — dostawa',
    dzieci: [
      { kod: '44100000', nazwa: 'Materiały konstrukcyjne' },
    ],
  },
  {
    kod: '48000000',
    nazwa: 'Oprogramowanie — dostawa i licencje',
    dzieci: [],
  },
  {
    kod: '51000000',
    nazwa: 'Montaż i instalowanie urządzeń',
    dzieci: [],
  },
  {
    kod: '64000000',
    nazwa: 'Usługi pocztowe i telekomunikacyjne',
    dzieci: [],
  },
  {
    kod: '66000000',
    nazwa: 'Usługi finansowe i ubezpieczeniowe',
    dzieci: [
      { kod: '66510000', nazwa: 'Ubezpieczenia' },
    ],
  },
  {
    kod: '70000000',
    nazwa: 'Nieruchomości — usługi',
    dzieci: [],
  },
  {
    kod: '92000000',
    nazwa: 'Kultura, sport i rekreacja — usługi',
    dzieci: [],
  },
  {
    kod: '98000000',
    nazwa: 'Inne usługi (pralnia, fryzjer, pogrzebowe)',
    dzieci: [],
  },
  // Działy rzadsze u JDG — bez rozwinięcia, ale obecne, żeby każda branża coś znalazła.
  { kod: '03000000', nazwa: 'Produkty rolnictwa, leśnictwa i rybołówstwa', dzieci: [] },
  { kod: '14000000', nazwa: 'Górnictwo, metale i surowce', dzieci: [] },
  { kod: '16000000', nazwa: 'Maszyny rolnicze', dzieci: [] },
  { kod: '19000000', nazwa: 'Skóra, tkaniny, tworzywa sztuczne', dzieci: [] },
  { kod: '22000000', nazwa: 'Druki i wydawnictwa', dzieci: [] },
  { kod: '24000000', nazwa: 'Produkty chemiczne', dzieci: [] },
  { kod: '31000000', nazwa: 'Maszyny i urządzenia elektryczne', dzieci: [] },
  { kod: '32000000', nazwa: 'Sprzęt radiowy, TV i telekomunikacyjny', dzieci: [] },
  { kod: '35000000', nazwa: 'Sprzęt bezpieczeństwa i ochrony', dzieci: [] },
  { kod: '37000000', nazwa: 'Instrumenty muzyczne, sport, zabawki', dzieci: [] },
  { kod: '38000000', nazwa: 'Sprzęt laboratoryjny i pomiarowy', dzieci: [] },
  { kod: '41000000', nazwa: 'Woda uzdatniona', dzieci: [] },
  { kod: '42000000', nazwa: 'Maszyny przemysłowe', dzieci: [] },
  { kod: '43000000', nazwa: 'Maszyny górnicze i budowlane', dzieci: [] },
  { kod: '63000000', nazwa: 'Usługi wspierające transport, biura podróży', dzieci: [] },
  { kod: '65000000', nazwa: 'Media komunalne (woda, gaz, energia)', dzieci: [] },
  { kod: '73000000', nazwa: 'Badania i rozwój', dzieci: [] },
  { kod: '75000000', nazwa: 'Administracja publiczna i obrona', dzieci: [] },
  { kod: '76000000', nazwa: 'Usługi dla przemysłu naftowego i gazowego', dzieci: [] },
];

/** Zdejmuje polskie znaki (NFD nie rozkłada ł/Ł — mapujemy ręcznie) i obniża litery. */
export function bezOgonkow(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/*
 * Lekki stemmer polskiej fleksji — ta sama logika co w silniku dopasowań
 * (firebase/functions/src/lib/textNorm.js, tam jest pełne uzasadnienie).
 * Duplikat świadomy: aplikacja i functions to osobne pakiety bez wspólnej
 * biblioteki; przy zmianie algorytmu zaktualizować oba pliki.
 */
const KONCOWKI = [
  'iami', 'ymi', 'ich', 'ych', 'ego', 'emu', 'ach', 'ami',
  'ow', 'om', 'em', 'ie', 'ia', 'ej', 'ym',
  'y', 'i', 'a', 'e', 'u', 'o',
];
const MIN_RDZEN = 3;
const MIN_PREFIKS = 4;

function rdzen(slowo) {
  if (!slowo || slowo.length <= MIN_RDZEN) return slowo ?? '';
  for (const koncowka of KONCOWKI) {
    if (slowo.endsWith(koncowka) && slowo.length - koncowka.length >= MIN_RDZEN) {
      return slowo.slice(0, -koncowka.length);
    }
  }
  return slowo;
}

function rdzenie(tekst) {
  return bezOgonkow(tekst).split(/[^a-z0-9]+/).filter(Boolean).map(rdzen);
}

/** Dłuższe rdzenie łapią po prefiksie („sprzatan" ⊂ „sprzatan…"), krótkie wymagają równości. */
function trafiaWRdzenie(rdzenSlowa, rdzenieNazwy) {
  if (rdzenSlowa.length >= MIN_PREFIKS) {
    return rdzenieNazwy.some((r) => r.startsWith(rdzenSlowa) || rdzenSlowa.startsWith(r));
  }
  return rdzenieNazwy.includes(rdzenSlowa);
}

/**
 * Kody z pola tekstowego profilu. Segmenty po przecinku; z każdego bierzemy
 * pierwszy 8-cyfrowy ciąg (obsługuje zapis z cyfrą kontrolną „45310000-3").
 * Bez lookbehind w regexie — Hermes go nie wspiera na starszych Androidach.
 */
export function kodyZTekstu(tekst) {
  const kody = String(tekst ?? '')
    .split(',')
    .map((segment) => (segment.match(/\d{8}/) ?? [])[0])
    .filter(Boolean);
  return [...new Set(kody)];
}

/**
 * Tap w ściądze: dodaje kod do tekstu pola albo usuwa, jeśli już tam jest.
 * Wynik jest znormalizowany do formy „kod, kod" (gubi cyfry kontrolne — celowo,
 * to forma kanoniczna, którą rozumie backend).
 */
export function przelaczKod(tekst, kod) {
  const kody = kodyZTekstu(tekst);
  const bez = kody.filter((k) => k !== kod);
  const nowe = bez.length === kody.length ? [...kody, kod] : bez;
  return nowe.join(', ');
}

/**
 * Wyszukiwanie po nazwie lub prefiksie kodu. Nazwy porównujemy po RDZENIACH
 * słów (jak silnik dopasowań), więc „sprzatanie" trafia w „Usługi sprzątania",
 * a ogonki i wielkość liter nie mają znaczenia.
 * @returns {null | Array<{kod: string, nazwa: string}>}
 *   null = puste zapytanie (pokaż cały katalog); [] = brak trafień.
 */
export function szukajWKatalogu(zapytanie) {
  const q = bezOgonkow(zapytanie).trim();
  if (!q) return null;

  const poKodzie = /^\d{2,}$/.test(q);
  const rdzenieZapytania = poKodzie ? [] : rdzenie(q);

  const wyniki = [];
  for (const dzial of KATALOG_CPV) {
    for (const wpis of [dzial, ...(dzial.dzieci ?? [])]) {
      let trafienie;
      if (poKodzie) {
        trafienie = wpis.kod.startsWith(q);
      } else {
        const nazwa = bezOgonkow(wpis.nazwa);
        // Substring łapie fragmenty w środku słowa; rdzenie — odmiany fleksyjne.
        trafienie = nazwa.includes(q)
          || (rdzenieZapytania.length > 0
            && rdzenieZapytania.every((r) => trafiaWRdzenie(r, rdzenie(wpis.nazwa))));
      }
      if (trafienie) wyniki.push({ kod: wpis.kod, nazwa: wpis.nazwa });
    }
  }
  return wyniki;
}
